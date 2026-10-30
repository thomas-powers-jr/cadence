// Phase 343 (343-01, T4) — settle-level refusal end to end under
// `verification.fallback: "refuse"`. Drives the real `settleService` with the
// real verifier factories (no factory mocks): the deep-verify seam points at
// a host-cli binary path that does not exist (AC-1), the code-review seam at a
// claude-family bin under `CLAUDECODE=1` so the self-invocation guard fires
// before any spawn (AC-2), and the security-audit seam at `anthropic` with no
// key (the lazy selection-time refusal, AC-1 family). No real `claude`/`codex`
// process is spawned and nothing touches the network.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defaultConfig,
  emptyState,
  type CadenceConfig,
  type Summary,
} from '@thomas-powers-jr/cadence-types';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { settleService } from '../../src/services/settle.js';
import type { CommandIO } from '../../src/services/io.js';

const FALLING_BACK = /falling back to mock/i;
/** A host-cli cause token from `HostCliError.reason` — the not-found path on
 *  POSIX; win32 can surface a spawn error or a non-zero exit instead. */
const HOST_CLI_CAUSE = /\((not-found|spawn-error|nonzero-exit)\)/;

let fx: Fixture | undefined;
let stderrSpy: ReturnType<typeof vi.spyOn> | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  stderrSpy?.mockRestore();
  stderrSpy = undefined;
  if (fx) {
    await fx.cleanup();
    fx = undefined;
  }
});

function captureIO(): { io: CommandIO; err: string[] } {
  const err: string[] = [];
  return { io: { out: () => {}, err: (s) => err.push(s) }, err };
}

/** Captures anything written straight to `process.stderr` (the host-cli
 *  quota notice, any downgrade banner) alongside the `io.err` lines. */
function spyProcessStderr(): string[] {
  const chunks: string[] = [];
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  return chunks;
}

function draftMd(phase: string, id: string, tier: string): string {
  return `---
phase: ${phase}
id: ${id}
tier: ${tier}
status: APPROVED
---

# ${id} — fallback refuse fixture

## Objective

Prove a verifier seam refuses instead of falling back to mock.

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

/** A BUILD-state cadence repo with one DONE task under `config`. */
async function setupBuildRepo(args: {
  phase: string;
  id: string;
  tier: string;
  config: CadenceConfig;
}): Promise<string> {
  fx = await tempRepo({ initialized: true, projectName: 'fallback-refuse' });
  const root = fx.root;
  const { phase, id, tier, config } = args;
  const phaseDir = join(root, '.cadence', 'phases', phase);
  await mkdir(phaseDir, { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'foo.ts'), 'export const x = 1;\n', 'utf8');
  await writeFile(join(root, '.cadence', 'config.json'), JSON.stringify(config, null, 2));
  const state = {
    ...emptyState('fallback-refuse'),
    loopPosition: 'BUILD' as const,
    activePhase: phase,
    activeDraft: id,
  };
  await writeFile(join(root, '.cadence', 'state.json'), JSON.stringify(state, null, 2));
  await writeFile(join(phaseDir, `${id}-DRAFT.md`), draftMd(phase, id, tier));
  await writeFile(
    join(phaseDir, `${id}-PROGRESS.json`),
    JSON.stringify({ draftId: id, tasks: { T1: { status: 'DONE' } } }, null, 2),
  );
  return root;
}

/** No real AC coverage in these fixtures — relax the evidence floor so the
 *  bypass-proceeds cases are about the verifier seam, not the floor. */
function refuseConfig(
  profile: CadenceConfig['profile'],
  patch: Partial<CadenceConfig>,
): CadenceConfig {
  return {
    ...defaultConfig,
    profile,
    gates: { ...defaultConfig.gates, evidenceFloor: 'unverified' },
    verification: { ...defaultConfig.verification, fallback: 'refuse' },
    ...patch,
  } as CadenceConfig;
}

/** A real `assertion`-mode test naming AC-1 at the default test glob, so the
 *  mock deep verifier (which fires in standard × complex) links it and
 *  passes — leaving code-review as the only seam under test in AC-2. */
async function seedCoverageTest(root: string): Promise<void> {
  await mkdir(join(root, 'packages', 'core', 'tests'), { recursive: true });
  await writeFile(
    join(root, 'packages', 'core', 'tests', 'foo.test.ts'),
    "it('AC-1 coverage fixture', () => { expect(true).toBe(true); });\n",
    'utf8',
  );
}

async function readSummary(root: string, phase: string, id: string): Promise<Summary> {
  return JSON.parse(
    await readFile(join(root, '.cadence', 'phases', phase, `${id}-SUMMARY.json`), 'utf8'),
  ) as Summary;
}

async function loopPosition(root: string): Promise<string> {
  const st = JSON.parse(await readFile(join(root, '.cadence', 'state.json'), 'utf8')) as {
    loopPosition: string;
  };
  return st.loopPosition;
}

const MISSING_BIN = join('/', 'nonexistent-cadence-343', 'no-such-host-cli');

describe('settle refuses an unlaunchable host-cli deep verifier under verification.fallback "refuse" (343-01 AC-1)', () => {
  const PHASE = '01-deep-refuse';
  const ID = '01-01';

  it('343-01/AC-1: settle --auto --deep exits 1 and writes a refused SUMMARY whose deep-verify entry names the refusal and a host-cli cause, with no mock-fallback text', async () => {
    vi.stubEnv('CLAUDECODE', '');
    vi.stubEnv('CADENCE_HOST_CLI_BIN', MISSING_BIN);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const root = await setupBuildRepo({
      phase: PHASE,
      id: ID,
      tier: 'complex',
      config: refuseConfig('standard', { verifier: { provider: 'host-cli' } } as Partial<CadenceConfig>),
    });
    const processErr = spyProcessStderr();
    const { io, err } = captureIO();

    const res = await settleService(
      root,
      { auto: true, deep: true, interactive: false, allowMissingCoverage: true },
      io,
    );

    expect(res.exitCode).toBe(1);
    const summary = await readSummary(root, PHASE, ID);
    expect(summary.acResults).toEqual([]);
    const deep = summary.gates?.find((g) => g.gate === 'deep-verify');
    expect(deep?.status).toBe('refused');
    const reason = deep?.reason ?? '';
    expect(reason).toContain('deep-verify');
    expect(reason).toContain('verification.fallback is refuse');
    expect(reason).toMatch(HOST_CLI_CAUSE);
    expect(reason).toContain(MISSING_BIN);
    expect(reason).not.toMatch(FALLING_BACK);
    expect(summary.assurance?.overall).toBe('unverified');

    const allStderr = err.join('') + processErr.join('');
    expect(allStderr).toContain('verification.fallback is refuse');
    expect(allStderr).not.toMatch(FALLING_BACK);
    // A refused settle never transitions the loop.
    expect(await loopPosition(root)).toBe('BUILD');
  });

  it('343-01/AC-1: the same run with --allow-verifier-failure proceeds and records the verifier failure as that flag does', async () => {
    vi.stubEnv('CLAUDECODE', '');
    vi.stubEnv('CADENCE_HOST_CLI_BIN', MISSING_BIN);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const root = await setupBuildRepo({
      phase: PHASE,
      id: ID,
      tier: 'complex',
      config: refuseConfig('standard', { verifier: { provider: 'host-cli' } } as Partial<CadenceConfig>),
    });
    const processErr = spyProcessStderr();
    const { io, err } = captureIO();

    const res = await settleService(
      root,
      {
        auto: true,
        deep: true,
        interactive: false,
        allowMissingCoverage: true,
        allowVerifierFailure: true,
      },
      io,
    );

    const errText = err.join('');
    expect(errText).toContain('--allow-verifier-failure set');
    expect(errText).not.toMatch(FALLING_BACK);
    expect(processErr.join('')).not.toMatch(FALLING_BACK);

    const summary = await readSummary(root, PHASE, ID);
    // deep-verify did not refuse: the flag turned the failure into pass=false verdicts.
    const deep = summary.gates?.find((g) => g.gate === 'deep-verify');
    expect(deep?.status).not.toBe('refused');
    const verdict = summary.deepVerify?.['AC-1'];
    expect(verdict?.pass).toBe(false);
    expect(verdict?.provider).toBe('host-cli');
    expect(verdict?.reason).toContain('verifier failed:');
    expect(verdict?.reason).toContain('verification.fallback is refuse');
    // The verifier-failure anomaly becomes a gateBypasses entry naming the flag
    // (settle.ts anomalyToGateBypass) on the success write path.
    expect(res.exitCode).toBe(0);
    const bypass = summary.gateBypasses?.find((b) => b.gate === 'deep-verify');
    expect(bypass?.flag).toBe('--allow-verifier-failure');
    expect(bypass?.severity).toBe('error');
    expect(bypass?.reason).toContain('deep verifier failed:');
    expect(await loopPosition(root)).toBe('IDLE');
  });
});

describe('settle refuses a self-invoking claude code-review seam under verification.fallback "refuse" (343-01 AC-2)', () => {
  const PHASE = '02-review-refuse';
  const ID = '02-01';

  it('343-01/AC-2: CLAUDECODE=1 with a claude-family code-review bin refuses settle with a self-invocation reason and no mock-fallback text', async () => {
    vi.stubEnv('CLAUDECODE', '1');
    vi.stubEnv('CADENCE_HOST_CLI_BIN', 'claude');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const root = await setupBuildRepo({
      phase: PHASE,
      id: ID,
      tier: 'complex',
      config: refuseConfig('standard', {
        verifier: { provider: 'mock' },
        codeReview: { provider: 'host-cli' },
      } as Partial<CadenceConfig>),
    });
    await seedCoverageTest(root);
    const processErr = spyProcessStderr();
    const { io, err } = captureIO();

    const res = await settleService(
      root,
      { auto: true, interactive: false, allowMissingCoverage: true },
      io,
    );

    expect(res.exitCode).toBe(1);
    const summary = await readSummary(root, PHASE, ID);
    expect(summary.acResults).toEqual([]);
    const review = summary.gates?.find((g) => g.gate === 'code-review');
    expect(review?.status).toBe('refused');
    const reason = review?.reason ?? '';
    expect(reason).toContain('code-review');
    expect(reason).toContain('self-invocation');
    expect(reason).toContain('verification.fallback is refuse');
    expect(reason).not.toMatch(FALLING_BACK);
    const allStderr = err.join('') + processErr.join('');
    expect(allStderr).not.toMatch(FALLING_BACK);
    // The guard fires before spawn, so the host-cli quota notice never prints.
    expect(processErr.join('')).not.toContain('SUBSCRIPTION QUOTA IN USE');
    expect(await loopPosition(root)).toBe('BUILD');
  });

  it('343-01/AC-2: with --allow-code-review-failure the settle proceeds and records the reviewVerifierFailure bypass unchanged', async () => {
    vi.stubEnv('CLAUDECODE', '1');
    vi.stubEnv('CADENCE_HOST_CLI_BIN', 'claude');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const root = await setupBuildRepo({
      phase: PHASE,
      id: ID,
      tier: 'complex',
      config: refuseConfig('standard', {
        verifier: { provider: 'mock' },
        codeReview: { provider: 'host-cli' },
      } as Partial<CadenceConfig>),
    });
    await seedCoverageTest(root);
    spyProcessStderr();
    const { io, err } = captureIO();

    const res = await settleService(
      root,
      {
        auto: true,
        interactive: false,
        allowMissingCoverage: true,
        allowCodeReviewFailure: true,
      },
      io,
    );

    expect(res.exitCode).toBe(0);
    const errText = err.join('');
    expect(errText).toContain('code-review: --allow-code-review-failure set; proceeding past a verifier failure');
    expect(errText).not.toMatch(FALLING_BACK);
    const summary = await readSummary(root, PHASE, ID);
    // Phase 248's record: the code-review gates[] entry is skipped with a
    // skipReason naming the gate-specific flag and the configured provider.
    const review = summary.gates?.find((g) => g.gate === 'code-review');
    expect(review?.status).toBe('skipped');
    expect(review?.skipReason).toContain('bypassed via --allow-code-review-failure');
    expect(review?.skipReason).toContain('verifier failure bypassed');
    expect(review?.skipReason).toContain('self-invocation');
    expect(review?.skipReason).toContain('configured provider: host-cli');
    expect(await loopPosition(root)).toBe('IDLE');
  });
});

describe('settle refuses an anthropic security-audit seam with no key under verification.fallback "refuse" (343-01 AC-1 family, wiring)', () => {
  const PHASE = '03-audit-refuse';
  const ID = '03-01';

  it('343-01/AC-1: strict × complex settle refuses at security-audit naming the seam and the missing key, with no mock-fallback banner', async () => {
    vi.stubEnv('CLAUDECODE', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const root = await setupBuildRepo({
      phase: PHASE,
      id: ID,
      tier: 'complex',
      config: refuseConfig('strict', {
        securityAudit: { provider: 'anthropic' },
      } as Partial<CadenceConfig>),
    });
    const processErr = spyProcessStderr();
    const { io, err } = captureIO();

    const res = await settleService(
      root,
      { auto: true, interactive: false, allowMissingCoverage: true },
      io,
    );

    expect(res.exitCode).toBe(1);
    const summary = await readSummary(root, PHASE, ID);
    const audit = summary.gates?.find((g) => g.gate === 'security-audit');
    expect(audit?.status).toBe('refused');
    const reason = audit?.reason ?? '';
    expect(reason).toContain('security-audit');
    expect(reason).toContain('verification.fallback is refuse');
    expect(reason).toContain('ANTHROPIC_API_KEY is unset');
    expect(reason).not.toMatch(FALLING_BACK);
    expect(err.join('') + processErr.join('')).not.toMatch(FALLING_BACK);
  });
});
