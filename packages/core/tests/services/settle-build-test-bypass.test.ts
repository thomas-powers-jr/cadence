import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { runGit } from '@thomas-powers-jr/cadence-testkit';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SummaryZ } from '@thomas-powers-jr/cadence-types';
import { verifySummaryContentHash } from '../../src/services/summary-verify.js';
import {
  AnomalyEventZ,
  defaultConfig,
  emptyState,
  type AnomalyEvent,
  type CadenceConfig,
  type Draft,
  type GateProvenance,
  type Summary,
} from '@thomas-powers-jr/cadence-types';
import { settleService } from '../../src/services/settle.js';
import { collectAnomalies } from '../../src/notify/collect.js';
import { deriveAssuranceRecord } from '../../src/gates/assurance-record.js';
import type { CommandIO } from '../../src/services/io.js';

/**
 * Phase 346 (346-01, T4): a build-test-must-pass bypass over a failing suite
 * becomes one error-severity `build-test-must-pass` gateBypasses entry whose
 * flag matches the gate's notice and the gates[] skip reason, whose reason
 * names the command and exit code, and whose `detail` carries the output
 * tail. The matching `build-test-bypassed` anomaly keeps the tail in its
 * context only, never in its message.
 *
 * The assurance cap is proven two ways:
 *  - live: a strict-profile settle with a stubbed real-provider code-review
 *    over a real git diff grades `strong` with a passing suite, and the same
 *    settle with a failing suite let through by `--allow-failing-build` grades
 *    `mixed` — its build-test entry being the only error-severity bypass;
 *  - derived: the mock-only fixture (whose own grade is already `mixed`, since
 *    no real verifier ran) is re-derived through `deriveAssuranceRecord` with
 *    one synthetic real-provider gate: `strong` without the entry, `mixed`
 *    with it.
 */

const reviewCalls = vi.hoisted(() => ({ constructed: [] as string[] }));

// Same seam as settle-checkpoint-force-release.test.ts: the real factory
// constructs the configured verifier (no network), and `.verify` is stubbed
// to a clean, finding-free review.
vi.mock('../../src/verify/code-review-factory.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/verify/code-review-factory.js')>();
  return {
    ...actual,
    selectCodeReviewVerifier: (
      cfg: Parameters<typeof actual.selectCodeReviewVerifier>[0],
      opts: Parameters<typeof actual.selectCodeReviewVerifier>[1],
    ) => {
      const real = actual.selectCodeReviewVerifier(cfg, opts);
      reviewCalls.constructed.push(real.name);
      return {
        name: real.name,
        verify: async () => ({ findings: {}, provider: real.name }),
      };
    },
  };
});

const PHASE = '346-btb-fixture';
const DRAFT_ID = '346-01';
const SINCE = '2026-11-12T10:00:00.000Z';
const FIXED_NOW = '2026-11-12T12:00:00.000Z';
const FAIL_COMMAND = 'node fail-346.cjs';
const PASS_COMMAND = 'node pass-346.cjs';
const TAIL_MARKER = 'boom-346';

const DRAFT = `---
phase: ${PHASE}
id: ${DRAFT_ID}
tier: standard
status: APPROVED
---

# ${DRAFT_ID} — build-test bypass fixture

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

function captureIO(): { io: CommandIO; err: string[] } {
  const err: string[] = [];
  return { io: { out: () => {}, err: (s) => err.push(s) }, err };
}

interface SetupOpts {
  testCommand: string;
  liveStrong?: boolean;
}

function fixtureConfig(root: string, opts: SetupOpts): CadenceConfig {
  return {
    ...defaultConfig,
    ...(opts.liveStrong === true
      ? { profile: 'strict' as const, codeReview: { provider: 'anthropic' as const } }
      : {}),
    gates: { sealed: [], evidenceFloor: 'unverified' },
    notify: { transport: 'file', file: join(root, '.cadence', 'anomalies.log') },
    verification: { ...defaultConfig.verification, testCommand: opts.testCommand },
  };
}

async function setupRepo(parent: string, opts: SetupOpts): Promise<string> {
  const root = await realpath(await mkdtemp(join(parent, 'repo-')));
  const phaseDir = join(root, '.cadence', 'phases', PHASE);
  await mkdir(phaseDir, { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'foo.ts'), 'export const x = 1;\n', 'utf8');
  // Script files rather than `node -e "..."`, so no shell quoting differs on Windows.
  await writeFile(
    join(root, 'fail-346.cjs'),
    `console.log('${TAIL_MARKER}'); console.error('second-346'); process.exit(2);\n`,
    'utf8',
  );
  await writeFile(join(root, 'pass-346.cjs'), "console.log('fine-346');\n", 'utf8');
  await writeFile(
    join(root, '.cadence', 'config.json'),
    JSON.stringify(fixtureConfig(root, opts), null, 2),
  );
  const state = {
    ...emptyState('settle-build-test-bypass'),
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
  if (opts.liveStrong === true) {
    await writeFile(join(root, '.env'), 'ANTHROPIC_API_KEY=from-dotenv-build-test-bypass\n');
    runGit(root, ['init', '-q']);
    runGit(root, ['config', 'user.email', 'test@example.com']);
    runGit(root, ['config', 'user.name', 'Test']);
    runGit(root, ['config', 'commit.gpgsign', 'false']);
    runGit(root, ['add', '-A']);
    runGit(root, ['commit', '-q', '-m', 'base']);
    await writeFile(join(root, 'src', 'foo.ts'), 'export const x = 2;\n', 'utf8');
  }
  return root;
}

interface SettleRun {
  exitCode: number;
  summary: Summary;
  summaryMd: string;
  stderr: string;
  anomalies: AnomalyEvent[];
}

async function settleIn(
  root: string,
  flags: { allowFailingBuild?: boolean; force?: boolean } = {},
): Promise<SettleRun> {
  const { io, err } = captureIO();
  const res = await settleService(root, { auto: true, now: () => FIXED_NOW, ...flags }, io);
  const base = join(root, '.cadence', 'phases', PHASE, `${DRAFT_ID}-SUMMARY`);
  const summary = JSON.parse(await readFile(`${base}.json`, 'utf8')) as Summary;
  const summaryMd = await readFile(`${base}.md`, 'utf8');
  let anomalies: AnomalyEvent[] = [];
  try {
    const raw = await readFile(join(root, '.cadence', 'anomalies.log'), 'utf8');
    anomalies = raw
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => AnomalyEventZ.parse(JSON.parse(l)));
  } catch {
    anomalies = [];
  }
  return { exitCode: res.exitCode, summary, summaryMd, stderr: err.join(''), anomalies };
}

function buildTestEntries(s: Summary) {
  return (s.gateBypasses ?? []).filter((b) => b.gate === 'build-test-must-pass');
}

/** The gates[] entry build-test-must-pass recorded during this settle. */
function buildTestGate(s: Summary): GateProvenance | undefined {
  return (s.gates ?? []).find((g) => g.gate === 'build-test-must-pass');
}

describe('settle records a bypassed failing suite in gateBypasses (phase 346, T4)', () => {
  let parent: string;
  let origKey: string | undefined;
  let allowRun: SettleRun;
  let forceRun: SettleRun;
  let passRun: SettleRun;

  beforeAll(async () => {
    origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    parent = await realpath(await mkdtemp(join(tmpdir(), 'cadence-settle-btb-')));
    allowRun = await settleIn(await setupRepo(parent, { testCommand: FAIL_COMMAND }), {
      allowFailingBuild: true,
    });
    forceRun = await settleIn(await setupRepo(parent, { testCommand: FAIL_COMMAND }), {
      force: true,
    });
    passRun = await settleIn(await setupRepo(parent, { testCommand: PASS_COMMAND }));
  });

  afterAll(async () => {
    if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
    await rm(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
      () => {},
    );
  });

  const cases = [
    { name: '--allow-failing-build', flag: '--allow-failing-build', run: () => allowRun },
    { name: 'bare --force', flag: '--force', run: () => forceRun },
  ] as const;

  for (const c of cases) {
    it(`346-01/AC-3: under ${c.name}, SUMMARY.gateBypasses holds exactly one error-severity build-test-must-pass entry naming ${c.flag}, the command and exit code, with the output tail as detail`, () => {
      const run = c.run();
      expect(run.exitCode, run.stderr).toBe(0);
      const entries = buildTestEntries(run.summary);
      expect(entries).toHaveLength(1);
      const entry = entries[0]!;
      expect(entry).toMatchObject({
        gate: 'build-test-must-pass',
        flag: c.flag,
        severity: 'error',
      });
      expect(entry.reason).toContain(FAIL_COMMAND);
      expect(entry.reason).toContain('exited 2');
      expect(entry.reason).not.toContain(TAIL_MARKER);
      expect(entry.detail).toContain(TAIL_MARKER);
      expect(entry.detail).toContain('second-346');
    });

    it(`346-01/AC-3: under ${c.name}, the entry's flag equals the gates[] skip reason's flag and the gate's own notice flag`, () => {
      const run = c.run();
      const gate = buildTestGate(run.summary);
      expect(gate).toMatchObject({ status: 'skipped', skipReason: `bypassed via ${c.flag}` });
      expect(buildTestEntries(run.summary)[0]?.flag).toBe(c.flag);
      expect(run.stderr).toContain(`build-test-must-pass: BYPASSED via ${c.flag}:`);
      expect(run.stderr).toContain(
        `settle bypass [error] build-test-must-pass: ${FAIL_COMMAND} exited 2 (${c.flag})`,
      );
    });

    it(`346-01/AC-3: under ${c.name}, one build-test-bypassed anomaly carries flag, command and exitCode in its context and keeps the tail out of the event entirely`, () => {
      const run = c.run();
      const events = run.anomalies.filter((e) => e.type === 'build-test-bypassed');
      expect(events).toHaveLength(1);
      const ev = events[0]!;
      expect(ev.severity).toBe('error');
      expect(ev.message).toContain(c.flag);
      expect(ev.message).toContain(FAIL_COMMAND);
      expect(ev.message).toContain('exited 2');
      expect(ev.message).not.toContain(TAIL_MARKER);
      expect(ev.context).toMatchObject({ flag: c.flag, command: FAIL_COMMAND, exitCode: 2 });
      // The event reaches notifier transports (a webhook POSTs it whole), so the tail must not ride in it at all.
      expect('outputTail' in ev.context).toBe(false);
      expect(JSON.stringify(ev)).not.toContain(TAIL_MARKER);
    });

    it(`346-01/AC-3: under ${c.name}, the settle-written SUMMARY.md lists the entry and shows its detail as an indented block, and the record still verifies`, () => {
      const run = c.run();
      expect(run.summaryMd).toContain(
        `- ERROR build-test-must-pass via ${c.flag}: ${FAIL_COMMAND} exited 2\n\n      `,
      );
      expect(run.summaryMd).toMatch(new RegExp(`^ {6}.*${TAIL_MARKER}`, 'm'));
      expect(verifySummaryContentHash(SummaryZ.parse(run.summary))).toBe('MATCH');
    });

    it(`346-01/AC-3: under ${c.name}, the entry alone caps assurance at mixed where the same record without it grades strong`, () => {
      const run = c.run();
      const bypasses = run.summary.gateBypasses ?? [];
      // The build-test entry is the only error-severity bypass in this settle.
      expect(
        bypasses.filter((b) => b.severity === 'error' && b.gate !== 'build-test-must-pass'),
      ).toEqual([]);
      // The mock-only fixture cannot grade strong by itself (no real verifier),
      // so re-derive with one synthetic real-provider gate (pure, no call).
      const withReal: GateProvenance[] = [
        ...(run.summary.gates ?? []),
        { gate: 'code-review', status: 'ran', provider: 'anthropic' },
      ];
      expect(
        deriveAssuranceRecord(withReal, run.summary.acResults, { gateBypasses: bypasses }).overall,
      ).toBe('mixed');
      expect(
        deriveAssuranceRecord(withReal, run.summary.acResults, {
          gateBypasses: bypasses.filter((b) => b.gate !== 'build-test-must-pass'),
        }).overall,
      ).toBe('strong');
    });
  }

  it('346-01/AC-3: bare --force over a failing suite with every task DONE records no settle/--force entry beside the build-test one', () => {
    const bypasses = forceRun.summary.gateBypasses ?? [];
    expect(bypasses.filter((b) => b.gate === 'settle')).toEqual([]);
    expect(forceRun.anomalies.filter((e) => e.type === 'force-used')).toEqual([]);
  });

  it('346-01/AC-3: a settle whose suite passed records no build-test-bypassed anomaly or entry, and its gate ran', () => {
    expect(passRun.exitCode, passRun.stderr).toBe(0);
    expect(buildTestEntries(passRun.summary)).toEqual([]);
    expect(passRun.anomalies.filter((e) => e.type === 'build-test-bypassed')).toEqual([]);
    expect(buildTestGate(passRun.summary)?.status).toBe('ran');
    expect(passRun.stderr).not.toContain('BYPASSED');
  });

  describe('live grade: strict profile, stubbed real-provider code-review over a real diff', () => {
    it('346-01/AC-3: with a passing suite the live settle grades strong and records no build-test entry (the unchanged baseline)', async () => {
      reviewCalls.constructed.length = 0;
      const root = await setupRepo(parent, { testCommand: PASS_COMMAND, liveStrong: true });
      const run = await settleIn(root);
      expect(run.exitCode, run.stderr).toBe(0);
      expect(reviewCalls.constructed).toEqual(['anthropic']);
      expect(run.summary.gates?.find((g) => g.gate === 'code-review')).toMatchObject({
        status: 'ran',
        provider: 'anthropic',
      });
      expect(buildTestEntries(run.summary)).toEqual([]);
      expect(run.summary.assurance?.overall).toBe('strong');
    });

    it('346-01/AC-3: the same live settle with a failing suite let through by --allow-failing-build grades mixed, its build-test entry the only error-severity bypass', async () => {
      reviewCalls.constructed.length = 0;
      const root = await setupRepo(parent, { testCommand: FAIL_COMMAND, liveStrong: true });
      const run = await settleIn(root, { allowFailingBuild: true });
      expect(run.exitCode, run.stderr).toBe(0);
      expect(reviewCalls.constructed).toEqual(['anthropic']);
      const bypasses = run.summary.gateBypasses ?? [];
      expect(bypasses.filter((b) => b.severity === 'error')).toEqual([
        expect.objectContaining({
          gate: 'build-test-must-pass',
          flag: '--allow-failing-build',
        }),
      ]);
      expect(run.summary.assurance?.overall).toBe('mixed');
    });
  });
});

describe('collectAnomalies build-test-bypassed (phase 346, T4)', () => {
  const draft = {
    acceptanceCriteria: [],
    tasks: [],
  } as unknown as Draft;
  const base = {
    draft,
    progress: { draftId: 'x', tasks: {} },
    coverageBypassed: false,
    force: false,
  };
  const now = () => new Date(FIXED_NOW);

  it('346-01/AC-3: emits exactly one error event whose message and context name flag, command and exit code only, never the tail', () => {
    const events = collectAnomalies(
      {
        ...base,
        buildTestBypass: {
          flag: '--force',
          command: 'pnpm test',
          exitCode: 3,
          outputTail: 'FAIL tail-only-line',
        },
      },
      { now },
    );
    const hits = events.filter((e) => e.type === 'build-test-bypassed');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      severity: 'error',
      context: { flag: '--force', command: 'pnpm test', exitCode: 3 },
    });
    expect('outputTail' in hits[0]!.context).toBe(false);
    expect(JSON.stringify(hits[0])).not.toContain('tail-only-line');
    expect(hits[0]!.message).toContain('--force');
    expect(hits[0]!.message).toContain('pnpm test exited 3');
    expect(hits[0]!.message).not.toContain('tail-only-line');
  });

  it('346-01/AC-3: an inline credential in the command never reaches the event, its message or its context', () => {
    const [ev] = collectAnomalies(
      {
        ...base,
        buildTestBypass: { flag: '--force', command: 'GITHUB_TOKEN=ghp_abcdef123456 pnpm test', exitCode: 1 },
      },
      { now },
    );
    expect(JSON.stringify(ev)).not.toContain('ghp_abcdef123456');
    expect(ev?.context['command']).toBe('GITHUB_TOKEN=[REDACTED] pnpm test');
    expect(ev?.message).toContain('GITHUB_TOKEN=[REDACTED] pnpm test exited 1');
  });

  it('346-01/AC-3: a bypass without a captured tail emits the same event, and nothing is emitted without a bypass', () => {
    const [ev] = collectAnomalies(
      {
        ...base,
        buildTestBypass: { flag: '--allow-failing-build', command: 'make test', exitCode: 1 },
      },
      { now },
    );
    expect(ev?.type).toBe('build-test-bypassed');
    expect(ev && 'outputTail' in ev.context).toBe(false);
    expect(collectAnomalies(base, { now }).some((e) => e.type === 'build-test-bypassed')).toBe(
      false,
    );
  });
});
