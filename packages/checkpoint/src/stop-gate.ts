import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { findUnfilledSections } from '@thomas-powers-jr/cadence-core';
import {
  checkpointReadingPath,
  defaultExcludedCadenceDirs,
  defaultProjectMarker,
  resolveProjectDir,
} from './sensor.js';
import type { CheckpointReading } from './sensor.js';
import { isUnknownReading, readMachineState, transitionStore, updateStoreExtras } from './state.js';
import type { CheckpointState, MachineStateExtrasPatch, TransitionContext, TransitionResult } from './state.js';
import type { DiagnosticCode } from './types.js';
import { HANDOFF_SCHEMAS, declaredHandoffVersion, validate } from './validate.js';

/**
 * Checkpoint Stop gate (phase 336, Arc A Phase 3).
 *
 * The first half of this file is the PURE decision (`decideStop`). The
 * second half is the impure shell (`runStopGate`, the `checkpoint stop-gate`
 * command): it gathers the facts — the machine state, `reading.json` by
 * exact name, the newest `SESSION-*.md` whose mtime is after `since` decoded
 * once as strict UTF-8 — calls `decideStop`, executes `plan.ops` in order
 * (each op maps 1:1 to one `transitionStore` / `updateStoreExtras` call), and
 * prints `plan.stdout` only when every op succeeded. The store is always
 * written before stdout.
 */

// ---------------------------------------------------------------------------
// Facts, options, plan.
// ---------------------------------------------------------------------------

/** The slice of a machine-state read the gate consults. */
export interface StopMachine {
  state: CheckpointState;
  /** `null` only for a store that does not exist yet (which reads as `idle`). */
  since: string | null;
  instructed?: boolean;
  blocks?: number;
}

export interface StopFacts {
  machine: StopMachine;
  /** The parsed `reading.json`, or `null` when absent or unreadable. */
  reading: CheckpointReading | null;
  /**
   * The newest SESSION doc whose mtime is after `machine.since`, already
   * decoded (strict UTF-8, BOM stripped), or `null` when there is none.
   */
  handoffDoc: string | null;
  /** The Stop payload's `stop_hook_active`. */
  stopHookActive: boolean;
  /** The clock the reading's age is measured against. */
  now: Date;
}

export interface StopOptions {
  /** Block at or above this effective context-usage percentage. */
  threshold: number;
  /** The consecutive-block chain length at which the gate releases instead of blocking. */
  ceiling: number;
  /** A reading whose `ts` is more than this many seconds before `now` is absent. */
  maxReadingAgeS: number;
}

/** One `transitionStore(projectDir, to, { ctx, extras })` call. `from` is informational. */
export interface TransitionOp {
  kind: 'transition';
  from: CheckpointState;
  to: CheckpointState;
  ctx?: TransitionContext;
  extras?: MachineStateExtrasPatch;
}

/** One `updateStoreExtras(projectDir, patch, { expectedState, expectedSince })` call. */
export interface UpdateExtrasOp {
  kind: 'update-extras';
  patch: MachineStateExtrasPatch;
  expectedState: CheckpointState;
  expectedSince?: string;
}

export type StoreOp = TransitionOp | UpdateExtrasOp;

export interface StopBlock {
  decision: 'block';
  reason: string;
}

export interface StopRelease {
  systemMessage: string;
}

export type StopStdout = StopBlock | StopRelease;

export interface StopPlan {
  /** Executed in order; stop at the first refusal and print nothing. */
  ops: StoreOp[];
  /** The exact JSON object to print, or `null` for empty stdout. */
  stdout: StopStdout | null;
  /** One stderr notice line (no trailing newline), or `null`. */
  stderr: string | null;
}

/** A finding about the candidate handoff doc: the validator's codes plus the gate's own two. */
export type StopGateDiagnosticCode = DiagnosticCode | 'version-downgrade' | 'unfilled-section';

export interface StopGateDiagnostic {
  code: StopGateDiagnosticCode;
  message: string;
}

/** The lowest `cadence_handoff` version a gate-instructed doc may declare (AC-5). */
export const MIN_GATE_HANDOFF_VERSION = 2;

// ---------------------------------------------------------------------------
// The effective percentage and the stale bound.
// ---------------------------------------------------------------------------

function isCount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * The effective context usage (D-BJ, dec-20261013-001), or `null` when the
 * reading is unknown. A known `used_percentage` (finite, > 0) wins. Only when
 * `used_percentage` is null or absent is the percentage computed from
 * `absolute.current_usage` with Claude Code's input-only formula,
 * `(input_tokens + cache_creation_input_tokens + cache_read_input_tokens) /
 * context_window_size x 100`; `output_tokens` never counts. A
 * `used_percentage` of 0 (post-/compact) or any other non-null unknown value
 * NEVER falls back: the stale `current_usage` beside it must not block. A
 * missing component, a missing or non-positive window, or a computed 0 is
 * unknown too — nothing is coerced to 0.
 */
export function effectivePercentage(reading: Pick<CheckpointReading, 'used_percentage' | 'absolute'>): number | null {
  const used = reading.used_percentage as number | null | undefined;
  if (!isUnknownReading(used)) return used as number;
  if (used !== null && used !== undefined) return null;

  const usage = reading.absolute?.current_usage ?? null;
  const window = reading.absolute?.context_window_size ?? null;
  if (usage === null || !(typeof window === 'number' && Number.isFinite(window) && window > 0)) return null;
  const parts = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens];
  if (!parts.every(isCount)) return null;
  const percent = ((parts as number[]).reduce((sum, n) => sum + n, 0) / window) * 100;
  return isUnknownReading(percent) ? null : percent;
}

/** How far ahead of `now` a reading's `ts` may be (clock skew) before it is absent. */
export const MAX_READING_FUTURE_SKEW_S = 5;

/**
 * True when the reading counts for `idle` (AC-13): its `ts` parses, is at
 * most `maxReadingAgeS` before `now`, at most `MAX_READING_FUTURE_SKEW_S`
 * after it, and not earlier than the machine's `since`. The last bound makes
 * a reading taken before the last reset/settle (a pre-`/clear` reading)
 * absent, so it never re-blocks a fresh session. A null or unparseable
 * `since` imposes no lower bound.
 */
function isFresh(reading: CheckpointReading, now: Date, maxReadingAgeS: number, since: string | null): boolean {
  const taken = Date.parse(reading.ts);
  if (!Number.isFinite(taken)) return false;
  const ageS = (now.getTime() - taken) / 1000;
  if (ageS > maxReadingAgeS || ageS < -MAX_READING_FUTURE_SKEW_S) return false;
  const floor = since === null ? Number.NaN : Date.parse(since);
  return !(Number.isFinite(floor) && taken < floor);
}

// ---------------------------------------------------------------------------
// The candidate doc check.
// ---------------------------------------------------------------------------

/**
 * Everything wrong with a candidate handoff doc, in order: the validator's
 * diagnostics, a schema downgrade below `MIN_GATE_HANDOFF_VERSION`, and each
 * section core's `findUnfilledSections` still reports. Empty means it passes.
 * The version is read through validate.ts's own `declaredHandoffVersion`, so
 * the two can never disagree; `version-downgrade` fires only for a SUPPORTED
 * version below the minimum, and an unsupported one is left to the
 * validator's `HANDOFF_VERSION_UNSUPPORTED`.
 */
export function checkHandoffDoc(text: string): StopGateDiagnostic[] {
  const diagnostics: StopGateDiagnostic[] = validate(text).diagnostics.map((d) => ({
    code: d.code,
    message: d.message,
  }));
  const version = declaredHandoffVersion(text);
  if (HANDOFF_SCHEMAS.has(version) && /^\d+$/.test(version) && Number(version) < MIN_GATE_HANDOFF_VERSION) {
    diagnostics.push({
      code: 'version-downgrade',
      message:
        `the doc declares cadence_handoff: ${version}; a gate-instructed handoff must declare ` +
        `cadence_handoff: ${MIN_GATE_HANDOFF_VERSION} or later`,
    });
  }
  for (const section of findUnfilledSections(text)) {
    diagnostics.push({ code: 'unfilled-section', message: `"${section}" still holds a FILL IN marker` });
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------
// Messages: plain ASCII, one paragraph.
// ---------------------------------------------------------------------------

/** Collapses whitespace and maps every non-printable-ASCII character to `?`. */
function plainAscii(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?')
    .trim();
}

function formatPercent(value: number): string {
  return String(Number(value.toFixed(2)));
}

const INSTRUCTION =
  'Before you stop, run `cadence handoff` to scaffold a SESSION handoff doc under .cadence/handoff/, then fill ' +
  'every section: replace each FILL IN marker with narrative, and write None under Open decisions if there are ' +
  'none. Keep `cadence_handoff: 2` in its frontmatter and set nothing below `cadence_handoff: 2`. Then stop again ' +
  'so the gate can check the doc.';

function thresholdReason(effective: number, threshold: number): string {
  return `checkpoint: context usage is ${formatPercent(effective)}% (threshold ${formatPercent(threshold)}%). ${INSTRUCTION}`;
}

function armedReason(): string {
  return `checkpoint: the context checkpoint is armed and no handoff doc newer than the arming was found. ${INSTRUCTION}`;
}

function invalidDocReason(diagnostics: readonly StopGateDiagnostic[]): string {
  const findings = diagnostics.map((d) => `[${d.code}] ${d.message}`).join('; ');
  return plainAscii(
    `checkpoint: the newest handoff doc does not pass the checkpoint gate: ${findings}. Fix that doc (or run ` +
      '`cadence handoff` for a fresh scaffold), fill every section, set nothing below `cadence_handoff: 2`, then ' +
      'stop again.',
  );
}

function releaseMessage(ceiling: number): string {
  return (
    `checkpoint: released this stop at the block ceiling of ${ceiling} consecutive blocks without a valid ` +
    'handoff doc. A force-release is recorded in .cadence/checkpoint/state.json (forced, forcedAt, ' +
    'lastForcedAt), and settle reports it as a checkpoint-stop ceiling-release bypass. Write the handoff with ' +
    '`cadence handoff` before ending the session.'
  );
}

function inertNotice(state: CheckpointState): string {
  return (
    `checkpoint stop-gate: state is ${state}, a leftover from an interrupted run; the gate takes no action. ` +
    'The next SessionStart (startup, clear or compact) walks it back to idle.'
  );
}

// ---------------------------------------------------------------------------
// The decision.
// ---------------------------------------------------------------------------

function nothing(): StopPlan {
  return { ops: [], stdout: null, stderr: null };
}

/**
 * The armed-state outcome when the gate would block. `next` is the chain
 * length this block would make; at the ceiling (with `stop_hook_active`) the
 * gate releases instead, deciding in memory from `armed` — the release never
 * visits `written`, because the store refuses `written -> settled` with
 * `ctx.forced`.
 */
function blockOrRelease(
  facts: StopFacts,
  options: StopOptions,
  next: number,
  block: { ops: StoreOp[]; reason: string },
): StopPlan {
  if (facts.stopHookActive && next >= options.ceiling) {
    return {
      ops: [{ kind: 'transition', from: 'armed', to: 'settled', ctx: { forced: true } }],
      stdout: { systemMessage: releaseMessage(options.ceiling) },
      stderr: null,
    };
  }
  return { ops: block.ops, stdout: { decision: 'block', reason: block.reason }, stderr: null };
}

function decideIdle(facts: StopFacts, options: StopOptions): StopPlan {
  if (facts.reading === null || !isFresh(facts.reading, facts.now, options.maxReadingAgeS, facts.machine.since)) {
    return nothing();
  }
  const effective = effectivePercentage(facts.reading);
  if (effective === null || effective < options.threshold) return nothing();
  // The block printed here is the instruction for this entry into armed. The
  // effective percentage goes into the ctx so the store's own known-reading
  // guard holds on the fallback path, where the raw value is null.
  return {
    ops: [
      {
        kind: 'transition',
        from: 'idle',
        to: 'armed',
        ctx: { reading: { used_percentage: effective } },
        extras: { instructed: true, blocks: 1 },
      },
    ],
    stdout: { decision: 'block', reason: thresholdReason(effective, options.threshold) },
    stderr: null,
  };
}

function decideArmed(facts: StopFacts, options: StopOptions): StopPlan {
  const { machine } = facts;
  // A Stop with stop_hook_active false is a fresh turn: it starts a new chain.
  const next = facts.stopHookActive ? (machine.blocks ?? 0) + 1 : 1;

  const expectedSince = machine.since !== null ? { expectedSince: machine.since } : {};

  if (facts.handoffDoc === null) {
    // CMD-D: one instruction per entry into armed, never per turn.
    if (machine.instructed === true) {
      // A silent pass on a fresh turn breaks the run of consecutive gate
      // blocks, so the chain counts only blocks that follow one another.
      if (!facts.stopHookActive && (machine.blocks ?? 0) > 0) {
        return {
          ops: [{ kind: 'update-extras', patch: { blocks: null }, expectedState: 'armed', ...expectedSince }],
          stdout: null,
          stderr: null,
        };
      }
      return nothing();
    }
    return blockOrRelease(facts, options, next, {
      ops: [
        {
          kind: 'update-extras',
          patch: { instructed: true, blocks: next },
          expectedState: 'armed',
          ...expectedSince,
        },
      ],
      reason: armedReason(),
    });
  }

  const diagnostics = checkHandoffDoc(facts.handoffDoc);
  if (diagnostics.length === 0) {
    return {
      ops: [
        { kind: 'transition', from: 'armed', to: 'written' },
        { kind: 'transition', from: 'written', to: 'settled' },
      ],
      stdout: null,
      stderr: null,
    };
  }
  // The block carrying the diagnostics is the instruction for the new entry
  // into armed that `written -> armed` makes.
  return blockOrRelease(facts, options, next, {
    ops: [
      { kind: 'transition', from: 'armed', to: 'written' },
      { kind: 'transition', from: 'written', to: 'armed', extras: { instructed: true, blocks: next } },
    ],
    reason: invalidDocReason(diagnostics),
  });
}

/**
 * Pure Stop-gate decision. Never throws on well-typed facts and does no I/O.
 *
 * - `idle`: a fresh (not stale, not > 5 s ahead, not before `since`), known
 *   effective percentage at or above the threshold arms (`idle -> armed`,
 *   instruction recorded, chain of 1) and blocks with the instruction;
 *   anything else does nothing.
 * - `armed`, no doc: blocks with the instruction once per entry into armed
 *   (recorded via a same-state `updateStoreExtras`), silent afterwards; a
 *   silent pass with `stop_hook_active` false clears a non-zero chain
 *   (`updateStoreExtras({ blocks: null })`, no stdout).
 * - `armed`, doc: a doc passing `checkHandoffDoc` settles
 *   (`armed -> written -> settled`, no stdout); a failing one goes
 *   `armed -> written -> armed` and blocks with its diagnostics.
 * - Chain: `next = stop_hook_active ? blocks + 1 : 1`; a would-be block with
 *   `stop_hook_active` and `next >= ceiling` releases instead
 *   (`armed -> settled` with `ctx.forced`, `{ systemMessage }`).
 * - `settled`: nothing. `written`, `reset`, `resumed` (crash leftovers): no
 *   op, no stdout, one stderr notice.
 */
export function decideStop(facts: StopFacts, options: StopOptions): StopPlan {
  switch (facts.machine.state) {
    case 'idle':
      return decideIdle(facts, options);
    case 'armed':
      return decideArmed(facts, options);
    case 'settled':
      return nothing();
    case 'written':
    case 'reset':
    case 'resumed':
      return { ops: [], stdout: null, stderr: inertNotice(facts.machine.state) };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers for the shell: flags, payload, reading file, newest doc.
// ---------------------------------------------------------------------------

/** The hook-command flag defaults (no config fields: operator choice 2026-10-22). */
export const DEFAULT_STOP_OPTIONS: Readonly<StopOptions> = Object.freeze({
  threshold: 70,
  ceiling: 3,
  maxReadingAgeS: 600,
});

const NOTICE_PREFIX = 'checkpoint stop-gate: ';

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const FLAG_KEYS: ReadonlyMap<string, keyof StopOptions> = new Map([
  ['--threshold', 'threshold'],
  ['--ceiling', 'ceiling'],
  ['--max-reading-age-s', 'maxReadingAgeS'],
]);

/** Unsigned decimal: digits with an optional fraction. No sign, exponent, hex or padding. */
const DECIMAL_RE = /^\d+(?:\.\d+)?$/;
const INTEGER_RE = /^\d+$/;

export type ParseStopGateArgsResult = { ok: true; options: StopOptions } | { ok: false; reason: string };

/**
 * Pure: the `stop-gate` flags, `--flag v` or `--flag=v`, each at most once.
 * Refuses (one-line reason) an unknown argument, a flag with no value, a
 * repeated flag, a `--threshold` outside 0 < t <= 100, a `--ceiling` that is
 * not an integer >= 2 (the ceiling counts `stop_hook_active` re-blocks, so 1
 * cannot mean "release on the first"), or a non-positive
 * `--max-reading-age-s`. Values must be plain unsigned decimals, so `NaN`,
 * `Infinity`, `0x10` and `-5` are all refused.
 */
export function parseStopGateArgs(argv: readonly string[]): ParseStopGateArgsResult {
  const refuse = (reason: string): ParseStopGateArgsResult => ({ ok: false, reason: oneLine(reason) });
  const raw = new Map<keyof StopOptions, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const key = FLAG_KEYS.get(name);
    if (key === undefined) return refuse(`unknown argument "${arg}"`);
    let value: string | undefined;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[i + 1];
      i++;
    }
    if (value === undefined) return refuse(`${name} needs a value`);
    if (raw.has(key)) return refuse(`${name} is given more than once`);
    raw.set(key, value);
  }

  const options: StopOptions = { ...DEFAULT_STOP_OPTIONS };
  const threshold = raw.get('threshold');
  if (threshold !== undefined) {
    const n = Number(threshold);
    if (!DECIMAL_RE.test(threshold) || !Number.isFinite(n) || n <= 0 || n > 100) {
      return refuse(`--threshold must be a percentage with 0 < t <= 100 (got "${threshold}")`);
    }
    options.threshold = n;
  }
  const ceiling = raw.get('ceiling');
  if (ceiling !== undefined) {
    const n = Number(ceiling);
    if (!INTEGER_RE.test(ceiling) || !Number.isSafeInteger(n) || n < 2) {
      return refuse(`--ceiling must be an integer >= 2 (got "${ceiling}")`);
    }
    options.ceiling = n;
  }
  const maxAge = raw.get('maxReadingAgeS');
  if (maxAge !== undefined) {
    const n = Number(maxAge);
    if (!DECIMAL_RE.test(maxAge) || !Number.isFinite(n) || n <= 0) {
      return refuse(`--max-reading-age-s must be a positive number of seconds (got "${maxAge}")`);
    }
    options.maxReadingAgeS = n;
  }
  return { ok: true, options };
}

export type ParseStopPayloadResult =
  | { ok: true; cwd: string; stopHookActive: boolean }
  | { ok: false; reason: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Pure: the slice of a Claude Code `Stop` payload the gate reads — `cwd` (a
 * non-empty string, required) and `stop_hook_active` (only `true` counts).
 */
export function parseStopPayload(text: string): ParseStopPayloadResult {
  if (text.trim().length === 0) return { ok: false, reason: 'the Stop payload on stdin is empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `the Stop payload is not valid JSON (${oneLine((err as Error).message)})` };
  }
  const payload = asRecord(parsed);
  if (payload === null) return { ok: false, reason: 'the Stop payload is not a JSON object' };
  const cwd = payload['cwd'];
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return { ok: false, reason: 'the Stop payload has no string "cwd"' };
  }
  return { ok: true, cwd, stopHookActive: payload['stop_hook_active'] === true };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Pure: a parsed `reading.json` (a serialized `CheckpointReading`, as the
 * sensor writes it) back into a well-typed reading, or `null` when it is not
 * an object with a string `ts`. Every other field is kept only when it has
 * its documented type (else `null`), so `decideStop` never sees a coerced
 * value. `unknown` is recomputed with the one unknown-reading predicate.
 * A PRESENT `used_percentage` that is neither null nor a finite number is an
 * unknown reading, exactly like `effectivePercentage`'s non-null-unknown
 * rule: it reads as `null` with `current_usage: null`, so no fallback
 * percentage can be computed from the usage beside it.
 * (Not `parseReading`: that takes a statusline payload and stamps `ts = now`.)
 */
export function readingFromJson(value: unknown): CheckpointReading | null {
  const record = asRecord(value);
  if (record === null) return null;
  const ts = record['ts'];
  if (typeof ts !== 'string') return null;
  const absolute = asRecord(record['absolute']) ?? {};
  const rawUsed = record['used_percentage'];
  const used = numberOrNull(rawUsed);
  const usedIsGarbage = rawUsed !== undefined && rawUsed !== null && used === null;
  const usage = usedIsGarbage ? null : asRecord(absolute['current_usage']);
  const exceeds = record['exceeds_200k_tokens'];
  return {
    used_percentage: used,
    unknown: isUnknownReading(used),
    absolute: {
      total_input_tokens: numberOrNull(absolute['total_input_tokens']),
      total_output_tokens: numberOrNull(absolute['total_output_tokens']),
      context_window_size: numberOrNull(absolute['context_window_size']),
      current_usage:
        usage === null
          ? null
          : {
              input_tokens: numberOrNull(usage['input_tokens']),
              output_tokens: numberOrNull(usage['output_tokens']),
              cache_creation_input_tokens: numberOrNull(usage['cache_creation_input_tokens']),
              cache_read_input_tokens: numberOrNull(usage['cache_read_input_tokens']),
            },
    },
    exceeds_200k_tokens: typeof exceeds === 'boolean' ? exceeds : null,
    current_dir: stringOrNull(record['current_dir']),
    project_dir: stringOrNull(record['project_dir']),
    ts,
  };
}

/** A SESSION handoff doc's file name, as `cadence handoff` writes it. */
const SESSION_DOC_RE = /^SESSION-.*\.md$/;

export interface HandoffCandidate {
  name: string;
  mtimeMs: number;
}

/**
 * Pure: the newest candidate whose mtime is strictly after `sinceMs`, or
 * `null`. Equal mtimes resolve to the greater name (SESSION names embed
 * their timestamp), so the pick never depends on directory listing order.
 */
export function newestHandoffAfter(candidates: readonly HandoffCandidate[], sinceMs: number): string | null {
  let best: HandoffCandidate | null = null;
  for (const candidate of candidates) {
    if (!(candidate.mtimeMs > sinceMs)) continue;
    if (
      best === null ||
      candidate.mtimeMs > best.mtimeMs ||
      (candidate.mtimeMs === best.mtimeMs && candidate.name > best.name)
    ) {
      best = candidate;
    }
  }
  return best?.name ?? null;
}

// ---------------------------------------------------------------------------
// Impure shell: `checkpoint stop-gate`.
// ---------------------------------------------------------------------------

/** The store write seam: the two writers the shell executes `plan.ops` through. */
export interface StopGateStore {
  transition: typeof transitionStore;
  updateExtras: typeof updateStoreExtras;
}

const DEFAULT_STORE: StopGateStore = { transition: transitionStore, updateExtras: updateStoreExtras };

export interface StopGateRunOptions {
  /** The arguments after `stop-gate`. */
  argv: readonly string[];
  /** The Stop payload, read to the end. */
  stdin: AsyncIterable<unknown> | Iterable<unknown>;
  /** Receives at most one JSON object plus `\n`, and only after every store op succeeded. */
  stdout: { write(chunk: string): unknown };
  /** Receives one-line notices only. */
  stderr: { write(chunk: string): unknown };
  /** The clock for the reading's age and for every store write's `since`. */
  now?: () => Date;
  /** Defaults to `defaultExcludedCadenceDirs(process.env, os.homedir())`. */
  excludedCadenceDirs?: readonly string[];
  /** Defaults to the sensor's `defaultProjectMarker(excludedCadenceDirs)`. */
  isProjectMarker?: (dir: string) => Promise<boolean>;
  /** Defaults to the real `transitionStore` / `updateStoreExtras`. */
  store?: StopGateStore;
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.alloc(0);
}

async function readAll(stdin: StopGateRunOptions['stdin']): Promise<Buffer> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stdin) chunks.push(toBuffer(chunk));
  } catch {
    // A broken stdin is whatever arrived; parseStopPayload reports it.
  }
  return Buffer.concat(chunks);
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** One line naming a thrown error: its message, prefixed with its code when the message lacks it. */
function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = errorCode(err);
  const text = oneLine(code !== undefined && !message.includes(code) ? `${code}: ${message}` : message);
  return text.length > 0 ? text : 'unknown error';
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

type Notice = (line: string) => void;

/**
 * `<project>/.cadence/checkpoint/reading.json`, by that exact name only —
 * the directory is never listed, so a `reading.json.<pid>.<rand>.tmp`
 * sibling is never opened. A missing file is no reading and no notice; an
 * unreadable or unparseable one is no reading and one notice.
 */
async function loadReading(projectDir: string, notice: Notice): Promise<CheckpointReading | null> {
  const path = checkpointReadingPath(projectDir);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    notice(`cannot read ${path} (${describeError(err)}); treated as no reading`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    notice(`${path} is not valid JSON (${oneLine((err as Error).message)}); treated as no reading`);
    return null;
  }
  const reading = readingFromJson(parsed);
  if (reading === null) notice(`${path} is not a checkpoint reading (no string "ts"); treated as no reading`);
  return reading;
}

/**
 * The newest `<project>/.cadence/handoff/SESSION-*.md` whose mtime is after
 * `since`, read as bytes and decoded ONCE with a fatal UTF-8 decoder (which
 * strips a BOM) — the one text `decideStop` hands to both `validate()` and
 * `findUnfilledSections`. A missing handoff directory, no candidate, or an
 * unparseable `since` is no doc. A doc that is not valid UTF-8 is no doc
 * plus one notice: `StopFacts` carries decoded text only, so the byte-level
 * verdict cannot reach `decideStop`, and a lossy decode could settle on
 * bytes the validator would reject. Other I/O errors propagate to the
 * envelope.
 */
async function loadHandoffDoc(projectDir: string, since: string, notice: Notice): Promise<string | null> {
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) return null;
  const dir = join(projectDir, '.cadence', 'handoff');
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    const code = errorCode(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
  const candidates: HandoffCandidate[] = [];
  for (const name of names) {
    if (!SESSION_DOC_RE.test(name)) continue;
    try {
      const info = await stat(join(dir, name));
      if (info.isFile()) candidates.push({ name, mtimeMs: info.mtimeMs });
    } catch {
      // Gone (or unreadable) between the listing and the stat: not a candidate.
    }
  }
  const newest = newestHandoffAfter(candidates, sinceMs);
  if (newest === null) return null;
  const path = join(dir, newest);
  const bytes = await readFile(path);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    notice(
      `${path} is not valid UTF-8 (NON_UTF8_INPUT); the gate cannot check it, so it counts as no handoff doc ` +
        'and the checkpoint stays armed',
    );
    return null;
  }
}

async function applyOp(
  store: StopGateStore,
  projectDir: string,
  op: StoreOp,
  stderr: { write(chunk: string): unknown },
  now: () => Date,
): Promise<TransitionResult> {
  if (op.kind === 'transition') {
    return store.transition(projectDir, op.to, {
      stderr,
      now,
      ...(op.ctx !== undefined ? { ctx: op.ctx } : {}),
      ...(op.extras !== undefined ? { extras: op.extras } : {}),
    });
  }
  return store.updateExtras(projectDir, op.patch, {
    stderr,
    expectedState: op.expectedState,
    ...(op.expectedSince !== undefined ? { expectedSince: op.expectedSince } : {}),
  });
}

async function stopGate(opts: StopGateRunOptions, write: (chunk: string) => void): Promise<void> {
  const notice: Notice = (line) => write(`${NOTICE_PREFIX}${line}\n`);
  const stderrSink = {
    write: (chunk: string): boolean => {
      write(chunk);
      return true;
    },
  };

  const args = parseStopGateArgs(opts.argv);
  if (!args.ok) {
    notice(`${args.reason}; the gate did not run`);
    return;
  }

  const payload = parseStopPayload((await readAll(opts.stdin)).toString('utf8'));
  if (!payload.ok) {
    notice(`${payload.reason}; the gate did not run`);
    return;
  }

  const start = resolve(payload.cwd);
  if (!(await isDirectory(start))) {
    notice(`session directory ${start} does not exist; the gate did not run`);
    return;
  }
  const isMarker =
    opts.isProjectMarker ??
    defaultProjectMarker(opts.excludedCadenceDirs ?? defaultExcludedCadenceDirs(process.env, homedir()));
  const projectDir = await resolveProjectDir(start, isMarker);
  // Not every session is in a cadence project: nothing to gate, nothing to say.
  if (projectDir === null) return;

  const read = readMachineState(projectDir);
  if (!read.ok) {
    write(`${read.reason}\n`);
    return;
  }
  const machine: StopMachine = {
    state: read.state,
    since: read.since,
    ...(read.instructed !== undefined ? { instructed: read.instructed } : {}),
    ...(read.blocks !== undefined ? { blocks: read.blocks } : {}),
  };

  // Each file is read only in the state that consults it, so no other state
  // can emit a notice about it.
  const reading = machine.state === 'idle' ? await loadReading(projectDir, notice) : null;
  const handoffDoc =
    machine.state === 'armed' && machine.since !== null ? await loadHandoffDoc(projectDir, machine.since, notice) : null;

  const clock = opts.now ?? (() => new Date());
  const plan = decideStop(
    { machine, reading, handoffDoc, stopHookActive: payload.stopHookActive, now: clock() },
    args.options,
  );

  const store = opts.store ?? DEFAULT_STORE;
  for (const op of plan.ops) {
    // A refusal has already written its one line; print nothing else.
    const result = await applyOp(store, projectDir, op, stderrSink, clock);
    if (!result.ok) return;
  }
  if (plan.stdout !== null) opts.stdout.write(`${JSON.stringify(plan.stdout)}\n`);
  if (plan.stderr !== null) write(`${plan.stderr}\n`);
}

/**
 * The `checkpoint stop-gate` command (a Claude Code `Stop` hook). Reads the
 * Stop payload, resolves the project from its `cwd` with the sensor's rule,
 * reads the machine state, `reading.json` (in `idle`) and the newest handoff
 * doc after `since` (in `armed`), calls `decideStop`, executes the plan's
 * store ops in order and — only when every op succeeded — prints the plan's
 * one JSON object. Always resolves 0 and never rejects: every refusal is one
 * stderr line, and the whole handler sits in one envelope that turns any
 * thrown error (an `EACCES` from the store write included) into exactly one
 * `checkpoint stop-gate: <message>` line with empty stdout. A broken hook
 * never blocks a session.
 */
export async function runStopGate(opts: StopGateRunOptions): Promise<number> {
  // Best-effort: a stderr whose write throws must not escape the envelope.
  const write = (chunk: string): void => {
    try {
      opts.stderr.write(chunk);
    } catch {
      // Nowhere left to report it.
    }
  };
  try {
    await stopGate(opts, write);
  } catch (err) {
    write(`${NOTICE_PREFIX}${describeError(err)}\n`);
  }
  return 0;
}
