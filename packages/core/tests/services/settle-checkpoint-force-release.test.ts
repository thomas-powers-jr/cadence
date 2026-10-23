import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { runGit } from '@thomas-powers-jr/cadence-testkit';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultConfig,
  emptyState,
  type CadenceConfig,
  type CadenceState,
  type GateProvenance,
  type Summary,
} from '@thomas-powers-jr/cadence-types';
import { settleService } from '../../src/services/settle.js';
import { draftNewService } from '../../src/services/draft-new.js';
import { draftApproveService } from '../../src/services/draft-approve.js';
import { buildTaskService } from '../../src/services/build-task.js';
import { SimpleStateBackend } from '../../src/state/simple.js';
import { deriveAssuranceRecord } from '../../src/gates/assurance-record.js';
import type { CommandIO } from '../../src/services/io.js';

/**
 * Phase 336 (336-01, T2): D-CE (`dec-20261022-002`) settle side. A checkpoint
 * Stop-gate ceiling force-release stamps a sticky `lastForcedAt` into
 * `.cadence/checkpoint/state.json`; a later `SessionStart` resets the store's
 * `state` to `idle` but never clears `lastForcedAt`. `settle run` reads that
 * file by path (best-effort) and, when `lastForcedAt` is at or after the
 * active draft's `openDrafts[].since`, records a `checkpoint-stop` /
 * `ceiling-release` / `error` entry in `gateBypasses` — which phase 283's D-S
 * cap turns into an `assurance.overall` ceiling of `mixed`.
 *
 * Three fixtures:
 *  - seeded: a BUILD-state repo whose cadence `openDrafts` carries a fixed
 *    `since`, so the before/after/equal comparisons are deterministic;
 *  - real flow: the genuine draft new → draft approve → build task services
 *    stamp `since` themselves, bracketed by `before`/`after` wall-clock
 *    captures (no flake: `since` necessarily lies between them);
 *  - live grade: strict profile with a code-review verifier whose factory is
 *    stubbed below (constructed, never called — no provider is contacted)
 *    over a real git diff, so the un-capped live settle grades `strong` and
 *    the cap is observable on the live `assurance.overall`.
 * All three use a real passing test command and a qualifying assertion-mode
 * coverage test for AC-1, so AC-1 lands at `executed` and no
 * `--allow-missing-coverage` / `--force` bypass is needed to finalize.
 */

const reviewCalls = vi.hoisted(() => ({ constructed: [] as string[] }));

// Mirrors settle.test.ts's phase-332 seam: the real factory constructs the
// configured verifier (construction alone makes no network call), and its
// `.verify` is swapped for a stub returning a clean, finding-free review, so
// the gate's provenance carries the real provider identity without any call.
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

// Deliberately free of the word 'checkpoint': the silent-path tests assert no
// stderr line mentions it, and settle may echo phase paths or titles.
const PHASE = '336-ckpt-fixture';
const DRAFT_ID = '336-01';
const SINCE = '2026-10-22T10:00:00.000Z';
const AFTER = '2026-10-22T10:01:00.000Z';
const BEFORE = '2026-10-22T09:59:00.000Z';
const FIXED_NOW = '2026-10-22T12:00:00.000Z';

const DRAFT = `---
phase: ${PHASE}
id: ${DRAFT_ID}
tier: standard
status: APPROVED
---

# ${DRAFT_ID} — force-release fixture

## Objective

Settle a draft while a checkpoint record sits on disk.

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

function captureIO(): { io: CommandIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
}

function git(cwd: string, args: string[]): void {
  runGit(cwd, args);
}

type CheckpointSeed =
  | { kind: 'none' }
  | { kind: 'raw'; text: string }
  | { kind: 'json'; value: unknown };

interface SetupOpts {
  checkpoint: CheckpointSeed;
  /** Defaults to `[{ id: DRAFT_ID, since: SINCE }]`. */
  openDrafts?: { id: string; since: string }[];
  /**
   * Strict profile + a (stubbed) real-provider code-review over a real,
   * uncommitted git diff — the shape whose un-capped live grade is `strong`.
   */
  liveStrong?: boolean;
}

function fixtureConfig(liveStrong: boolean): CadenceConfig {
  return {
    ...defaultConfig,
    ...(liveStrong
      ? { profile: 'strict' as const, codeReview: { provider: 'anthropic' as const } }
      : {}),
    gates: { sealed: [], evidenceFloor: 'unverified' },
    verification: {
      ...defaultConfig.verification,
      testCommand: 'node -e "process.exit(0)"',
    },
  };
}

/** A qualifying assertion-mode coverage test for AC-1 at the default testGlobs location. */
async function seedCoverageTest(root: string): Promise<void> {
  await mkdir(join(root, 'packages', 'core', 'tests'), { recursive: true });
  await writeFile(
    join(root, 'packages', 'core', 'tests', 'foo.test.ts'),
    "it('AC-1 coverage fixture', () => { expect(true).toBe(true); });\n",
    'utf8',
  );
}

async function seedCheckpoint(root: string, seed: CheckpointSeed): Promise<void> {
  if (seed.kind === 'none') return;
  await mkdir(join(root, '.cadence', 'checkpoint'), { recursive: true });
  const text = seed.kind === 'raw' ? seed.text : JSON.stringify(seed.value, null, 2);
  await writeFile(join(root, '.cadence', 'checkpoint', 'state.json'), text, 'utf8');
}

async function setupRepo(parent: string, opts: SetupOpts): Promise<string> {
  const liveStrong = opts.liveStrong === true;
  const root = await realpath(await mkdtemp(join(parent, 'repo-')));
  const phaseDir = join(root, '.cadence', 'phases', PHASE);
  await mkdir(phaseDir, { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'foo.ts'), 'export const x = 1;\n', 'utf8');
  await writeFile(
    join(root, '.cadence', 'config.json'),
    JSON.stringify(fixtureConfig(liveStrong), null, 2),
  );
  const state = {
    ...emptyState('settle-checkpoint-force-release'),
    loopPosition: 'BUILD' as const,
    activePhase: PHASE,
    activeDraft: DRAFT_ID,
    openDrafts: opts.openDrafts ?? [{ id: DRAFT_ID, since: SINCE }],
  };
  await writeFile(join(root, '.cadence', 'state.json'), JSON.stringify(state, null, 2));
  await writeFile(join(phaseDir, `${DRAFT_ID}-DRAFT.md`), DRAFT);
  await writeFile(
    join(phaseDir, `${DRAFT_ID}-PROGRESS.json`),
    JSON.stringify({ draftId: DRAFT_ID, tasks: { T1: { status: 'DONE' } } }, null, 2),
  );
  await seedCoverageTest(root);
  await seedCheckpoint(root, opts.checkpoint);

  if (liveStrong) {
    // The key only ever reaches the verifier's constructor; `.verify` is
    // stubbed above, so nothing is sent anywhere.
    await writeFile(join(root, '.env'), 'ANTHROPIC_API_KEY=from-dotenv-checkpoint-test\n');
    // A real git workdir with an uncommitted change to the reviewed file —
    // without it the review diff is empty and code-review tags itself
    // `providerSelection: 'empty-diff'`, which never counts as a real
    // verifier (phase 287), so `strong` would be unreachable.
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['config', 'commit.gpgsign', 'false']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'base']);
    await writeFile(join(root, 'src', 'foo.ts'), 'export const x = 2;\n', 'utf8');
  }
  return root;
}

/** A store already reset to `idle` by SessionStart, carrying a sticky `lastForcedAt`. */
function idleStore(lastForcedAt: unknown): CheckpointSeed {
  return {
    kind: 'json',
    value: { state: 'idle', since: '2026-10-22T11:00:00.000Z', lastForcedAt },
  };
}

interface SettleRun {
  exitCode: number;
  summary: Summary;
  /** What settle wrote through its `io.err` seam. */
  stderr: string;
  /**
   * What reached the real `process.stderr` during the settle (the default
   * anomaly notifier writes there, not through `io.err`). Captured by a
   * pass-through spy, so output still appears as before.
   */
  processStderr: string;
}

async function settleIn(root: string): Promise<SettleRun> {
  const { io, err } = captureIO();
  const processChunks: string[] = [];
  const realWrite = process.stderr.write.bind(process.stderr);
  const spy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array, ...rest: unknown[]) => {
      processChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return (realWrite as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
    });
  let res;
  try {
    res = await settleService(root, { auto: true, now: () => FIXED_NOW }, io);
  } finally {
    spy.mockRestore();
  }
  const summary = JSON.parse(
    await readFile(join(root, '.cadence', 'phases', PHASE, `${DRAFT_ID}-SUMMARY.json`), 'utf8'),
  ) as Summary;
  return {
    exitCode: res.exitCode,
    summary,
    stderr: err.join(''),
    processStderr: processChunks.join(''),
  };
}

/** Every line, on either captured stderr stream, that mentions `checkpoint`. */
function checkpointLines(run: SettleRun): string[] {
  return [...run.stderr.split('\n'), ...run.processStderr.split('\n')].filter((l) =>
    l.includes('checkpoint'),
  );
}

async function readCadenceState(root: string): Promise<CadenceState> {
  return new SimpleStateBackend(root).readState();
}

interface RealFlowRepo {
  root: string;
  before: string;
  after: string;
  sinceAfterNew: string | undefined;
  sinceAfterApprove: string | undefined;
}

/**
 * Drives the genuine services: draft new → draft approve → build task (T1
 * DONE). `before` is captured (minus a minute) before draft new runs and
 * `after` once approve returns, so the draft's real `openDrafts[].since`
 * necessarily lies between them.
 */
async function setupRealFlowRepo(parent: string): Promise<RealFlowRepo> {
  const root = await realpath(await mkdtemp(join(parent, 'flow-')));
  await mkdir(join(root, '.cadence', 'phases'), { recursive: true });
  await writeFile(
    join(root, '.cadence', 'config.json'),
    JSON.stringify(fixtureConfig(false), null, 2),
  );
  await new SimpleStateBackend(root).commit(emptyState('settle-checkpoint-real-flow'));

  const before = new Date(Date.now() - 60_000).toISOString();
  const created = captureIO();
  const newRes = await draftNewService(
    root,
    { phase: PHASE, num: '1', title: 'force-release fixture', tier: 'standard' },
    created.io,
  );
  expect(newRes.exitCode, created.err.join('')).toBe(0);
  const sinceAfterNew = (await readCadenceState(root)).openDrafts.find(
    (d) => d.id === DRAFT_ID,
  )?.since;

  await writeFile(join(root, '.cadence', 'phases', PHASE, `${DRAFT_ID}-DRAFT.md`), DRAFT);
  const approved = captureIO();
  const approveRes = await draftApproveService(root, { phase: PHASE, num: '1' }, approved.io);
  expect(approveRes.exitCode, approved.err.join('')).toBe(0);
  const after = new Date().toISOString();
  const sinceAfterApprove = (await readCadenceState(root)).openDrafts.find(
    (d) => d.id === DRAFT_ID,
  )?.since;

  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'foo.ts'), 'export const x = 1;\n', 'utf8');
  await seedCoverageTest(root);
  const built = captureIO();
  const buildRes = await buildTaskService(root, { taskId: 'T1', status: 'DONE' }, built.io);
  expect(buildRes.exitCode, built.err.join('')).toBe(0);

  return { root, before, after, sinceAfterNew, sinceAfterApprove };
}

function expectSinceStampedByDraftNew(flow: RealFlowRepo): void {
  // The regression D-CE depends on: approve must keep draft new's `since`
  // rather than re-stamping it, and that stamp lies inside [before, after].
  expect(flow.sinceAfterNew).toBeDefined();
  expect(flow.sinceAfterApprove).toBe(flow.sinceAfterNew);
  const sinceMs = Date.parse(flow.sinceAfterNew ?? '');
  expect(sinceMs).toBeGreaterThanOrEqual(Date.parse(flow.before));
  expect(sinceMs).toBeLessThanOrEqual(Date.parse(flow.after));
}

describe('settle run records a checkpoint ceiling force-release (phase 336, D-CE)', () => {
  let parent: string;
  let origKey: string | undefined;
  let control: SettleRun;

  beforeAll(async () => {
    origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    parent = await realpath(await mkdtemp(join(tmpdir(), 'cadence-settle-ckpt-')));
    control = await settleIn(await setupRepo(parent, { checkpoint: { kind: 'none' } }));
  });

  afterAll(async () => {
    if (origKey !== undefined) process.env.ANTHROPIC_API_KEY = origKey;
    await rm(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
      () => {},
    );
  });

  it('336-01/AC-16: with no checkpoint file the settle succeeds, AC-1 is executed, and no checkpoint-stop entry exists (the control run)', () => {
    expect(control.exitCode).toBe(0);
    expect(control.summary.acResults.find((r) => r.id === 'AC-1')?.evidence).toBe('executed');
    expect((control.summary.gateBypasses ?? []).some((b) => b.gate === 'checkpoint-stop')).toBe(
      false,
    );
    expect(control.stderr).not.toContain('checkpoint-stop');
    expect(checkpointLines(control)).toEqual([]);
  });

  it("336-01/AC-15: a lastForcedAt after the draft's openDrafts since, in a store already reset to idle, records exactly one checkpoint-stop/ceiling-release/error bypass and caps assurance at mixed", async () => {
    const root = await setupRepo(parent, { checkpoint: idleStore(AFTER) });
    const run = await settleIn(root);

    expect(run.exitCode).toBe(0);
    const bypasses = run.summary.gateBypasses ?? [];
    const entries = bypasses.filter((b) => b.gate === 'checkpoint-stop');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      gate: 'checkpoint-stop',
      flag: 'ceiling-release',
      severity: 'error',
    });
    expect(entries[0]?.reason).toContain(AFTER);
    expect(run.summary.assurance?.overall).toBe('mixed');
    expect(run.stderr).toContain('settle bypass [error] checkpoint-stop');
    // Proves the process.stderr capture behind `checkpointLines` is live (the
    // default anomaly notifier writes there), so the silent-path assertions
    // below are not vacuous.
    expect(run.processStderr).toContain('checkpoint-force-released');

    // The checkpoint entry is the ONLY error-severity bypass in this settle,
    // so it alone is what can cap the grade.
    expect(bypasses.filter((b) => b.severity === 'error' && b.gate !== 'checkpoint-stop')).toEqual(
      [],
    );

    // This mock-only fixture's un-capped grade is already 'mixed' (AC-1 is
    // `executed`, no real verifier), so the live-grade describe block below
    // carries the discriminating live proof. Here, re-derive over the
    // persisted gates/acResults with one synthetic real-provider gate (pure
    // function, no provider is called): capped 'mixed' with the recorded
    // bypasses, 'strong' with the checkpoint-stop entry filtered out.
    const withReal: GateProvenance[] = [
      ...(run.summary.gates ?? []),
      { gate: 'code-review', status: 'ran', provider: 'anthropic' },
    ];
    const capped = deriveAssuranceRecord(withReal, run.summary.acResults, {
      gateBypasses: bypasses,
    });
    expect(capped.overall).toBe('mixed');
    const uncapped = deriveAssuranceRecord(withReal, run.summary.acResults, {
      gateBypasses: bypasses.filter((b) => b.gate !== 'checkpoint-stop'),
    });
    expect(uncapped.overall).toBe('strong');
  });

  it("336-01/AC-15: a lastForcedAt exactly equal to the draft's openDrafts since counts as at-or-after and records the bypass", async () => {
    const root = await setupRepo(parent, { checkpoint: idleStore(SINCE) });
    const run = await settleIn(root);
    expect(run.exitCode).toBe(0);
    const entries = (run.summary.gateBypasses ?? []).filter((b) => b.gate === 'checkpoint-stop');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ flag: 'ceiling-release', severity: 'error' });
  });

  it('336-01/AC-15: the comparison is by parsed time, not string order (an offset timestamp that is later in time but sorts earlier as a string still records)', async () => {
    // 2026-10-22T09:00:30-01:00 is 10:00:30Z — 30s after SINCE (10:00:00Z) —
    // but as a string it sorts before '2026-10-22T10:00:00.000Z'.
    const root = await setupRepo(parent, { checkpoint: idleStore('2026-10-22T09:00:30.000-01:00') });
    const run = await settleIn(root);
    expect(run.exitCode).toBe(0);
    expect((run.summary.gateBypasses ?? []).filter((b) => b.gate === 'checkpoint-stop')).toHaveLength(
      1,
    );
  });

  /** The one loud notice settle prints when a valid record cannot be compared. */
  const uncomparableNotice = (ts: string): string =>
    `settle: checkpoint force-release record (lastForcedAt ${ts}) found but the active draft has no open-time to compare it against; not recorded as a bypass`;

  it("336-01/AC-15: fail-open edge of the window — a later lastForcedAt with no openDrafts entry for the active draft has no since to compare against, so no fact is recorded and exactly one stderr notice names the record", async () => {
    const root = await setupRepo(parent, { checkpoint: idleStore(AFTER), openDrafts: [] });
    const run = await settleIn(root);
    expect(run.exitCode).toBe(0);
    const bypasses = run.summary.gateBypasses ?? [];
    expect(bypasses.some((b) => b.gate === 'checkpoint-stop')).toBe(false);
    expect(bypasses).toEqual(control.summary.gateBypasses ?? []);
    expect(run.summary.assurance).toEqual(control.summary.assurance);
    const checkpointLines = run.stderr.split('\n').filter((l) => l.includes('checkpoint'));
    expect(checkpointLines).toEqual([uncomparableNotice(AFTER)]);
  });

  it("336-01/AC-15: fail-open edge of the window — an unparseable openDrafts since for the active draft records no fact and prints the same single stderr notice", async () => {
    const root = await setupRepo(parent, {
      checkpoint: idleStore(AFTER),
      openDrafts: [{ id: DRAFT_ID, since: 'not a timestamp' }],
    });
    const run = await settleIn(root);
    expect(run.exitCode).toBe(0);
    const bypasses = run.summary.gateBypasses ?? [];
    expect(bypasses.some((b) => b.gate === 'checkpoint-stop')).toBe(false);
    expect(bypasses).toEqual(control.summary.gateBypasses ?? []);
    expect(run.summary.assurance).toEqual(control.summary.assurance);
    const checkpointLines = run.stderr.split('\n').filter((l) => l.includes('checkpoint'));
    expect(checkpointLines).toEqual([uncomparableNotice(AFTER)]);
  });

  const noEffectCases: { name: string; opts: SetupOpts }[] = [
    {
      name: "a lastForcedAt earlier than the draft's openDrafts since",
      opts: { checkpoint: idleStore(BEFORE) },
    },
    {
      name: 'a checkpoint state.json that is not valid JSON',
      opts: { checkpoint: { kind: 'raw', text: '{ this is not valid json' } },
    },
    {
      name: 'a lastForcedAt that is not a string',
      opts: { checkpoint: idleStore(1761127260000) },
    },
    {
      name: 'a lastForcedAt that is not an ISO timestamp',
      opts: { checkpoint: idleStore('yesterday afternoon') },
    },
    {
      name: 'a checkpoint record with no lastForcedAt at all',
      opts: { checkpoint: { kind: 'json', value: { state: 'idle', since: SINCE } } },
    },
    {
      name: 'a JSON array instead of an object',
      opts: { checkpoint: { kind: 'raw', text: '[1, 2, 3]' } },
    },
  ];

  for (const c of noEffectCases) {
    it(`336-01/AC-16: ${c.name} records no checkpoint-stop bypass and settles exactly as with no file`, async () => {
      const root = await setupRepo(parent, c.opts);
      const run = await settleIn(root);
      expect(run.exitCode).toBe(control.exitCode);
      expect(run.exitCode).toBe(0);
      const bypasses = run.summary.gateBypasses ?? [];
      expect(bypasses.some((b) => b.gate === 'checkpoint-stop')).toBe(false);
      expect(bypasses).toEqual(control.summary.gateBypasses ?? []);
      expect(run.summary.assurance).toEqual(control.summary.assurance);
      expect(run.summary.acResults).toEqual(control.summary.acResults);
      expect(run.stderr).not.toContain('checkpoint-stop');
      expect(run.stderr).not.toContain('checkpoint-force-released');
      expect(checkpointLines(run)).toEqual([]);
    });
  }

  describe('real flow: draft new → draft approve → build task → settle', () => {
    it('336-01/AC-15: a lastForcedAt stamped after approve returns records exactly one checkpoint-stop/ceiling-release/error bypass, and openDrafts keeps the since draft new stamped', async () => {
      const flow = await setupRealFlowRepo(parent);
      expectSinceStampedByDraftNew(flow);
      await seedCheckpoint(flow.root, idleStore(flow.after));

      const run = await settleIn(flow.root);
      expect(run.exitCode, run.stderr).toBe(0);
      const entries = (run.summary.gateBypasses ?? []).filter((b) => b.gate === 'checkpoint-stop');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        gate: 'checkpoint-stop',
        flag: 'ceiling-release',
        severity: 'error',
      });
      expect(entries[0]?.reason).toContain(flow.after);
    });

    it('336-01/AC-16: a lastForcedAt from before draft new ran records no checkpoint-stop bypass, and openDrafts keeps the since draft new stamped', async () => {
      const flow = await setupRealFlowRepo(parent);
      expectSinceStampedByDraftNew(flow);
      await seedCheckpoint(flow.root, idleStore(flow.before));

      const run = await settleIn(flow.root);
      expect(run.exitCode, run.stderr).toBe(0);
      expect((run.summary.gateBypasses ?? []).some((b) => b.gate === 'checkpoint-stop')).toBe(
        false,
      );
      expect(run.stderr).not.toContain('checkpoint-stop');
      expect(checkpointLines(run)).toEqual([]);
    });
  });

  describe('live grade: strict profile, stubbed real-provider code-review over a real diff', () => {
    it("336-01/AC-16: with no checkpoint file the live settle grades strong — the un-capped baseline the cap is measured against", async () => {
      reviewCalls.constructed.length = 0;
      const root = await setupRepo(parent, { checkpoint: { kind: 'none' }, liveStrong: true });
      const run = await settleIn(root);
      expect(run.exitCode, run.stderr).toBe(0);
      expect(reviewCalls.constructed).toEqual(['anthropic']);
      const review = run.summary.gates?.find((g) => g.gate === 'code-review');
      expect(review).toMatchObject({ status: 'ran', provider: 'anthropic' });
      expect(review?.providerSelection).not.toBe('empty-diff');
      expect(run.summary.acResults.find((r) => r.id === 'AC-1')?.evidence).toBe('executed');
      expect((run.summary.gateBypasses ?? []).some((b) => b.gate === 'checkpoint-stop')).toBe(
        false,
      );
      expect(run.summary.assurance?.overall).toBe('strong');
      expect(checkpointLines(run)).toEqual([]);
    });

    it("336-01/AC-15: the same live settle with a forced record after since grades mixed, and the checkpoint-stop entry is its only error-severity bypass", async () => {
      reviewCalls.constructed.length = 0;
      const root = await setupRepo(parent, { checkpoint: idleStore(AFTER), liveStrong: true });
      const run = await settleIn(root);
      expect(run.exitCode, run.stderr).toBe(0);
      expect(reviewCalls.constructed).toEqual(['anthropic']);
      expect(run.summary.gates?.find((g) => g.gate === 'code-review')).toMatchObject({
        status: 'ran',
        provider: 'anthropic',
      });
      const bypasses = run.summary.gateBypasses ?? [];
      expect(bypasses.filter((b) => b.gate === 'checkpoint-stop')).toEqual([
        expect.objectContaining({ flag: 'ceiling-release', severity: 'error' }),
      ]);
      expect(bypasses.filter((b) => b.severity === 'error' && b.gate !== 'checkpoint-stop')).toEqual(
        [],
      );
      expect(run.summary.assurance?.overall).toBe('mixed');
    });
  });
});
