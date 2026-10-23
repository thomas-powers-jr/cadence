import { open, stat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { defaultExcludedCadenceDirs, defaultProjectMarker, resolveProjectDir } from './sensor.js';
import { checkpointStatePath, readMachineState, transitionStore } from './state.js';
import type { CheckpointState, TransitionContext } from './state.js';

/**
 * Checkpoint SessionStart reset (phase 336, Arc A Phase 3).
 *
 * `checkpoint session-start` is a Claude Code `SessionStart` hook. On a new
 * session (`source` `startup`, `clear` or `compact`; never `resume` or
 * `fork`) it walks a non-idle machine back to `idle` with the store's
 * existing edges, as a single winner: the walk runs only while this process
 * holds `<project>/.cadence/checkpoint/session-start.lock`, claimed with
 * `open(…, 'wx')`. A lock that already exists — another handler mid-walk, or
 * one that crashed — is reported in one stderr line and never broken (refuse
 * + suggest). It prints nothing to stdout: cadence's own SessionStart hook
 * already runs `cadence resume`, so there is no context to inject.
 *
 * The pure half is `parseSessionStartPayload` and `nextResetEdge`; the impure
 * shell is `runSessionStart`.
 */

/** The SessionStart sources that start a new session and so reset the machine. */
export const RESET_SOURCES = Object.freeze(['startup', 'clear', 'compact'] as const);

export type ResetSource = (typeof RESET_SOURCES)[number];

export function isResetSource(source: string): source is ResetSource {
  return (RESET_SOURCES as readonly string[]).includes(source);
}

/** `<project>/.cadence/checkpoint/session-start.lock`, beside the store. */
export function sessionStartLockPath(projectDir: string): string {
  return join(dirname(checkpointStatePath(projectDir)), 'session-start.lock');
}

const NOTICE_PREFIX = 'checkpoint session-start: ';

/** The one line (no trailing newline) a handler prints when the lock already exists. */
export function lockHeldNotice(lockPath: string): string {
  return (
    `${NOTICE_PREFIX}the reset did not run: the lock ${lockPath} already exists (another checkpoint ` +
    `session-start holds it, or one crashed and left it). If no checkpoint session-start is running, delete ` +
    `${lockPath} and start a new session.`
  );
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export type ParseSessionStartPayloadResult =
  | { ok: true; cwd: string; source: string }
  | { ok: false; reason: string };

/**
 * Pure: the slice of a Claude Code `SessionStart` payload the handler reads —
 * `cwd` (a non-empty string) and `source` (a string). Anything else is a
 * one-line refusal reason.
 */
export function parseSessionStartPayload(text: string): ParseSessionStartPayloadResult {
  if (text.trim().length === 0) return { ok: false, reason: 'the SessionStart payload on stdin is empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `the SessionStart payload is not valid JSON (${oneLine((err as Error).message)})` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'the SessionStart payload is not a JSON object' };
  }
  const payload = parsed as Record<string, unknown>;
  const cwd = payload['cwd'];
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return { ok: false, reason: 'the SessionStart payload has no string "cwd"' };
  }
  const source = payload['source'];
  if (typeof source !== 'string') return { ok: false, reason: 'the SessionStart payload has no string "source"' };
  return { ok: true, cwd, source };
}

/** One `transitionStore(projectDir, to, { ctx })` call of the reset walk. */
export interface ResetEdge {
  to: CheckpointState;
  ctx?: TransitionContext;
}

/**
 * Pure: the next edge of the walk to `idle`, using existing edges only, or
 * `null` at `idle`. `settled -> reset -> resumed -> idle`; a stale `armed`
 * takes the guarded `armed -> idle` (`ctx.sessionReset`, the only edge that
 * carries it); a crash leftover `written` goes `written -> armed` first.
 */
export function nextResetEdge(state: CheckpointState): ResetEdge | null {
  switch (state) {
    case 'idle':
      return null;
    case 'settled':
      return { to: 'reset' };
    case 'reset':
      return { to: 'resumed' };
    case 'resumed':
      return { to: 'idle' };
    case 'armed':
      return { to: 'idle', ctx: { sessionReset: true } };
    case 'written':
      return { to: 'armed' };
  }
}

/** The longest walk (`settled -> reset -> resumed -> idle`). */
const MAX_RESET_EDGES = 3;

// ---------------------------------------------------------------------------
// Impure shell: `checkpoint session-start`.
// ---------------------------------------------------------------------------

/** The store write seam the walk runs through. */
export interface SessionStartStore {
  transition: typeof transitionStore;
}

const DEFAULT_STORE: SessionStartStore = { transition: transitionStore };

export interface SessionStartRunOptions {
  /** The arguments after `session-start` (it takes none). */
  argv: readonly string[];
  /** The SessionStart payload, read to the end. */
  stdin: AsyncIterable<unknown> | Iterable<unknown>;
  /** Receives one-line notices only. There is no stdout: the handler never prints there. */
  stderr: { write(chunk: string): unknown };
  /** The clock for the lock body and every store write's `since`. */
  now?: () => Date;
  /** Defaults to `defaultExcludedCadenceDirs(process.env, os.homedir())`. */
  excludedCadenceDirs?: readonly string[];
  /** Defaults to the sensor's `defaultProjectMarker(excludedCadenceDirs)`. */
  isProjectMarker?: (dir: string) => Promise<boolean>;
  /** Defaults to the real `transitionStore`. */
  store?: SessionStartStore;
  /** Creates the lock exclusively; defaults to `open(path, 'wx')`. Must reject with `EEXIST` when it exists. */
  openLock?: (path: string) => Promise<FileHandle>;
  /** Removes this process's own lock; defaults to `fs.promises.unlink`. */
  unlinkLock?: (path: string) => Promise<void>;
}

/**
 * Windows transiently refuses an unlink with EPERM / EACCES / EBUSY while
 * another handle (an antivirus scanner, an indexer) is briefly open on the
 * file. The codes and backoff mirror core's atomic-write `renameWithRetry`.
 */
const UNLINK_RETRY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY']);
const UNLINK_MAX_ATTEMPTS = 10;
const UNLINK_BACKOFF_MS = 15;

/** Removes the lock this process created, retrying only the transient codes; the last error propagates. */
async function removeOwnLock(path: string, unlinkLock: (path: string) => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await unlinkLock(path);
      return;
    } catch (err) {
      const code = errorCode(err);
      if (attempt >= UNLINK_MAX_ATTEMPTS || code === undefined || !UNLINK_RETRY_CODES.has(code)) throw err;
      await new Promise((r) => setTimeout(r, UNLINK_BACKOFF_MS * attempt));
    }
  }
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.alloc(0);
}

async function readPayload(stdin: SessionStartRunOptions['stdin']): Promise<string> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stdin) chunks.push(toBuffer(chunk));
  } catch {
    // A broken stdin is whatever arrived; parseSessionStartPayload reports it.
  }
  return Buffer.concat(chunks).toString('utf8');
}

function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

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

type Write = (chunk: string) => void;

/**
 * The walk, run only while this process holds the lock. Re-reads the state
 * first (another winner may have finished between the fast read and the
 * claim), then takes one edge at a time from each result's state, stopping at
 * `idle` or at the first refusal (which has already written its one line).
 */
async function walkToIdle(projectDir: string, opts: SessionStartRunOptions, write: Write): Promise<void> {
  const read = readMachineState(projectDir);
  if (!read.ok) {
    write(`${read.reason}\n`);
    return;
  }
  const store = opts.store ?? DEFAULT_STORE;
  const stderr = {
    write: (chunk: string): boolean => {
      write(chunk);
      return true;
    },
  };
  let state = read.state;
  for (let step = 0; step < MAX_RESET_EDGES; step++) {
    const edge = nextResetEdge(state);
    if (edge === null) return;
    const result = await store.transition(projectDir, edge.to, {
      stderr,
      ...(opts.now !== undefined ? { now: opts.now } : {}),
      ...(edge.ctx !== undefined ? { ctx: edge.ctx } : {}),
    });
    if (!result.ok) return;
    state = result.state;
  }
}

async function sessionStart(opts: SessionStartRunOptions, write: Write): Promise<void> {
  const notice = (line: string): void => write(`${NOTICE_PREFIX}${line}\n`);

  if (opts.argv.length > 0) {
    notice(`unknown argument "${oneLine(opts.argv[0] ?? '')}" (session-start takes none); the reset did not run`);
    return;
  }

  const payload = parseSessionStartPayload(await readPayload(opts.stdin));
  if (!payload.ok) {
    notice(`${payload.reason}; the reset did not run`);
    return;
  }
  // `resume`, `fork` and any other source continue a session: nothing to reset.
  if (!isResetSource(payload.source)) return;

  const start = resolve(payload.cwd);
  if (!(await isDirectory(start))) {
    notice(`session directory ${start} does not exist; the reset did not run`);
    return;
  }
  const isMarker =
    opts.isProjectMarker ??
    defaultProjectMarker(opts.excludedCadenceDirs ?? defaultExcludedCadenceDirs(process.env, homedir()));
  const projectDir = await resolveProjectDir(start, isMarker);
  // Not every session is in a cadence project: nothing to reset, nothing to say.
  if (projectDir === null) return;

  // The cheap common path: an idle (or absent) store needs no lock.
  const fast = readMachineState(projectDir);
  if (!fast.ok) {
    write(`${fast.reason}\n`);
    return;
  }
  if (fast.state === 'idle') return;

  const lockPath = sessionStartLockPath(projectDir);
  let handle: FileHandle;
  try {
    handle = await (opts.openLock ?? ((path: string) => open(path, 'wx')))(lockPath);
  } catch (err) {
    if (errorCode(err) === 'EEXIST') {
      // Held by another handler, or left by a crashed one: never broken here.
      write(`${lockHeldNotice(lockPath)}\n`);
      return;
    }
    throw err;
  }

  // From here the lock is this process's own, so only this path removes it.
  try {
    try {
      const at = (opts.now ?? (() => new Date()))().toISOString();
      await handle.writeFile(`checkpoint session-start pid ${process.pid} at ${at}\n`, 'utf8');
    } finally {
      // Closed before the walk, so the unlink below never meets an open handle.
      await handle.close();
    }
    await walkToIdle(projectDir, opts, write);
  } finally {
    try {
      await removeOwnLock(lockPath, opts.unlinkLock ?? ((path: string) => unlink(path)));
    } catch (err) {
      notice(
        `could not remove its own lock ${lockPath} (${describeError(err)}); if no checkpoint session-start is ` +
          `running, delete ${lockPath}`,
      );
    }
  }
}

/**
 * The `checkpoint session-start` command (a Claude Code `SessionStart` hook).
 * Always resolves 0 and never rejects; it never writes stdout. Every refusal
 * is one stderr line, and the whole handler sits in one envelope that turns
 * any thrown error into exactly one `checkpoint session-start: <message>`
 * line. A broken hook never blocks a session. The one exception to "one
 * line" is a double failure: when the walk throws AND removing this
 * process's own lock still fails after its retries, the lock notice and the
 * envelope line are both printed (two lines, still exit 0).
 */
export async function runSessionStart(opts: SessionStartRunOptions): Promise<number> {
  // Best-effort: a stderr whose write throws must not escape the envelope.
  const write: Write = (chunk) => {
    try {
      opts.stderr.write(chunk);
    } catch {
      // Nowhere left to report it.
    }
  };
  try {
    await sessionStart(opts, write);
  } catch (err) {
    write(`${NOTICE_PREFIX}${describeError(err)}\n`);
  }
  return 0;
}
