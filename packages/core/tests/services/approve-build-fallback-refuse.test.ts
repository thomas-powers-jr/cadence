// Phase 343 (343-01, T4) — the seams with no gate failure path (plan-review,
// per-task-verify, spec-review, ui-spec-review) refuse through their command's
// error exit under `verification.fallback: "refuse"`, without mutating loop
// state. Drives the real `draftApproveService` / `buildTaskService` with the
// real verifier factories; the host-cli bin is a path that does not exist and
// `CLAUDECODE` is stubbed off, so nothing is spawned and nothing touches the
// network. spec-review / ui-spec-review are exercised at their selection
// seam (`resolveSpecReviewPort` / `resolveUiSpecReviewPort`) with an
// `anthropic` provider and no key — the lazy selection-time refusal.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defaultConfig,
  emptyState,
  type CadenceConfig,
} from '@thomas-powers-jr/cadence-types';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { draftApproveService } from '../../src/services/draft-approve.js';
import { buildTaskService } from '../../src/services/build-task.js';
import {
  resolveSpecReviewPort,
  resolveUiSpecReviewPort,
} from '../../src/services/spec-approve-ports.js';
import { VerifierFallbackRefusedError } from '../../src/verify/verifier-factory.js';
import { SimpleStateBackend } from '../../src/state/simple.js';
import type { CommandIO } from '../../src/services/io.js';

const FALLING_BACK = /falling back to mock/i;
const HOST_CLI_CAUSE = /\((not-found|spawn-error|nonzero-exit)\)/;
const MISSING_BIN = join('/', 'nonexistent-cadence-343', 'no-such-host-cli');
const PHASE = '01-foundation';
const DRAFT_ID = '01-01';

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

function captureIO(): { io: CommandIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
}

function spyProcessStderr(): string[] {
  const chunks: string[] = [];
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  return chunks;
}

function draftMd(tier: 'standard' | 'complex', status: 'PENDING' | 'APPROVED'): string {
  return `---
phase: ${PHASE}
id: ${DRAFT_ID}
tier: ${tier}
status: ${status}
---

# ${DRAFT_ID} — fallback refuse fixture

## Objective

Prove a seam without a gate failure path refuses through its command.

## Acceptance Criteria

### AC-1: It refuses
Given a precondition
When an action
Then an observable outcome

## Tasks

### T1: Do the thing
- files: \`src/foo.ts\`
- action: do the thing
- verify: run the test
- done: AC-1

## Boundaries

- DO NOT touch anything else.
`;
}

function refuseConfig(patch: Partial<CadenceConfig>): CadenceConfig {
  return {
    ...defaultConfig,
    profile: 'strict',
    verification: { ...defaultConfig.verification, fallback: 'refuse' },
    ...patch,
  } as CadenceConfig;
}

async function rawState(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, '.cadence', 'state.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('draft approve refuses a host-cli plan-review seam under verification.fallback "refuse" (343-01 AC-7)', () => {
  it('343-01/AC-7: strict × complex approve exits 1 naming plan-review and the refusal, and leaves the loop in DRAFT', async () => {
    vi.stubEnv('CLAUDECODE', '');
    vi.stubEnv('CADENCE_HOST_CLI_BIN', MISSING_BIN);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    fx = await tempRepo({ initialized: true, projectName: 'fallback-refuse' });
    const root = fx.root;
    await mkdir(join(root, '.cadence', 'phases', PHASE), { recursive: true });
    const state = emptyState('fallback-refuse');
    state.loopPosition = 'DRAFT';
    await new SimpleStateBackend(root).commit(state);
    await writeFile(
      join(root, '.cadence', 'phases', PHASE, `${DRAFT_ID}-DRAFT.md`),
      draftMd('complex', 'PENDING'),
      'utf8',
    );
    await writeFile(
      join(root, '.cadence', 'config.json'),
      JSON.stringify(refuseConfig({ planReview: { provider: 'host-cli' } } as Partial<CadenceConfig>), null, 2),
      'utf8',
    );
    const before = await rawState(root);
    const processErr = spyProcessStderr();
    const { io, err } = captureIO();

    // `approve: false` is --no-approve: skip the manual prompt so plan-review is reached.
    const res = await draftApproveService(
      root,
      { phase: PHASE, num: '01', approve: false },
      io,
    );

    expect(res.exitCode).toBe(1);
    const errText = err.join('');
    expect(errText).toContain('draft approve failed:');
    expect(errText).toContain('plan-review');
    expect(errText).toContain('verification.fallback is refuse');
    expect(errText).toMatch(HOST_CLI_CAUSE);
    expect(errText + processErr.join('')).not.toMatch(FALLING_BACK);

    const after = await rawState(root);
    expect(after.loopPosition).toBe('DRAFT');
    expect(after.loopPosition).toBe(before.loopPosition);
    expect(after.activeDraft).toBe(before.activeDraft);
    expect(after.draftReadAt).toBe(before.draftReadAt);
  });
});

describe('build task refuses a host-cli per-task-verify seam under verification.fallback "refuse" (343-01 AC-7)', () => {
  it('343-01/AC-7: strict × standard build task T1 --status=DONE exits 1 naming per-task-verify and the refusal, and records nothing', async () => {
    vi.stubEnv('CLAUDECODE', '');
    vi.stubEnv('CADENCE_HOST_CLI_BIN', MISSING_BIN);
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    fx = await tempRepo({ initialized: true, projectName: 'fallback-refuse' });
    const root = fx.root;
    const phaseDir = join(root, '.cadence', 'phases', PHASE);
    await mkdir(phaseDir, { recursive: true });
    const state = emptyState('fallback-refuse');
    state.loopPosition = 'BUILD';
    state.activePhase = PHASE;
    state.activeDraft = DRAFT_ID;
    state.tier = 'standard';
    await new SimpleStateBackend(root).commit(state);
    await writeFile(join(phaseDir, `${DRAFT_ID}-DRAFT.md`), draftMd('standard', 'APPROVED'), 'utf8');
    const progressPath = join(phaseDir, `${DRAFT_ID}-PROGRESS.json`);
    const progressBefore = JSON.stringify(
      { draftId: DRAFT_ID, tasks: { T1: { status: 'PENDING' } } },
      null,
      2,
    );
    await writeFile(progressPath, progressBefore, 'utf8');
    await writeFile(
      join(root, '.cadence', 'config.json'),
      JSON.stringify(refuseConfig({ perTaskVerifier: { provider: 'host-cli' } } as Partial<CadenceConfig>), null, 2),
      'utf8',
    );
    const before = await rawState(root);
    const processErr = spyProcessStderr();
    const { io, out, err } = captureIO();

    const res = await buildTaskService(root, { taskId: 'T1', status: 'DONE' }, io);

    expect(res.exitCode).toBe(1);
    const errText = err.join('');
    expect(errText).toContain('build task failed:');
    expect(errText).toContain('per-task-verify');
    expect(errText).toContain('verification.fallback is refuse');
    expect(errText).toMatch(HOST_CLI_CAUSE);
    expect(errText + processErr.join('')).not.toMatch(FALLING_BACK);
    expect(out.join('')).not.toContain('Recorded T1');

    // Task record and loop position untouched.
    expect(await readFile(progressPath, 'utf8')).toBe(progressBefore);
    const after = await rawState(root);
    expect(after.loopPosition).toBe('BUILD');
    expect(after.loopPosition).toBe(before.loopPosition);
    expect(after.activeDraft).toBe(DRAFT_ID);
  });
});

describe('spec-review and ui-spec-review selection seams receive verification.fallback (343-01 AC-7, wiring)', () => {
  async function callVerify(fn: () => unknown): Promise<unknown> {
    // The refusing proxy throws synchronously; normalise to a rejection.
    return Promise.resolve().then(fn);
  }

  it('343-01/AC-7: resolveSpecReviewPort under refuse with an anthropic provider and no key selects without warning, then refuses on verify', async () => {
    vi.stubEnv('CLAUDECODE', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    fx = await tempRepo();
    const processErr = spyProcessStderr();
    const cfg = refuseConfig({ specReview: { provider: 'anthropic' } } as Partial<CadenceConfig>);

    const port = resolveSpecReviewPort(undefined, cfg, fx.root);
    expect(processErr.join('')).toBe('');

    const err = await callVerify(() =>
      port.verify({} as Parameters<typeof port.verify>[0]),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VerifierFallbackRefusedError);
    expect((err as VerifierFallbackRefusedError).label).toBe('spec-review');
    expect((err as Error).message).toContain('verification.fallback is refuse');
    expect((err as Error).message).toContain('ANTHROPIC_API_KEY is unset');
    expect((err as Error).message).not.toMatch(FALLING_BACK);
    expect(processErr.join('')).not.toMatch(FALLING_BACK);
  });

  it('343-01/AC-7: resolveUiSpecReviewPort under refuse with an anthropic provider and no key selects without warning, then refuses on verify', async () => {
    vi.stubEnv('CLAUDECODE', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    fx = await tempRepo();
    const processErr = spyProcessStderr();
    const cfg = refuseConfig({ uiSpecReview: { provider: 'anthropic' } } as Partial<CadenceConfig>);

    const port = resolveUiSpecReviewPort(undefined, cfg, fx.root);
    expect(processErr.join('')).toBe('');

    const err = await callVerify(() =>
      port.verify({} as Parameters<typeof port.verify>[0]),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VerifierFallbackRefusedError);
    expect((err as VerifierFallbackRefusedError).label).toBe('ui-spec-review');
    expect((err as Error).message).toContain('verification.fallback is refuse');
    expect((err as Error).message).toContain('ANTHROPIC_API_KEY is unset');
    expect((err as Error).message).not.toMatch(FALLING_BACK);
  });

  it('343-01/AC-7: without the setting the same spec-review selection still prints the 1.73.0 mock-fallback banner (control)', async () => {
    vi.stubEnv('CLAUDECODE', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    fx = await tempRepo();
    const processErr = spyProcessStderr();
    const cfg = {
      ...defaultConfig,
      specReview: { provider: 'anthropic' },
    } as CadenceConfig;

    resolveSpecReviewPort(undefined, cfg, fx.root);
    expect(processErr.join('')).toMatch(FALLING_BACK);
  });
});
