import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { atomicWriteText } from '@thomas-powers-jr/cadence-core';
import { isUnknownReading } from './state.js';

/**
 * Checkpoint statusline sensor (phase 331, Arc A Phase 2). Claude Code pipes
 * its statusline JSON to `checkpoint statusline [--] <inner argv>`; the
 * sensor records a reading to `<project>/.cadence/checkpoint/reading.json`
 * (D-BS) and passes the inner statusline's stdout through byte-for-byte.
 * The sensor never reads or writes machine state (`state.json`) and never
 * calls `transition` — recording is all it does.
 */

export interface ReadingCurrentUsage {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}

export interface ReadingAbsolute {
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  context_window_size: number | null;
  /** `null` before the first API call and again after `/compact` (Claude Code docs). */
  current_usage: ReadingCurrentUsage | null;
}

/**
 * One recorded sensor reading. Both units are kept (D-BJ): the coarse integer
 * `used_percentage` and the absolute token counts. Every field is the raw
 * payload value, or `null` when absent or not of the documented type — no
 * fallback percentage is ever computed into it.
 */
export interface CheckpointReading {
  used_percentage: number | null;
  unknown: boolean;
  absolute: ReadingAbsolute;
  exceeds_200k_tokens: boolean | null;
  current_dir: string | null;
  project_dir: string | null;
  ts: string;
}

export type ParseReadingResult =
  | {
      ok: true;
      reading: CheckpointReading;
      /** Where project resolution starts: `workspace.current_dir`, else `cwd`, else `null`. */
      sessionDir: string | null;
    }
  | { ok: false; reason: string };

export function checkpointReadingPath(projectDir: string): string {
  return join(projectDir, '.cadence', 'checkpoint', 'reading.json');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Pure: turns the statusline stdin text into a reading. Malformed JSON, or
 * JSON that is not an object, is a failure with a one-line reason and no
 * reading. Fields follow Claude Code's documented statusline schema
 * (`context_window.*`, top-level `exceeds_200k_tokens`, `workspace.*`).
 */
export function parseReading(text: string, now: Date): ParseReadingResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `statusline stdin is not valid JSON (${oneLine((err as Error).message)})` };
  }
  const payload = asRecord(parsed);
  if (payload === null) return { ok: false, reason: 'statusline stdin is not a JSON object' };

  const cw = asRecord(payload['context_window']) ?? {};
  const usage = asRecord(cw['current_usage']);
  const workspace = asRecord(payload['workspace']) ?? {};
  const usedPercentage = numberOrNull(cw['used_percentage']);
  const currentDir = stringOrNull(workspace['current_dir']);
  const exceeds = payload['exceeds_200k_tokens'];

  const reading: CheckpointReading = {
    used_percentage: usedPercentage,
    unknown: isUnknownReading(usedPercentage),
    absolute: {
      total_input_tokens: numberOrNull(cw['total_input_tokens']),
      total_output_tokens: numberOrNull(cw['total_output_tokens']),
      context_window_size: numberOrNull(cw['context_window_size']),
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
    current_dir: currentDir,
    project_dir: stringOrNull(workspace['project_dir']),
    ts: now.toISOString(),
  };
  return { ok: true, reading, sessionDir: currentDir ?? stringOrNull(payload['cwd']) };
}

/**
 * Pure: walks from `startDir` (absolute) up to the filesystem root and
 * returns the nearest directory for which `hasCadenceDir` holds, or `null`.
 * The predicate may be async, so the impure caller's filesystem probes never
 * block the event loop (a stalled network path must not hold the statusline).
 */
export async function resolveProjectDir(
  startDir: string,
  hasCadenceDir: (dir: string) => boolean | Promise<boolean>,
): Promise<string | null> {
  let dir = startDir;
  for (;;) {
    if (await hasCadenceDir(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * `.cadence` directories that are not project markers: the user-level store
 * core keeps at `CADENCE_HOME ?? ~/.cadence` (onboarding state). Without this
 * exclusion every session under the home directory would resolve to the home
 * directory as its "project".
 */
export function defaultExcludedCadenceDirs(env: Record<string, string | undefined>, home: string): string[] {
  const dirs = [resolve(home, '.cadence')];
  const cadenceHome = env['CADENCE_HOME'];
  if (cadenceHome !== undefined && cadenceHome.length > 0) dirs.push(resolve(cadenceHome));
  return dirs;
}

/**
 * Canonical comparison key, after core's `worktreeKey`: best-effort realpath
 * (resolves junctions, symlinks, Windows 8.3 short names, and on-disk casing),
 * falling back to `resolve` on any error, then lowercased on win32. Comparing
 * plain strings would let any alias of an excluded store pass as a project.
 */
async function pathKey(path: string): Promise<string> {
  let canonical: string;
  try {
    // fs/promises realpath is the native (uv_fs_realpath) implementation,
    // like realpathSync.native.
    canonical = await realpath(path);
  } catch {
    canonical = resolve(path);
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** The default project marker test: a `.cadence` directory that is not an excluded store. */
function defaultProjectMarker(excludedCadenceDirs: readonly string[]): (dir: string) => Promise<boolean> {
  let excluded: Promise<Set<string>> | undefined;
  return async (dir) => {
    const marker = join(dir, '.cadence');
    if (!(await isDirectory(marker))) return false;
    excluded ??= Promise.all(excludedCadenceDirs.map(pathKey)).then((keys) => new Set(keys));
    return !(await excluded).has(await pathKey(marker));
  };
}

// ---------------------------------------------------------------------------
// Impure shell
// ---------------------------------------------------------------------------

export interface StatuslineOptions {
  /** The arguments after `statusline`; one leading `--` is dropped. */
  argv: readonly string[];
  stdin: AsyncIterable<unknown> | Iterable<unknown>;
  /** Receives the inner statusline's stdout bytes, unmodified. */
  stdout: { write(chunk: Uint8Array): unknown };
  /** Receives one-line notices only; the inner's own stderr is inherited. */
  stderr: { write(chunk: string): unknown };
  /** Start of project resolution when the payload names no directory. */
  cwdFallback: string;
  now?: () => Date;
  /** Defaults to `defaultExcludedCadenceDirs(process.env, os.homedir())`. */
  excludedCadenceDirs?: readonly string[];
  /** How long to wait for the reading once the inner has exited. Defaults to `RECORD_DEADLINE_MS`. */
  recordDeadlineMs?: number;
  /** Writes the reading file. Defaults to mkdir of the parent, then `atomicWriteText`. */
  writeReading?: (path: string, text: string) => Promise<void>;
  /**
   * Whether `dir` is the project (holds a non-excluded `.cadence/` directory).
   * Defaults to async stat + realpath against `excludedCadenceDirs`.
   */
  isProjectMarker?: (dir: string) => Promise<boolean>;
}

const NOTICE_PREFIX = 'checkpoint statusline: ';

/**
 * How long the wrapper waits for the recording after the inner exits before
 * it flushes and exits: a ceiling chosen by the operator (331-02), not a
 * measured tail. Claude Code shows a statusline only once the command exits,
 * debounces update triggers by 300 ms (a quiet period before a run, not a
 * time budget for it), and cancels a run still in flight when a new one
 * triggers (https://code.claude.com/docs/en/statusline). The recording
 * usually finishes before the inner exits; the worst measured case was
 * 84.6 ms after it, on windows-latest under suite load (probe run
 * 39450266774), and the slower-runner tail behind PR #571's dropped readings
 * was never captured. This bounds the wait, not process lifetime: a truly
 * hung filesystem call can still keep the process alive (see the phase
 * report). A write abandoned at the deadline can leave a `*.tmp` sibling.
 */
export const RECORD_DEADLINE_MS = 1000;

async function defaultWriteReading(path: string, text: string): Promise<void> {
  // atomicWriteText (D-BR) writes a temp sibling then renames; it does
  // not create the parent directory.
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteText(path, text);
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk, 'utf8');
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.alloc(0);
}

async function readAll(stdin: StatuslineOptions['stdin']): Promise<Buffer> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stdin) chunks.push(toBuffer(chunk));
  } catch {
    // A broken stdin is recorded as whatever arrived; parseReading reports it.
  }
  return Buffer.concat(chunks);
}

/**
 * Best-effort: never throws, never touches `state.json`. A missing project
 * (no `.cadence/` up the tree) is silent and creates nothing; every other
 * failure is exactly one stderr line.
 */
async function recordReading(input: Buffer, opts: StatuslineOptions): Promise<void> {
  try {
    const parsed = parseReading(input.toString('utf8'), (opts.now ?? (() => new Date()))());
    if (!parsed.ok) {
      opts.stderr.write(`${NOTICE_PREFIX}reading not recorded: ${parsed.reason}\n`);
      return;
    }
    const start = resolve(opts.cwdFallback, parsed.sessionDir ?? opts.cwdFallback);
    if (!(await isDirectory(start))) {
      opts.stderr.write(`${NOTICE_PREFIX}reading not recorded: session directory ${start} does not exist\n`);
      return;
    }
    const isMarker =
      opts.isProjectMarker ??
      defaultProjectMarker(opts.excludedCadenceDirs ?? defaultExcludedCadenceDirs(process.env, homedir()));
    const project = await resolveProjectDir(start, isMarker);
    if (project === null) return;

    const path = checkpointReadingPath(project);
    try {
      await (opts.writeReading ?? defaultWriteReading)(path, `${JSON.stringify(parsed.reading, null, 2)}\n`);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      opts.stderr.write(
        `${NOTICE_PREFIX}reading not recorded: cannot write ${path} (${oneLine(e.code ?? e.message ?? String(err))})\n`,
      );
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    opts.stderr.write(`${NOTICE_PREFIX}reading not recorded: ${oneLine(e.code ?? e.message ?? String(err))}\n`);
  }
}

/** Spawns the inner statusline with no shell; resolves with its exit code (127 if it cannot start). */
function runInner(argv: readonly string[], input: Buffer, opts: StatuslineOptions): Promise<number> {
  const [exe, ...args] = argv as [string, ...string[]];
  return new Promise((resolveCode) => {
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      resolveCode(code);
    };
    const cannotRun = (err: unknown): void => {
      if (settled) return;
      const e = err as NodeJS.ErrnoException;
      opts.stderr.write(`${NOTICE_PREFIX}cannot run inner statusline "${exe}" (${oneLine(e.code ?? e.message ?? String(err))})\n`);
      finish(127);
    };

    let child: ChildProcess;
    try {
      child = spawn(exe, args, { shell: false, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
    } catch (err) {
      cannotRun(err);
      return;
    }

    // Each chunk is written to stdout as it arrives (331-02), so the wrapper
    // keeps no copy of the inner's output. Backpressure is not applied
    // (opts.stdout exposes only write), so a slow reader can still queue
    // output in the stdout stream's own buffer. Claude Code renders only once
    // the wrapper exits, so render time is unchanged. 'close' fires only after
    // the inner's stdout has ended, so every chunk is written before the exit
    // code is reported.
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      opts.stdout.write(chunk);
    });
    child.on('error', (err) => {
      // Only a failure to start is fatal; later errors (e.g. a kill failure)
      // leave 'close' to report the exit code.
      if (child.pid === undefined) cannotRun(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      finish(code ?? 1);
    });
    // An inner that exits without reading stdin makes this write EPIPE; that
    // is the inner's business, not a wrapper crash.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input);
  });
}

/**
 * The `checkpoint statusline` command. Buffers all stdin, then records the
 * reading and runs the inner statusline concurrently: the recorder never
 * writes stdout, so a slow or failed write cannot corrupt it. Once the inner
 * exits, the recording gets at most `recordDeadlineMs` more; past that it is
 * abandoned with one stderr notice and its later notices are dropped.
 * Resolves with the inner's exit code (0 when there is no inner argv); never
 * rejects.
 */
export async function runStatusline(opts: StatuslineOptions): Promise<number> {
  const input = await readAll(opts.stdin);
  const argv = opts.argv[0] === '--' ? opts.argv.slice(1) : opts.argv;
  // A notice is best-effort: a stderr whose write throws synchronously must
  // not turn into a rejection that skips the flush-and-exit. (A pipe's EPIPE
  // arrives later as an 'error' event on the stream, which this cannot catch.)
  const stderr = {
    write: (chunk: string): unknown => {
      try {
        return opts.stderr.write(chunk);
      } catch {
        return false;
      }
    },
  };
  let abandoned = false;
  const gatedStderr = {
    write: (chunk: string): unknown => (abandoned ? true : stderr.write(chunk)),
  };
  // The inner is spawned first; the recording's filesystem work is all async,
  // so neither can hold up the other.
  const inner = argv.length === 0 ? Promise.resolve(0) : runInner(argv, input, { ...opts, stderr });
  const recording = recordReading(input, { ...opts, stderr: gatedStderr }).then(() => true);
  const code = await inner;

  const deadlineMs = opts.recordDeadlineMs ?? RECORD_DEADLINE_MS;
  // A ref'd timer, cleared when the recording wins: an unref'd one could let
  // the loop drain before it fires, and the exit code would never be set.
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<false>((done) => {
    timer = setTimeout(() => done(false), deadlineMs);
  });
  const recorded = await Promise.race([recording, deadline]);
  clearTimeout(timer);
  if (!recorded) {
    abandoned = true;
    stderr.write(`${NOTICE_PREFIX}reading not recorded within ${deadlineMs} ms of the inner exiting; abandoned it\n`);
  }
  return code;
}

interface FlushableStream {
  write(chunk: string, cb: () => void): unknown;
}

/**
 * Exits once everything already written to stdout, then stderr, has been
 * flushed. `process.exitCode` alone would let an abandoned reading write keep
 * the process alive; a bare `process.exit` could truncate piped output.
 */
export function exitAfterFlush(
  code: number,
  streams: { stdout: FlushableStream; stderr: FlushableStream },
  exit: (code: number) => void,
): void {
  streams.stdout.write('', () => {
    streams.stderr.write('', () => exit(code));
  });
}
