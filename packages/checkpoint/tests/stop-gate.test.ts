import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findUnfilledSections } from '@thomas-powers-jr/cadence-core';
// Test-only import by relative SOURCE path, exactly as drift-sections.test.ts
// does (see its comment block): renderSession is not part of core's public
// API, and these fixtures must come from core's REAL SESSION renderer, not
// hand-written markdown, so a renderer change reaches the gate's tests.
import { renderSession } from '../../core/src/handoff/render-session.js';
import type { SessionRenderInput } from '../../core/src/handoff/render-session.js';
import { decideStop, effectivePercentage } from '../src/stop-gate.js';
import type { StopFacts, StopMachine, StopOptions, StopPlan } from '../src/stop-gate.js';
import { checkpointStatePath, readMachineState, transitionStore, updateStoreExtras } from '../src/state.js';
import type { CheckpointState, TransitionResult } from '../src/state.js';
import type { CheckpointReading, ReadingCurrentUsage } from '../src/sensor.js';
import { validate } from '../src/validate.js';

// ---------------------------------------------------------------------------
// Fixtures: core's real renderer, input mirroring drift-sections.test.ts.
// ---------------------------------------------------------------------------

const PACKET: SessionRenderInput['packet'] = {
  schemaVersion: 1,
  scope: 'handoff',
  generatedAt: '2026-06-03T14:02:00.000Z',
  loop: { present: true, loopPosition: 'BUILD', activePhase: '46-handoff', activeDraft: null, tier: 'standard' },
  recommendations: [],
  assumptions: [],
  decisions: [],
  files: [],
  totals: { recommendations: 0, assumptions: 0, decisions: 0, files: 0, recommendationsOmitted: 0 },
};

const GIT: SessionRenderInput['git'] = {
  available: true,
  branch: 'main',
  dirty: true,
  ahead: 0,
  behind: 0,
  head: 'abc1234',
  recentCommits: 'abc1234 feat: x',
  diffStat: ' 1 file changed',
  fetched: true,
};

const INPUT: SessionRenderInput = {
  generatedAt: '2026-06-03T14:02:00.000Z',
  label: 'stop-gate',
  packet: PACKET,
  git: GIT,
  contextPacketPath: '.cadence/intelligence/context/handoff.json',
};

const RENDERED = renderSession(INPUT);

/** Core's own marker predicate (placeholders.ts): a line holding both `<!--` and `FILL IN`. */
function isMarkerLine(line: string): boolean {
  return line.includes('<!--') && line.includes('FILL IN');
}

/** Section title the way core's findUnfilledSections derives it. */
function sectionTitle(heading: string): string {
  return (heading.split('·')[0] ?? '').trim();
}

/**
 * Replaces every marker line with narrative, except in the sections named in
 * `keep`, whose markers are left in place. The narrative carries no `%`, no
 * `## ` and no fences, so it cannot trip any validator check.
 */
function fillMarkers(doc: string, keep: readonly string[] = []): string {
  let current = '(preamble)';
  return doc
    .split('\n')
    .map((line) => {
      const heading = /^## (.+)$/.exec(line);
      if (heading) {
        current = sectionTitle(heading[1] ?? '');
        return line;
      }
      if (!isMarkerLine(line) || keep.includes(current)) return line;
      return current === 'Open decisions' ? 'None.' : `- Narrative written for ${current}.`;
    })
    .join('\n');
}

/** The filled doc rewritten to schema v1: `cadence_handoff: 1` and no "Open decisions" section. */
function toVersionOne(doc: string): string {
  const out: string[] = [];
  let dropping = false;
  for (const line of doc.split('\n')) {
    if (line.startsWith('## ')) dropping = line === '## Open decisions';
    if (dropping) continue;
    out.push(line === 'cadence_handoff: 2' ? 'cadence_handoff: 1' : line);
  }
  return out.join('\n');
}

const FILLED = fillMarkers(RENDERED);
const UNFILLED_SECTIONS = ['What landed this session', 'Next action'] as const;
const TWO_UNFILLED = fillMarkers(RENDERED, UNFILLED_SECTIONS);
const VERSION_ONE = toVersionOne(FILLED);

// ---------------------------------------------------------------------------
// Facts builders (return values only; every assertion stays in an it()).
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-22T12:00:00.000Z');
const SINCE = '2026-10-22T11:00:00.000Z';
const OPTIONS: StopOptions = { threshold: 70, ceiling: 3, maxReadingAgeS: 600 };

function usage(overrides: Partial<ReadingCurrentUsage> = {}): ReadingCurrentUsage {
  return {
    input_tokens: 50_000,
    output_tokens: 7_000,
    cache_creation_input_tokens: 10_000,
    cache_read_input_tokens: 40_000,
    ...overrides,
  };
}

function reading(
  usedPercentage: number | null,
  currentUsage: ReadingCurrentUsage | null = null,
  opts: { ageS?: number; ts?: string; window?: number | null } = {},
): CheckpointReading {
  const ts = opts.ts ?? new Date(NOW.getTime() - (opts.ageS ?? 10) * 1000).toISOString();
  return {
    used_percentage: usedPercentage,
    unknown: !(typeof usedPercentage === 'number' && usedPercentage > 0),
    absolute: {
      total_input_tokens: null,
      total_output_tokens: null,
      context_window_size: opts.window === undefined ? 200_000 : opts.window,
      current_usage: currentUsage,
    },
    exceeds_200k_tokens: false,
    current_dir: null,
    project_dir: null,
    ts,
  };
}

function idle(): StopMachine {
  return { state: 'idle', since: null };
}

function armed(extras: { instructed?: boolean; blocks?: number } = {}): StopMachine {
  return { state: 'armed', since: SINCE, ...extras };
}

function facts(over: Partial<StopFacts> & Pick<StopFacts, 'machine'>): StopFacts {
  return { reading: null, handoffDoc: null, stopHookActive: false, now: NOW, ...over };
}

const NOTHING: StopPlan = { ops: [], stdout: null, stderr: null };

function isPlainAsciiLine(text: string): boolean {
  return /^[\x20-\x7E]+$/.test(text);
}

function reasonOf(plan: StopPlan): string {
  return plan.stdout !== null && 'reason' in plan.stdout ? plan.stdout.reason : '';
}

function stdoutKind(plan: StopPlan): 'block' | 'release' | 'none' {
  if (plan.stdout === null) return 'none';
  return 'decision' in plan.stdout ? 'block' : 'release';
}

// ---------------------------------------------------------------------------
// Real-store harness: executes a plan's ops 1:1 against transitionStore /
// updateStoreExtras, as the T5 shell will, so a plan the store would refuse
// cannot pass here.
// ---------------------------------------------------------------------------

let projectDir: string;
let stderrChunks: string[];
let clock: number;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'checkpoint-stop-gate-'));
  mkdirSync(join(projectDir, '.cadence'));
  stderrChunks = [];
  clock = NOW.getTime();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

const sink = {
  write(chunk: string): boolean {
    stderrChunks.push(chunk);
    return true;
  },
};

function tick(): Date {
  clock += 1000;
  return new Date(clock);
}

function seedStore(record: Record<string, unknown>): void {
  mkdirSync(join(projectDir, '.cadence', 'checkpoint'), { recursive: true });
  writeFileSync(checkpointStatePath(projectDir), `${JSON.stringify(record, null, 2)}\n`);
}

function machineFromStore(): StopMachine {
  const read = readMachineState(projectDir);
  if (!read.ok) throw new Error(read.reason);
  return {
    state: read.state,
    since: read.since,
    ...(read.instructed !== undefined ? { instructed: read.instructed } : {}),
    ...(read.blocks !== undefined ? { blocks: read.blocks } : {}),
  };
}

async function applyPlan(plan: StopPlan): Promise<TransitionResult[]> {
  const results: TransitionResult[] = [];
  for (const op of plan.ops) {
    if (op.kind === 'transition') {
      results.push(
        await transitionStore(projectDir, op.to, {
          stderr: sink,
          now: tick,
          ...(op.ctx !== undefined ? { ctx: op.ctx } : {}),
          ...(op.extras !== undefined ? { extras: op.extras } : {}),
        }),
      );
    } else {
      results.push(
        await updateStoreExtras(projectDir, op.patch, {
          stderr: sink,
          expectedState: op.expectedState,
          ...(op.expectedSince !== undefined ? { expectedSince: op.expectedSince } : {}),
        }),
      );
    }
  }
  return results;
}

/** One Stop against the real store: read, decide, apply. */
async function stopOnce(
  over: Omit<Partial<StopFacts>, 'machine'>,
  options: StopOptions = OPTIONS,
): Promise<{ plan: StopPlan; results: TransitionResult[] }> {
  const plan = decideStop(facts({ machine: machineFromStore(), ...over }), options);
  const results = await applyPlan(plan);
  return { plan, results };
}

function allOk(results: readonly TransitionResult[]): boolean {
  return results.every((r) => r.ok);
}

function storeState(): CheckpointState | 'refused' {
  const read = readMachineState(projectDir);
  return read.ok ? read.state : 'refused';
}

const HIGH = reading(85);

// ---------------------------------------------------------------------------

// Fixture preconditions, not AC proofs: they pin the renderer/validator
// inputs the AC tests below rely on. They deliberately carry no AC token, so
// settle's coverage scan (which links the first token per file) points the
// verifier at the gate tests instead of at these sanity checks.
describe('decideStop: fixtures come from core\'s real renderer', () => {
  it('fixture precondition: the filled render validates clean, has no unfilled section, and declares cadence_handoff: 2', () => {
    expect(validate(FILLED)).toEqual({ ok: true, diagnostics: [] });
    expect(findUnfilledSections(FILLED)).toEqual([]);
    expect(FILLED).toMatch(/^cadence_handoff: 2$/m);
    expect(FILLED).not.toBe(RENDERED);
  });

  it('fixture precondition: the two-marker render is structurally valid and core names exactly the two kept sections', () => {
    expect(validate(TWO_UNFILLED)).toEqual({ ok: true, diagnostics: [] });
    expect(findUnfilledSections(TWO_UNFILLED)).toEqual([...UNFILLED_SECTIONS]);
  });

  it('fixture precondition: the v1 rewrite is valid under schema v1 and has no unfilled section', () => {
    expect(validate(VERSION_ONE)).toEqual({ ok: true, diagnostics: [] });
    expect(findUnfilledSections(VERSION_ONE)).toEqual([]);
    expect(VERSION_ONE).toMatch(/^cadence_handoff: 1$/m);
    expect(VERSION_ONE).not.toContain('## Open decisions');
  });
});

describe('decideStop: unknown readings (D-BJ)', () => {
  it('336-01/AC-2: used_percentage and current_usage both null never block and plan no store op', () => {
    const plan = decideStop(facts({ machine: idle(), reading: reading(null, null) }), OPTIONS);
    expect(plan).toEqual(NOTHING);
  });

  it('336-01/AC-2: used_percentage 0 never falls back, even when current_usage would compute above the threshold', () => {
    const big = usage({ input_tokens: 150_000, cache_creation_input_tokens: 10_000, cache_read_input_tokens: 20_000 });
    // The same usage with a null used_percentage computes 90%: the fallback
    // WOULD block, so only the 0-is-unknown rule keeps this quiet.
    expect(effectivePercentage(reading(null, big))).toBe(90);
    expect(effectivePercentage(reading(0, big))).toBeNull();
    const plan = decideStop(facts({ machine: idle(), reading: reading(0, big), stopHookActive: true }), OPTIONS);
    expect(plan).toEqual(NOTHING);
  });

  it('336-01/AC-2: a null usage component or a missing window is unknown, never coerced to 0', () => {
    expect(effectivePercentage(reading(null, usage({ cache_read_input_tokens: null })))).toBeNull();
    expect(effectivePercentage(reading(null, usage(), { window: null }))).toBeNull();
    expect(effectivePercentage(reading(null, usage(), { window: 0 }))).toBeNull();
    expect(
      effectivePercentage(
        reading(null, usage({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })),
      ),
    ).toBeNull();
    expect(effectivePercentage(reading(-5, usage()))).toBeNull();
  });

  it('336-01/AC-2: NaN, Infinity and negative used_percentage, and NaN or negative token counts, are unknown', () => {
    const big = usage({ input_tokens: 150_000, cache_creation_input_tokens: 10_000, cache_read_input_tokens: 20_000 });
    for (const used of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -0.5]) {
      expect(effectivePercentage(reading(used, big))).toBeNull();
      expect(decideStop(facts({ machine: idle(), reading: reading(used, big) }), OPTIONS)).toEqual(NOTHING);
    }
    for (const field of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] as const) {
      for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
        const r = reading(null, usage({ ...big, [field]: bad }));
        expect(effectivePercentage(r)).toBeNull();
        expect(decideStop(facts({ machine: idle(), reading: r }), OPTIONS)).toEqual(NOTHING);
      }
    }
    for (const window of [Number.NaN, Number.POSITIVE_INFINITY, -200_000]) {
      expect(effectivePercentage(reading(null, big, { window }))).toBeNull();
    }
  });
});

describe('decideStop: the stale bound', () => {
  it('336-01/AC-13: a reading above threshold older than maxReadingAgeS is absent', () => {
    const stale = decideStop(facts({ machine: idle(), reading: reading(85, null, { ageS: 601 }) }), OPTIONS);
    expect(stale).toEqual(NOTHING);
    const unparseable = decideStop(facts({ machine: idle(), reading: reading(85, null, { ts: 'not-a-time' }) }), OPTIONS);
    expect(unparseable).toEqual(NOTHING);
    // Exactly at the bound the reading is still fresh: "older than" is strict.
    const atBound = decideStop(facts({ machine: idle(), reading: reading(85, null, { ageS: 600 }) }), OPTIONS);
    expect(stdoutKind(atBound)).toBe('block');
    expect(atBound.ops).toEqual([
      {
        kind: 'transition',
        from: 'idle',
        to: 'armed',
        ctx: { reading: { used_percentage: 85 } },
        extras: { instructed: true, blocks: 1 },
      },
    ]);
  });

  it('336-01/AC-13: a reading taken before the machine\'s since (before the last reset) is absent', () => {
    const since = new Date(NOW.getTime() - 60_000).toISOString();
    const machine: StopMachine = { state: 'idle', since };
    const beforeSince = decideStop(facts({ machine, reading: reading(85, null, { ageS: 120 }) }), OPTIONS);
    expect(beforeSince).toEqual(NOTHING);
    const atSince = decideStop(facts({ machine, reading: reading(85, null, { ageS: 60 }) }), OPTIONS);
    expect(stdoutKind(atSince)).toBe('block');
    const afterSince = decideStop(facts({ machine, reading: reading(85, null, { ageS: 30 }) }), OPTIONS);
    expect(stdoutKind(afterSince)).toBe('block');
    // since null (no store yet) means no lower bound.
    const noBound = decideStop(facts({ machine: idle(), reading: reading(85, null, { ageS: 120 }) }), OPTIONS);
    expect(stdoutKind(noBound)).toBe('block');
  });

  it('336-01/AC-13: a reading more than 5 s in the future is absent; within 5 s it is fresh', () => {
    const sixAhead = decideStop(facts({ machine: idle(), reading: reading(85, null, { ageS: -6 }) }), OPTIONS);
    expect(sixAhead).toEqual(NOTHING);
    const fourAhead = decideStop(facts({ machine: idle(), reading: reading(85, null, { ageS: -4 }) }), OPTIONS);
    expect(stdoutKind(fourAhead)).toBe('block');
    expect(fourAhead.ops).toHaveLength(1);
  });

  it('336-01/AC-13: on the real store, a reading from before a settle-and-reset does not re-arm the fresh idle', async () => {
    seedStore({ state: 'idle', since: new Date(NOW.getTime() - 60_000).toISOString() });
    const { plan, results } = await stopOnce({ reading: reading(85, null, { ageS: 120 }) });
    expect(plan).toEqual(NOTHING);
    expect(results).toEqual([]);
    expect(storeState()).toBe('idle');
  });
});

describe('decideStop: the absolute fallback (input-only formula)', () => {
  // (50_000 + 10_000 + 40_000) / 200_000 * 100 = 50%.
  const computed = usage();

  it('336-01/AC-14: the fallback is (input + cache_creation + cache_read) / window x 100 and output_tokens never counts', () => {
    expect(effectivePercentage(reading(null, computed))).toBe(50);
    expect(effectivePercentage(reading(null, usage({ output_tokens: 0 })))).toBe(50);
    expect(effectivePercentage(reading(null, usage({ output_tokens: 10_000_000 })))).toBe(50);
    expect(effectivePercentage(reading(null, usage({ output_tokens: null })))).toBe(50);
    expect(effectivePercentage(reading(72, computed))).toBe(72);
  });

  it('336-01/AC-14: a threshold just above the computed percent prints nothing and stays idle', () => {
    for (const output of [0, 7_000, 10_000_000]) {
      const plan = decideStop(
        facts({ machine: idle(), reading: reading(null, usage({ output_tokens: output })) }),
        { ...OPTIONS, threshold: 50.01 },
      );
      expect(plan).toEqual(NOTHING);
    }
  });

  it('336-01/AC-14: a threshold just below the computed percent blocks and arms, with the computed percent in the ctx', () => {
    for (const output of [0, 7_000, 10_000_000]) {
      const plan = decideStop(
        facts({ machine: idle(), reading: reading(null, usage({ output_tokens: output })) }),
        { ...OPTIONS, threshold: 49.99 },
      );
      expect(plan.ops).toEqual([
        {
          kind: 'transition',
          from: 'idle',
          to: 'armed',
          ctx: { reading: { used_percentage: 50 } },
          extras: { instructed: true, blocks: 1 },
        },
      ]);
      expect(plan.stdout).toEqual({
        decision: 'block',
        reason:
          'checkpoint: context usage is 50% (threshold 49.99%). Before you stop, run `cadence handoff` to scaffold ' +
          'a SESSION handoff doc under .cadence/handoff/, then fill every section: replace each FILL IN marker with ' +
          'narrative, and write None under Open decisions if there are none. Keep `cadence_handoff: 2` in its ' +
          'frontmatter and set nothing below `cadence_handoff: 2`. Then stop again so the gate can check the doc.',
      });
      expect(plan.stderr).toBeNull();
    }
  });

  it('336-01/AC-14: the idle-to-armed op is accepted by the real store although the raw used_percentage is null', async () => {
    const { plan, results } = await stopOnce({ reading: reading(null, computed) }, { ...OPTIONS, threshold: 49.99 });
    expect(stdoutKind(plan)).toBe('block');
    expect(results).toEqual([{ ok: true, state: 'armed' }]);
    expect(stderrChunks).toEqual([]);
    expect(machineFromStore()).toEqual({ state: 'armed', since: expect.any(String), instructed: true, blocks: 1 });
  });

  it('336-01/AC-14: at or above the threshold blocks; a known used_percentage below it does nothing', () => {
    expect(stdoutKind(decideStop(facts({ machine: idle(), reading: reading(70) }), OPTIONS))).toBe('block');
    expect(decideStop(facts({ machine: idle(), reading: reading(69) }), OPTIONS)).toEqual(NOTHING);
    expect(decideStop(facts({ machine: idle(), reading: null }), OPTIONS)).toEqual(NOTHING);
  });
});

describe('decideStop: one instruction per entry into armed (CMD-D)', () => {
  it('336-01/AC-3: armed and not yet instructed, no doc: records the instruction and blocks once', () => {
    const plan = decideStop(facts({ machine: armed({ blocks: 1 }), stopHookActive: true }), OPTIONS);
    expect(plan.ops).toEqual([
      {
        kind: 'update-extras',
        patch: { instructed: true, blocks: 2 },
        expectedState: 'armed',
        expectedSince: SINCE,
      },
    ]);
    expect(stdoutKind(plan)).toBe('block');
    expect(reasonOf(plan)).toContain('`cadence handoff`');
    expect(reasonOf(plan)).toContain('set nothing below `cadence_handoff: 2`');
    expect(reasonOf(plan)).toContain('fill every section');
    expect(isPlainAsciiLine(reasonOf(plan))).toBe(true);
  });

  it('336-01/AC-3: armed and already instructed, no doc: no stdout, whatever stop_hook_active says', () => {
    expect(decideStop(facts({ machine: armed({ instructed: true }) }), OPTIONS)).toEqual(NOTHING);
    expect(decideStop(facts({ machine: armed({ instructed: true, blocks: 0 }) }), OPTIONS)).toEqual(NOTHING);
    expect(
      decideStop(facts({ machine: armed({ instructed: true, blocks: 1 }) }), OPTIONS).stdout,
    ).toBeNull();
    expect(
      decideStop(facts({ machine: armed({ instructed: true, blocks: 2 }), stopHookActive: true }), OPTIONS),
    ).toEqual(NOTHING);
  });

  it('336-01/AC-3: three consecutive Stops against the real store print exactly one instruction', async () => {
    seedStore({ state: 'armed', since: SINCE });
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await stopOnce({ stopHookActive: i > 0 }));
    expect(runs.map((r) => stdoutKind(r.plan))).toEqual(['block', 'none', 'none']);
    expect(runs.map((r) => r.plan.ops.length)).toEqual([1, 0, 0]);
    expect(runs.every((r) => allOk(r.results))).toBe(true);
    expect(stderrChunks).toEqual([]);
    expect(machineFromStore()).toEqual({ state: 'armed', since: SINCE, instructed: true, blocks: 1 });
  });
});

// Each AC's real-store test comes first: settle links the first AC token per
// file, so the verifier sees the end-state proof before the plan-shape one.
describe('decideStop: a handoff doc newer than since', () => {
  it('336-01/AC-4: applied to the real store, the valid doc settles without a force record', async () => {
    seedStore({ state: 'armed', since: SINCE, instructed: true, blocks: 2 });
    const { plan, results } = await stopOnce({ handoffDoc: FILLED, stopHookActive: true });
    expect(plan.stdout).toBeNull();
    expect(results).toEqual([
      { ok: true, state: 'written' },
      { ok: true, state: 'settled' },
    ]);
    expect(machineFromStore()).toEqual({ state: 'settled', since: expect.any(String) });
    const read = readMachineState(projectDir);
    expect(read.ok && read.forced).toBeFalsy();
  });

  it('336-01/AC-4: a valid v2 doc plans armed -> written -> settled with no stdout, even mid-chain', () => {
    for (const stopHookActive of [false, true]) {
      const plan = decideStop(
        facts({ machine: armed({ instructed: true, blocks: 2 }), handoffDoc: FILLED, stopHookActive }),
        OPTIONS,
      );
      expect(plan).toEqual({
        ops: [
          { kind: 'transition', from: 'armed', to: 'written' },
          { kind: 'transition', from: 'written', to: 'settled' },
        ],
        stdout: null,
        stderr: null,
      });
    }
  });

  it('336-01/AC-5: applied to the real store, the downgrade leaves the store armed', async () => {
    seedStore({ state: 'armed', since: SINCE, instructed: true, blocks: 1 });
    const { plan, results } = await stopOnce({ handoffDoc: VERSION_ONE, stopHookActive: true });
    expect(reasonOf(plan)).toContain('version-downgrade');
    expect(allOk(results)).toBe(true);
    expect(machineFromStore()).toEqual({ state: 'armed', since: expect.any(String), instructed: true, blocks: 2 });
  });

  it('336-01/AC-5: a cadence_handoff: 1 doc blocks with a version-downgrade diagnostic and returns to armed', () => {
    const plan = decideStop(
      facts({ machine: armed({ instructed: true, blocks: 1 }), handoffDoc: VERSION_ONE, stopHookActive: true }),
      OPTIONS,
    );
    expect(plan.ops).toEqual([
      { kind: 'transition', from: 'armed', to: 'written' },
      { kind: 'transition', from: 'written', to: 'armed', extras: { instructed: true, blocks: 2 } },
    ]);
    expect(Object.keys(plan.stdout ?? {})).toEqual(['decision', 'reason']);
    expect(reasonOf(plan)).toContain('version-downgrade');
    expect(reasonOf(plan)).toContain('cadence_handoff: 1');
    expect(isPlainAsciiLine(reasonOf(plan))).toBe(true);
    expect(plan.stderr).toBeNull();
  });

  it('336-01/AC-5: version-downgrade fires only for a supported version below 2; others are the validator\'s', () => {
    for (const value of ['01', '0', '"1"']) {
      const doc = VERSION_ONE.replace('cadence_handoff: 1', `cadence_handoff: ${value}`);
      const reason = reasonOf(decideStop(facts({ machine: armed({ instructed: true }), handoffDoc: doc }), OPTIONS));
      expect(reason).toContain('HANDOFF_VERSION_UNSUPPORTED');
      expect(reason).not.toContain('version-downgrade');
    }
    const noKey = FILLED.replace('cadence_handoff: 2\n', '');
    expect(decideStop(facts({ machine: armed({ instructed: true }), handoffDoc: noKey }), OPTIONS).ops).toEqual([
      { kind: 'transition', from: 'armed', to: 'written' },
      { kind: 'transition', from: 'written', to: 'settled' },
    ]);
  });

  it('336-01/AC-6: applied to the real store, the unfilled doc leaves the store armed', async () => {
    seedStore({ state: 'armed', since: SINCE, instructed: true, blocks: 1 });
    const { plan, results } = await stopOnce({ handoffDoc: TWO_UNFILLED });
    expect(allOk(results)).toBe(true);
    expect(storeState()).toBe('armed');
    for (const name of findUnfilledSections(TWO_UNFILLED)) expect(reasonOf(plan)).toContain(`"${name}"`);
  });

  it('336-01/AC-6: unfilled sections block with each name exactly as findUnfilledSections returns it', () => {
    const plan = decideStop(facts({ machine: armed({ instructed: true, blocks: 1 }), handoffDoc: TWO_UNFILLED }), OPTIONS);
    expect(plan.ops).toEqual([
      { kind: 'transition', from: 'armed', to: 'written' },
      { kind: 'transition', from: 'written', to: 'armed', extras: { instructed: true, blocks: 1 } },
    ]);
    expect(stdoutKind(plan)).toBe('block');
    const names = findUnfilledSections(TWO_UNFILLED);
    expect(names).toEqual(['What landed this session', 'Next action']);
    for (const name of names) expect(reasonOf(plan)).toContain(`"${name}"`);
    expect(reasonOf(plan)).not.toContain('version-downgrade');
    expect(isPlainAsciiLine(reasonOf(plan))).toBe(true);
  });

  it('336-01/AC-6: validator diagnostics are carried too, as plain ASCII', () => {
    // A State header near-miss quotes the raw header (with its middle dot and
    // em dash) in the validator's message; the reason must stay ASCII.
    const broken = FILLED.replace('## State on handoff', '## state on handoff');
    const plan = decideStop(facts({ machine: armed({ instructed: true }), handoffDoc: broken }), OPTIONS);
    expect(stdoutKind(plan)).toBe('block');
    expect(reasonOf(plan)).toContain('SECTION_HEADER_MISMATCH');
    expect(isPlainAsciiLine(reasonOf(plan))).toBe(true);
  });
});

describe('decideStop: the block chain and the ceiling', () => {
  it('336-01/AC-8: the ceiling-th consecutive would-be block releases from armed with ctx.forced, never via written', () => {
    const invalidDoc = decideStop(
      facts({ machine: armed({ instructed: true, blocks: 2 }), handoffDoc: TWO_UNFILLED, stopHookActive: true }),
      OPTIONS,
    );
    const noDoc = decideStop(facts({ machine: armed({ blocks: 2 }), stopHookActive: true }), OPTIONS);
    for (const plan of [invalidDoc, noDoc]) {
      expect(plan.ops).toEqual([{ kind: 'transition', from: 'armed', to: 'settled', ctx: { forced: true } }]);
      expect(plan.stdout).not.toBeNull();
      expect(Object.keys(plan.stdout ?? {})).toEqual(['systemMessage']);
      const message = plan.stdout !== null && 'systemMessage' in plan.stdout ? plan.stdout.systemMessage : '';
      expect(message).toContain('ceiling of 3');
      expect(message).toContain('force-release is recorded');
      expect(isPlainAsciiLine(message)).toBe(true);
      expect(plan.stderr).toBeNull();
    }
  });

  it('336-01/AC-8: stop_hook_active false starts a new chain instead of releasing', () => {
    const plan = decideStop(
      facts({ machine: armed({ instructed: true, blocks: 2 }), handoffDoc: TWO_UNFILLED, stopHookActive: false }),
      OPTIONS,
    );
    expect(plan.ops).toEqual([
      { kind: 'transition', from: 'armed', to: 'written' },
      { kind: 'transition', from: 'written', to: 'armed', extras: { instructed: true, blocks: 1 } },
    ]);
    expect(stdoutKind(plan)).toBe('block');
    const noDoc = decideStop(facts({ machine: armed({ blocks: 5 }), stopHookActive: false }), OPTIONS);
    expect(noDoc.ops).toEqual([
      { kind: 'update-extras', patch: { instructed: true, blocks: 1 }, expectedState: 'armed', expectedSince: SINCE },
    ]);
  });

  it('336-01/AC-8: with ceiling 3 the real store goes block, block, release and records the force', async () => {
    const first = await stopOnce({ reading: HIGH, stopHookActive: false });
    const second = await stopOnce({ handoffDoc: TWO_UNFILLED, stopHookActive: true });
    const third = await stopOnce({ handoffDoc: TWO_UNFILLED, stopHookActive: true });
    expect([first, second, third].map((r) => stdoutKind(r.plan))).toEqual(['block', 'block', 'release']);
    expect([first, second, third].every((r) => allOk(r.results))).toBe(true);
    expect(third.plan.ops.some((op) => op.kind === 'transition' && op.to === 'written')).toBe(false);
    expect(stderrChunks).toEqual([]);
    const read = readMachineState(projectDir);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.state).toBe('settled');
    expect(read.forced).toBe(true);
    expect(typeof read.forcedAt).toBe('string');
    expect(read.lastForcedAt).toBe(read.forcedAt);
    expect(read.blocks).toBeUndefined();
  });

  it('336-01/AC-8: a stop_hook_active false Stop between blocks resets the chain on the real store', async () => {
    const kinds: string[] = [];
    kinds.push(stdoutKind((await stopOnce({ reading: HIGH, stopHookActive: false })).plan));
    kinds.push(stdoutKind((await stopOnce({ handoffDoc: TWO_UNFILLED, stopHookActive: true })).plan));
    kinds.push(stdoutKind((await stopOnce({ handoffDoc: TWO_UNFILLED, stopHookActive: false })).plan));
    expect(machineFromStore().blocks).toBe(1);
    kinds.push(stdoutKind((await stopOnce({ handoffDoc: TWO_UNFILLED, stopHookActive: true })).plan));
    expect(storeState()).toBe('armed');
    kinds.push(stdoutKind((await stopOnce({ handoffDoc: TWO_UNFILLED, stopHookActive: true })).plan));
    expect(kinds).toEqual(['block', 'block', 'block', 'block', 'release']);
    expect(stderrChunks).toEqual([]);
    expect(storeState()).toBe('settled');
  });

  it('336-01/AC-8: a silent armed pass with stop_hook_active false clears the chain, with no stdout', () => {
    const plan = decideStop(facts({ machine: armed({ instructed: true, blocks: 2 }), stopHookActive: false }), OPTIONS);
    expect(plan).toEqual({
      ops: [{ kind: 'update-extras', patch: { blocks: null }, expectedState: 'armed', expectedSince: SINCE }],
      stdout: null,
      stderr: null,
    });
    // With stop_hook_active true the silent pass keeps the chain untouched.
    expect(
      decideStop(facts({ machine: armed({ instructed: true, blocks: 2 }), stopHookActive: true }), OPTIONS),
    ).toEqual(NOTHING);
  });

  it('336-01/AC-8: block, block, silent pass, then the next block starts a new chain and does not release', async () => {
    const first = await stopOnce({ reading: HIGH, stopHookActive: false });
    const second = await stopOnce({ handoffDoc: TWO_UNFILLED, stopHookActive: true });
    expect(machineFromStore().blocks).toBe(2);
    const silent = await stopOnce({ stopHookActive: false });
    expect(silent.plan.stdout).toBeNull();
    expect(silent.plan.ops).toHaveLength(1);
    expect(allOk(silent.results)).toBe(true);
    expect(machineFromStore().blocks).toBeUndefined();
    expect(machineFromStore().instructed).toBe(true);
    // Without the clear this Stop would be the third consecutive block and
    // release at ceiling 3; after it, it is a new chain's first block.
    const fourth = await stopOnce({ handoffDoc: TWO_UNFILLED, stopHookActive: true });
    expect(stdoutKind(fourth.plan)).toBe('block');
    expect(allOk(fourth.results)).toBe(true);
    expect(machineFromStore().blocks).toBe(1);
    const fifth = await stopOnce({ handoffDoc: TWO_UNFILLED, stopHookActive: true });
    expect(stdoutKind(fifth.plan)).toBe('block');
    expect(storeState()).toBe('armed');
    expect([first, second].map((r) => stdoutKind(r.plan))).toEqual(['block', 'block']);
    expect(stderrChunks).toEqual([]);
  });
});

describe('decideStop: inert states', () => {
  it('336-01/AC-18: written, reset and resumed plan no op and no stdout, and name the stuck state once on stderr', () => {
    for (const state of ['written', 'reset', 'resumed'] as const) {
      const plan = decideStop(
        facts({ machine: { state, since: SINCE }, reading: HIGH, handoffDoc: FILLED, stopHookActive: true }),
        OPTIONS,
      );
      expect(plan.ops).toEqual([]);
      expect(plan.stdout).toBeNull();
      expect(typeof plan.stderr).toBe('string');
      const notice = plan.stderr ?? '';
      expect(notice).toContain(`state is ${state}`);
      expect(notice).toContain('The next SessionStart (startup, clear or compact) walks it back to idle.');
      // Deleting the store would erase the sticky lastForcedAt record, so the
      // notice must never suggest it.
      expect(notice).not.toContain('state.json');
      expect(notice).not.toMatch(/remov/i);
      expect(isPlainAsciiLine(notice)).toBe(true);
    }
  });

  it('336-01/AC-18: settled does nothing at all, not even a stderr notice', () => {
    const plan = decideStop(
      facts({ machine: { state: 'settled', since: SINCE }, reading: HIGH, handoffDoc: TWO_UNFILLED, stopHookActive: true }),
      OPTIONS,
    );
    expect(plan).toEqual(NOTHING);
  });
});
