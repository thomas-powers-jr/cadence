// Phase 344 (344-01, T2) - each of the seven call sites that pass
// `verification.fallback` to a verifier selector also passes
// `verification.hostCliIsolation` from the loaded config, when it is set.
//
// Each selector module is wrapped so the options the REAL call site hands it
// are recorded, then the real selector runs (every provider here is `mock`, so
// nothing is spawned). The call sites are reached through their real commands,
// each of which loads `.cadence/config.json` with `loadConfig`:
//   - `settleService`        -> services/settle.ts: deep-verify, code-review, security-audit
//   - `draftApproveService`  -> gates/draft-context.ts: plan-review
//   - `buildTaskService`     -> gates/build-context.ts: per-task-verify
//   - `specApproveService`   -> services/spec-approve-ports.ts: spec-review, ui-spec-review
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultConfig, emptyState } from '@thomas-powers-jr/cadence-types';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import type { CommandIO } from '../../src/services/io.js';
import type { VerifierSelectOptions } from '../../src/verify/verifier-factory.js';

type SelectorName =
  | 'selectVerifier'
  | 'selectPerTaskVerifier'
  | 'selectCodeReviewVerifier'
  | 'selectSecurityAuditVerifier'
  | 'selectPlanReviewVerifier'
  | 'selectSpecReviewVerifier'
  | 'selectUiSpecReviewVerifier';

/** The options each selector was called with, in call order. */
const received = vi.hoisted(
  () =>
    ({
      selectVerifier: [],
      selectPerTaskVerifier: [],
      selectCodeReviewVerifier: [],
      selectSecurityAuditVerifier: [],
      selectPlanReviewVerifier: [],
      selectSpecReviewVerifier: [],
      selectUiSpecReviewVerifier: [],
    }) as Record<string, Array<Record<string, unknown> | undefined>>,
);

vi.mock('../../src/verify/factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/verify/factory.js')>();
  const selectVerifier: typeof actual.selectVerifier = (config, opts) => {
    received.selectVerifier?.push(opts as Record<string, unknown> | undefined);
    return actual.selectVerifier(config, opts);
  };
  return { ...actual, selectVerifier };
});

vi.mock('../../src/verify/per-task-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/verify/per-task-factory.js')>();
  const selectPerTaskVerifier: typeof actual.selectPerTaskVerifier = (config, opts) => {
    received.selectPerTaskVerifier?.push(opts as Record<string, unknown> | undefined);
    return actual.selectPerTaskVerifier(config, opts);
  };
  return { ...actual, selectPerTaskVerifier };
});

vi.mock('../../src/verify/code-review-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/verify/code-review-factory.js')>();
  const selectCodeReviewVerifier: typeof actual.selectCodeReviewVerifier = (config, opts) => {
    received.selectCodeReviewVerifier?.push(opts as Record<string, unknown> | undefined);
    return actual.selectCodeReviewVerifier(config, opts);
  };
  return { ...actual, selectCodeReviewVerifier };
});

vi.mock('../../src/verify/security-audit-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/verify/security-audit-factory.js')>();
  const selectSecurityAuditVerifier: typeof actual.selectSecurityAuditVerifier = (config, opts) => {
    received.selectSecurityAuditVerifier?.push(opts as Record<string, unknown> | undefined);
    return actual.selectSecurityAuditVerifier(config, opts);
  };
  return { ...actual, selectSecurityAuditVerifier };
});

vi.mock('../../src/verify/plan-review-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/verify/plan-review-factory.js')>();
  const selectPlanReviewVerifier: typeof actual.selectPlanReviewVerifier = (config, opts) => {
    received.selectPlanReviewVerifier?.push(opts as Record<string, unknown> | undefined);
    return actual.selectPlanReviewVerifier(config, opts);
  };
  return { ...actual, selectPlanReviewVerifier };
});

vi.mock('../../src/verify/spec-review-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/verify/spec-review-factory.js')>();
  const selectSpecReviewVerifier: typeof actual.selectSpecReviewVerifier = (config, opts) => {
    received.selectSpecReviewVerifier?.push(opts as Record<string, unknown> | undefined);
    return actual.selectSpecReviewVerifier(config, opts);
  };
  return { ...actual, selectSpecReviewVerifier };
});

vi.mock('../../src/verify/ui-spec-review-factory.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/verify/ui-spec-review-factory.js')>();
  const selectUiSpecReviewVerifier: typeof actual.selectUiSpecReviewVerifier = (config, opts) => {
    received.selectUiSpecReviewVerifier?.push(opts as Record<string, unknown> | undefined);
    return actual.selectUiSpecReviewVerifier(config, opts);
  };
  return { ...actual, selectUiSpecReviewVerifier };
});

const { settleService } = await import('../../src/services/settle.js');
const { draftApproveService } = await import('../../src/services/draft-approve.js');
const { buildTaskService } = await import('../../src/services/build-task.js');
const { specApproveService } = await import('../../src/services/spec-approve.js');
const { SimpleStateBackend } = await import('../../src/state/simple.js');

const PHASE = '44-isolation';
const ID = '44-01';
const PROJECT = 'isolation-call-sites';

let fx: Fixture | undefined;
let stderrSpy: ReturnType<typeof vi.spyOn> | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  stderrSpy?.mockRestore();
  stderrSpy = undefined;
  for (const calls of Object.values(received)) calls.length = 0;
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

/** Keeps the mock-provider banners the real selectors print out of the test output. */
function muteProcessStderr(): void {
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
}

/** The setting under test: a value written to config.json, or `undefined` for a config without the key. */
type Setting = 'off' | 'on' | undefined;

/**
 * A strict-profile config.json (every review gate fires at the complex tier),
 * all providers left at `mock`. `hostCliIsolation` is written only when
 * `setting` is given, so the "absent" runs load a config without the key.
 */
function configJson(setting: Setting): string {
  return JSON.stringify(
    {
      ...defaultConfig,
      profile: 'strict',
      // These fixtures carry no real AC coverage; relax the evidence floor so
      // the settle run is about which options reach the selectors.
      gates: { ...defaultConfig.gates, evidenceFloor: 'unverified' },
      verification: {
        ...defaultConfig.verification,
        ...(setting !== undefined ? { hostCliIsolation: setting } : {}),
      },
    },
    null,
    2,
  );
}

function draftMd(tier: 'standard' | 'complex', status: 'PENDING' | 'APPROVED'): string {
  return `---
phase: ${PHASE}
id: ${ID}
tier: ${tier}
status: ${status}
---

# ${ID} — isolation call-site fixture

## Objective

Prove each verifier call site forwards the isolation setting.

## Acceptance Criteria

### AC-1: It forwards
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

const SPEC_MD = `---
phase: ${PHASE}
id: ${ID}
status: PENDING
---

# ${ID} — demo

## Objective

Prove the isolation setting reaches the spec-review selectors.

## Acceptance Criteria

### AC-1: it works
Given a precondition
When an action
Then an observable outcome

## Constraints

- host-agnostic

## Open Questions

- none
`;

const UI_SPEC_MD = `---
phase: ${PHASE}
id: ${ID}
status: PENDING
---

# ${ID} — demo

## Components

### X
- new

#### Layout & Tokens
- spacing-4

#### Precedent References
- (none)

## Responsive & Interaction

- collapses below 768px
`;

async function newRepo(setting: Setting): Promise<{ root: string; phaseDir: string }> {
  vi.stubEnv('CLAUDECODE', '');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  fx = await tempRepo({ initialized: true, projectName: PROJECT });
  const root = fx.root;
  const phaseDir = join(root, '.cadence', 'phases', PHASE);
  await mkdir(phaseDir, { recursive: true });
  await writeFile(join(root, '.cadence', 'config.json'), configJson(setting), 'utf8');
  return { root, phaseDir };
}

/** strict × complex `settle run --auto --deep`: deep-verify, code-review and security-audit all fire. */
async function runSettle(setting: Setting): Promise<void> {
  const { root, phaseDir } = await newRepo(setting);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'foo.ts'), 'export const x = 1;\n', 'utf8');
  const state = {
    ...emptyState(PROJECT),
    loopPosition: 'BUILD' as const,
    activePhase: PHASE,
    activeDraft: ID,
  };
  await writeFile(join(root, '.cadence', 'state.json'), JSON.stringify(state, null, 2), 'utf8');
  await writeFile(join(phaseDir, `${ID}-DRAFT.md`), draftMd('complex', 'APPROVED'), 'utf8');
  await writeFile(
    join(phaseDir, `${ID}-PROGRESS.json`),
    JSON.stringify({ draftId: ID, tasks: { T1: { status: 'DONE' } } }, null, 2),
    'utf8',
  );
  // A real assertion-mode test naming AC-1 at the default test glob, so the
  // mock deep verifier links it and passes and the later gates are reached.
  await mkdir(join(root, 'packages', 'core', 'tests'), { recursive: true });
  await writeFile(
    join(root, 'packages', 'core', 'tests', 'foo.test.ts'),
    "it('AC-1 coverage fixture', () => { expect(true).toBe(true); });\n",
    'utf8',
  );
  muteProcessStderr();
  const { io, err } = captureIO();
  const res = await settleService(
    root,
    { auto: true, deep: true, interactive: false, allowMissingCoverage: true },
    io,
  );
  // The run must get past every gate, or a later selector was never reached.
  expect(err.join('')).not.toContain('refused');
  expect(res.exitCode).toBe(0);
}

/** strict × complex `draft approve --no-approve`: plan-review fires. */
async function runDraftApprove(setting: Setting): Promise<void> {
  const { root, phaseDir } = await newRepo(setting);
  const state = emptyState(PROJECT);
  state.loopPosition = 'DRAFT';
  await new SimpleStateBackend(root).commit(state);
  await writeFile(join(phaseDir, `${ID}-DRAFT.md`), draftMd('complex', 'PENDING'), 'utf8');
  muteProcessStderr();
  await draftApproveService(root, { phase: PHASE, num: '01', approve: false }, captureIO().io);
}

/** strict × standard `build task T1 --status=DONE`: per-task-verify fires. */
async function runBuildTask(setting: Setting): Promise<void> {
  const { root, phaseDir } = await newRepo(setting);
  const state = emptyState(PROJECT);
  state.loopPosition = 'BUILD';
  state.activePhase = PHASE;
  state.activeDraft = ID;
  state.tier = 'standard';
  await new SimpleStateBackend(root).commit(state);
  await writeFile(join(phaseDir, `${ID}-DRAFT.md`), draftMd('standard', 'APPROVED'), 'utf8');
  await writeFile(
    join(phaseDir, `${ID}-PROGRESS.json`),
    JSON.stringify({ draftId: ID, tasks: { T1: { status: 'PENDING' } } }, null, 2),
    'utf8',
  );
  muteProcessStderr();
  await buildTaskService(root, { taskId: 'T1', status: 'DONE' }, captureIO().io);
}

/** `spec approve` on a slice with a UI-SPEC: spec-review, then ui-spec-review. */
async function runSpecApprove(setting: Setting): Promise<void> {
  const { root, phaseDir } = await newRepo(setting);
  await writeFile(join(phaseDir, `${ID}-SPEC.md`), SPEC_MD, 'utf8');
  await writeFile(join(phaseDir, `${ID}-UI-SPEC.md`), UI_SPEC_MD, 'utf8');
  const statePath = join(root, '.cadence', 'state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8')) as Record<string, unknown>;
  state.loopPosition = 'SPEC';
  state.activeSpec = ID;
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
  muteProcessStderr();
  await specApproveService(root, { phase: PHASE, num: '01' }, captureIO().io);
}

interface CallSite {
  /** The call site as AC-3 names it. */
  site: string;
  selector: SelectorName;
  run(setting: Setting): Promise<void>;
}

const CALL_SITES: CallSite[] = [
  { site: 'services/settle.ts deep-verify', selector: 'selectVerifier', run: runSettle },
  { site: 'services/settle.ts code-review', selector: 'selectCodeReviewVerifier', run: runSettle },
  { site: 'services/settle.ts security-audit', selector: 'selectSecurityAuditVerifier', run: runSettle },
  { site: 'gates/draft-context.ts plan-review', selector: 'selectPlanReviewVerifier', run: runDraftApprove },
  { site: 'gates/build-context.ts per-task-verify', selector: 'selectPerTaskVerifier', run: runBuildTask },
  { site: 'services/spec-approve-ports.ts spec-review', selector: 'selectSpecReviewVerifier', run: runSpecApprove },
  { site: 'services/spec-approve-ports.ts ui-spec-review', selector: 'selectUiSpecReviewVerifier', run: runSpecApprove },
];

/** The options the call site passed, after asserting it selected its verifier at least once. */
function optsFor(selector: SelectorName): VerifierSelectOptions[] {
  const calls = received[selector] ?? [];
  // A call site that never selected its verifier would prove nothing.
  expect(calls.length).toBeGreaterThanOrEqual(1);
  return calls.map((c) => {
    expect(c).toBeDefined();
    return c as VerifierSelectOptions;
  });
}

describe.each(CALL_SITES)('$site forwards verification.hostCliIsolation (344-01 AC-3)', ({ site, selector, run }) => {
  it.each(['off', 'on'] as const)(
    `344-01/AC-3: ${site} passes hostCliIsolation %j from the loaded config to ${selector}`,
    async (value) => {
      await run(value);
      for (const opts of optsFor(selector)) {
        expect(opts.hostCliIsolation).toBe(value);
        // The site is the one that passes `fallback`: it resolves against the repo, too.
        expect(opts.cwd).toBe(fx?.root);
      }
    },
  );

  it(`344-01/AC-3: ${site} passes no hostCliIsolation key to ${selector} when the config does not set it`, async () => {
    await run(undefined);
    for (const opts of optsFor(selector)) {
      expect('hostCliIsolation' in opts).toBe(false);
      expect(opts.cwd).toBe(fx?.root);
    }
  });
});
