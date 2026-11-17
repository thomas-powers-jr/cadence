import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { runCoverageGate } from '../../src/gates/coverage.js';
import { runSettleGates, GATE_REGISTRY } from '../../src/gates/registry.js';
import type { GateEntry, SettleGate } from '../../src/gates/registry.js';
import type { GateResult, SettleContext } from '../../src/gates/types.js';
import { collectAnomalies } from '../../src/notify/collect.js';
import { settleService } from '../../src/services/settle.js';
import type { CommandIO } from '../../src/services/io.js';
import type { VerifyTestRef } from '../../src/verify/verifier.js';

/**
 * Phase 346 (346-01, T5): in assertion mode, an unsealed pass over real
 * coverage gaps through bare --force (no --allow-missing-coverage) is a
 * coverage bypass, recorded under the flag that actually fired: the gate sets
 * `coverageBypassed`, gates[] records `bypassed via --force`, the
 * coverage-bypassed anomaly names --force, and SUMMARY.gateBypasses carries a
 * warn-severity test-coverage entry with flag --force. --allow-missing-coverage
 * is unchanged and stays the named flag whenever it is set; no gaps, sealed,
 * mention mode and the malformed-id phase-qualified path are unchanged.
 */

// ---------------------------------------------------------------------------
// Gate unit cases
// ---------------------------------------------------------------------------

const assertionConfig = { verification: { coverageMode: 'assertion' } } as never;
const sealedAssertionConfig = {
  verification: { coverageMode: 'assertion' },
  gates: { sealed: ['test-coverage'] },
} as never;

function gateCtx(over: {
  opts?: Record<string, unknown>;
  config?: unknown;
  coverageMap?: Map<string, VerifyTestRef[]>;
  errs?: string[];
  activeDraft?: string;
  onScan?: () => void;
}): SettleContext {
  const errs = over.errs ?? [];
  return {
    cwd: '/x',
    state: { activeDraft: over.activeDraft } as never,
    draft: {
      acceptanceCriteria: [{ id: 'AC-1', given: '', when: '', then: '' }],
      tasks: [],
    } as never,
    progress: { draftId: 'd', tasks: {} },
    config: over.config ?? null,
    gateSet: { gates: ['test-coverage'], softCap: false },
    opts: over.opts ?? {},
    explicitIds: new Set<string>(),
    touchedFiles: [],
    coverage: async () => {
      over.onScan?.();
      return over.coverageMap ?? new Map<string, VerifyTestRef[]>();
    },
    verifiers: { deep: { verify: async () => ({ verdicts: {}, provider: 'mock' }) } },
    emit: { anomalies: async () => {} },
    io: { err: (s: string) => errs.push(s) },
  } as unknown as SettleContext;
}

const covered = (): Map<string, VerifyTestRef[]> =>
  new Map([['AC-1', [{ file: 'a.test.ts', line: 5, snippet: "it('AC-1', ...)", qualifying: true }]]]);

describe('runCoverageGate · bare --force over real gaps (phase 346, T5)', () => {
  it('346-01/AC-4: assertion mode, unsealed, a real gap under bare --force passes AND sets coverageBypassed', async () => {
    const res = await runCoverageGate(
      gateCtx({ opts: { force: true }, config: assertionConfig, coverageMap: new Map() }),
    );
    expect(res.outcome).toBe('pass');
    expect(res.flags?.coverageBypassed).toBe(true);
  });

  it('346-01/AC-4: a weak link under bare --force in assertion mode is a real gap and is marked bypassed', async () => {
    const map = new Map<string, VerifyTestRef[]>([
      ['AC-1', [{ file: 'a.test.ts', line: 3, snippet: '// AC-1', qualifying: false }]],
    ]);
    const res = await runCoverageGate(
      gateCtx({ opts: { force: true }, config: assertionConfig, coverageMap: map }),
    );
    expect(res.outcome).toBe('pass');
    expect(res.flags?.coverageBypassed).toBe(true);
  });

  it('346-01/AC-4: a skipped-only link under bare --force in assertion mode is a real gap and is marked bypassed', async () => {
    const map = new Map<string, VerifyTestRef[]>([
      ['AC-1', [{ file: 'a.test.ts', line: 3, snippet: "it.skip('AC-1', ...)", qualifying: false, skipped: true }]],
    ]);
    const res = await runCoverageGate(
      gateCtx({ opts: { force: true }, config: assertionConfig, coverageMap: map }),
    );
    expect(res.outcome).toBe('pass');
    expect(res.flags?.coverageBypassed).toBe(true);
    // Without --force the same map refuses, so the bypass above is real.
    const refused = await runCoverageGate(gateCtx({ opts: {}, config: assertionConfig, coverageMap: map }));
    expect(refused.outcome).toBe('refuse');
  });

  it('346-01/AC-4: no gaps under bare --force records no bypass', async () => {
    const errs: string[] = [];
    const res = await runCoverageGate(
      gateCtx({ errs, opts: { force: true }, config: assertionConfig, coverageMap: covered() }),
    );
    expect(res.outcome).toBe('pass');
    expect(res.flags?.coverageBypassed).toBe(false);
    expect(errs).toEqual([]);
  });

  it('346-01/AC-4: --allow-missing-coverage still short-circuits before any scan, gaps or not', async () => {
    let scanned = false;
    const res = await runCoverageGate(
      gateCtx({
        opts: { allowMissingCoverage: true },
        config: assertionConfig,
        coverageMap: covered(),
        onScan: () => {
          scanned = true;
        },
      }),
    );
    expect(res.outcome).toBe('pass');
    expect(res.flags?.coverageBypassed).toBe(true);
    expect(scanned).toBe(false);
  });

  it('346-01/AC-4: both flags set behave exactly like --allow-missing-coverage (early return, bypassed)', async () => {
    let scanned = false;
    const res = await runCoverageGate(
      gateCtx({
        opts: { force: true, allowMissingCoverage: true },
        config: assertionConfig,
        coverageMap: new Map(),
        onScan: () => {
          scanned = true;
        },
      }),
    );
    expect(res).toEqual({ outcome: 'pass', flags: { coverageBypassed: true } });
    expect(scanned).toBe(false);
  });

  it('346-01/AC-4: sealed + bare --force over a real gap still refuses and never marks a bypass', async () => {
    const errs: string[] = [];
    const res = await runCoverageGate(
      gateCtx({ errs, opts: { force: true }, config: sealedAssertionConfig, coverageMap: new Map() }),
    );
    expect(res.outcome).toBe('refuse');
    expect(res.flags?.coverageBypassed).toBe(false);
    expect(errs.join('')).toContain('This gate is sealed (gates.sealed)');
  });

  it('346-01/AC-4: mention mode under bare --force over a real gap is unchanged (pass, not bypassed)', async () => {
    const errs: string[] = [];
    const res = await runCoverageGate(
      gateCtx({ errs, opts: { force: true }, coverageMap: new Map() }),
    );
    expect(res).toEqual({ outcome: 'pass', flags: { coverageBypassed: false } });
    expect(errs).toEqual([]);
  });

  it('346-01/AC-4: the malformed-id phase-qualified --force path is unchanged (pass, not bypassed)', async () => {
    const errs: string[] = [];
    const res = await runCoverageGate(
      gateCtx({
        errs,
        opts: { force: true },
        config: { verification: { coverageMode: 'assertion', coverageScheme: 'phase-qualified' } },
        activeDraft: '',
      }),
    );
    expect(res).toEqual({ outcome: 'pass', flags: { coverageBypassed: false } });
    expect(errs.join('')).toContain('phase-qualified');
  });
});

// ---------------------------------------------------------------------------
// Registry skipReason
// ---------------------------------------------------------------------------

function stubRegistry(verdict: GateResult): Record<SettleGate, GateEntry> {
  const out = {} as Record<SettleGate, GateEntry>;
  for (const gate of Object.keys(GATE_REGISTRY) as SettleGate[]) {
    out[gate] = {
      impl: async () => (gate === 'test-coverage' ? verdict : { outcome: 'pass' }),
      selfGuarded: GATE_REGISTRY[gate].selfGuarded ?? false,
    };
  }
  return out;
}

async function coverageSkipReason(opts: Record<string, unknown>): Promise<string | undefined> {
  const ctx = { gateSet: { gates: ['test-coverage'] }, opts } as unknown as SettleContext;
  const { gates } = await runSettleGates(ctx, {
    registry: stubRegistry({ outcome: 'pass', flags: { coverageBypassed: true } }),
    order: ['test-coverage'],
  });
  return gates.find((g) => g.gate === 'test-coverage')?.skipReason;
}

describe('registry names the coverage flag that fired (phase 346, T5)', () => {
  it('346-01/AC-4: bare --force names --force', async () => {
    expect(await coverageSkipReason({ force: true })).toBe('bypassed via --force');
  });

  it('346-01/AC-4: --allow-missing-coverage names --allow-missing-coverage', async () => {
    expect(await coverageSkipReason({ allowMissingCoverage: true })).toBe(
      'bypassed via --allow-missing-coverage',
    );
  });

  it('346-01/AC-4: both flags name --allow-missing-coverage (it wins over --force)', async () => {
    expect(await coverageSkipReason({ force: true, allowMissingCoverage: true })).toBe(
      'bypassed via --allow-missing-coverage',
    );
  });
});

// ---------------------------------------------------------------------------
// collectAnomalies
// ---------------------------------------------------------------------------

function collectCtx(extra: { coverageBypassed: boolean; coverageBypassFlag?: '--force' | '--allow-missing-coverage' }) {
  return {
    draft: { acceptanceCriteria: [], tasks: [] } as unknown as Draft,
    progress: { draftId: 'd', tasks: {} },
    force: false,
    ...extra,
  };
}

describe('collectAnomalies names the coverage flag that fired (phase 346, T5)', () => {
  it('346-01/AC-4: coverageBypassFlag --force names --force in the message and context, severity warn', () => {
    const events = collectAnomalies(collectCtx({ coverageBypassed: true, coverageBypassFlag: '--force' }));
    const cov = events.filter((e) => e.type === 'coverage-bypassed');
    expect(cov).toHaveLength(1);
    expect(cov[0]!.message).toBe('test-coverage gate bypassed via --force');
    expect(cov[0]!.severity).toBe('warn');
    expect(cov[0]!.context).toEqual({ flag: '--force' });
  });

  it('346-01/AC-4: without coverageBypassFlag the event is exactly today\'s --allow-missing-coverage one', () => {
    const events = collectAnomalies(collectCtx({ coverageBypassed: true }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'coverage-bypassed',
      severity: 'warn',
      message: 'test-coverage gate bypassed via --allow-missing-coverage',
      context: {},
    });
  });
});

// ---------------------------------------------------------------------------
// End-to-end settle
// ---------------------------------------------------------------------------

const PHASE = '346-cov-fixture';
const DRAFT_ID = '346-01';
const SINCE = '2026-11-12T10:00:00.000Z';
const FIXED_NOW = '2026-11-12T12:00:00.000Z';

const DRAFT = `---
phase: ${PHASE}
id: ${DRAFT_ID}
tier: standard
status: APPROVED
---

# ${DRAFT_ID} — coverage force-bypass fixture

## Objective

Settle a draft whose only AC may have no asserting test.

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

interface SetupOpts {
  mode: 'assertion' | 'mention';
  covered: boolean;
}

function fixtureConfig(root: string, opts: SetupOpts): CadenceConfig {
  return {
    ...defaultConfig,
    gates: { sealed: [], evidenceFloor: 'unverified' },
    notify: { transport: 'file', file: join(root, '.cadence', 'anomalies.log') },
    verification: { ...defaultConfig.verification, coverageMode: opts.mode },
  };
}

async function setupRepo(parent: string, opts: SetupOpts): Promise<string> {
  const root = await realpath(await mkdtemp(join(parent, 'repo-')));
  const phaseDir = join(root, '.cadence', 'phases', PHASE);
  await mkdir(phaseDir, { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'foo.ts'), 'export const x = 1;\n', 'utf8');
  await writeFile(
    join(root, '.cadence', 'config.json'),
    JSON.stringify(fixtureConfig(root, opts), null, 2),
  );
  const state = {
    ...emptyState('settle-coverage-force-bypass'),
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
    opts.covered
      ? "it('AC-1 coverage fixture', () => { expect(true).toBe(true); });\n"
      : "it('unrelated fixture', () => { expect(true).toBe(true); });\n",
    'utf8',
  );
  return root;
}

interface SettleRun {
  exitCode: number;
  summary: Summary;
  stderr: string;
  anomalies: AnomalyEvent[];
}

function captureIO(): { io: CommandIO; err: string[] } {
  const err: string[] = [];
  return { io: { out: () => {}, err: (s) => err.push(s) }, err };
}

async function settleIn(
  root: string,
  flags: { force?: boolean; allowMissingCoverage?: boolean },
): Promise<SettleRun> {
  const { io, err } = captureIO();
  const res = await settleService(root, { auto: true, now: () => FIXED_NOW, ...flags }, io);
  const base = join(root, '.cadence', 'phases', PHASE, `${DRAFT_ID}-SUMMARY`);
  const summary = JSON.parse(await readFile(`${base}.json`, 'utf8')) as Summary;
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
  return { exitCode: res.exitCode, summary, stderr: err.join(''), anomalies };
}

const coverageEntries = (s: Summary) =>
  (s.gateBypasses ?? []).filter((b) => b.gate === 'test-coverage');
const coverageGate = (s: Summary): GateProvenance | undefined =>
  (s.gates ?? []).find((g) => g.gate === 'test-coverage');
const coverageAnomalies = (r: SettleRun) => r.anomalies.filter((a) => a.type === 'coverage-bypassed');

describe('settle records a bare --force coverage bypass with the flag that fired (phase 346, T5)', () => {
  let parent: string;
  let forceGaps: SettleRun;
  let allowGaps: SettleRun;
  let bothGaps: SettleRun;
  let forceNoGaps: SettleRun;
  let mentionForceGaps: SettleRun;

  beforeAll(async () => {
    parent = await realpath(await mkdtemp(join(tmpdir(), 'cadence-settle-cov-force-')));
    forceGaps = await settleIn(await setupRepo(parent, { mode: 'assertion', covered: false }), {
      force: true,
    });
    allowGaps = await settleIn(await setupRepo(parent, { mode: 'assertion', covered: false }), {
      allowMissingCoverage: true,
    });
    bothGaps = await settleIn(await setupRepo(parent, { mode: 'assertion', covered: false }), {
      force: true,
      allowMissingCoverage: true,
    });
    forceNoGaps = await settleIn(await setupRepo(parent, { mode: 'assertion', covered: true }), {
      force: true,
    });
    mentionForceGaps = await settleIn(
      await setupRepo(parent, { mode: 'mention', covered: false }),
      { force: true },
    );
  });

  afterAll(async () => {
    await rm(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
      () => {},
    );
  });

  it('346-01/AC-4: bare --force over real gaps records a warn test-coverage gateBypasses entry with flag --force, a --force skip reason and a --force anomaly', () => {
    const run = forceGaps;
    expect(run.exitCode, run.stderr).toBe(0);
    const entries = coverageEntries(run.summary);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      gate: 'test-coverage',
      flag: '--force',
      severity: 'warn',
      reason: 'test-coverage gate bypassed via --force',
    });
    expect(coverageGate(run.summary)).toMatchObject({
      status: 'skipped',
      skipReason: 'bypassed via --force',
    });
    expect(run.stderr).toContain(
      'settle bypass [warn] test-coverage: test-coverage gate bypassed via --force (--force)',
    );
    const anomalies = coverageAnomalies(run);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      severity: 'warn',
      message: 'test-coverage gate bypassed via --force',
    });
  });

  it('346-01/AC-4: --allow-missing-coverage over real gaps records the entry and skip reason exactly as today', () => {
    const run = allowGaps;
    expect(run.exitCode, run.stderr).toBe(0);
    const entries = coverageEntries(run.summary);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      gate: 'test-coverage',
      flag: '--allow-missing-coverage',
      severity: 'warn',
      reason: 'test-coverage gate bypassed via --allow-missing-coverage',
    });
    expect(coverageGate(run.summary)).toMatchObject({
      status: 'skipped',
      skipReason: 'bypassed via --allow-missing-coverage',
    });
  });

  it('346-01/AC-4: with both flags set, --allow-missing-coverage is the named flag', () => {
    const run = bothGaps;
    expect(run.exitCode, run.stderr).toBe(0);
    const entries = coverageEntries(run.summary);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ flag: '--allow-missing-coverage', severity: 'warn' });
    expect(coverageGate(run.summary)?.skipReason).toBe('bypassed via --allow-missing-coverage');
    for (const a of coverageAnomalies(run)) {
      expect(a.message).toBe('test-coverage gate bypassed via --allow-missing-coverage');
    }
  });

  it('346-01/AC-4: bare --force with no gaps records no coverage bypass and the gate ran', () => {
    const run = forceNoGaps;
    expect(run.exitCode, run.stderr).toBe(0);
    expect(coverageEntries(run.summary)).toEqual([]);
    expect(coverageGate(run.summary)).toMatchObject({ status: 'ran' });
    expect(coverageAnomalies(run)).toEqual([]);
  });

  it('346-01/AC-4: mention mode under bare --force over a real gap is unchanged (no coverage bypass recorded)', () => {
    const run = mentionForceGaps;
    expect(run.exitCode, run.stderr).toBe(0);
    expect(coverageEntries(run.summary)).toEqual([]);
    expect(coverageGate(run.summary)).toMatchObject({ status: 'ran' });
    expect(coverageAnomalies(run)).toEqual([]);
  });
});
