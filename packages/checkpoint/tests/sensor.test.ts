import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
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

/** The inner statusline run directly, no wrapper, no shell. */
function runInnerDirect(input: Buffer, extra: string[] = []): ProcResult {
  const r = spawnSync(process.execPath, [INNER, ...extra], { input, windowsHide: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr.toString('utf8') };
}

/** The built wrapper: `node bin/checkpoint.cjs statusline <args...>`, no shell. */
function runWrapper(
  input: Buffer,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): ProcResult {
  const r = spawnSync(process.execPath, [BIN, 'statusline', ...args], {
    input,
    windowsHide: true,
    env: opts.env ?? envWithout('CADENCE_HOME'),
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

  it('defaults the record deadline to 250 ms, inside Claude Code\'s 300 ms statusline debounce', () => {
    expect(RECORD_DEADLINE_MS).toBe(250);
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
      env: envWithout('CADENCE_HOME'),
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
