import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  checkpointReadingPath,
  defaultExcludedCadenceDirs,
  exitAfterFlush,
  parseReading,
  RECORD_DEADLINE_MS,
  recordDeadlineFromEnv,
  resolveProjectDir,
  runStatusline,
} from '../src/sensor.js';

const BIN = join(__dirname, '..', 'bin', 'checkpoint.cjs');
const FIXTURES = join(__dirname, 'fixtures', 'statusline');
const INNER = join(FIXTURES, 'inner-statusline.cjs');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FIXED_NOW = new Date('2026-10-15T12:34:56.789Z');

type Json = Record<string, unknown>;

/** The user-level store exclusions the CLI uses by default (CADENCE_HOME / ~/.cadence). */
const REAL_EXCLUSIONS = defaultExcludedCadenceDirs(process.env, homedir());
const USER_STORE_READING = join(homedir(), '.cadence', 'checkpoint', 'reading.json');

/** Realpath (falling back to resolve), lowercased on win32: the same key the sensor must use. */
function canonical(path: string): string {
  let real: string;
  try {
    real = realpathSync.native(path);
  } catch {
    real = resolve(path);
  }
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/** Bytes + mtime of the user-level store's reading.json, or null when absent. */
function snapshotUserStoreReading(): { bytes: Buffer; mtimeMs: number } | null {
  if (!existsSync(USER_STORE_READING)) return null;
  return { bytes: readFileSync(USER_STORE_READING), mtimeMs: statSync(USER_STORE_READING).mtimeMs };
}

function loadPayload(name: string): Json {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Json;
}

/** The fixture payload with its session directories pointed at real paths. */
function payloadFor(name: string, currentDir: string, projectDir = currentDir): Buffer {
  const payload = loadPayload(name);
  payload['cwd'] = currentDir;
  payload['workspace'] = { current_dir: currentDir, project_dir: projectDir };
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

interface ProcResult {
  status: number | null;
  stdout: Buffer;
  stderr: string;
}

function envWithout(...keys: string[]): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of keys) delete env[key];
  return env;
}

// The subject of the tests that use these is recording or stdout bytes, not
// the record deadline, and loaded CI runners have missed even 1000 ms (run
// 39461022835). The deadline's own tests (331-02/AC-1, the 331-01/AC-9
// abandon tests, sensor-concurrency.test.ts) keep the default. 10 s rather
// than more: these runners use spawnSync, which the test timer cannot
// interrupt, so a write that is slow but finishes should still fail readably
// ("not recorded within 10000 ms") inside the shared budget.
const GENEROUS_DEADLINE_MS = 10_000;

/** A built-wrapper child env with the generous deadline (only in the child, never on process.env). */
function sensorEnv(env: NodeJS.ProcessEnv = envWithout('CADENCE_HOME')): NodeJS.ProcessEnv {
  return { ...env, CHECKPOINT_RECORD_DEADLINE_MS: String(GENEROUS_DEADLINE_MS) };
}

/** The inner statusline run directly, no wrapper, no shell. */
function runInnerDirect(input: Buffer, extra: string[] = []): ProcResult {
  const r = spawnSync(process.execPath, [INNER, ...extra], { input, windowsHide: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr.toString('utf8') };
}

/**
 * The built wrapper: `node bin/checkpoint.cjs statusline <args...>`, no shell.
 * Every caller's subject is recording or bytes, so the child always gets the
 * generous deadline, on top of `opts.env` when one is given.
 */
function runWrapper(
  input: Buffer,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): ProcResult {
  const r = spawnSync(process.execPath, [BIN, 'statusline', ...args], {
    input,
    windowsHide: true,
    env: sensorEnv(opts.env),
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr.toString('utf8') };
}

function stderrLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

function readReading(projectDir: string): Json {
  return JSON.parse(readFileSync(checkpointReadingPath(projectDir), 'utf8')) as Json;
}

const ABSOLUTE_42 = {
  total_input_tokens: 15500,
  total_output_tokens: 1200,
  context_window_size: 200000,
  current_usage: {
    input_tokens: 8500,
    output_tokens: 1200,
    cache_creation_input_tokens: 5000,
    cache_read_input_tokens: 2000,
  },
};

let tmp: string;
let project: string;

beforeEach(() => {
  // Realpath the root (8.3 short names, symlinked TMPDIR) so every path the
  // tests compare is canonical.
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'checkpoint-sensor-')));
  project = join(tmp, 'project');
  mkdirSync(join(project, '.cadence'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Pure: parseReading
// ---------------------------------------------------------------------------

describe('parseReading', () => {
  it('331-01/AC-2: records used_percentage, absolutes, flags, both dirs, and an ISO ts from a documented payload', () => {
    const text = payloadFor('payload-42.json', '/repo/wt', '/repo/primary').toString('utf8');
    const result = parseReading(text, FIXED_NOW);
    expect(result).toEqual({
      ok: true,
      sessionDir: '/repo/wt',
      reading: {
        used_percentage: 42,
        unknown: false,
        absolute: ABSOLUTE_42,
        exceeds_200k_tokens: false,
        current_dir: '/repo/wt',
        project_dir: '/repo/primary',
        ts: '2026-10-15T12:34:56.789Z',
      },
    });
  });

  // Whole-branch review I2: the phase report shows "the actual output of the
  // built wrapper on payload-42". Tie that block to the code: parse the
  // report's json block and deep-equal it against parseReading's output for
  // the same fixture, with the report's placeholder dirs fed in and ts taken
  // from the report (the only value that legitimately differs per run).
  it('331-01/AC-6: the phase report\'s reading schema block is exactly what parseReading records for payload-42', () => {
    const report = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'checkpoint', 'REPORT-checkpoint-phase-2.md'), 'utf8');
    const section = report.split(/^## /m).find((s) => s.startsWith('Reading schema'));
    expect(section, 'report is missing ## Reading schema').toBeDefined();
    const block = /```json\r?\n([\s\S]*?)\r?\n```/.exec(section ?? '');
    expect(block, 'Reading schema section has no ```json block').not.toBeNull();
    const documented = JSON.parse(block?.[1] ?? '') as Json;
    expect(documented['ts']).toMatch(ISO);

    const text = payloadFor('payload-42.json', '<scratch project>').toString('utf8');
    const result = parseReading(text, new Date(documented['ts'] as string));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reading).toEqual(documented);
  });

  it('331-01/AC-2: a null used_percentage is recorded as null and unknown, with every absolute present and nothing computed', () => {
    const result = parseReading(readFileSync(join(FIXTURES, 'payload-null.json'), 'utf8'), FIXED_NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // toEqual pins the exact key set: there is no fallback-percentage field.
    expect(result.reading).toEqual({
      used_percentage: null,
      unknown: true,
      absolute: ABSOLUTE_42,
      exceeds_200k_tokens: false,
      current_dir: '/x',
      project_dir: '/launch/dir',
      ts: '2026-10-15T12:34:56.789Z',
    });
  });

  it('331-01/AC-2: a post-/compact payload records current_usage as null and keeps the totals present', () => {
    const result = parseReading(readFileSync(join(FIXTURES, 'payload-compacted.json'), 'utf8'), FIXED_NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reading.used_percentage).toBeNull();
    expect(result.reading.unknown).toBe(true);
    expect(result.reading.absolute).toEqual({
      total_input_tokens: 65933,
      total_output_tokens: 13,
      context_window_size: 1000000,
      current_usage: null,
    });
  });

  it('331-01/AC-2: absent and non-numeric fields are recorded as null, never coerced', () => {
    const result = parseReading(
      JSON.stringify({
        context_window: {
          used_percentage: '42',
          total_input_tokens: '15500',
          current_usage: { input_tokens: 1, output_tokens: null, cache_read_input_tokens: 'x' },
        },
        exceeds_200k_tokens: 'no',
        workspace: { current_dir: 7 },
      }),
      FIXED_NOW,
    );
    expect(result).toEqual({
      ok: true,
      sessionDir: null,
      reading: {
        used_percentage: null,
        unknown: true,
        absolute: {
          total_input_tokens: null,
          total_output_tokens: null,
          context_window_size: null,
          current_usage: {
            input_tokens: 1,
            output_tokens: null,
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
          },
        },
        exceeds_200k_tokens: null,
        current_dir: null,
        project_dir: null,
        ts: '2026-10-15T12:34:56.789Z',
      },
    });
  });

  it('331-01/AC-2: an empty object payload yields an all-null unknown reading', () => {
    const result = parseReading('{}', FIXED_NOW);
    expect(result).toEqual({
      ok: true,
      sessionDir: null,
      reading: {
        used_percentage: null,
        unknown: true,
        absolute: { total_input_tokens: null, total_output_tokens: null, context_window_size: null, current_usage: null },
        exceeds_200k_tokens: null,
        current_dir: null,
        project_dir: null,
        ts: '2026-10-15T12:34:56.789Z',
      },
    });
  });

  it('331-01/AC-2: a used_percentage of 0 is recorded raw as 0 and classified unknown', () => {
    const result = parseReading(JSON.stringify({ context_window: { used_percentage: 0 } }), FIXED_NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reading.used_percentage).toBe(0);
    expect(result.reading.unknown).toBe(true);
  });

  it('falls back to the payload cwd as the session dir when workspace.current_dir is absent', () => {
    const result = parseReading(JSON.stringify({ cwd: '/from/cwd', workspace: { project_dir: '/p' } }), FIXED_NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionDir).toBe('/from/cwd');
    expect(result.reading.current_dir).toBeNull();
    expect(result.reading.project_dir).toBe('/p');
  });

  it('331-01/AC-9: malformed JSON is a distinguishable failure with a one-line reason and no reading', () => {
    for (const text of ['', '{"context_window":', 'not json at all']) {
      const result = parseReading(text, FIXED_NOW);
      expect(result.ok, text).toBe(false);
      if (result.ok) continue;
      expect(result.reason, text).toMatch(/not valid JSON/);
      expect(result.reason, text).not.toContain('\n');
      expect('reading' in result, text).toBe(false);
    }
  });

  it('331-01/AC-9: JSON that is not an object is refused', () => {
    for (const text of ['null', '[]', '42', '"x"']) {
      const result = parseReading(text, FIXED_NOW);
      expect(result.ok, text).toBe(false);
      if (!result.ok) expect(result.reason, text).toMatch(/not a JSON object/);
    }
  });
});

// ---------------------------------------------------------------------------
// Pure: resolveProjectDir / defaultExcludedCadenceDirs
// ---------------------------------------------------------------------------

describe('resolveProjectDir', () => {
  const root = resolve('/');

  it('returns the start dir itself when it holds .cadence/', async () => {
    const start = join(root, 'a', 'b');
    expect(await resolveProjectDir(start, (dir) => dir === start)).toBe(start);
  });

  it('walks up to the nearest ancestor holding .cadence/', async () => {
    const outer = join(root, 'a');
    const inner = join(root, 'a', 'b');
    const start = join(root, 'a', 'b', 'c', 'd');
    const asked: string[] = [];
    const found = await resolveProjectDir(start, (dir) => {
      asked.push(dir);
      return dir === inner || dir === outer;
    });
    expect(found).toBe(inner);
    expect(asked).toEqual([start, join(root, 'a', 'b', 'c'), inner]);
  });

  it('returns null after checking every ancestor up to the filesystem root', async () => {
    const start = join(root, 'a', 'b');
    const asked: string[] = [];
    expect(await resolveProjectDir(start, (dir) => (asked.push(dir), false))).toBeNull();
    expect(asked).toEqual([start, join(root, 'a'), root]);
  });
});

describe('defaultExcludedCadenceDirs', () => {
  it('excludes the user-level ~/.cadence store and an explicit CADENCE_HOME', () => {
    expect(defaultExcludedCadenceDirs({}, '/home/u')).toEqual([resolve('/home/u', '.cadence')]);
    expect(defaultExcludedCadenceDirs({ CADENCE_HOME: '/elsewhere/.cadence' }, '/home/u')).toEqual([
      resolve('/home/u', '.cadence'),
      resolve('/elsewhere/.cadence'),
    ]);
  });
});

describe('recordDeadlineFromEnv', () => {
  const KEY = 'CHECKPOINT_RECORD_DEADLINE_MS';

  it('331-02/AC-7: a positive integer CHECKPOINT_RECORD_DEADLINE_MS is used as the record deadline', () => {
    expect(recordDeadlineFromEnv({ [KEY]: '2500' })).toBe(2500);
    expect(recordDeadlineFromEnv({ [KEY]: '1' })).toBe(1);
    expect(recordDeadlineFromEnv({ [KEY]: '60000' })).toBe(60000);
  });

  it('331-02/AC-7: an absent or empty CHECKPOINT_RECORD_DEADLINE_MS leaves the default', () => {
    expect(recordDeadlineFromEnv({})).toBeUndefined();
    expect(recordDeadlineFromEnv({ [KEY]: undefined })).toBeUndefined();
    expect(recordDeadlineFromEnv({ [KEY]: '' })).toBeUndefined();
  });

  it('331-02/AC-7: zero, negative, non-integer and non-numeric values leave the default', () => {
    for (const value of ['0', '-5', '1.5', 'abc', '1e3', '0x10', 'Infinity', 'NaN', '12ms']) {
      expect(recordDeadlineFromEnv({ [KEY]: value }), value).toBeUndefined();
    }
  });

  it('331-02/AC-7: only canonical digits are accepted: surrounding whitespace, a sign and leading zeros are refused', () => {
    for (const value of [' 12 ', '12 ', ' 12', '\t12', '12\n', '+12', '012', '00']) {
      expect(recordDeadlineFromEnv({ [KEY]: value }), JSON.stringify(value)).toBeUndefined();
    }
  });

  it("331-02/AC-7: a value above setTimeout's 2147483647 ms maximum leaves the default (Node would fire it after 1 ms)", () => {
    expect(recordDeadlineFromEnv({ [KEY]: '2147483647' })).toBe(2147483647);
    expect(recordDeadlineFromEnv({ [KEY]: '2147483648' })).toBeUndefined();
    expect(recordDeadlineFromEnv({ [KEY]: '99999999999999999999' })).toBeUndefined();
  });

  it('331-02/AC-7: other variables are ignored', () => {
    expect(recordDeadlineFromEnv({ RECORD_DEADLINE_MS: '2500', CHECKPOINT_DEADLINE_MS: '2500' })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Impure, in-process: runStatusline
// ---------------------------------------------------------------------------

interface Collector<T> {
  chunks: T[];
  write(chunk: T): boolean;
}

function collector<T>(): Collector<T> {
  const chunks: T[] = [];
  return {
    chunks,
    write(chunk: T): boolean {
      chunks.push(chunk);
      return true;
    },
  };
}

describe('runStatusline (in-process)', () => {
  it('331-01/AC-2: records the reading, passes the inner stdout bytes through, and returns the inner exit code', async () => {
    const input = payloadFor('payload-42.json', project);
    const stdout = collector<Uint8Array>();
    const stderr = collector<string>();
    const code = await runStatusline({
      argv: ['--', process.execPath, INNER, '5'],
      stdin: [input],
      stdout,
      stderr,
      cwdFallback: tmp,
      now: () => FIXED_NOW,
      excludedCadenceDirs: REAL_EXCLUSIONS,
      recordDeadlineMs: GENEROUS_DEADLINE_MS,
    });
    expect(code).toBe(5);
    expect(stderr.chunks).toEqual([]);
    const direct = runInnerDirect(input);
    expect(Buffer.concat(stdout.chunks).equals(direct.stdout)).toBe(true);
    expect(readReading(project)).toEqual({
      used_percentage: 42,
      unknown: false,
      absolute: ABSOLUTE_42,
      exceeds_200k_tokens: false,
      current_dir: project,
      project_dir: project,
      ts: '2026-10-15T12:34:56.789Z',
    });
  });

  it('331-01/AC-9: with no inner argv it writes no stdout and returns 0', async () => {
    const stdout = collector<Uint8Array>();
    const stderr = collector<string>();
    const code = await runStatusline({
      argv: ['--'],
      stdin: [payloadFor('payload-42.json', project)],
      stdout,
      stderr,
      cwdFallback: tmp,
      excludedCadenceDirs: REAL_EXCLUSIONS,
      recordDeadlineMs: GENEROUS_DEADLINE_MS,
    });
    expect(code).toBe(0);
    expect(Buffer.concat(stdout.chunks).length).toBe(0);
    expect(stderr.chunks).toEqual([]);
    expect(readReading(project)['used_percentage']).toBe(42);
  });

  it('331-01/AC-9: a missing inner executable yields one stderr line naming it and exit 127', async () => {
    const missing = join(tmp, 'no-such-statusline-exe');
    const stdout = collector<Uint8Array>();
    const stderr = collector<string>();
    const code = await runStatusline({
      argv: [missing, '--flag'],
      stdin: [payloadFor('payload-42.json', project)],
      stdout,
      stderr,
      cwdFallback: tmp,
      excludedCadenceDirs: REAL_EXCLUSIONS,
      recordDeadlineMs: GENEROUS_DEADLINE_MS,
    });
    expect(code).toBe(127);
    expect(Buffer.concat(stdout.chunks).length).toBe(0);
    expect(stderr.chunks).toHaveLength(1);
    expect(stderr.chunks[0]).toContain(missing);
    expect(stderr.chunks[0]).toMatch(/\n$/);
    expect((stderr.chunks[0] as string).slice(0, -1)).not.toContain('\n');
  });

  it('331-01/AC-9: an excluded .cadence dir is not treated as a project', async () => {
    const fakeHome = join(tmp, 'home');
    mkdirSync(join(fakeHome, '.cadence'), { recursive: true });
    mkdirSync(join(fakeHome, 'work'));
    // The walk continues above the fake home, so the real user-level store
    // must stay excluded too, or this test would write into it.
    const realBefore = snapshotUserStoreReading();
    const stderr = collector<string>();
    const code = await runStatusline({
      argv: [],
      stdin: [payloadFor('payload-42.json', join(fakeHome, 'work'))],
      stdout: collector<Uint8Array>(),
      stderr,
      cwdFallback: tmp,
      excludedCadenceDirs: [...defaultExcludedCadenceDirs({}, fakeHome), ...REAL_EXCLUSIONS],
      recordDeadlineMs: GENEROUS_DEADLINE_MS,
    });
    expect(code).toBe(0);
    expect(stderr.chunks).toEqual([]);
    expect(readdirSync(join(fakeHome, '.cadence'))).toEqual([]);
    expect(snapshotUserStoreReading()).toEqual(realBefore);
  });

  it('331-01/AC-9: an alias (junction or dir symlink) of an excluded .cadence dir is still excluded, in both directions', async () => {
    const fakeHome = join(tmp, 'aliashome');
    mkdirSync(join(fakeHome, '.cadence'), { recursive: true });
    mkdirSync(join(fakeHome, 'work'));
    const alias = join(tmp, 'alias');
    symlinkSync(fakeHome, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(realpathSync.native(join(alias, '.cadence'))).toBe(realpathSync.native(join(fakeHome, '.cadence')));
    const realBefore = snapshotUserStoreReading();

    // Session through the alias, exclusion named by the real path; then the
    // exclusion named through the alias, session by the real path.
    const cases: ReadonlyArray<readonly [string, string]> = [
      [join(alias, 'work'), fakeHome],
      [join(fakeHome, 'work'), alias],
    ];
    for (const [sessionDir, excludedHome] of cases) {
      const stderr = collector<string>();
      const code = await runStatusline({
        argv: [],
        stdin: [payloadFor('payload-42.json', sessionDir)],
        stdout: collector<Uint8Array>(),
        stderr,
        cwdFallback: tmp,
        excludedCadenceDirs: [...defaultExcludedCadenceDirs({}, excludedHome), ...REAL_EXCLUSIONS],
        recordDeadlineMs: GENEROUS_DEADLINE_MS,
      });
      expect(code, sessionDir).toBe(0);
      expect(stderr.chunks, sessionDir).toEqual([]);
      expect(readdirSync(join(fakeHome, '.cadence')), sessionDir).toEqual([]);
    }
    expect(snapshotUserStoreReading()).toEqual(realBefore);
  });

  it('331-01/AC-9: a session dir that does not exist records nothing and emits one notice', async () => {
    const gone = join(project, 'deleted-subdir');
    const stderr = collector<string>();
    const code = await runStatusline({
      argv: [],
      stdin: [payloadFor('payload-42.json', gone)],
      stdout: collector<Uint8Array>(),
      stderr,
      cwdFallback: tmp,
      excludedCadenceDirs: REAL_EXCLUSIONS,
      recordDeadlineMs: GENEROUS_DEADLINE_MS,
    });
    expect(code).toBe(0);
    expect(stderr.chunks).toHaveLength(1);
    expect(stderr.chunks[0]).toContain('deleted-subdir');
    expect(existsSync(join(project, '.cadence', 'checkpoint'))).toBe(false);
  });

  it('331-01/AC-9: an inner that never reads stdin and exits early does not crash the wrapper', async () => {
    const quick = join(tmp, 'quick.cjs');
    writeFileSync(quick, "process.stdout.write('ok'); process.exit(4);\n");
    const big = Buffer.concat([payloadFor('payload-42.json', project), Buffer.alloc(4 * 1024 * 1024, 0x20)]);
    const stdout = collector<Uint8Array>();
    const code = await runStatusline({
      argv: [process.execPath, quick],
      stdin: [big],
      stdout,
      stderr: collector<string>(),
      cwdFallback: tmp,
      excludedCadenceDirs: REAL_EXCLUSIONS,
      recordDeadlineMs: GENEROUS_DEADLINE_MS,
    });
    expect(code).toBe(4);
    expect(Buffer.concat(stdout.chunks).toString('utf8')).toBe('ok');
  });

  it('331-01/AC-9: a reading write that never finishes is abandoned at the deadline; stdout and the exit code are unaffected', async () => {
    const input = payloadFor('payload-42.json', project);
    const stdout = collector<Uint8Array>();
    const stderr = collector<string>();
    const run = runStatusline({
      argv: ['--', process.execPath, INNER, '3'],
      stdin: [input],
      stdout,
      stderr,
      cwdFallback: tmp,
      excludedCadenceDirs: REAL_EXCLUSIONS,
      recordDeadlineMs: 50,
      writeReading: () => new Promise<void>(() => undefined),
    });
    // Fails fast (not at vitest's 20 s timeout) when the wrapper still waits.
    const outcome = await Promise.race([
      run.then((code) => ({ code })),
      new Promise<'hung'>((done) => setTimeout(() => done('hung'), 5000)),
    ]);
    expect(outcome).toEqual({ code: 3 });
    expect(Buffer.concat(stdout.chunks).equals(runInnerDirect(input).stdout)).toBe(true);
    expect(stderr.chunks).toHaveLength(1);
    expect(stderr.chunks[0]).toMatch(/^checkpoint statusline: reading not recorded within 50 ms/);
    expect((stderr.chunks[0] as string).slice(0, -1)).not.toContain('\n');
  });

  it('331-01/AC-9: a project walk that stalls (e.g. a hung network path) is bounded by the same deadline, and the inner still runs', async () => {
    const input = payloadFor('payload-42.json', project);
    const stdout = collector<Uint8Array>();
    const stderr = collector<string>();
    let walked = 0;
    const run = runStatusline({
      argv: ['--', process.execPath, INNER, '2'],
      stdin: [input],
      stdout,
      stderr,
      cwdFallback: tmp,
      recordDeadlineMs: 50,
      isProjectMarker: () => {
        walked++;
        return new Promise<boolean>(() => undefined);
      },
    });
    const outcome = await Promise.race([
      run.then((code) => ({ code })),
      new Promise<'hung'>((done) => setTimeout(() => done('hung'), 5000)),
    ]);
    expect(outcome).toEqual({ code: 2 });
    expect(walked).toBe(1);
    expect(Buffer.concat(stdout.chunks).equals(runInnerDirect(input).stdout)).toBe(true);
    expect(stderr.chunks).toHaveLength(1);
    expect(stderr.chunks[0]).toMatch(/^checkpoint statusline: reading not recorded within 50 ms/);
  });

  it('331-01/AC-9: a stderr that throws while a notice is written never makes runStatusline reject', async () => {
    const throwing = {
      write(): never {
        throw new Error('EPIPE on stderr');
      },
    };
    await expect(
      runStatusline({
        argv: [],
        stdin: [Buffer.from('not json', 'utf8')],
        stdout: collector<Uint8Array>(),
        stderr: throwing,
        cwdFallback: tmp,
        excludedCadenceDirs: REAL_EXCLUSIONS,
      }),
    ).resolves.toBe(0);
  });

  it('331-01/AC-9: an abandoned write that fails later adds no second notice', async () => {
    const stderr = collector<string>();
    let failLater: Promise<void> = Promise.resolve();
    const code = await runStatusline({
      argv: [],
      stdin: [payloadFor('payload-42.json', project)],
      stdout: collector<Uint8Array>(),
      stderr,
      cwdFallback: tmp,
      excludedCadenceDirs: REAL_EXCLUSIONS,
      recordDeadlineMs: 20,
      writeReading: () => {
        failLater = new Promise<void>((_, reject) => setTimeout(() => reject(Object.assign(new Error('late'), { code: 'EBUSY' })), 100));
        return failLater;
      },
    });
    expect(code).toBe(0);
    await failLater.catch(() => undefined);
    await new Promise((done) => setTimeout(done, 20));
    expect(stderr.chunks).toHaveLength(1);
    expect(stderr.chunks[0]).toContain('not recorded within 20 ms');
  });

  it('331-01/AC-9: a write that finishes inside the deadline is awaited and emits no notice', async () => {
    const stderr = collector<string>();
    const writes: Array<[string, string]> = [];
    const code = await runStatusline({
      argv: [],
      stdin: [payloadFor('payload-42.json', project)],
      stdout: collector<Uint8Array>(),
      stderr,
      cwdFallback: tmp,
      now: () => FIXED_NOW,
      excludedCadenceDirs: REAL_EXCLUSIONS,
      recordDeadlineMs: 2000,
      writeReading: async (path, text) => {
        await new Promise((done) => setTimeout(done, 30));
        writes.push([path, text]);
      },
    });
    expect(code).toBe(0);
    expect(stderr.chunks).toEqual([]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe(checkpointReadingPath(project));
    expect((JSON.parse(writes[0]?.[1] ?? '') as Json)['used_percentage']).toBe(42);
  });

  it('331-02/AC-1: the record deadline is a 1500 ms statusline-hold ceiling (Claude Code renders only on exit; 300 ms is a debounce between runs, not a budget)', () => {
    expect(RECORD_DEADLINE_MS).toBe(1500);
  });

  it('331-02/AC-1: without recordDeadlineMs a never-settling write is abandoned with one notice naming 1500 ms, and the inner result is returned', async () => {
    const input = payloadFor('payload-42.json', project);
    const stdout = collector<Uint8Array>();
    const stderr = collector<string>();
    const code = await runStatusline({
      argv: ['--', process.execPath, INNER, '4'],
      stdin: [input],
      stdout,
      stderr,
      cwdFallback: tmp,
      now: () => FIXED_NOW,
      excludedCadenceDirs: REAL_EXCLUSIONS,
      writeReading: () => new Promise<void>(() => undefined),
    });
    expect(code).toBe(4);
    expect(Buffer.concat(stdout.chunks).equals(runInnerDirect(input).stdout)).toBe(true);
    expect(stderr.chunks).toHaveLength(1);
    expect(stderr.chunks[0]).toMatch(/reading not recorded within 1500 ms/);
  });

  it('331-02/AC-3: the inner stdout is written as it arrives, before the inner exits', async () => {
    const signal = join(tmp, 'signal');
    const captured: string[] = [];
    const stdout = {
      write(chunk: Uint8Array): boolean {
        captured.push(Buffer.from(chunk).toString('utf8'));
        return true;
      },
    };
    // Joined, so a pipe read that splits the first chunk still counts.
    const firstArrived = (): boolean => captured.join('').includes('first');
    const run = runStatusline({
      argv: ['--', process.execPath, join(FIXTURES, 'inner-two-chunks.cjs'), signal],
      stdin: [payloadFor('payload-42.json', project)],
      stdout,
      stderr: collector<string>(),
      cwdFallback: tmp,
      now: () => FIXED_NOW,
      excludedCadenceDirs: REAL_EXCLUSIONS,
      recordDeadlineMs: GENEROUS_DEADLINE_MS,
    });
    // Bounded wait in the test body for the first chunk; not a vitest timeout.
    const waitUntil = Date.now() + 10_000;
    while (!firstArrived() && Date.now() < waitUntil) {
      await new Promise((done) => setTimeout(done, 10));
    }
    const firstSeenBeforeSignal = firstArrived();
    // Unconditional, so the inner always exits and nothing hangs.
    writeFileSync(signal, 'go');
    const code = await run;
    expect(code).toBe(0);
    expect(firstSeenBeforeSignal).toBe(true);
    expect(captured.join('')).toBe('first\nsecond');
    expect(captured.length).toBeGreaterThan(1);
  });
});

describe('exitAfterFlush', () => {
  it('331-01/AC-9: exits with the code only after stdout and then stderr have flushed', async () => {
    const events: string[] = [];
    const pending: Array<() => void> = [];
    const stream = (name: string): { write(chunk: string, cb: () => void): boolean } => ({
      write(chunk: string, cb: () => void): boolean {
        events.push(`${name}:write:${JSON.stringify(chunk)}`);
        pending.push(() => {
          events.push(`${name}:flushed`);
          cb();
        });
        return true;
      },
    });
    exitAfterFlush(7, { stdout: stream('stdout'), stderr: stream('stderr') }, (code) => events.push(`exit:${code}`));
    expect(events).toEqual(['stdout:write:""']);
    pending.shift()?.();
    expect(events).toEqual(['stdout:write:""', 'stdout:flushed', 'stderr:write:""']);
    pending.shift()?.();
    expect(events).toEqual(['stdout:write:""', 'stdout:flushed', 'stderr:write:""', 'stderr:flushed', 'exit:7']);
  });
});

// ---------------------------------------------------------------------------
// CLI-level: the built wrapper, spawned directly with no shell
// ---------------------------------------------------------------------------

describe('checkpoint statusline (built wrapper, no shell)', () => {
  it('331-01/AC-1 (state-file half): payload-42 records used_percentage 42 with absolutes and an ISO ts, stdout byte-equal to the inner', () => {
    const input = payloadFor('payload-42.json', project);
    const direct = runInnerDirect(input);
    expect(direct.status).toBe(0);
    // The fixture really carries what a lossy pass-through would mangle.
    const text = direct.stdout.toString('utf8');
    expect(text).toContain('\u001b[32m');
    expect(text).toContain('Ünïcødé — 日本');
    expect(text).toContain('model:\u001b[0m Opus\n');
    expect(text).not.toContain('\r');
    expect(text.endsWith('\n')).toBe(false);

    const before = Date.now();
    const wrapped = runWrapper(input, ['--', process.execPath, INNER]);
    const after = Date.now();
    expect(wrapped.stderr).toBe('');
    expect(wrapped.status).toBe(0);
    expect(wrapped.stdout.equals(direct.stdout)).toBe(true);

    const reading = readReading(project);
    expect(reading).toEqual({
      used_percentage: 42,
      unknown: false,
      absolute: ABSOLUTE_42,
      exceeds_200k_tokens: false,
      current_dir: project,
      project_dir: project,
      ts: expect.stringMatching(ISO) as unknown as string,
    });
    const ts = Date.parse(reading['ts'] as string);
    expect(ts).toBeGreaterThanOrEqual(before - 1);
    expect(ts).toBeLessThanOrEqual(after + 1);
    expect(readdirSync(join(project, '.cadence', 'checkpoint'))).toEqual(['reading.json']);
  });

  for (const fixture of ['payload-null.json', 'payload-compacted.json']) {
    it(`331-01/AC-2: ${fixture} records nulls and unknown, computes no percentage, and leaves a seeded state.json byte-unchanged`, () => {
      const statePath = join(project, '.cadence', 'checkpoint', 'state.json');
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(statePath, '{  "state":"armed",\r\n "since":"2026-01-01T00:00:00.000Z"}');
      const stateBefore = readFileSync(statePath);
      const mtimeBefore = statSync(statePath).mtimeMs;

      const input = payloadFor(fixture, project);
      const wrapped = runWrapper(input, ['--', process.execPath, INNER]);
      expect(wrapped.status).toBe(0);
      expect(wrapped.stderr).toBe('');
      expect(wrapped.stdout.equals(runInnerDirect(input).stdout)).toBe(true);

      const payload = loadPayload(fixture);
      const cw = payload['context_window'] as Json;
      const reading = readReading(project);
      expect(reading).toEqual({
        used_percentage: null,
        unknown: true,
        absolute: {
          total_input_tokens: cw['total_input_tokens'],
          total_output_tokens: cw['total_output_tokens'],
          context_window_size: cw['context_window_size'],
          current_usage: cw['current_usage'],
        },
        exceeds_200k_tokens: false,
        current_dir: project,
        project_dir: project,
        ts: expect.stringMatching(ISO) as unknown as string,
      });
      expect(readFileSync(statePath).equals(stateBefore)).toBe(true);
      expect(statSync(statePath).mtimeMs).toBe(mtimeBefore);
    });

    it(`331-01/AC-2: ${fixture} does not create state.json`, () => {
      const wrapped = runWrapper(payloadFor(fixture, project), []);
      expect(wrapped.status).toBe(0);
      expect(readReading(project)['unknown']).toBe(true);
      expect(readdirSync(join(project, '.cadence', 'checkpoint'))).toEqual(['reading.json']);
    });
  }

  it('331-01/AC-9: when .cadence/checkpoint is a file, stdout is still byte-identical, the exit code is forwarded, and one notice goes to stderr', () => {
    const blocker = join(project, '.cadence', 'checkpoint');
    writeFileSync(blocker, 'not a directory');
    const input = payloadFor('payload-42.json', project);
    const direct = runInnerDirect(input, ['3']);
    expect(direct.status).toBe(3);

    const wrapped = runWrapper(input, ['--', process.execPath, INNER, '3']);
    expect(wrapped.stdout.equals(direct.stdout)).toBe(true);
    expect(wrapped.status).toBe(3);
    const lines = stderrLines(wrapped.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^checkpoint statusline: reading not recorded: cannot write /);
    expect(lines[0]).toContain(checkpointReadingPath(project));
    expect(lines[0]).toMatch(/\([A-Z]+\)$/);
    expect(wrapped.stderr).not.toMatch(/\n\s+at /);
    expect(readFileSync(blocker, 'utf8')).toBe('not a directory');
    expect(existsSync(join(project, '.cadence', 'state.json'))).toBe(false);
  });

  it('331-01/AC-9: with no .cadence/ in the session dir or any ancestor, stdout is identical and nothing is created', () => {
    const bare = join(tmp, 'bare', 'deep');
    mkdirSync(bare, { recursive: true });
    // Verify the "no .cadence anywhere" premise rather than assume it: the
    // only .cadence allowed up the chain is the user-level ~/.cadence store,
    // which the sensor excludes as a non-project marker.
    // Compared by realpath, so an 8.3 short-name or symlinked TMPDIR/home can
    // never make a project marker look like the excluded store.
    const userStore = canonical(resolve(homedir(), '.cadence'));
    const found: string[] = [];
    for (let dir = bare; ; dir = dirname(dir)) {
      if (existsSync(join(dir, '.cadence'))) found.push(canonical(join(dir, '.cadence')));
      if (dirname(dir) === dir) break;
    }
    for (const marker of found) expect(marker).toBe(userStore);
    const userReadingBefore = snapshotUserStoreReading();

    const input = payloadFor('payload-42.json', bare);
    const direct = runInnerDirect(input, ['2']);
    const wrapped = runWrapper(input, ['--', process.execPath, INNER, '2']);
    expect(wrapped.stdout.equals(direct.stdout)).toBe(true);
    expect(wrapped.status).toBe(2);
    expect(wrapped.stderr).toBe('');
    expect(existsSync(join(tmp, 'bare', '.cadence'))).toBe(false);
    expect(existsSync(join(bare, '.cadence'))).toBe(false);
    expect(snapshotUserStoreReading()).toEqual(userReadingBefore);
  });

  it('331-01/AC-9: a CADENCE_HOME store is excluded too, so a session under it records nothing', () => {
    const fakeHome = join(tmp, 'fakehome');
    const store = join(fakeHome, '.cadence');
    mkdirSync(store, { recursive: true });
    const sub = join(fakeHome, 'sub');
    mkdirSync(sub);
    const alias = join(tmp, 'fakehome-alias');
    symlinkSync(fakeHome, alias, process.platform === 'win32' ? 'junction' : 'dir');
    // The walk continues above the fake home; the real user-level store must
    // stay untouched too.
    expect(canonical(store)).not.toBe(canonical(resolve(homedir(), '.cadence')));
    const realBefore = snapshotUserStoreReading();
    const input = payloadFor('payload-42.json', sub);
    // CADENCE_HOME named directly, then through a junction/symlink alias.
    for (const cadenceHome of [store, join(alias, '.cadence')]) {
      const wrapped = runWrapper(input, ['--', process.execPath, INNER], {
        env: { ...process.env, CADENCE_HOME: cadenceHome },
      });
      expect(wrapped.status, cadenceHome).toBe(0);
      expect(wrapped.stderr, cadenceHome).toBe('');
      expect(wrapped.stdout.equals(runInnerDirect(input).stdout), cadenceHome).toBe(true);
      expect(readdirSync(store), cadenceHome).toEqual([]);
      expect(existsSync(join(sub, '.cadence')), cadenceHome).toBe(false);
    }
    expect(snapshotUserStoreReading()).toEqual(realBefore);
  });

  it('331-01/AC-9: malformed stdin still yields byte-identical stdout and one stderr notice, and records nothing', () => {
    const input = Buffer.from('{"context_window": {"used_percentage": 4', 'utf8');
    const direct = runInnerDirect(input);
    const wrapped = runWrapper(input, ['--', process.execPath, INNER], { cwd: project });
    expect(wrapped.stdout.equals(direct.stdout)).toBe(true);
    expect(wrapped.stdout.toString('utf8')).toContain('model:\u001b[0m ?');
    expect(wrapped.status).toBe(0);
    const lines = stderrLines(wrapped.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/not valid JSON/);
    expect(existsSync(join(project, '.cadence', 'checkpoint'))).toBe(false);
  });

  it('331-01/AC-9: a missing inner executable writes one stderr notice naming it, no stack trace, and exits nonzero', () => {
    const missing = join(tmp, 'no-such-statusline-exe');
    const wrapped = runWrapper(payloadFor('payload-42.json', project), ['--', missing, 'arg']);
    expect(wrapped.status).not.toBe(0);
    expect(wrapped.status).toBe(127);
    expect(wrapped.stdout.length).toBe(0);
    const lines = stderrLines(wrapped.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(missing);
    expect(wrapped.stderr).not.toMatch(/\n\s+at /);
    expect(wrapped.stderr).not.toMatch(/Error:/);
  });

  it('331-01/AC-9: a session cwd below the project root records at the root .cadence/checkpoint/', () => {
    const nested = join(project, 'packages', 'deep', 'dir');
    mkdirSync(nested, { recursive: true });
    const wrapped = runWrapper(payloadFor('payload-42.json', nested), ['--', process.execPath, INNER]);
    expect(wrapped.status).toBe(0);
    expect(wrapped.stderr).toBe('');
    const reading = readReading(project);
    expect(reading['current_dir']).toBe(nested);
    expect(reading['used_percentage']).toBe(42);
    expect(existsSync(join(nested, '.cadence'))).toBe(false);
  });

  it('331-01/AC-9: in a worktree-shaped layout the reading lands under current_dir\'s nearest .cadence/, recording both dirs', () => {
    const primary = project;
    const worktree = join(primary, '.claude', 'worktrees', 'wt');
    mkdirSync(join(worktree, '.cadence'), { recursive: true });
    const wrapped = runWrapper(payloadFor('payload-42.json', worktree, primary), ['--', process.execPath, INNER]);
    expect(wrapped.status).toBe(0);
    expect(wrapped.stderr).toBe('');
    const reading = readReading(worktree);
    expect(reading['current_dir']).toBe(worktree);
    expect(reading['project_dir']).toBe(primary);
    expect(existsSync(join(primary, '.cadence', 'checkpoint'))).toBe(false);
  });

  it('331-01/AC-9: falls back to the payload cwd, then the process cwd, to find the project', () => {
    const payload = loadPayload('payload-42.json');
    delete payload['workspace'];
    payload['cwd'] = project;
    const viaCwd = runWrapper(Buffer.from(JSON.stringify(payload)), []);
    expect(viaCwd.status).toBe(0);
    expect(readReading(project)['current_dir']).toBeNull();

    rmSync(join(project, '.cadence', 'checkpoint'), { recursive: true });
    delete payload['cwd'];
    const viaProcess = runWrapper(Buffer.from(JSON.stringify(payload)), [], { cwd: project });
    expect(viaProcess.status).toBe(0);
    expect(readReading(project)['used_percentage']).toBe(42);
  });

  it('331-01/AC-9: the exit code of the inner is forwarded', () => {
    const input = payloadFor('payload-42.json', project);
    for (const code of [0, 1, 3]) {
      const wrapped = runWrapper(input, ['--', process.execPath, INNER, String(code)]);
      expect(wrapped.status).toBe(code);
    }
  });

  it('331-01/AC-9: the -- separator is optional', () => {
    const input = payloadFor('payload-42.json', project);
    const direct = runInnerDirect(input);
    const without = runWrapper(input, [process.execPath, INNER]);
    expect(without.status).toBe(0);
    expect(without.stdout.equals(direct.stdout)).toBe(true);
    expect(readReading(project)['used_percentage']).toBe(42);
  });

  it('331-01/AC-9: inner output far larger than a pipe buffer reaches stdout whole before the wrapper exits', () => {
    const big = join(tmp, 'big.cjs');
    // 4 MiB of a non-repeating-per-pipe-buffer byte pattern, then exit 6.
    writeFileSync(
      big,
      'const b = Buffer.alloc(4 * 1024 * 1024); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + (i >> 12)) & 0xff;\n' +
        'process.stdout.write(b, () => { process.exitCode = 6; });\n',
    );
    const expected = Buffer.alloc(4 * 1024 * 1024);
    for (let i = 0; i < expected.length; i++) expected[i] = (i * 31 + (i >> 12)) & 0xff;
    const r = spawnSync(process.execPath, [BIN, 'statusline', '--', process.execPath, big], {
      input: payloadFor('payload-42.json', project),
      windowsHide: true,
      env: sensorEnv(),
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(r.stderr.toString('utf8')).toBe('');
    expect(r.status).toBe(6);
    expect(r.stdout.length).toBe(expected.length);
    expect(r.stdout.equals(expected)).toBe(true);
    expect(readReading(project)['used_percentage']).toBe(42);
  });

  it('331-01/AC-9: with no inner argv the wrapper writes empty stdout and exits 0', () => {
    for (const args of [[], ['--']]) {
      const wrapped = runWrapper(payloadFor('payload-42.json', project), args);
      expect(wrapped.status).toBe(0);
      expect(wrapped.stdout.length).toBe(0);
      expect(wrapped.stderr).toBe('');
    }
    expect(readReading(project)['used_percentage']).toBe(42);
  });

  it('keeps `checkpoint validate` usage intact', () => {
    const r = spawnSync(process.execPath, [BIN], { windowsHide: true });
    expect(r.status).toBe(2);
    expect(r.stderr.toString('utf8')).toContain('Usage: checkpoint validate <path>');
    expect(r.stderr.toString('utf8')).toContain('checkpoint statusline');
  });
});

describe('checkpoint statusline (built wrapper process shape)', () => {
  function runWrapperAsync(
    input: Buffer,
    args: string[],
  ): Promise<{ pid: number | undefined; status: number | null; stdout: Buffer }> {
    return new Promise((done, fail) => {
      const child = spawn(process.execPath, [BIN, 'statusline', ...args], {
        windowsHide: true,
        // A developer's exported override must not change what this test runs.
        env: envWithout('CADENCE_HOME', 'CHECKPOINT_RECORD_DEADLINE_MS'),
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const out: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.on('error', fail);
      child.on('close', (status) => done({ pid: child.pid, status, stdout: Buffer.concat(out) }));
      child.stdin.on('error', () => undefined);
      child.stdin.end(input);
    });
  }

  it('331-02/AC-2: the inner statusline is a direct child of the spawned bin process, with stdout and exit code forwarded', async () => {
    const fixture = join(FIXTURES, 'inner-ppid.cjs');
    // This test is about process shape, not recording: tmp holds no .cadence of
    // its own (a .cadence in an ancestor of the OS temp dir would still get a
    // reading, as in the AC-9 "no .cadence in any ancestor" test).
    const input = payloadFor('payload-42.json', tmp);
    const side = join(tmp, 'ppid.txt');
    const direct = spawnSync(process.execPath, [fixture, join(tmp, 'ppid-direct.txt')], { input, windowsHide: true });

    const ok = await runWrapperAsync(input, ['--', process.execPath, fixture, side]);
    expect(ok.pid).toBeDefined();
    expect(readFileSync(side, 'utf8')).toBe(String(ok.pid));
    expect(ok.status).toBe(0);
    expect(ok.stdout.equals(direct.stdout)).toBe(true);

    const failing = await runWrapperAsync(input, ['--', process.execPath, fixture, join(tmp, 'ppid-3.txt'), '3']);
    expect(failing.status).toBe(3);
  });
});

describe('checkpoint statusline (built wrapper, deadline override wiring)', () => {
  /**
   * Runs the built wrapper (no inner) with a preload that makes
   * fs/promises' stat never settle in the wrapper process only, so the
   * recording can never finish and the outcome depends only on the deadline:
   * the notice names the deadline the statusline command actually used.
   */
  function runWithHungWalk(deadline: string | undefined): { status: number | null; stderr: string } {
    const preload = join(tmp, 'hang-walk.cjs');
    writeFileSync(
      preload,
      "if (process.argv.includes('statusline')) {\n" +
        "  const fsp = require('node:fs/promises');\n" +
        '  fsp.stat = () => new Promise(() => undefined);\n' +
        "  require('node:module').syncBuiltinESMExports();\n" +
        '}\n',
    );
    const env = envWithout('CADENCE_HOME', 'CHECKPOINT_RECORD_DEADLINE_MS');
    env['NODE_OPTIONS'] = `--require ${JSON.stringify(preload)}`;
    if (deadline !== undefined) env['CHECKPOINT_RECORD_DEADLINE_MS'] = deadline;
    const r = spawnSync(process.execPath, [BIN, 'statusline'], {
      input: payloadFor('payload-42.json', project),
      windowsHide: true,
      env,
    });
    return { status: r.status, stderr: r.stderr.toString('utf8') };
  }

  it('331-02/AC-7: the statusline command uses a valid CHECKPOINT_RECORD_DEADLINE_MS and ignores an invalid one', () => {
    const valid = runWithHungWalk('37');
    expect(valid.status).toBe(0);
    expect(valid.stderr).toBe('checkpoint statusline: reading not recorded within 37 ms of the inner exiting; abandoned it\n');

    const invalid = runWithHungWalk('abc');
    expect(invalid.status).toBe(0);
    expect(invalid.stderr).toBe('checkpoint statusline: reading not recorded within 1500 ms of the inner exiting; abandoned it\n');
  });
});

describe('checkpoint statusline (built wrapper, real stdout pipe)', () => {
  interface PipedRun {
    child: ReturnType<typeof spawn>;
    stdout: () => string;
    stderr: () => string;
    /** The wrapper's exit status; null if the test body's guard had to kill it. */
    closed: Promise<number | null>;
  }

  /**
   * `node bin/checkpoint.cjs statusline -- node inner-two-chunks.cjs <signal> <code>` with all three stdio
   * piped, and the generous deadline: both callers assert a recorded reading.
   */
  function spawnTwoChunks(input: Buffer, signal: string, code: number): PipedRun {
    const child = spawn(
      process.execPath,
      [BIN, 'statusline', '--', process.execPath, join(FIXTURES, 'inner-two-chunks.cjs'), signal, String(code)],
      { windowsHide: true, env: sensorEnv(), stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    // A wrapper that never exits is killed here, in the test body, so the
    // assertions report it instead of a hung test.
    const guard = setTimeout(() => child.kill(), 15_000);
    const closed = new Promise<number | null>((done, fail) => {
      child.on('error', fail);
      child.on('close', (status) => {
        clearTimeout(guard);
        done(status);
      });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
    return {
      child,
      stdout: () => Buffer.concat(out).toString('utf8'),
      stderr: () => Buffer.concat(err).toString('utf8'),
      closed,
    };
  }

  /** Bounded wait in the test body; not a vitest timeout. */
  async function waitFor(condition: () => boolean, ms = 10_000): Promise<boolean> {
    const until = Date.now() + ms;
    while (!condition() && Date.now() < until) {
      await new Promise((done) => setTimeout(done, 10));
    }
    return condition();
  }

  it('331-02/AC-3: through a real pipe the first chunk reaches the reader before the inner exits, and the whole output and exit code follow', async () => {
    const signal = join(tmp, 'signal');
    const run = spawnTwoChunks(payloadFor('payload-42.json', project), signal, 3);
    const firstSeenBeforeSignal = await waitFor(() => run.stdout().includes('first'));
    // Unconditional, so the inner always exits and nothing hangs.
    writeFileSync(signal, 'go');
    const status = await run.closed;
    expect(firstSeenBeforeSignal).toBe(true);
    expect(status).toBe(3);
    expect(run.stdout()).toBe('first\nsecond');
    expect(run.stderr()).toBe('');
    expect(readReading(project)['used_percentage']).toBe(42);
  });

  it('331-02/AC-6: a reader that closes the stdout pipe mid-run does not crash the wrapper; the exit code is forwarded and the reading recorded', async () => {
    const signal = join(tmp, 'signal');
    const run = spawnTwoChunks(payloadFor('payload-42.json', project), signal, 5);
    const firstSeen = await waitFor(() => run.stdout().includes('first'));
    // The statusline reader goes away: the wrapper's next stdout write (the
    // inner's second chunk) goes into a pipe with no read end. That write
    // fails on every OS whatever its size: EPIPE on a Windows pipe, EPIPE (or
    // ECONNRESET) on the AF_UNIX socketpair Node uses for 'pipe' stdio on
    // POSIX, where Node ignores SIGPIPE. Nothing else holds the read end,
    // since the inner's stdout is its own pipe into the wrapper.
    run.child.stdout?.destroy();
    writeFileSync(signal, 'go');
    const status = await run.closed;
    const stderr = run.stderr();
    expect(firstSeen).toBe(true);
    expect(stderr).not.toContain("Unhandled 'error'");
    expect(stderr).not.toContain('EPIPE');
    expect(stderr).not.toMatch(/^\s+at /m);
    for (const line of stderrLines(stderr)) expect(line).toMatch(/^checkpoint statusline: /);
    expect(status).toBe(5);
    expect(readReading(project)['used_percentage']).toBe(42);
  });
});
