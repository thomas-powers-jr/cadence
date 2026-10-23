import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
// Test-only import by relative SOURCE path, exactly as stop-gate.test.ts and
// drift-sections.test.ts do: the SESSION docs below come from core's REAL
// renderer, not hand-written markdown.
import { renderSession } from '../../core/src/handoff/render-session.js';
import type { SessionRenderInput } from '../../core/src/handoff/render-session.js';
import { checkpointReadingPath } from '../src/sensor.js';
import { checkpointStatePath, transitionStore, updateStoreExtras } from '../src/state.js';
import {
  effectivePercentage,
  newestHandoffAfter,
  parseStopPayload,
  readingFromJson,
  runStopGate,
} from '../src/stop-gate.js';
import type { StopGateStore } from '../src/stop-gate.js';

const BIN = join(__dirname, '..', 'bin', 'checkpoint.cjs');
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------------------------------------------------------------------------
// Fixtures: core's real SESSION renderer, input mirroring stop-gate.test.ts.
// ---------------------------------------------------------------------------

const INPUT: SessionRenderInput = {
  generatedAt: '2026-06-03T14:02:00.000Z',
  label: 'stop-gate-cli',
  packet: {
    schemaVersion: 1,
    scope: 'handoff',
    generatedAt: '2026-06-03T14:02:00.000Z',
    loop: { present: true, loopPosition: 'BUILD', activePhase: '46-handoff', activeDraft: null, tier: 'standard' },
    recommendations: [],
    assumptions: [],
    decisions: [],
    files: [],
    totals: { recommendations: 0, assumptions: 0, decisions: 0, files: 0, recommendationsOmitted: 0 },
  },
  git: {
    available: true,
    branch: 'main',
    dirty: true,
    ahead: 0,
    behind: 0,
    head: 'abc1234',
    recentCommits: 'abc1234 feat: x',
    diffStat: ' 1 file changed',
    fetched: true,
  },
  contextPacketPath: '.cadence/intelligence/context/handoff.json',
};

const RENDERED = renderSession(INPUT);

/** Core's own marker predicate (placeholders.ts): a line holding both `<!--` and `FILL IN`. */
function isMarkerLine(line: string): boolean {
  return line.includes('<!--') && line.includes('FILL IN');
}

/** Replaces every marker line with narrative, except in the sections named in `keep`. */
function fillMarkers(doc: string, keep: readonly string[] = []): string {
  let current = '(preamble)';
  return doc
    .split('\n')
    .map((line) => {
      const heading = /^## (.+)$/.exec(line);
      if (heading) {
        current = ((heading[1] ?? '').split('·')[0] ?? '').trim();
        return line;
      }
      if (!isMarkerLine(line) || keep.includes(current)) return line;
      return current === 'Open decisions' ? 'None.' : `- Narrative written for ${current}.`;
    })
    .join('\n');
}

const FILLED = fillMarkers(RENDERED);
const UNFILLED_SECTIONS = ['What landed this session', 'Next action'] as const;
const TWO_UNFILLED = fillMarkers(RENDERED, UNFILLED_SECTIONS);
const DOC_NAME = 'SESSION-2026-10-22-1200-stop-gate-cli.md';

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A fresh canonical temp project holding a `.cadence/` directory. */
function newProject(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'checkpoint-stop-gate-cli-')));
  roots.push(root);
  const project = join(root, 'project');
  mkdirSync(join(project, '.cadence'), { recursive: true });
  return project;
}

/** A fresh canonical temp directory with no `.cadence/` anywhere in it. */
function newBareDir(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'checkpoint-stop-gate-bare-')));
  roots.push(root);
  return root;
}

function seedStore(project: string, record: Record<string, unknown>): void {
  mkdirSync(join(project, '.cadence', 'checkpoint'), { recursive: true });
  writeFileSync(checkpointStatePath(project), `${JSON.stringify(record, null, 2)}\n`);
}

function storeBytes(project: string): Buffer | null {
  const path = checkpointStatePath(project);
  return existsSync(path) ? readFileSync(path) : null;
}

function storeJson(project: string): Record<string, unknown> {
  return JSON.parse(readFileSync(checkpointStatePath(project), 'utf8')) as Record<string, unknown>;
}

/** The store's bytes with every timestamp masked, for comparing two runs taken at different instants. */
function maskedStore(project: string): string {
  const record = storeJson(project);
  for (const key of ['since', 'forcedAt', 'lastForcedAt']) if (key in record) record[key] = '<ts>';
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** A serialized `CheckpointReading`, shaped exactly as the sensor writes it. */
function readingText(usedPercentage: number | null, ts: string): string {
  const reading = {
    used_percentage: usedPercentage,
    unknown: !(typeof usedPercentage === 'number' && usedPercentage > 0),
    absolute: {
      total_input_tokens: 100_000,
      total_output_tokens: 7_000,
      context_window_size: 200_000,
      current_usage: {
        input_tokens: 50_000,
        output_tokens: 7_000,
        cache_creation_input_tokens: 10_000,
        cache_read_input_tokens: 40_000,
      },
    },
    exceeds_200k_tokens: false,
    current_dir: null,
    project_dir: null,
    ts,
  };
  return `${JSON.stringify(reading, null, 2)}\n`;
}

function writeReading(project: string, usedPercentage: number | null, ts = new Date().toISOString()): void {
  mkdirSync(join(project, '.cadence', 'checkpoint'), { recursive: true });
  writeFileSync(checkpointReadingPath(project), readingText(usedPercentage, ts));
}

function writeDoc(project: string, bytes: Buffer, mtime: Date = new Date(), name: string = DOC_NAME): string {
  const dir = join(project, '.cadence', 'handoff');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, bytes);
  utimesSync(path, mtime, mtime);
  return path;
}

function stopPayload(cwd: string, stopHookActive = false): string {
  return JSON.stringify({
    session_id: 'stop-gate-cli-test',
    transcript_path: join(cwd, 'transcript.jsonl'),
    cwd,
    permission_mode: 'default',
    hook_event_name: 'Stop',
    stop_hook_active: stopHookActive,
  });
}

function childEnv(): NodeJS.ProcessEnv {
  // CADENCE_HOME is dropped so a developer's own setting can never exclude
  // (or include) the temp project; HOME/USERPROFILE are kept, so the default
  // ~/.cadence exclusion still applies on the walk up from a bare temp dir.
  const env = { ...process.env };
  delete env['CADENCE_HOME'];
  return env;
}

interface BinResult {
  status: number | null;
  stdout: Buffer;
  stderr: string;
}

/** The built bin: `node bin/checkpoint.cjs stop-gate <args...>`, no shell. */
function runBin(args: readonly string[], input: string | Buffer): BinResult {
  const r = spawnSync(process.execPath, [BIN, 'stop-gate', ...args], {
    input,
    env: childEnv(),
    windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr.toString('utf8') };
}

function stderrLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

interface InProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runInProcess(
  args: readonly string[],
  payload: string,
  extra: { now?: () => Date; store?: StopGateStore; onStdout?: (chunk: string) => void } = {},
): Promise<InProcessResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runStopGate({
    argv: args,
    stdin: [Buffer.from(payload, 'utf8')],
    stdout: {
      write(chunk: string): boolean {
        extra.onStdout?.(chunk);
        out.push(chunk);
        return true;
      },
    },
    stderr: {
      write(chunk: string): boolean {
        err.push(chunk);
        return true;
      },
    },
    ...(extra.now !== undefined ? { now: extra.now } : {}),
    ...(extra.store !== undefined ? { store: extra.store } : {}),
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
}

const HOUR_MS = 60 * 60 * 1000;

function armedRecord(since: string): Record<string, unknown> {
  return { state: 'armed', since, instructed: true, blocks: 1 };
}

// ---------------------------------------------------------------------------
// AC-1: the threshold crossing blocks once and arms, store before stdout.
// ---------------------------------------------------------------------------

describe('checkpoint stop-gate (built bin): AC-1', () => {
  it('336-01/AC-1: idle + a reading at or above the threshold prints exactly one block line naming `cadence handoff`, exits 0, and arms the store', () => {
    const project = newProject();
    writeReading(project, 85);
    const before = Date.now();
    const r = runBin([], stopPayload(project));
    const after = Date.now();

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const stdout = r.stdout.toString('utf8');
    expect(stdout).toMatch(/^\{[^\n]*\}\n$/);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['decision', 'reason']);
    expect(parsed['decision']).toBe('block');
    expect(parsed['reason']).toContain('cadence handoff');
    expect(stdout).toBe(`${JSON.stringify(parsed)}\n`);

    const store = storeJson(project);
    expect(Object.keys(store)).toEqual(['state', 'since', 'instructed', 'blocks']);
    expect(store['state']).toBe('armed');
    expect(store['instructed']).toBe(true);
    expect(store['blocks']).toBe(1);
    expect(store['since']).toMatch(ISO);
    const since = Date.parse(store['since'] as string);
    expect(since).toBeGreaterThanOrEqual(before - 1000);
    expect(since).toBeLessThanOrEqual(after + 1000);
    expect(storeBytes(project)?.toString('utf8')).toBe(`${JSON.stringify(store, null, 2)}\n`);
  });

  it('336-01/AC-1: --threshold is honoured in both spellings (--threshold=50 blocks a 60% reading, --threshold 61 does not)', () => {
    const blocked = newProject();
    writeReading(blocked, 60);
    const low = runBin(['--threshold=50'], stopPayload(blocked));
    expect(low.status).toBe(0);
    expect(JSON.parse(low.stdout.toString('utf8'))).toMatchObject({ decision: 'block' });
    expect(storeJson(blocked)['state']).toBe('armed');

    const passed = newProject();
    writeReading(passed, 60);
    const high = runBin(['--threshold', '61', '--ceiling', '4', '--max-reading-age-s', '30'], stopPayload(passed));
    expect(high.status).toBe(0);
    expect(high.stdout.length).toBe(0);
    expect(high.stderr).toBe('');
    expect(storeBytes(passed)).toBeNull();
  });

  it('336-01/AC-1: the store reads armed before the block is written to stdout', async () => {
    const project = newProject();
    const now = new Date('2026-10-22T12:00:00.000Z');
    writeReading(project, 90, new Date(now.getTime() - 10_000).toISOString());
    const events: string[] = [];
    const store: StopGateStore = {
      transition: async (...args: Parameters<typeof transitionStore>) => {
        const result = await transitionStore(...args);
        events.push(`transition:${args[1]}`);
        return result;
      },
      updateExtras: async (...args: Parameters<typeof updateStoreExtras>) => {
        const result = await updateStoreExtras(...args);
        events.push('update-extras');
        return result;
      },
    };
    const r = await runInProcess([], stopPayload(project), {
      now: () => now,
      store,
      onStdout: () => events.push(`stdout:${String(storeJson(project)['state'])}`),
    });

    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(events).toEqual(['transition:armed', 'stdout:armed']);
    expect(JSON.parse(r.stdout)).toMatchObject({ decision: 'block' });
    expect(storeBytes(project)?.toString('utf8')).toBe(
      `${JSON.stringify({ state: 'armed', since: now.toISOString(), instructed: true, blocks: 1 }, null, 2)}\n`,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-4: a valid v2 handoff settles, through the built bin.
// ---------------------------------------------------------------------------

describe('checkpoint stop-gate (built bin): AC-4', () => {
  it('336-01/AC-4: armed + a filled v2 doc from core\'s renderer written after since exits 0 with empty stdout and leaves the store settled', () => {
    const project = newProject();
    seedStore(project, armedRecord(new Date(Date.now() - HOUR_MS).toISOString()));
    writeDoc(project, Buffer.from(FILLED, 'utf8'));
    const r = runBin([], stopPayload(project));
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBe(0);
    expect(r.stderr).toBe('');
    expect(storeJson(project)).toEqual({ state: 'settled', since: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// AC-7: a BOM never changes the verdict.
// ---------------------------------------------------------------------------

interface TwinRun {
  result: BinResult;
  project: string;
}

/** One project per twin: identical armed store, the doc written after `since`. */
function runTwin(doc: string, withBom: boolean): TwinRun {
  const project = newProject();
  seedStore(project, armedRecord(new Date(Date.now() - HOUR_MS).toISOString()));
  const text = Buffer.from(doc, 'utf8');
  writeDoc(project, withBom ? Buffer.concat([BOM, text]) : text);
  return { result: runBin([], stopPayload(project)), project };
}

describe('checkpoint stop-gate (built bin): AC-7', () => {
  it('336-01/AC-7: both twin pairs - the AC-4 filled v2 doc (settles) and the AC-6 two-marker doc (blocks naming both sections) - give byte-identical stdout, exit code and store with and without a BOM', () => {
    // Filled pair: both settle with empty stdout.
    const filledPlain = runTwin(FILLED, false);
    const filledBom = runTwin(FILLED, true);

    const bomDoc = readFileSync(join(filledBom.project, '.cadence', 'handoff', DOC_NAME));
    expect(bomDoc.subarray(0, 3).equals(BOM)).toBe(true);

    expect(filledPlain.result.status).toBe(0);
    expect(filledPlain.result.stderr).toBe('');
    expect(filledPlain.result.stdout.length).toBe(0);
    expect(storeJson(filledPlain.project)['state']).toBe('settled');

    expect(filledBom.result.status).toBe(filledPlain.result.status);
    expect(filledBom.result.stdout.equals(filledPlain.result.stdout)).toBe(true);
    expect(filledBom.result.stderr).toBe(filledPlain.result.stderr);
    expect(maskedStore(filledBom.project)).toBe(maskedStore(filledPlain.project));

    // Unfilled pair: both block, naming both kept sections, and stay armed.
    const unfilledPlain = runTwin(TWO_UNFILLED, false);
    const unfilledBom = runTwin(TWO_UNFILLED, true);

    const unfilledBomDoc = readFileSync(join(unfilledBom.project, '.cadence', 'handoff', DOC_NAME));
    expect(unfilledBomDoc.subarray(0, 3).equals(BOM)).toBe(true);

    expect(unfilledPlain.result.status).toBe(0);
    expect(unfilledPlain.result.stderr).toBe('');
    const stdout = unfilledPlain.result.stdout.toString('utf8');
    expect(stdout).toMatch(/^\{[^\n]*\}\n$/);
    const parsed = JSON.parse(stdout) as { decision: string; reason: string };
    expect(parsed.decision).toBe('block');
    for (const section of UNFILLED_SECTIONS) expect(parsed.reason).toContain(`"${section}"`);
    expect(storeJson(unfilledPlain.project)).toMatchObject({ state: 'armed', instructed: true, blocks: 1 });

    expect(unfilledBom.result.status).toBe(unfilledPlain.result.status);
    expect(unfilledBom.result.stdout.equals(unfilledPlain.result.stdout)).toBe(true);
    expect(unfilledBom.result.stderr).toBe(unfilledPlain.result.stderr);
    expect(maskedStore(unfilledBom.project)).toBe(maskedStore(unfilledPlain.project));
  });

  it('336-01/AC-7: with a fixed clock the BOM twins leave byte-identical store files', async () => {
    const now = new Date('2026-10-22T12:00:00.000Z');
    const since = '2026-10-22T11:00:00.000Z';
    const mtime = new Date('2026-10-22T11:30:00.000Z');
    const outcomes: { stdout: string; code: number; store: string }[] = [];
    for (const doc of [FILLED, TWO_UNFILLED]) {
      for (const withBom of [false, true]) {
        const project = newProject();
        seedStore(project, armedRecord(since));
        const text = Buffer.from(doc, 'utf8');
        writeDoc(project, withBom ? Buffer.concat([BOM, text]) : text, mtime);
        const r = await runInProcess([], stopPayload(project), { now: () => now });
        outcomes.push({ stdout: r.stdout, code: r.code, store: storeBytes(project)?.toString('utf8') ?? '<absent>' });
      }
    }
    const [filledPlain, filledBom, unfilledPlain, unfilledBom] = outcomes;
    expect(filledBom).toEqual(filledPlain);
    expect(unfilledBom).toEqual(unfilledPlain);
    expect(filledPlain?.store).toBe(`${JSON.stringify({ state: 'settled', since: now.toISOString() }, null, 2)}\n`);
    expect(unfilledPlain?.store).toBe(
      `${JSON.stringify({ state: 'armed', since: now.toISOString(), instructed: true, blocks: 1 }, null, 2)}\n`,
    );
  });

  it('336-01/AC-7: a doc that is not valid UTF-8 never settles; it is reported once on stderr and treated as no doc', async () => {
    const project = newProject();
    const since = '2026-10-22T11:00:00.000Z';
    seedStore(project, armedRecord(since));
    const path = writeDoc(
      project,
      Buffer.concat([Buffer.from(FILLED, 'utf8'), Buffer.from([0xff, 0xfe, 0x0a])]),
      new Date('2026-10-22T11:30:00.000Z'),
    );
    const r = await runInProcess([], stopPayload(project), { now: () => new Date('2026-10-22T12:00:00.000Z') });

    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    const lines = stderrLines(r.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^checkpoint stop-gate: /);
    expect(lines[0]).toContain('NON_UTF8_INPUT');
    expect(lines[0]).toContain(path);
    // Exactly the no-doc outcome: still armed with the instruction recorded;
    // the silent pass on a fresh turn only ends the block chain.
    expect(storeBytes(project)?.toString('utf8')).toBe(
      `${JSON.stringify({ state: 'armed', since, instructed: true }, null, 2)}\n`,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-9: a temp sibling is never a reading.
// ---------------------------------------------------------------------------

describe('checkpoint stop-gate (built bin): AC-9', () => {
  function seedIdleWithSibling(siblingBytes: string): { project: string; sibling: string; before: Buffer } {
    const project = newProject();
    seedStore(project, { state: 'idle', since: new Date(Date.now() - HOUR_MS).toISOString() });
    const sibling = `${checkpointReadingPath(project)}.4242.ab12cd34.tmp`;
    writeFileSync(sibling, siblingBytes);
    return { project, sibling, before: storeBytes(project) as Buffer };
  }

  it('336-01/AC-9: an invalid-JSON reading.json.<pid>.<rand>.tmp sibling is never parsed: empty stdout, no stderr, store unchanged', () => {
    const bytes = '{"used_percentage": 95, "ts": oops';
    const { project, sibling, before } = seedIdleWithSibling(bytes);
    const r = runBin([], stopPayload(project));

    expect(r.status).toBe(0);
    expect(r.stdout.length).toBe(0);
    expect(r.stderr).toBe('');
    expect(storeBytes(project)?.equals(before)).toBe(true);
    expect(existsSync(checkpointReadingPath(project))).toBe(false);
    expect(readFileSync(sibling, 'utf8')).toBe(bytes);
  });

  it('336-01/AC-9: a tmp sibling holding a fresh reading above the threshold does not block', () => {
    const { project, before } = seedIdleWithSibling(readingText(95, new Date().toISOString()));
    const r = runBin([], stopPayload(project));

    expect(r.status).toBe(0);
    expect(r.stdout.length).toBe(0);
    expect(r.stderr).toBe('');
    expect(storeBytes(project)?.equals(before)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-10: nothing wedges a session — store errors, bad flags, bad payloads.
// ---------------------------------------------------------------------------

describe('checkpoint stop-gate: AC-10', () => {
  it('336-01/AC-10: an EACCES thrown by the store write seam while the gate is about to block leaves stdout empty, exits 0, and prints one notice naming the error', async () => {
    const project = newProject();
    const now = new Date('2026-10-22T12:00:00.000Z');
    writeReading(project, 95, new Date(now.getTime() - 10_000).toISOString());
    const calls: string[] = [];
    const eacces = (): never => {
      throw Object.assign(new Error(`EACCES: permission denied, open '${checkpointStatePath(project)}'`), {
        code: 'EACCES',
      });
    };
    const store: StopGateStore = {
      transition: async (_dir, to) => {
        calls.push(`transition:${to}`);
        return eacces();
      },
      updateExtras: async () => {
        calls.push('update-extras');
        return eacces();
      },
    };
    const r = await runInProcess([], stopPayload(project), { now: () => now, store });

    expect(calls).toEqual(['transition:armed']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    const lines = stderrLines(r.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^checkpoint stop-gate: /);
    expect(lines[0]).toContain('EACCES');
    expect(r.stderr.endsWith('\n')).toBe(true);
    expect(storeBytes(project)).toBeNull();
  });

  const REFUSED: readonly (readonly string[])[] = [
    ['--threshold', '0'],
    ['--threshold', '100.5'],
    ['--threshold', 'abc'],
    ['--threshold=NaN'],
    ['--threshold=Infinity'],
    ['--threshold'],
    ['--ceiling', '1'],
    ['--ceiling', '2.5'],
    ['--ceiling=x'],
    ['--max-reading-age-s', '0'],
    ['--max-reading-age-s=-5'],
    ['--threshold', '50', '--threshold', '60'],
    ['--bogus'],
    ['stray'],
  ];

  it.each(REFUSED.map((args) => [args.join(' '), args] as const))(
    '336-01/AC-10: refuses `%s` with one stderr line, exit 0, empty stdout, and no store write',
    (_label, args) => {
      const project = newProject();
      writeReading(project, 95);
      const r = runBin(args, stopPayload(project));

      expect(r.status).toBe(0);
      expect(r.stdout.length).toBe(0);
      const lines = stderrLines(r.stderr);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^checkpoint stop-gate: /);
      expect(storeBytes(project)).toBeNull();
    },
  );

  it.each([
    ['an empty payload', ''],
    ['a payload that is not JSON', '{"cwd": '],
    ['a JSON payload that is not an object', '[1, 2]'],
    ['a payload with no cwd', JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false })],
  ] as const)('336-01/AC-10: %s is one stderr line, exit 0, empty stdout', (_label, payload) => {
    const r = runBin([], payload);

    expect(r.status).toBe(0);
    expect(r.stdout.length).toBe(0);
    const lines = stderrLines(r.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^checkpoint stop-gate: /);
  });

  it('336-01/AC-10: a corrupt store is its one refusal line on stderr, exit 0, empty stdout, bytes unchanged', () => {
    const project = newProject();
    mkdirSync(join(project, '.cadence', 'checkpoint'), { recursive: true });
    writeFileSync(checkpointStatePath(project), '{"state": "armed", ');
    writeReading(project, 95);
    const before = storeBytes(project) as Buffer;
    const r = runBin([], stopPayload(project));

    expect(r.status).toBe(0);
    expect(r.stdout.length).toBe(0);
    const lines = stderrLines(r.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('checkpoint state refused');
    expect(storeBytes(project)?.equals(before)).toBe(true);
  });

  it('336-01/AC-10: a session outside any cadence project exits 0 silently and touches no user-level store', () => {
    const bare = newBareDir();
    const userStore = join(homedir(), '.cadence', 'checkpoint');
    const snapshot = (): (string | null)[] =>
      ['state.json', 'reading.json'].map((name) =>
        existsSync(join(userStore, name)) ? readFileSync(join(userStore, name)).toString('base64') : null,
      );
    const before = snapshot();
    const r = runBin([], stopPayload(bare, true));

    expect(r.status).toBe(0);
    expect(r.stdout.length).toBe(0);
    expect(r.stderr).toBe('');
    expect(existsSync(join(bare, '.cadence'))).toBe(false);
    expect(snapshot()).toEqual(before);
  });

  it.skipIf(process.platform !== 'win32' && process.getuid?.() === 0)(
    '336-01/AC-10: a store the real filesystem refuses to write (read-only state.json on win32, read-only checkpoint dir on POSIX) is one notice, exit 0, empty stdout, bytes unchanged, no .tmp left',
    () => {
      const project = newProject();
      seedStore(project, { state: 'idle', since: new Date(Date.now() - HOUR_MS).toISOString() });
      writeReading(project, 95);
      const checkpointDir = join(project, '.cadence', 'checkpoint');
      const statePath = checkpointStatePath(project);
      const before = storeBytes(project) as Buffer;
      const win32 = process.platform === 'win32';
      let r: BinResult;
      if (win32) chmodSync(statePath, 0o444);
      else chmodSync(checkpointDir, 0o555);
      try {
        r = runBin([], stopPayload(project));
      } finally {
        if (win32) chmodSync(statePath, 0o644);
        else chmodSync(checkpointDir, 0o755);
      }

      expect(r.status).toBe(0);
      expect(r.stdout.length).toBe(0);
      const lines = stderrLines(r.stderr);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^checkpoint stop-gate: \S/);
      expect(storeBytes(project)?.equals(before)).toBe(true);
      expect(readdirSync(checkpointDir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// AC-8 / AC-18 / AC-3 through the built bin.
// ---------------------------------------------------------------------------

describe('checkpoint stop-gate (built bin): ceiling, crash leftovers, once per entry', () => {
  it('336-01/AC-8: at the ceiling with stop_hook_active true, an invalid doc releases with one systemMessage line and a forced settle', () => {
    const project = newProject();
    const sinceMs = Date.now() - HOUR_MS;
    seedStore(project, { state: 'armed', since: new Date(sinceMs).toISOString(), instructed: true, blocks: 2 });
    writeDoc(project, Buffer.from(TWO_UNFILLED, 'utf8'), new Date(sinceMs + 10 * 60_000));
    const before = Date.now();
    const r = runBin(['--ceiling', '3'], stopPayload(project, true));
    const after = Date.now();

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const stdout = r.stdout.toString('utf8');
    expect(stdout).toMatch(/^\{[^\n]*\}\n$/);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['systemMessage']);
    expect(parsed).not.toHaveProperty('decision');
    expect(typeof parsed['systemMessage']).toBe('string');
    expect(stdout).toBe(`${JSON.stringify(parsed)}\n`);

    const store = storeJson(project);
    expect(Object.keys(store)).toEqual(['state', 'since', 'forced', 'forcedAt', 'lastForcedAt']);
    expect(store['state']).toBe('settled');
    expect(store['forced']).toBe(true);
    expect(store['forcedAt']).toMatch(ISO);
    expect(store['lastForcedAt']).toBe(store['forcedAt']);
    const forcedAt = Date.parse(store['forcedAt'] as string);
    expect(forcedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(forcedAt).toBeLessThanOrEqual(after + 1000);
  });

  it('336-01/AC-18: written, reset and resumed leftovers each exit 0 with empty stdout, unchanged store bytes and one notice line', () => {
    for (const state of ['written', 'reset', 'resumed'] as const) {
      const project = newProject();
      seedStore(project, { state, since: new Date(Date.now() - HOUR_MS).toISOString() });
      writeReading(project, 95);
      const before = storeBytes(project) as Buffer;
      const r = runBin([], stopPayload(project));

      expect(r.status).toBe(0);
      expect(r.stdout.length).toBe(0);
      const lines = stderrLines(r.stderr);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^checkpoint stop-gate: /);
      expect(lines[0]).toContain(`state is ${state}`);
      expect(lines[0]).not.toContain('state.json');
      expect(storeBytes(project)?.equals(before)).toBe(true);
    }
  });

  it('336-01/AC-3: armed with instructed false and no doc, three consecutive Stops print exactly one block, all exit 0', () => {
    const project = newProject();
    seedStore(project, { state: 'armed', since: new Date(Date.now() - HOUR_MS).toISOString(), instructed: false });
    const runs = [1, 2, 3].map(() => runBin([], stopPayload(project)));

    for (const r of runs) {
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
    }
    const blocks = runs.filter((r) => r.stdout.length > 0);
    expect(blocks).toHaveLength(1);
    expect(runs[0]?.stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(blocks[0]?.stdout.toString('utf8') ?? '') as { decision: string; reason: string };
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toContain('cadence handoff');
    expect(storeJson(project)).toMatchObject({ state: 'armed', instructed: true });
  });
});

// ---------------------------------------------------------------------------
// AC-4: the shell's doc selection decides what settles.
// ---------------------------------------------------------------------------

const ARMED_NO_DOC = 'no handoff doc newer than the arming was found';

describe('checkpoint stop-gate: AC-4 doc selection', () => {
  it('336-01/AC-4: a filled valid doc whose mtime is before `since` is not a candidate: no settle, the no-doc instruction instead (built bin)', () => {
    const project = newProject();
    const sinceMs = Date.now() - HOUR_MS;
    const since = new Date(sinceMs).toISOString();
    seedStore(project, { state: 'armed', since });
    writeDoc(project, Buffer.from(FILLED, 'utf8'), new Date(sinceMs - 60_000));
    const r = runBin([], stopPayload(project));

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const parsed = JSON.parse(r.stdout.toString('utf8')) as { decision: string; reason: string };
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toContain(ARMED_NO_DOC);
    expect(storeJson(project)).toEqual({ state: 'armed', since, instructed: true, blocks: 1 });
  });

  it('336-01/AC-4: with two docs after `since`, the newer (invalid) one is checked, not the older valid one: block with its diagnostics, no settle (built bin)', () => {
    const project = newProject();
    const sinceMs = Date.now() - HOUR_MS;
    seedStore(project, armedRecord(new Date(sinceMs).toISOString()));
    // The invalid doc's name sorts first, so only mtime can make it the pick.
    writeDoc(project, Buffer.from(FILLED, 'utf8'), new Date(sinceMs + 10 * 60_000), 'SESSION-2026-10-22-1210-valid.md');
    writeDoc(project, Buffer.from(TWO_UNFILLED, 'utf8'), new Date(sinceMs + 20 * 60_000), 'SESSION-2026-10-22-1100-invalid.md');
    const r = runBin([], stopPayload(project));

    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const parsed = JSON.parse(r.stdout.toString('utf8')) as { decision: string; reason: string };
    expect(parsed.decision).toBe('block');
    for (const section of UNFILLED_SECTIONS) expect(parsed.reason).toContain(`"${section}"`);
    expect(storeJson(project)).toMatchObject({ state: 'armed', instructed: true, blocks: 1 });
  });

  it('336-01/AC-4: only regular files named SESSION-*.md are candidates (other names, a SESSION-*.md directory and case variants are ignored)', async () => {
    const project = newProject();
    const since = '2026-10-22T11:00:00.000Z';
    const after = new Date('2026-10-22T11:30:00.000Z');
    seedStore(project, { state: 'armed', since });
    const valid = Buffer.from(FILLED, 'utf8');
    for (const name of ['NOTES.md', 'session-2026-10-22.md', 'SESSION-2026-10-22.md.tmp', 'SESSION-2026-10-22.txt']) {
      writeDoc(project, valid, after, name);
    }
    const dirDoc = join(project, '.cadence', 'handoff', 'SESSION-2026-10-22-dir.md');
    mkdirSync(dirDoc);
    utimesSync(dirDoc, after, after);
    const r = await runInProcess([], stopPayload(project), { now: () => new Date('2026-10-22T12:00:00.000Z') });

    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect((JSON.parse(r.stdout) as { reason: string }).reason).toContain(ARMED_NO_DOC);
    expect(storeJson(project)).toMatchObject({ state: 'armed', instructed: true, blocks: 1 });
  });

  it('336-01/AC-4: newestHandoffAfter needs an mtime strictly after since and breaks mtime ties by the greater name', () => {
    expect(newestHandoffAfter([{ name: 'SESSION-a.md', mtimeMs: 1000 }], 1000)).toBeNull();
    expect(newestHandoffAfter([{ name: 'SESSION-a.md', mtimeMs: 999 }], 1000)).toBeNull();
    expect(newestHandoffAfter([], 1000)).toBeNull();
    expect(newestHandoffAfter([{ name: 'SESSION-a.md', mtimeMs: 1000.5 }], 1000)).toBe('SESSION-a.md');
    expect(
      newestHandoffAfter(
        [
          { name: 'SESSION-b.md', mtimeMs: 2000 },
          { name: 'SESSION-c.md', mtimeMs: 2000 },
          { name: 'SESSION-a.md', mtimeMs: 2000 },
        ],
        1000,
      ),
    ).toBe('SESSION-c.md');
    expect(
      newestHandoffAfter(
        [
          { name: 'SESSION-z.md', mtimeMs: 1500 },
          { name: 'SESSION-a.md', mtimeMs: 3000 },
        ],
        1000,
      ),
    ).toBe('SESSION-a.md');
  });
});

// ---------------------------------------------------------------------------
// AC-14 / AC-2: the reading survives the shell's round trip with its meaning.
// ---------------------------------------------------------------------------

describe('checkpoint stop-gate: reading.json round trip', () => {
  const NOW_FIXED = new Date('2026-10-22T12:00:00.000Z');
  const FRESH_TS = new Date(NOW_FIXED.getTime() - 10_000).toISOString();

  it('336-01/AC-14: readingFromJson keeps current_usage when used_percentage is null, so the input-only fallback survives', () => {
    const reading = readingFromJson(JSON.parse(readingText(null, FRESH_TS)));
    expect(reading).not.toBeNull();
    expect(reading?.used_percentage).toBeNull();
    expect(reading?.absolute.current_usage).toEqual({
      input_tokens: 50_000,
      output_tokens: 7_000,
      cache_creation_input_tokens: 10_000,
      cache_read_input_tokens: 40_000,
    });
    // (50000 + 10000 + 40000) / 200000 x 100; output_tokens never counts.
    expect(effectivePercentage(reading as NonNullable<typeof reading>)).toBe(50);
  });

  it('336-01/AC-14: through the shell, a null used_percentage blocks at --threshold 50 and passes at --threshold 50.01', async () => {
    const blocked = newProject();
    writeReading(blocked, null, FRESH_TS);
    const at = await runInProcess(['--threshold', '50'], stopPayload(blocked), { now: () => NOW_FIXED });
    expect(at.code).toBe(0);
    expect(JSON.parse(at.stdout)).toMatchObject({ decision: 'block' });
    expect(storeJson(blocked)['state']).toBe('armed');

    const passed = newProject();
    writeReading(passed, null, FRESH_TS);
    const above = await runInProcess(['--threshold=50.01'], stopPayload(passed), { now: () => NOW_FIXED });
    expect(above.code).toBe(0);
    expect(above.stdout).toBe('');
    expect(above.stderr).toBe('');
    expect(storeBytes(passed)).toBeNull();
  });

  it('336-01/AC-2: a present used_percentage that is not a number reads as unknown, never as a fallback', () => {
    const parsed = JSON.parse(readingText(null, FRESH_TS)) as Record<string, unknown>;
    for (const bad of ['95', true, {}, []]) {
      const reading = readingFromJson({ ...parsed, used_percentage: bad });
      expect(reading).not.toBeNull();
      expect(reading?.used_percentage).toBeNull();
      expect(reading?.absolute.current_usage).toBeNull();
      expect(effectivePercentage(reading as NonNullable<typeof reading>)).toBeNull();
    }
  });

  it('336-01/AC-2: through the shell, a string used_percentage with an above-threshold current_usage does not block', async () => {
    const project = newProject();
    mkdirSync(join(project, '.cadence', 'checkpoint'), { recursive: true });
    const record = JSON.parse(readingText(null, FRESH_TS)) as Record<string, unknown>;
    writeFileSync(checkpointReadingPath(project), `${JSON.stringify({ ...record, used_percentage: '95' }, null, 2)}\n`);
    const r = await runInProcess(['--threshold', '10'], stopPayload(project), { now: () => NOW_FIXED });

    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
    expect(storeBytes(project)).toBeNull();
  });

  it('336-01/AC-10: readingFromJson refuses a non-object or a reading with no string ts', () => {
    expect(readingFromJson(null)).toBeNull();
    expect(readingFromJson([1])).toBeNull();
    expect(readingFromJson('x')).toBeNull();
    expect(readingFromJson({ used_percentage: 95 })).toBeNull();
    expect(readingFromJson({ used_percentage: 95, ts: 123 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-10: the Stop payload slice.
// ---------------------------------------------------------------------------

describe('parseStopPayload', () => {
  it('336-01/AC-10: only stop_hook_active === true counts as true', () => {
    const at = (value: unknown): unknown => {
      const result = parseStopPayload(JSON.stringify({ cwd: '/p', stop_hook_active: value }));
      return result.ok ? result.stopHookActive : result.reason;
    };
    expect(at(true)).toBe(true);
    expect(at(false)).toBe(false);
    expect(at('true')).toBe(false);
    expect(at(1)).toBe(false);
    expect(at(null)).toBe(false);
    expect(parseStopPayload(JSON.stringify({ cwd: '/p' }))).toEqual({ ok: true, cwd: '/p', stopHookActive: false });
  });

  it('336-01/AC-10: a missing, empty or non-string cwd is refused with a one-line reason', () => {
    for (const payload of [{}, { cwd: '' }, { cwd: 42 }, { cwd: null }]) {
      const result = parseStopPayload(JSON.stringify({ ...payload, stop_hook_active: true }));
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.reason).toMatch(/^[^\n]*cwd[^\n]*$/);
    }
    expect(parseStopPayload('').ok).toBe(false);
    expect(parseStopPayload('{').ok).toBe(false);
    expect(parseStopPayload('"str"').ok).toBe(false);
  });
});
