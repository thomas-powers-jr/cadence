import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  defaultConfig,
  emptyState,
  type CadenceConfig,
  type GateProvenance,
} from '@thomas-powers-jr/cadence-types';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { settleService, type SettleArgs } from '../../src/services/settle.js';
import type { DryRunReportData } from '../../src/services/settle-dry-run-report.js';
import type { CommandIO } from '../../src/services/io.js';
import { LoopViolationError } from '../../src/errors.js';
import type * as LoaderModule from '../../src/config/loader.js';

/** M-5 seam: when armed, the next `loadConfig` call throws a
 *  LoopViolationError, which reaches settleService's catch block (settle's
 *  first `loadConfig` runs after the preconditions). Pass-through otherwise. */
const loaderSeam = vi.hoisted(() => ({ throwNext: false }));
vi.mock('../../src/config/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof LoaderModule>();
  return {
    ...actual,
    loadConfig: async (...args: Parameters<typeof LoaderModule.loadConfig>) => {
      if (loaderSeam.throwNext) {
        loaderSeam.throwNext = false;
        throw new LoopViolationError('seam: loop violation mid-settle', { expected: 'BUILD', actual: 'SETTLE' });
      }
      return actual.loadConfig(...args);
    },
  };
});

/**
 * Phase 347 (347-01, T2): `settleService` with `dryRun`. Every AC-1 fixture is
 * a testkit ephemeral repo; the dry run runs first, then the real settle on
 * the same tree, and the two must decide the same thing. Every file in the
 * fixture (outside `.git` internals) is hashed around each dry run; the
 * notifier is `notify.transport: "file"` wherever the gate set includes
 * `anomaly-notify`, so a dispatched notification would change the hash.
 */

const PHASE = '30-dry';
const ID = '30-01';
const NOW = '2026-11-18T12:00:00.000Z';
const PHASE_DIR = join('.cadence', 'phases', PHASE);

const fixtures: Fixture[] = [];
const extraDirs: string[] = [];
afterEach(async () => {
  loaderSeam.throwNext = false;
  vi.unstubAllEnvs();
  for (const fx of fixtures.splice(0)) await fx.cleanup();
  for (const d of extraDirs.splice(0)) {
    await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }
});

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function captureIO(): { io: CommandIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
}

function draftMd(tier: string): string {
  return `---
phase: ${PHASE}
id: ${ID}
tier: ${tier}
status: APPROVED
---

# ${ID} — dry-run fixture

## Objective

Settle a draft.

## Acceptance Criteria

### AC-1: it works
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
}

interface Setup {
  profile?: CadenceConfig['profile'];
  tier?: 'quick-fix' | 'standard' | 'complex';
  /** Source written AFTER the base commit, so it is in the settle diff. */
  src?: string;
  coverage?: boolean;
  taskStatus?: string;
  loopPosition?: 'BUILD' | 'IDLE';
  testCommand?: 'pass' | 'fail' | 'marker';
  config?: Partial<CadenceConfig>;
  invoked?: string[];
}

async function setup(opts: Setup = {}): Promise<string> {
  const fx = await tempRepo({ initialized: true, projectName: 'settle-dry-run' });
  fixtures.push(fx);
  const root = fx.root;
  const phaseDir = join(root, PHASE_DIR);
  await mkdir(phaseDir, { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'foo.ts'), 'export const x = 0;\n', 'utf8');
  await writeFile(join(root, 'pass.cjs'), "console.log('ok');\n", 'utf8');
  await writeFile(join(root, 'fail.cjs'), "console.log('boom'); process.exit(3);\n", 'utf8');
  // Writes a file when it runs — proof the test command ran or did not.
  await writeFile(
    join(root, 'marker.cjs'),
    "require('fs').writeFileSync(require('path').join(process.cwd(), 'ran.marker'), 'x');\n",
    'utf8',
  );
  const testCommand =
    opts.testCommand === 'fail' ? 'node fail.cjs' : opts.testCommand === 'marker' ? 'node marker.cjs' : 'node pass.cjs';
  const config = {
    ...defaultConfig,
    profile: opts.profile ?? 'auto',
    gates: { ...defaultConfig.gates, sealed: [] },
    notify: { transport: 'file', file: join(root, '.cadence', 'anomalies.log') },
    verification: { ...defaultConfig.verification, testCommand },
    ...(opts.config ?? {}),
  } as CadenceConfig;
  await writeFile(join(root, '.cadence', 'config.json'), JSON.stringify(config, null, 2));
  const inBuild = (opts.loopPosition ?? 'BUILD') === 'BUILD';
  const base = emptyState('settle-dry-run');
  const state = {
    ...base,
    loopPosition: inBuild ? ('BUILD' as const) : ('IDLE' as const),
    activePhase: inBuild ? PHASE : null,
    activeDraft: inBuild ? ID : null,
    openDrafts: inBuild ? [{ id: ID, since: '2026-11-18T10:00:00.000Z' }] : [],
    skillAudit: { ...base.skillAudit, invoked: opts.invoked ?? [] },
  };
  await writeFile(join(root, '.cadence', 'state.json'), JSON.stringify(state, null, 2));
  await writeFile(join(phaseDir, `${ID}-DRAFT.md`), draftMd(opts.tier ?? 'standard'));
  await writeFile(
    join(phaseDir, `${ID}-PROGRESS.json`),
    JSON.stringify({ draftId: ID, tasks: { T1: { status: opts.taskStatus ?? 'DONE' } } }, null, 2),
  );
  if (opts.coverage !== false) {
    await mkdir(join(root, 'packages', 'core', 'tests'), { recursive: true });
    await writeFile(
      join(root, 'packages', 'core', 'tests', 'foo.test.ts'),
      "it('AC-1 coverage fixture', () => { expect(true).toBe(true); });\n",
      'utf8',
    );
  }
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  if (opts.src !== undefined) await writeFile(join(root, 'src', 'foo.ts'), opts.src, 'utf8');
  return root;
}

/** sha256 of every file under `root`, keyed by relative path, `.git` excluded. */
async function hashTree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else out[relative(root, p)] = createHash('sha256').update(await readFile(p)).digest('hex');
    }
  };
  await walk(root);
  return out;
}

interface Run {
  exitCode: number;
  data: DryRunReportData;
  stdout: string;
  stderr: string;
}

async function dryRun(root: string, flags: SettleArgs): Promise<Run> {
  const before = await hashTree(root);
  const { io, out, err } = captureIO();
  const res = await settleService(root, { ...flags, dryRun: true, now: () => NOW }, io);
  const after = await hashTree(root);
  // AC-2: cadence wrote nothing — SUMMARY, sidecar, state, PROGRESS, ledgers, anomaly log.
  expect(after).toEqual(before);
  return { exitCode: res.exitCode, data: res.data as DryRunReportData, stdout: out.join(''), stderr: err.join('') };
}

interface RealRun {
  exitCode: number;
  stderr: string;
  gates: GateProvenance[] | null;
}

async function realSettle(root: string, flags: SettleArgs): Promise<RealRun> {
  const { io, err } = captureIO();
  const res = await settleService(root, { ...flags, now: () => NOW }, io);
  const summaryPath = join(root, PHASE_DIR, `${ID}-SUMMARY.json`);
  const gates = existsSync(summaryPath)
    ? ((JSON.parse(await readFile(summaryPath, 'utf8')) as { gates: GateProvenance[] }).gates ?? [])
    : null;
  return { exitCode: res.exitCode, stderr: err.join(''), gates };
}

/**
 * AC-1: run the dry run, then the real settle with the same flags, and check
 * they decide the same thing: exit code, verdict, the refusing gate or check
 * with settle's reason, and the per-gate list.
 */
async function expectSameDecision(
  root: string,
  flags: SettleArgs,
  expected: { verdict: 'pass' } | { verdict: 'refuse'; at: string; summary: boolean },
): Promise<{ dry: Run; real: RealRun }> {
  const dry = await dryRun(root, flags);
  const real = await realSettle(root, flags);
  const code = expected.verdict === 'pass' ? 0 : 1;
  expect(dry.exitCode, dry.stderr).toBe(code);
  expect(real.exitCode, real.stderr).toBe(code);
  expect(dry.data.verdict).toBe(expected.verdict);
  const finalLine = dry.stdout.trimEnd().split('\n').pop();
  if (expected.verdict === 'pass') {
    expect(dry.data.refusal).toBeNull();
    expect(finalLine).toBe('settle would pass');
    expect(real.gates).not.toBeNull();
    expect(dry.data.gates).toEqual(real.gates);
  } else {
    expect(dry.data.refusal?.at).toBe(expected.at);
    expect(finalLine).toMatch(new RegExp(`^settle would refuse at ${expected.at}: `));
    if (expected.summary) {
      // The refused SUMMARY's gates[] is the dry run's per-gate list.
      expect(real.gates).not.toBeNull();
      expect(dry.data.gates).toEqual(real.gates);
      const last = real.gates![real.gates!.length - 1]!;
      if (last.status === 'refused') {
        expect(last.gate).toBe(expected.at);
        expect(dry.data.refusal?.reason).toBe(last.reason);
      }
    } else {
      expect(real.gates).toBeNull();
      expect(dry.data.gates).toEqual([]);
    }
    // Settle's own reason is what the real settle printed.
    for (const part of dry.data.refusal!.reason.split('; ')) {
      expect(real.stderr).toContain(part);
    }
  }
  return { dry, real };
}

const AUTO: SettleArgs = { auto: true };

/** The one stderr line settle printed that starts with `prefix`. */
function stderrLine(stderr: string, prefix: string): string | undefined {
  return stderr.split('\n').find((l) => l.startsWith(prefix));
}

async function readAnomalyLog(root: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(join(root, '.cadence', 'anomalies.log'), 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('settle run --dry-run decides exactly what settle would decide (347-01)', { timeout: 60_000 }, () => {
  it('347-01/AC-1: a passing settle — the dry run says it would pass with the same gates, writes nothing (AC-2)', async () => {
    const root = await setup();
    const { dry } = await expectSameDecision(root, AUTO, { verdict: 'pass' });
    expect(dry.data.wouldNotify).toEqual([]);
  });

  it('347-01/AC-1: refusal outside BUILD — the loop violation is recorded under would notify, not dispatched (AC-2)', async () => {
    const root = await setup({ loopPosition: 'IDLE' });
    const { dry } = await expectSameDecision(root, AUTO, { verdict: 'refuse', at: 'loop-position', summary: false });
    expect(dry.data.wouldNotify.map((e) => e.type)).toEqual(['loop-violation']);
    expect(dry.stdout).toContain('would notify:\n  loop-violation [error]');
    // The real settle dispatched the same event through the file transport;
    // the dry run's copy matches it field for field (drift guard for
    // settle.ts's mirrored recordLoopViolation).
    const log = await readAnomalyLog(root);
    expect(log).toHaveLength(1);
    const { type, severity, message, context } = log[0]!;
    expect(dry.data.wouldNotify).toEqual([{ type, severity, message, context }]);
  });

  it('347-01/AC-1: a phase-collision refusal', async () => {
    const root = await setup();
    const sibling = `${root}-wt30`;
    extraDirs.push(sibling);
    git(root, ['worktree', 'add', '-q', '-b', 'race-30', sibling]);
    await mkdir(join(sibling, '.cadence', 'phases', '30-race'), { recursive: true });
    await writeFile(join(sibling, '.cadence', 'phases', '30-race', '.keep'), '');
    await expectSameDecision(root, AUTO, { verdict: 'refuse', at: 'phase-collision', summary: false });
  });

  it('347-01/AC-1: the auto × complex soft-cap refusal', async () => {
    const root = await setup({ tier: 'complex' });
    await expectSameDecision(root, AUTO, { verdict: 'refuse', at: 'auto-complex-soft-cap', summary: false });
  });

  it('347-01/AC-1: an early-gate refusal (build-test-must-pass) before the AI gates', async () => {
    const root = await setup({ profile: 'standard', tier: 'complex', testCommand: 'fail', src: 'export const x = 1;\n' });
    const { dry } = await expectSameDecision(root, AUTO, { verdict: 'refuse', at: 'build-test-must-pass', summary: true });
    expect(dry.data.gates.map((g) => g.gate)).not.toContain('deep-verify');
    expect(dry.data.codeReview).toBeNull();
  });

  it('347-01/AC-1: a deep-verify refusal, with each AC verdict, reason and provider in the report (AC-3)', async () => {
    const root = await setup({ profile: 'standard', tier: 'complex', coverage: false, src: 'export const x = 1;\n' });
    const { dry } = await expectSameDecision(
      root,
      { auto: true, allowMissingCoverage: true },
      { verdict: 'refuse', at: 'deep-verify', summary: true },
    );
    expect(dry.data.deepVerify).toEqual([
      { id: 'AC-1', pass: false, reason: 'no linked test found', provider: 'mock' },
    ]);
    expect(dry.stdout).toContain('  AC-1: fail — no linked test found [provider mock]');
  });

  it('347-01/AC-1: a code-review refusal — findings, would-be attempt and reloop verdict reported; code-review-high recorded, not sent (AC-2, AC-3)', async () => {
    const root = await setup({ profile: 'standard', tier: 'complex', src: 'export function f() { console.log("oops"); }\n' });
    const { dry } = await expectSameDecision(root, AUTO, { verdict: 'refuse', at: 'code-review', summary: true });
    expect(dry.data.codeReview?.findings).toEqual([
      expect.objectContaining({ severity: 'high', file: 'src/foo.ts', message: 'console.log left in source' }),
    ]);
    expect(dry.data.codeReview?.convergence).toEqual({ attempt: 1, maxAttempts: 3, verdict: 'reloop', consumesAttempt: true });
    expect(dry.stdout).toContain('  convergence: would be attempt 1 of 3 — verdict reloop');
    expect(dry.data.wouldNotify.map((e) => e.type)).toContain('code-review-high');
  });

  it('347-01/AC-3: two consecutive dry runs predict the same attempt, and the following real settle records that attempt', async () => {
    const root = await setup({ profile: 'standard', tier: 'complex', src: 'export function f() { console.log("oops"); }\n' });
    const sidecarPath = join(root, PHASE_DIR, `${ID}-CODE-REVIEW.json`);
    const first = await dryRun(root, AUTO);
    const second = await dryRun(root, AUTO);
    expect(existsSync(sidecarPath)).toBe(false);
    expect(first.data.codeReview?.convergence?.attempt).toBe(1);
    expect(second.data.codeReview?.convergence).toEqual(first.data.codeReview?.convergence);

    await realSettle(root, AUTO);
    const afterReal = JSON.parse(await readFile(sidecarPath, 'utf8')) as { attempts: number };
    expect(afterReal.attempts).toBe(first.data.codeReview?.convergence?.attempt);

    // One real attempt spent: the next dry run predicts attempt 2 and a second
    // dry run after it still predicts 2 (the dry run spent nothing).
    const third = await dryRun(root, AUTO);
    const fourth = await dryRun(root, AUTO);
    expect(third.data.codeReview?.convergence?.attempt).toBe(2);
    expect(fourth.data.codeReview?.convergence?.attempt).toBe(2);
    await realSettle(root, AUTO);
    const afterSecond = JSON.parse(await readFile(sidecarPath, 'utf8')) as { attempts: number };
    expect(afterSecond.attempts).toBe(2);
  });

  it('347-01/AC-1: a bypassed code-review refusal — settle would pass, convergence verdict bypassed (AC-3)', async () => {
    const root = await setup({ profile: 'standard', tier: 'complex', src: 'export function f() { console.log("oops"); }\n' });
    const { dry } = await expectSameDecision(
      root,
      { auto: true, allowCodeReviewFailure: true },
      { verdict: 'pass' },
    );
    expect(dry.data.codeReview?.convergence?.verdict).toBe('bypassed');
    expect(dry.stdout).toMatch(/code-review: ran, findings bypassed via --allow-code-review-failure/);
    expect(dry.stderr).toContain('code-review: --allow-code-review-failure set; proceeding past 1 HIGH finding(s).');
  });

  it('347-01/AC-1: an --auto offender refusal', async () => {
    const root = await setup({ taskStatus: 'BLOCKED' });
    await expectSameDecision(root, AUTO, { verdict: 'refuse', at: 'ac-derivation', summary: true });
  });

  it('347-01/AC-1: a skill-audit refusal — the skill-audit-miss event is recorded, not sent (AC-2)', async () => {
    const root = await setup({ config: { skillAudit: { required: ['tdd'] } } as Partial<CadenceConfig> });
    const { dry, real } = await expectSameDecision(root, AUTO, { verdict: 'refuse', at: 'skill-audit', summary: true });
    const printed = stderrLine(real.stderr, 'settle run refused: required skill(s) not invoked');
    expect(printed).toBe(
      'settle run refused: required skill(s) not invoked: tdd. Invoke them, or pass --allow-skill-audit-miss to override.',
    );
    expect(dry.data.refusal?.reason).toBe(printed);
    expect(dry.data.wouldNotify.map((e) => e.type)).toContain('skill-audit-miss');
  });

  it('347-01/AC-1: a pack-resolution refusal records the full line settle prints', async () => {
    const root = await setup({ config: { packs: { enabled: ['ghost-pack'], disabled: [] } } as Partial<CadenceConfig> });
    const { dry, real } = await expectSameDecision(root, AUTO, { verdict: 'refuse', at: 'pack-resolution', summary: true });
    const printed = stderrLine(real.stderr, 'settle run refused: 1 enabled pack(s) could not be resolved');
    expect(printed).toBeDefined();
    expect(dry.data.refusal?.reason).toBe(printed);
  });

  it('347-01/AC-2: an anomaly that reaches settle\'s own notifier is recorded under would notify, not written; the real settle writes it', async () => {
    const root = await setup({
      coverage: false,
      config: { gates: { sealed: [], evidenceFloor: 'unverified' } } as Partial<CadenceConfig>,
    });
    const logPath = join(root, '.cadence', 'anomalies.log');
    const flags: SettleArgs = { auto: true, allowMissingCoverage: true };
    const dry = await dryRun(root, flags);
    expect(dry.exitCode, dry.stderr).toBe(0);
    expect(existsSync(logPath)).toBe(false);
    const dryEvents = dry.data.wouldNotify.filter((e) => e.type === 'coverage-bypassed');
    expect(dryEvents).toHaveLength(1);
    const real = await realSettle(root, flags);
    expect(real.exitCode, real.stderr).toBe(0);
    const logged = (await readAnomalyLog(root)).filter((e) => e.type === 'coverage-bypassed');
    expect(logged).toHaveLength(1);
    const { type, severity, message, context } = logged[0]!;
    expect(dryEvents[0]).toEqual({ type, severity, message, context });
  });

  it('347-01/AC-1: an evidence-floor refusal', async () => {
    const root = await setup({ config: { gates: { sealed: [], evidenceFloor: 'ai-verified' } } as Partial<CadenceConfig> });
    await expectSameDecision(root, AUTO, { verdict: 'refuse', at: 'evidence-floor', summary: true });
  });

  it('347-01/AC-1: a verification.fallback "refuse" refusal (unlaunchable host-cli deep verifier)', async () => {
    vi.stubEnv('CLAUDECODE', '');
    vi.stubEnv('CADENCE_HOST_CLI_BIN', join('/', 'nonexistent-cadence-347', 'no-such-host-cli'));
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const root = await setup({
      profile: 'standard',
      tier: 'complex',
      coverage: false,
      src: 'export const x = 1;\n',
      config: {
        gates: { sealed: [], evidenceFloor: 'unverified' },
        verifier: { provider: 'host-cli' },
        verification: { ...defaultConfig.verification, testCommand: 'node pass.cjs', fallback: 'refuse' },
      } as Partial<CadenceConfig>,
    });
    const { dry } = await expectSameDecision(
      root,
      { auto: true, deep: true, allowMissingCoverage: true },
      { verdict: 'refuse', at: 'deep-verify', summary: true },
    );
    expect(dry.data.refusal?.reason).toContain('verification.fallback is refuse');
  });

  it('347-01/AC-1: interactive-verdict under CADENCE_REQUIRE_TTY=1 without a TTY refuses in the dry run exactly as settle does', async () => {
    vi.stubEnv('CADENCE_REQUIRE_TTY', '1');
    expect(process.stdin.isTTY).not.toBe(true);
    const root = await setup({ profile: 'strict', tier: 'quick-fix' });
    const { dry } = await expectSameDecision(root, AUTO, { verdict: 'refuse', at: 'interactive-verdict', summary: true });
    expect(dry.data.wouldPrompt).toBe(false);
  });

  it('347-01/AC-3: when a gate before interactive-verdict refuses, the report does not claim settle would prompt', async () => {
    vi.stubEnv('CADENCE_PROMPTER_SCRIPT', 'pass\n');
    const root = await setup({ profile: 'strict', tier: 'quick-fix', testCommand: 'fail' });
    const dry = await dryRun(root, AUTO);
    expect(dry.data.refusal?.at).toBe('build-test-must-pass');
    expect(dry.data.wouldPrompt).toBe(false);
    expect(dry.stderr).not.toContain('would prompt');
    expect(dry.stdout).not.toContain('would prompt');
  });

  it('347-01/AC-2: a LoopViolationError thrown mid-settle reaches the catch block, which records the loop violation instead of sending it', async () => {
    const root = await setup();
    loaderSeam.throwNext = true;
    const dry = await dryRun(root, AUTO);
    expect(dry.exitCode).toBe(1);
    expect(dry.data.refusal).toEqual({ at: 'error', reason: 'settle run failed: seam: loop violation mid-settle' });
    expect(existsSync(join(root, '.cadence', 'anomalies.log'))).toBe(false);

    loaderSeam.throwNext = true;
    const real = await realSettle(root, AUTO);
    expect(real.exitCode).toBe(1);
    expect(real.stderr).toContain('settle run failed: seam: loop violation mid-settle');
    const log = await readAnomalyLog(root);
    expect(log).toHaveLength(1);
    const { type, severity, message, context } = log[0]!;
    expect(dry.data.wouldNotify).toEqual([{ type, severity, message, context }]);
  });

  it('347-01/AC-4: where settle would prompt, the dry run takes the non-interactive path and says so on stderr and in the report', async () => {
    vi.stubEnv('CADENCE_PROMPTER_SCRIPT', 'pass\n');
    const root = await setup({ profile: 'strict', tier: 'quick-fix' });
    const dry = await dryRun(root, AUTO);
    expect(dry.stderr).toContain('settle --dry-run: interactive-verdict would prompt for AC verdicts; the walk is skipped');
    expect(dry.data.wouldPrompt).toBe(true);
    expect(dry.stdout).toContain('interactive-verdict: settle would prompt for AC verdicts');
    expect(dry.stdout.trimEnd().split('\n').pop()).toMatch(/\(settle would prompt for AC verdicts first\)$/);
  });
});

describe('settle run --dry-run usage rules (347-01/AC-4)', { timeout: 30_000 }, () => {
  it('347-01/AC-4: --interactive with --dry-run exits 2 naming the flag, before any precondition, gate or test command runs', async () => {
    const root = await setup({ testCommand: 'marker' });
    const before = await hashTree(root);
    const { io, out, err } = captureIO();
    const res = await settleService(root, { auto: true, dryRun: true, interactive: true }, io);
    expect(res.exitCode).toBe(2);
    expect(err.join('')).toContain('--interactive cannot be combined with --dry-run');
    expect(err.join('')).toContain('needs a human to record verdicts');
    expect(out.join('')).toBe('');
    expect(existsSync(join(root, 'ran.marker'))).toBe(false);
    expect(await hashTree(root)).toEqual(before);
  });

  it('347-01/AC-4: --ship-ref with --dry-run exits 2 naming the flag, before anything runs', async () => {
    const root = await setup({ testCommand: 'marker' });
    const before = await hashTree(root);
    const { io, out, err } = captureIO();
    const res = await settleService(root, { auto: true, dryRun: true, shipRef: 'v1' }, io);
    expect(res.exitCode).toBe(2);
    expect(err.join('')).toContain('--ship-ref cannot be combined with --dry-run');
    expect(err.join('')).toContain('finalize step');
    expect(out.join('')).toBe('');
    expect(existsSync(join(root, 'ran.marker'))).toBe(false);
    expect(await hashTree(root)).toEqual(before);
  });

  it('347-01/AC-4: the test command still runs in a dry run (nothing stubbed), and its own write is outside the guarantee', async () => {
    const root = await setup({ testCommand: 'marker' });
    const { io } = captureIO();
    const res = await settleService(root, { auto: true, dryRun: true }, io);
    expect(res.exitCode).toBe(0);
    expect(existsSync(join(root, 'ran.marker'))).toBe(true);
  });
});
