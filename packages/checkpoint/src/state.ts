import { readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { atomicWriteText } from '@thomas-powers-jr/cadence-core';

/**
 * Checkpoint machine state (phase 331, Arc A Phase 2; guarded edges phase
 * 336). The table below is CMD-C's machine from
 * docs/handoffs/HANDOFF-checkpoint-phase-2.md §2, plus phase 336's two
 * guarded edges:
 *
 *   idle     ──(Stop, usage ≥ threshold)──────────────────▶ armed
 *   armed    ──(Stop, handoff mtime > since)──────────────▶ written
 *   written  ──(validator pass)───────────────────────────▶ settled
 *   written  ──(validator fail)───────────────────────────▶ armed
 *   settled  ──(SessionStart startup|clear|compact)───────▶ reset
 *   reset    ──(walked by the SessionStart winner)────────▶ resumed
 *   resumed  ─────────────────────────────────────────────▶ idle
 *
 *   guarded (legal only with the named ctx flag === true):
 *   armed    ──(Stop, block chain hits ceiling; ctx.forced)──────────▶ settled
 *   armed    ──(SessionStart startup|clear|compact; ctx.sessionReset)▶ idle
 *
 * `resume` and `fork` SessionStart sources drive no edge. The hook handlers
 * (stop-gate, session-start) own the events; this module owns the table and
 * the store.
 */
export const CHECKPOINT_STATES = Object.freeze(['idle', 'armed', 'written', 'settled', 'reset', 'resumed'] as const);

export type CheckpointState = (typeof CHECKPOINT_STATES)[number];

export const LEGAL_EDGES: readonly (readonly [CheckpointState, CheckpointState])[] = Object.freeze([
  Object.freeze(['idle', 'armed'] as const),
  Object.freeze(['armed', 'written'] as const),
  Object.freeze(['written', 'settled'] as const),
  Object.freeze(['written', 'armed'] as const),
  Object.freeze(['settled', 'reset'] as const),
  Object.freeze(['reset', 'resumed'] as const),
  Object.freeze(['resumed', 'idle'] as const),
]);

function edgeKey(from: string, to: string): string {
  return `${from} -> ${to}`;
}

const LEGAL_EDGE_KEYS: ReadonlySet<string> = new Set(LEGAL_EDGES.map(([from, to]) => edgeKey(from, to)));

/** The ctx flag that opens a guarded edge. */
export type GuardFlag = 'forced' | 'sessionReset';

export interface GuardedEdge {
  readonly from: CheckpointState;
  readonly to: CheckpointState;
  readonly requires: GuardFlag;
}

/**
 * Phase 336's guarded edges. Deliberately NOT in `LEGAL_EDGES`: without its
 * flag each pair is as illegal as any other non-edge. `armed -> settled`
 * is the Stop-gate's ceiling release (D-CE, dec-20261022-002);
 * `armed -> idle` is a new session discarding a stale `armed` (AC-17).
 */
export const GUARDED_EDGES: readonly GuardedEdge[] = Object.freeze([
  Object.freeze({ from: 'armed', to: 'settled', requires: 'forced' } as const),
  Object.freeze({ from: 'armed', to: 'idle', requires: 'sessionReset' } as const),
]);

function findGuardedEdge(from: CheckpointState, to: CheckpointState): GuardedEdge | undefined {
  return GUARDED_EDGES.find((edge) => edge.from === from && edge.to === to);
}

export function isCheckpointState(value: unknown): value is CheckpointState {
  return typeof value === 'string' && (CHECKPOINT_STATES as readonly string[]).includes(value);
}

/**
 * The one unknown-reading predicate (D-BJ; 0.4a). Unconditional: a
 * `used_percentage` of `null`, absent (`undefined`), or `0` is unknown — 0.4a
 * observed `0` right after `/compact`, where it means "not yet measured", not
 * an empty context. Only a finite number greater than 0 is a known reading.
 * It deliberately takes no machine state: the classification never depends
 * on where the machine is.
 */
export function isUnknownReading(usedPercentage: number | null | undefined): boolean {
  return !(typeof usedPercentage === 'number' && Number.isFinite(usedPercentage) && usedPercentage > 0);
}

/** The slice of a sensor reading the transition table consults. */
export interface TransitionReading {
  used_percentage?: number | null;
}

export interface TransitionContext {
  reading?: TransitionReading;
  /** Opens the guarded `armed -> settled` edge (ceiling release). Only `true` counts. */
  forced?: boolean;
  /** Opens the guarded `armed -> idle` edge (SessionStart reset). Only `true` counts. */
  sessionReset?: boolean;
}

export type TransitionResult = { ok: true; state: CheckpointState } | { ok: false; reason: string };

function describeUnknown(ctx: TransitionContext | undefined): string {
  if (ctx?.reading === undefined) return 'no reading was supplied';
  const value = ctx.reading.used_percentage;
  if (value === undefined) return 'used_percentage is absent';
  if (value === null) return 'used_percentage is null';
  return `used_percentage is ${String(value)}`;
}

/**
 * Pure transition check. Accepts a pair in `LEGAL_EDGES`, or a pair in
 * `GUARDED_EDGES` whose ctx flag is exactly `true`; rejects everything else.
 * `idle -> armed` additionally requires a known reading in `ctx` (missing ctx
 * counts as unknown). The guard flags open only their own edge and never
 * change any other verdict. Every rejection reason names both states and is a
 * single line.
 */
export function transition(from: CheckpointState, to: CheckpointState, ctx?: TransitionContext): TransitionResult {
  const pair = edgeKey(from, to);
  const guarded = findGuardedEdge(from, to);
  if (guarded !== undefined) {
    if (ctx?.[guarded.requires] === true) return { ok: true, state: to };
    return {
      ok: false,
      reason: `checkpoint transition refused: ${pair} is a guarded edge, legal only with ctx.${guarded.requires} === true`,
    };
  }
  if (!LEGAL_EDGE_KEYS.has(pair)) {
    return { ok: false, reason: `checkpoint transition refused: ${pair} is not a legal edge of the checkpoint machine` };
  }
  if (from === 'idle' && to === 'armed' && isUnknownReading(ctx?.reading?.used_percentage)) {
    return {
      ok: false,
      reason: `checkpoint transition refused: ${pair} requires a known reading, got an unknown reading (${describeUnknown(ctx)})`,
    };
  }
  return { ok: true, state: to };
}

// ---------------------------------------------------------------------------
// Impure store: <projectDir>/.cadence/checkpoint/state.json (D-BS).
// ---------------------------------------------------------------------------

/**
 * Optional, additive fields of the machine-state file (phase 336). Each is
 * OMITTED when unset, so a plain transition still writes exactly
 * `{ state, since }`. On disk the keys always appear in this order after
 * `state` and `since`.
 *
 * - `instructed` — the handoff instruction was issued for the current entry
 *   into `armed`. Set only through an explicit patch; every edge drops it.
 * - `blocks` — the consecutive-block chain length of the current armed epoch
 *   (from `idle -> armed` until the machine leaves `armed`/`written` for
 *   `settled` or `idle`). Set only through an explicit patch; carried across
 *   `armed <-> written`.
 * - `forced`, `forcedAt` — the latest settle was a ceiling release. Written
 *   only by the guarded `armed -> settled` edge; never patchable.
 * - `lastForcedAt` — sticky (D-CE, dec-20261022-002): written by the forced
 *   edge, then carried by every later edge and update; nothing clears it.
 */
export interface MachineStateExtras {
  instructed?: boolean;
  blocks?: number;
  forced?: true;
  forcedAt?: string;
  lastForcedAt?: string;
}

/**
 * The explicit per-call patch. Only the epoch fields are patchable; a key
 * that is present sets the field (`null` clears it), an absent key leaves the
 * carried value. `blocks` must be a non-negative integer.
 */
export interface MachineStateExtrasPatch {
  instructed?: boolean | null;
  blocks?: number | null;
}

export interface MachineStateFile extends MachineStateExtras {
  state: CheckpointState;
  since: string;
}

export interface MachineStateReadOk extends MachineStateExtras {
  ok: true;
  state: CheckpointState;
  since: string | null;
}

export type MachineStateRead = MachineStateReadOk | { ok: false; reason: string };

export function checkpointStatePath(projectDir: string): string {
  return join(projectDir, '.cadence', 'checkpoint', 'state.json');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * ENOENT on state.json is not proof the store is empty: on win32,
 * `readFileSync` reports ENOENT (not POSIX's ENOTDIR) when `.cadence` or
 * `.cadence/checkpoint` is a regular file. Walk that chain; an ancestor that
 * exists but is not a directory (or cannot be stat-ed for any reason other
 * than being absent) is a corrupt store. Returns the one-line refusal reason,
 * or null when the chain is absent or made of real directories.
 */
function findNonDirectoryAncestor(projectDir: string): string | null {
  for (const dir of [join(projectDir, '.cadence'), join(projectDir, '.cadence', 'checkpoint')]) {
    let isDirectory: boolean;
    try {
      isDirectory = statSync(dir).isDirectory();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      return `checkpoint state refused: cannot stat ${dir} (${oneLine(code ?? (err as Error).message)})`;
    }
    if (!isDirectory) return `checkpoint state refused: ${dir} exists but is not a directory`;
  }
  return null;
}

/**
 * The strict ISO-8601 shape core's settle-side reader accepts for
 * `lastForcedAt` (copied from `ISO_DATETIME_RE` in
 * packages/core/src/services/settle.ts, deliberately not imported), so the
 * store and settle agree on what a timestamp is.
 */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATETIME_RE.test(value) && Number.isFinite(Date.parse(value));
}

function isBlockCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** The well-typed extras of a parsed record; anything ill-typed is dropped. */
function readExtras(record: Record<string, unknown>): MachineStateExtras {
  const instructed = record['instructed'];
  const blocks = record['blocks'];
  const forcedAt = record['forcedAt'];
  const lastForcedAt = record['lastForcedAt'];
  return {
    ...(typeof instructed === 'boolean' ? { instructed } : {}),
    ...(isBlockCount(blocks) ? { blocks } : {}),
    ...(record['forced'] === true ? { forced: true as const } : {}),
    ...(isTimestamp(forcedAt) ? { forcedAt } : {}),
    ...(isTimestamp(lastForcedAt) ? { lastForcedAt } : {}),
  };
}

/**
 * A store read as the writers see it: the public read, plus a refusal when
 * the raw record carries a `lastForcedAt` key that fails the type check.
 * Reading drops such a value; writing would erase the force-release record
 * with no notice, so both writers refuse instead (refuse + suggest).
 */
type StoreRead = { ok: false; reason: string } | { ok: true; value: MachineStateReadOk; stickyRefusal: string | null };

/**
 * Reads the machine state. Only a genuinely missing file (with `.cadence/`
 * and `.cadence/checkpoint/` absent or real directories) means `idle`; any other read
 * failure, unparseable JSON, or a value that is not `{ state, since }` with a
 * known state is refused with a one-line reason — a corrupt store is never
 * silently treated as `idle`. The optional extras are returned when
 * well-typed; an ill-typed extra is dropped, never a refusal (though the
 * writers refuse to overwrite an ill-typed `lastForcedAt`).
 */
export function readMachineState(projectDir: string): MachineStateRead {
  const read = readStore(projectDir);
  return read.ok ? read.value : read;
}

function readStore(projectDir: string): StoreRead {
  const path = checkpointStatePath(projectDir);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // A regular file where `.cadence/` or `.cadence/checkpoint/` should be
    // surfaces as ENOENT on win32 but ENOTDIR on POSIX; route both through the
    // same ancestor check so the refusal reads the same on every OS. Only
    // ENOENT with a clean ancestor chain is a genuinely missing file (idle).
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      const blocked = findNonDirectoryAncestor(projectDir);
      if (blocked !== null) return { ok: false, reason: blocked };
      if (code === 'ENOENT') return { ok: true, value: { ok: true, state: 'idle', since: null }, stickyRefusal: null };
    }
    return {
      ok: false,
      reason: `checkpoint state refused: cannot read ${path} (${oneLine(code ?? (err as Error).message)})`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      reason: `checkpoint state refused: ${path} is not valid JSON (${oneLine((err as Error).message)})`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: `checkpoint state refused: ${path} is not a JSON object` };
  }
  const record = parsed as Record<string, unknown>;
  if (!isCheckpointState(record['state'])) {
    return {
      ok: false,
      reason: `checkpoint state refused: ${path} has no known state (expected one of ${CHECKPOINT_STATES.join(', ')})`,
    };
  }
  if (typeof record['since'] !== 'string') {
    return { ok: false, reason: `checkpoint state refused: ${path} has no string "since" timestamp` };
  }
  const stickyRefusal =
    'lastForcedAt' in record && !isTimestamp(record['lastForcedAt'])
      ? `checkpoint state refused: ${path} has an invalid "lastForcedAt" (expected an ISO-8601 timestamp); ` +
        'fix or remove that key by hand, the store will not erase a force-release record'
      : null;
  return {
    ok: true,
    value: { ok: true, state: record['state'], since: record['since'], ...readExtras(record) },
    stickyRefusal,
  };
}

/**
 * The store-level guard on the ctx flags: a flag passed on any edge but its
 * own is refused, so a forced settle can never silently skip the force
 * record (e.g. `written -> settled` with `ctx.forced`). The pure `transition`
 * table is unchanged — there a flag simply opens nothing else.
 */
function flagMisuse(from: CheckpointState, to: CheckpointState, ctx: TransitionContext | undefined): string | null {
  for (const edge of GUARDED_EDGES) {
    if (ctx?.[edge.requires] === true && !(edge.from === from && edge.to === to)) {
      return `checkpoint transition refused: ctx.${edge.requires} belongs only to ${edgeKey(edge.from, edge.to)}, not ${edgeKey(from, to)}`;
    }
  }
  return null;
}

/** A non-empty patch may only target an armed-epoch state (`armed` or `written`). */
function patchTargetRefusal(target: CheckpointState, patch: MachineStateExtrasPatch | undefined): string | null {
  if (patch === undefined) return null;
  const nonEmpty = patch.instructed !== undefined || patch.blocks !== undefined;
  if (!nonEmpty || target === 'armed' || target === 'written') return null;
  return `checkpoint state refused: an extras patch (instructed/blocks) applies only to armed or written, not ${target}`;
}

/** Returns a one-line refusal for an ill-typed patch value, or null. */
function checkPatch(patch: MachineStateExtrasPatch | undefined): string | null {
  if (patch === undefined) return null;
  const { instructed, blocks } = patch as Record<string, unknown>;
  if (instructed !== undefined && instructed !== null && typeof instructed !== 'boolean') {
    return 'checkpoint state refused: extras patch "instructed" must be a boolean or null';
  }
  if (blocks !== undefined && blocks !== null && !isBlockCount(blocks)) {
    return 'checkpoint state refused: extras patch "blocks" must be a non-negative integer or null';
  }
  return null;
}

type EpochExtras = Pick<MachineStateExtras, 'instructed' | 'blocks'>;

function epochOf(extras: MachineStateExtras): EpochExtras {
  return {
    ...(extras.instructed !== undefined ? { instructed: extras.instructed } : {}),
    ...(extras.blocks !== undefined ? { blocks: extras.blocks } : {}),
  };
}

/**
 * Applies a patch over the carried epoch fields. Reads only `instructed` and
 * `blocks` from the patch, so no patch — even a mistyped one — can touch
 * `forced`, `forcedAt` or `lastForcedAt`.
 */
function applyPatch(carried: EpochExtras, patch: MachineStateExtrasPatch | undefined): EpochExtras {
  let instructed = carried.instructed;
  let blocks = carried.blocks;
  if (patch?.instructed !== undefined) instructed = patch.instructed ?? undefined;
  if (patch?.blocks !== undefined) blocks = patch.blocks ?? undefined;
  return {
    ...(instructed !== undefined ? { instructed } : {}),
    ...(blocks !== undefined ? { blocks } : {}),
  };
}

/** Serializes a record with the fixed key order: state, since, then the extras. */
function serializeRecord(record: MachineStateFile): string {
  const ordered: MachineStateFile = {
    state: record.state,
    since: record.since,
    ...(record.instructed !== undefined ? { instructed: record.instructed } : {}),
    ...(record.blocks !== undefined ? { blocks: record.blocks } : {}),
    ...(record.forced !== undefined ? { forced: record.forced } : {}),
    ...(record.forcedAt !== undefined ? { forcedAt: record.forcedAt } : {}),
    ...(record.lastForcedAt !== undefined ? { lastForcedAt: record.lastForcedAt } : {}),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * The carry rules of an accepted edge (pure). With `sinceIso` the new
 * record's `since`:
 *
 * - `lastForcedAt` — every edge carries it; the forced edge sets it to
 *   `sinceIso`. No edge clears it.
 * - `forced`, `forcedAt` — set (to `true`, `sinceIso`) only by the guarded
 *   `armed -> settled` edge; every other edge drops them, so the
 *   SessionStart walk out of `settled` clears them.
 * - `blocks` — carried only across `armed -> written` and `written -> armed`
 *   (the block chain spans the validator round trip, or an agent writing an
 *   invalid doc every turn would never reach the ceiling); dropped on every
 *   other edge, so `idle -> armed` starts a fresh chain and
 *   `written -> settled`, the forced `armed -> settled` and the reset
 *   `armed -> idle` end it.
 * - `instructed` — dropped on every edge: it describes the current entry
 *   into `armed`, and `written -> armed` is a new entry. Only a patch (or
 *   `updateStoreExtras`) sets it.
 * - The patch is applied last, on every edge, and always wins for
 *   `instructed`/`blocks`.
 */
function nextRecord(
  current: MachineStateReadOk,
  to: CheckpointState,
  sinceIso: string,
  patch: MachineStateExtrasPatch | undefined,
): MachineStateFile {
  const from = current.state;
  const forcedEdge = from === 'armed' && to === 'settled';
  const epochCarries = (from === 'armed' && to === 'written') || (from === 'written' && to === 'armed');
  const carried: EpochExtras = epochCarries && current.blocks !== undefined ? { blocks: current.blocks } : {};
  const lastForcedAt = forcedEdge ? sinceIso : current.lastForcedAt;
  return {
    state: to,
    since: sinceIso,
    ...applyPatch(carried, patch),
    ...(forcedEdge ? { forced: true as const, forcedAt: sinceIso } : {}),
    ...(lastForcedAt !== undefined ? { lastForcedAt } : {}),
  };
}

async function writeRecord(projectDir: string, record: MachineStateFile): Promise<void> {
  const path = checkpointStatePath(projectDir);
  // atomicWriteText writes a temp sibling then renames; it does not create
  // the parent directory.
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteText(path, serializeRecord(record));
}

export interface TransitionStoreOptions {
  /** Receives exactly one `reason + '\n'` chunk on any refusal; nothing on success. */
  stderr: { write(chunk: string): unknown };
  ctx?: TransitionContext;
  now?: () => Date;
  /**
   * Explicit patch of the armed-epoch extras for the new record, applied
   * after the edge's carry rules (see `nextRecord`). Omit for a plain edge.
   */
  extras?: MachineStateExtrasPatch;
}

/**
 * Reads the current state, applies `transition`, and on success writes the
 * new record through core's `atomicWriteText` (D-BR): `{ state, since }`
 * plus whichever extras the edge's carry rules and `opts.extras` leave set.
 * Refuses — reason to `stderr` as one line, file and directory untouched —
 * on: a corrupt store; an ill-typed `lastForcedAt` on disk (which the write
 * would erase); a ctx guard flag passed on any edge but its own; an illegal
 * edge or unknown reading; an ill-typed patch; or a non-empty patch whose
 * target is neither `armed` nor `written`. Real I/O failures on the write
 * path propagate.
 */
export async function transitionStore(
  projectDir: string,
  to: CheckpointState,
  opts: TransitionStoreOptions,
): Promise<TransitionResult> {
  const refuse = (reason: string): TransitionResult => {
    opts.stderr.write(`${reason}\n`);
    return { ok: false, reason };
  };

  const read = readStore(projectDir);
  if (!read.ok) return refuse(read.reason);
  if (read.stickyRefusal !== null) return refuse(read.stickyRefusal);
  const current = read.value;

  const misuse = flagMisuse(current.state, to, opts.ctx);
  if (misuse !== null) return refuse(misuse);

  const result = transition(current.state, to, opts.ctx);
  if (!result.ok) return refuse(result.reason);

  const badPatch = checkPatch(opts.extras) ?? patchTargetRefusal(result.state, opts.extras);
  if (badPatch !== null) return refuse(badPatch);

  const sinceIso = (opts.now ?? (() => new Date()))().toISOString();
  await writeRecord(projectDir, nextRecord(current, result.state, sinceIso, opts.extras));
  return result;
}

export interface UpdateStoreExtrasOptions {
  /** Receives exactly one `reason + '\n'` chunk on any refusal; nothing on success. */
  stderr: { write(chunk: string): unknown };
  /** The state the caller believes the store is in; any other on-disk state is refused. */
  expectedState: CheckpointState;
  /**
   * The `since` the caller read. When given, any other on-disk `since` is
   * refused — it narrows the lost-update window between a hook's read and
   * its same-state write.
   */
  expectedSince?: string;
}

/**
 * A same-state write: applies `patch` to the epoch extras without changing
 * `state` or `since` (e.g. recording "instruction issued" or the block chain
 * while staying `armed`). Every other extra, `lastForcedAt` included, is kept
 * as read. Refuses — one stderr line, nothing written — when the store is
 * corrupt, when its `lastForcedAt` is ill-typed, when there is no state file
 * yet (there is no `since` to keep), when the on-disk state is not
 * `expectedState` or its `since` is not `expectedSince` (when given), when
 * the patch is ill-typed, or when a non-empty patch targets a state other
 * than `armed`/`written`. Writes through `atomicWriteText`; real I/O
 * failures propagate.
 */
export async function updateStoreExtras(
  projectDir: string,
  patch: MachineStateExtrasPatch,
  opts: UpdateStoreExtrasOptions,
): Promise<TransitionResult> {
  const refuse = (reason: string): TransitionResult => {
    opts.stderr.write(`${reason}\n`);
    return { ok: false, reason };
  };

  const read = readStore(projectDir);
  if (!read.ok) return refuse(read.reason);
  if (read.stickyRefusal !== null) return refuse(read.stickyRefusal);
  const current = read.value;
  if (current.since === null) {
    return refuse(
      `checkpoint state refused: cannot update extras, ${checkpointStatePath(projectDir)} does not exist yet`,
    );
  }
  if (current.state !== opts.expectedState) {
    return refuse(
      `checkpoint state refused: cannot update extras, store is ${current.state} but the caller expected ${opts.expectedState}`,
    );
  }
  if (opts.expectedSince !== undefined && current.since !== opts.expectedSince) {
    return refuse(
      `checkpoint state refused: cannot update extras, store since is ${current.since} but the caller expected ${opts.expectedSince}`,
    );
  }
  const badPatch = checkPatch(patch) ?? patchTargetRefusal(current.state, patch);
  if (badPatch !== null) return refuse(badPatch);

  await writeRecord(projectDir, {
    state: current.state,
    since: current.since,
    ...applyPatch(epochOf(current), patch),
    ...(current.forced !== undefined ? { forced: current.forced } : {}),
    ...(current.forcedAt !== undefined ? { forcedAt: current.forcedAt } : {}),
    ...(current.lastForcedAt !== undefined ? { lastForcedAt: current.lastForcedAt } : {}),
  });
  return { ok: true, state: current.state };
}
