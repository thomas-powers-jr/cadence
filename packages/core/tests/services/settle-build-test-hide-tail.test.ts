import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import {
  AnomalyEventZ,
  SummaryZ,
  defaultConfig,
  emptyState,
  type AnomalyEvent,
  type Summary,
} from '@thomas-powers-jr/cadence-types';
import { settleService } from '../../src/services/settle.js';
import { loadConfig } from '../../src/config/loader.js';
import { verifySummaryContentHash } from '../../src/services/summary-verify.js';
import type { CommandIO } from '../../src/services/io.js';

/**
 * Phase 348 (348-01, T2): `verification.buildTestOutputTail` at settle.
 *
 * AC-6 — under "hide" a bypassed failing suite's stderr carries the hidden
 * notice and none of the tail, and its `build-test-must-pass` gateBypasses
 * entry's `detail` says the lines were captured and hidden by config.
 * AC-7 — without the setting (absent, or "show") the phase-346 stderr and
 * detail hold; a config.json that never names the key loads, and a fresh
 * `cadence init` does not write it.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const CADENCE_CLI = join(__dirname, '../../dist/cli/index.js');

const PHASE = '348-hide-fixture';
const DRAFT_ID = '348-01';
const SINCE = '2026-11-21T10:00:00.000Z';
const FIXED_NOW = '2026-11-21T12:00:00.000Z';
const THREE_COMMAND = 'node three-348.cjs';
const ONE_COMMAND = 'node one-348.cjs';
const SILENT_COMMAND = 'node silent-348.cjs';
const MANY_COMMAND = 'node many-348.cjs';
// Every record names the command by program only (dec-20261116-001).
const SHOWN = 'node [arguments not shown]';
const TAIL_LINES = ['tail-348-a', 'tail-348-b', 'tail-348-c'] as const;
const HEADER = 'output tail (last lines):';
const HIDDEN_DETAIL_3 =
  'output tail: 3 lines captured, hidden by config (verification.buildTestOutputTail); not recorded, since test output can hold secrets';
const HIDDEN_DETAIL_1 =
  'output tail: 1 line captured, hidden by config (verification.buildTestOutputTail); not recorded, since test output can hold secrets';
const SILENT_DETAIL =
  'output tail: 0 lines shown on stderr at settle; not recorded, since test output can hold secrets';
const SHOWN_DETAIL_3 =
  'output tail: 3 lines shown on stderr at settle; not recorded, since test output can hold secrets';

const DRAFT = `---
phase: ${PHASE}
id: ${DRAFT_ID}
tier: standard
status: APPROVED
---

# ${DRAFT_ID} — hidden output tail fixture

## Objective

Settle a draft whose test command fails.

## Acceptance Criteria

### AC-1: it settles
Given a precondition
When an action
Then an observable outcome

## Tasks

### T1: do the thing
- files: \`src/foo.ts\`
- action: do it
- verify: it works
- done: AC-1

## Boundaries

- none
`;

type TailSetting = 'hide' | 'show' | 'absent';

interface SetupOpts {
  testCommand: string;
  tail: TailSetting;
}

const fixtures: Fixture[] = [];

async function setupRepo(opts: SetupOpts): Promise<string> {
  const fx = await tempRepo();
  fixtures.push(fx);
  const root = fx.root;
  const phaseDir = join(root, '.cadence', 'phases', PHASE);
  await mkdir(phaseDir, { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'foo.ts'), 'export const x = 1;\n', 'utf8');
  // Script files rather than `node -e "..."`, so no shell quoting differs on
  // Windows; one stdout write each, so the line order is fixed.
  await writeFile(
    join(root, 'three-348.cjs'),
    `process.stdout.write('${TAIL_LINES.join('\\n')}\\n'); process.exitCode = 2;\n`,
    'utf8',
  );
  await writeFile(
    join(root, 'one-348.cjs'),
    "process.stdout.write('tail-348-a\\n'); process.exitCode = 2;\n",
    'utf8',
  );
  await writeFile(join(root, 'silent-348.cjs'), 'process.exit(2);\n', 'utf8');
  // 45 lines, five more than the runner's 40-line tail keeps.
  await writeFile(
    join(root, 'many-348.cjs'),
    "let s = ''; for (let i = 1; i <= 45; i++) s += 'row-348-' + i + '\\n'; process.stdout.write(s); process.exitCode = 2;\n",
    'utf8',
  );
  const config = {
    ...defaultConfig,
    gates: { sealed: [], evidenceFloor: 'unverified' },
    notify: { transport: 'file', file: join(root, '.cadence', 'anomalies.log') },
    verification: {
      ...defaultConfig.verification,
      testCommand: opts.testCommand,
      ...(opts.tail === 'absent' ? {} : { buildTestOutputTail: opts.tail }),
    },
  };
  await writeFile(join(root, '.cadence', 'config.json'), JSON.stringify(config, null, 2));
  const state = {
    ...emptyState('settle-build-test-hide-tail'),
    loopPosition: 'BUILD' as const,
    activePhase: PHASE,
    activeDraft: DRAFT_ID,
    openDrafts: [{ id: DRAFT_ID, since: SINCE }],
  };
  await writeFile(join(root, '.cadence', 'state.json'), JSON.stringify(state, null, 2));
  await writeFile(join(phaseDir, `${DRAFT_ID}-DRAFT.md`), DRAFT);
  await writeFile(
    join(phaseDir, `${DRAFT_ID}-PROGRESS.json`),
    JSON.stringify({ draftId: DRAFT_ID, tasks: { T1: { status: 'DONE' } } }, null, 2),
  );
  await mkdir(join(root, 'packages', 'core', 'tests'), { recursive: true });
  await writeFile(
    join(root, 'packages', 'core', 'tests', 'foo.test.ts'),
    "it('AC-1 coverage fixture', () => { expect(true).toBe(true); });\n",
    'utf8',
  );
  return root;
}

interface SettleRun {
  root: string;
  exitCode: number;
  stderr: string;
  /** Absent when settle wrote no SUMMARY. */
  summary?: Summary;
  summaryMd?: string;
  anomalies: AnomalyEvent[];
}

async function settleIn(
  root: string,
  flags: { allowFailingBuild?: boolean; force?: boolean } = {},
): Promise<SettleRun> {
  const err: string[] = [];
  const io: CommandIO = { out: () => {}, err: (s) => err.push(s) };
  const res = await settleService(root, { auto: true, now: () => FIXED_NOW, ...flags }, io);
  const base = join(root, '.cadence', 'phases', PHASE, `${DRAFT_ID}-SUMMARY`);
  const run: SettleRun = { root, exitCode: res.exitCode, stderr: err.join(''), anomalies: [] };
  if (existsSync(`${base}.json`)) {
    run.summary = JSON.parse(await readFile(`${base}.json`, 'utf8')) as Summary;
    run.summaryMd = await readFile(`${base}.md`, 'utf8');
  }
  const log = join(root, '.cadence', 'anomalies.log');
  if (existsSync(log)) {
    run.anomalies = (await readFile(log, 'utf8'))
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => AnomalyEventZ.parse(JSON.parse(l)));
  }
  return run;
}

function buildTestEntries(run: SettleRun) {
  return (run.summary?.gateBypasses ?? []).filter((b) => b.gate === 'build-test-must-pass');
}

function runCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], { cwd, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

describe('settle and verification.buildTestOutputTail (phase 348, T2)', () => {
  let hideAllow: SettleRun;
  let hideForce: SettleRun;
  let hideOne: SettleRun;
  let hideSilent: SettleRun;
  let hideMany: SettleRun;
  let hideRefused: SettleRun;
  let showAllow: SettleRun;
  let absentAllow: SettleRun;

  beforeAll(async () => {
    hideAllow = await settleIn(await setupRepo({ testCommand: THREE_COMMAND, tail: 'hide' }), {
      allowFailingBuild: true,
    });
    hideForce = await settleIn(await setupRepo({ testCommand: THREE_COMMAND, tail: 'hide' }), {
      force: true,
    });
    hideOne = await settleIn(await setupRepo({ testCommand: ONE_COMMAND, tail: 'hide' }), {
      allowFailingBuild: true,
    });
    hideSilent = await settleIn(await setupRepo({ testCommand: SILENT_COMMAND, tail: 'hide' }), {
      allowFailingBuild: true,
    });
    hideMany = await settleIn(await setupRepo({ testCommand: MANY_COMMAND, tail: 'hide' }), {
      allowFailingBuild: true,
    });
    hideRefused = await settleIn(await setupRepo({ testCommand: THREE_COMMAND, tail: 'hide' }));
    showAllow = await settleIn(await setupRepo({ testCommand: THREE_COMMAND, tail: 'show' }), {
      allowFailingBuild: true,
    });
    absentAllow = await settleIn(await setupRepo({ testCommand: THREE_COMMAND, tail: 'absent' }), {
      allowFailingBuild: true,
    });
  });

  afterAll(async () => {
    for (const fx of fixtures) await fx.cleanup();
  });

  const hidden = [
    { flag: '--allow-failing-build', run: () => hideAllow },
    { flag: '--force', run: () => hideForce },
  ] as const;

  for (const c of hidden) {
    it(`348-01/AC-6: under hide a ${c.flag} bypass shows the hidden notice on stderr, none of the tail, and the gateBypasses detail says 3 lines were captured and hidden by config`, () => {
      const run = c.run();
      expect(run.exitCode, run.stderr).toBe(0);
      expect(run.stderr).toContain(
        `build-test-must-pass: BYPASSED via ${c.flag}: ${SHOWN} exited 2\n` +
          '  output tail: (hidden by config; 3 lines captured)\n',
      );
      expect(run.stderr.split('\n')).toContain('  output tail: (hidden by config; 3 lines captured)');
      for (const line of TAIL_LINES) expect(run.stderr).not.toContain(line);
      expect(run.stderr).not.toContain(HEADER);

      const entries = buildTestEntries(run);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        gate: 'build-test-must-pass',
        flag: c.flag,
        severity: 'error',
        reason: `${SHOWN} exited 2`,
      });
      expect(entries[0]!.detail).toBe(HIDDEN_DETAIL_3);
      expect(entries[0]!.detail).toBe(
        'output tail: 3 lines captured, hidden by config (verification.buildTestOutputTail); not recorded, since test output can hold secrets',
      );
    });

    it(`348-01/AC-6: under hide a ${c.flag} bypass records nothing beyond the detail text: no tail and no line-count key in SUMMARY.json, SUMMARY.md or the anomaly event`, () => {
      const run = c.run();
      const json = JSON.stringify(run.summary);
      for (const line of TAIL_LINES) {
        expect(json).not.toContain(line);
        expect(run.summaryMd).not.toContain(line);
        expect(JSON.stringify(run.anomalies)).not.toContain(line);
      }
      expect(json).not.toContain('hiddenTailLines');
      expect(json).not.toContain('outputTail');
      expect(run.summaryMd).toContain(`- ERROR build-test-must-pass via ${c.flag}: ${SHOWN} exited 2\n\n      ${HIDDEN_DETAIL_3}`);
      const events = run.anomalies.filter((e) => e.type === 'build-test-bypassed');
      expect(events).toHaveLength(1);
      expect(events[0]!.context).toEqual({ flag: c.flag, command: SHOWN, exitCode: 2 });
      expect(events[0]!.message).toBe(
        `build-test-must-pass gate bypassed via ${c.flag}: ${SHOWN} exited 2`,
      );
      expect(run.summary?.gates?.find((g) => g.gate === 'build-test-must-pass')).toMatchObject({
        status: 'skipped',
        skipReason: `bypassed via ${c.flag}`,
      });
      expect(verifySummaryContentHash(SummaryZ.parse(run.summary))).toBe('MATCH');
    });
  }

  it('348-01/AC-6: a one-line tail under hide reads "1 line captured" on stderr and in the detail', () => {
    expect(hideOne.exitCode, hideOne.stderr).toBe(0);
    expect(hideOne.stderr).toContain('\n  output tail: (hidden by config; 1 line captured)\n');
    expect(hideOne.stderr).not.toContain('tail-348-a');
    expect(hideOne.stderr).not.toContain(HEADER);
    expect(buildTestEntries(hideOne)[0]?.detail).toBe(HIDDEN_DETAIL_1);
    expect(buildTestEntries(hideOne)[0]?.detail).toBe(
      'output tail: 1 line captured, hidden by config (verification.buildTestOutputTail); not recorded, since test output can hold secrets',
    );
    expect(JSON.stringify(hideOne.summary)).not.toContain('tail-348-a');
  });

  it('348-01/AC-6: a suite that printed 45 lines counts the 40 the tail keeps, the number show would print', () => {
    expect(hideMany.exitCode, hideMany.stderr).toBe(0);
    expect(hideMany.stderr).toContain('\n  output tail: (hidden by config; 40 lines captured)\n');
    expect(hideMany.stderr).not.toContain('row-348-');
    expect(buildTestEntries(hideMany)[0]?.detail).toBe(
      'output tail: 40 lines captured, hidden by config (verification.buildTestOutputTail); not recorded, since test output can hold secrets',
    );
  });

  it('348-01/AC-6: a suite that printed nothing keeps the phase-346 text under hide: "(no output captured)" on stderr and the 0-lines detail', () => {
    expect(hideSilent.exitCode, hideSilent.stderr).toBe(0);
    expect(hideSilent.stderr).toContain(
      `build-test-must-pass: BYPASSED via --allow-failing-build: ${SHOWN} exited 2\n` +
        '  output tail: (no output captured)\n',
    );
    expect(hideSilent.stderr).not.toContain('hidden by config');
    const entries = buildTestEntries(hideSilent);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.detail).toBe(SILENT_DETAIL);
    expect(entries[0]!.detail).toBe(
      'output tail: 0 lines shown on stderr at settle; not recorded, since test output can hold secrets',
    );
  });

  it('348-01/AC-6: under hide a refused settle shows the hidden notice and none of the tail, and still refuses with the same reason', () => {
    expect(hideRefused.exitCode).not.toBe(0);
    // A refusal is not a bypass, and whatever settle recorded holds no tail.
    expect(buildTestEntries(hideRefused)).toEqual([]);
    expect(hideRefused.anomalies.filter((e) => e.type === 'build-test-bypassed')).toEqual([]);
    for (const line of TAIL_LINES) {
      expect(JSON.stringify(hideRefused.summary ?? null)).not.toContain(line);
      expect(hideRefused.summaryMd ?? '').not.toContain(line);
    }
    expect(hideRefused.stderr).toContain(
      `build-test-must-pass: ${SHOWN} exited 2\n` +
        'settle run refused: the test suite must pass before settle. ' +
        'Pass --allow-failing-build to bypass, or --force to settle anyway.\n' +
        '  output tail: (hidden by config; 3 lines captured)\n',
    );
    for (const line of TAIL_LINES) expect(hideRefused.stderr).not.toContain(line);
    expect(hideRefused.stderr).not.toContain(HEADER);
  });

  const shown = [
    { name: 'no verification.buildTestOutputTail key', run: () => absentAllow },
    { name: '"show"', run: () => showAllow },
  ] as const;

  for (const c of shown) {
    it(`348-01/AC-7: with ${c.name}, a bypassed settle prints the full tail block and records the phase-346 detail`, () => {
      const run = c.run();
      expect(run.exitCode, run.stderr).toBe(0);
      expect(run.stderr).toContain(
        `build-test-must-pass: BYPASSED via --allow-failing-build: ${SHOWN} exited 2\n` +
          '  output tail (last lines):\n' +
          '    tail-348-a\n' +
          '    tail-348-b\n' +
          '    tail-348-c\n',
      );
      expect(run.stderr).not.toContain('hidden by config');
      const entries = buildTestEntries(run);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.detail).toBe(SHOWN_DETAIL_3);
      expect(entries[0]!.detail).toBe(
        'output tail: 3 lines shown on stderr at settle; not recorded, since test output can hold secrets',
      );
      for (const line of TAIL_LINES) expect(JSON.stringify(run.summary)).not.toContain(line);
    });
  }

  it('348-01/AC-7: the two show settles are identical on stderr and in the build-test entry, the repo path aside', () => {
    const norm = (r: SettleRun) => r.stderr.split(r.root).join('<root>');
    expect(norm(showAllow)).toBe(norm(absentAllow));
    expect(buildTestEntries(showAllow)).toEqual(buildTestEntries(absentAllow));
  });
});

describe('config.json and verification.buildTestOutputTail (phase 348, T2)', () => {
  const made: Fixture[] = [];

  afterAll(async () => {
    for (const fx of made) await fx.cleanup();
  });

  async function repoWithConfig(config: unknown): Promise<string> {
    const fx = await tempRepo();
    made.push(fx);
    await mkdir(join(fx.root, '.cadence'), { recursive: true });
    await writeFile(join(fx.root, '.cadence', 'config.json'), JSON.stringify(config));
    return fx.root;
  }

  it('348-01/AC-7: a {} config.json and a { "verification": { "testGlobs": ["x"] } } config.json load, the key absent from the parsed config', async () => {
    const empty = await loadConfig(await repoWithConfig({}));
    expect('buildTestOutputTail' in empty.verification).toBe(false);

    const globsOnly = await loadConfig(await repoWithConfig({ verification: { testGlobs: ['x'] } }));
    expect(globsOnly.verification.testGlobs).toEqual(['x']);
    expect('buildTestOutputTail' in globsOnly.verification).toBe(false);

    // No config.json at all: defaultConfig, which has no such key either.
    const fx = await tempRepo();
    made.push(fx);
    expect('buildTestOutputTail' in (await loadConfig(fx.root)).verification).toBe(false);
  });

  it('348-01/AC-7: "show" and "hide" in config.json load as written; "Hide", true and null are refused as schema errors', async () => {
    for (const value of ['show', 'hide'] as const) {
      const cfg = await loadConfig(await repoWithConfig({ verification: { buildTestOutputTail: value } }));
      expect(cfg.verification.buildTestOutputTail).toBe(value);
    }
    for (const bad of ['Hide', true, null]) {
      const root = await repoWithConfig({ verification: { buildTestOutputTail: bad } });
      await expect(loadConfig(root)).rejects.toThrow(/config\.json failed schema validation[\s\S]*buildTestOutputTail/);
    }
  });

  it('348-01/AC-7: a fresh cadence init writes a config.json with no verification.buildTestOutputTail key', async () => {
    const fx = await tempRepo();
    made.push(fx);
    const r = await runCli(['init', '--name=demo'], fx.root);
    expect(r.code, r.stderr).toBe(0);
    const cfg = JSON.parse(await readFile(join(fx.root, '.cadence/config.json'), 'utf8')) as {
      verification?: Record<string, unknown>;
    };
    expect(cfg.verification).toBeDefined();
    expect(cfg.verification).not.toHaveProperty('buildTestOutputTail');
    // And the written file loads with the key still absent.
    expect('buildTestOutputTail' in (await loadConfig(fx.root)).verification).toBe(false);
  });
});
