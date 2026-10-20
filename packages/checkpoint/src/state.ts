import { readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { atomicWriteText } from '@thomas-powers-jr/cadence-core';

/**
 * Checkpoint machine state (phase 331, Arc A Phase 2). The table below is
 * CMD-C's machine from docs/handoffs/HANDOFF-checkpoint-phase-2.md §2:
 *
 *   idle     ──(Stop, usage ≥ threshold)──────────▶ armed
 *   armed    ──(Stop, handoff mtime > armedAt)────▶ written
 *   written  ──(validator pass)───────────────────▶ settled
 *   written  ──(validator fail)───────────────────▶ armed
 *   settled  ──(SessionStart clear|compact)───────▶ reset
 *   reset    ──(injection delivered + consumed)───▶ resumed
 *   resumed  ─────────────────────────────────────▶ idle
 *
 * Phase 2 ships the table and the store only. Every edge is driven by a hook
 * event Phase 3+ will own; nothing outside tests calls `transition` or
 * `transitionStore` yet.
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
 * Pure transition check. Rejects any pair that is not one of the 7 legal
 * edges; `idle -> armed` additionally requires a known reading in `ctx`
 * (missing ctx counts as unknown). Every rejection reason names both states
 * and is a single line.
 */
export function transition(from: CheckpointState, to: CheckpointState, ctx?: TransitionContext): TransitionResult {
  const pair = edgeKey(from, to);
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

export interface MachineStateFile {
  state: CheckpointState;
  since: string;
}

export type MachineStateRead =
  | { ok: true; state: CheckpointState; since: string | null }
  | { ok: false; reason: string };

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
 * Reads the machine state. Only a genuinely missing file (with `.cadence/`
 * and `.cadence/checkpoint/` absent or real directories) means `idle`; any other read
 * failure, unparseable JSON, or a value that is not `{ state, since }` with a
 * known state is refused with a one-line reason — a corrupt store is never
 * silently treated as `idle`.
 */
export function readMachineState(projectDir: string): MachineStateRead {
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
      if (code === 'ENOENT') return { ok: true, state: 'idle', since: null };
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
  return { ok: true, state: record['state'], since: record['since'] };
}

export interface TransitionStoreOptions {
  /** Receives exactly one `reason + '\n'` chunk on any refusal; nothing on success. */
  stderr: { write(chunk: string): unknown };
  ctx?: TransitionContext;
  now?: () => Date;
}

/**
 * Reads the current state, applies `transition`, and on success writes
 * `{ state, since }` through core's `atomicWriteText` (D-BR). On a refusal
 * (illegal edge, unknown reading, or a corrupt store) it writes the reason to
 * `stderr` and leaves the file — and the directory — untouched. Real I/O
 * failures on the write path propagate.
 */
export async function transitionStore(
  projectDir: string,
  to: CheckpointState,
  opts: TransitionStoreOptions,
): Promise<TransitionResult> {
  const current = readMachineState(projectDir);
  if (!current.ok) {
    opts.stderr.write(`${current.reason}\n`);
    return { ok: false, reason: current.reason };
  }

  const result = transition(current.state, to, opts.ctx);
  if (!result.ok) {
    opts.stderr.write(`${result.reason}\n`);
    return result;
  }

  const record: MachineStateFile = { state: result.state, since: (opts.now ?? (() => new Date()))().toISOString() };
  const path = checkpointStatePath(projectDir);
  // atomicWriteText writes a temp sibling then renames; it does not create
  // the parent directory.
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteText(path, `${JSON.stringify(record, null, 2)}\n`);
  return result;
}
