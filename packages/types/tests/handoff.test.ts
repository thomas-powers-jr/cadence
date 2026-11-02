import { describe, it, expect } from 'vitest';
import { GitFactsZ, ResumeResultZ, HandoffCandidateZ } from '../src/handoff.js';

describe('handoff types', () => {
  it('AC-1: GitFactsZ accepts the unavailable variant', () => {
    expect(() => GitFactsZ.parse({ available: false })).not.toThrow();
  });

  it('AC-1: GitFactsZ accepts a full available variant', () => {
    expect(() =>
      GitFactsZ.parse({
        available: true,
        branch: 'main',
        dirty: true,
        ahead: 0,
        behind: 0,
        head: 'abc1234',
        recentCommits: 'abc1234 feat: x',
        diffStat: ' 1 file changed',
        fetched: true,
      }),
    ).not.toThrow();
  });

  it('AC-1: GitFactsZ rejects an available variant missing branch', () => {
    expect(() => GitFactsZ.parse({ available: true, dirty: true })).toThrow();
  });

  it('AC-2: ResumeResultZ accepts the not-found shape', () => {
    expect(() => ResumeResultZ.parse({ found: false })).not.toThrow();
  });
});

describe('ResumeResultZ — brief/full mode', () => {
  it('AC-33: accepts a brief result with null context', () => {
    const parsed = ResumeResultZ.safeParse({
      found: true,
      handoffPath: '.cadence/handoff/SESSION-2026-06-05.md',
      generatedAt: '2026-06-05T00:00:00.000Z',
      doc: '## Next action\n**Action:** go',
      context: null,
      drift: null,
      mode: 'brief',
    });
    expect(parsed.success).toBe(true);
  });

  it('AC-33: rejects a found result missing mode', () => {
    const parsed = ResumeResultZ.safeParse({
      found: true,
      handoffPath: 'p',
      generatedAt: null,
      doc: 'd',
      context: null,
      drift: null,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('HandoffCandidateZ', () => {
  it('AC-3: parses a full valid candidate', () => {
    const parsed = HandoffCandidateZ.safeParse({
      path: '.cadence/handoff/SESSION-2026-07-03.md',
      fileName: 'SESSION-2026-07-03.md',
      source: 'sibling',
      worktreePath: '/home/thomas/projects/cadence-worktrees/feat-x',
      worktreeBranch: 'feat/x',
      generatedAt: '2026-07-03T00:00:00.000Z',
      label: 'phase 142 wrap-up',
      loopPosition: 'BUILD',
      activePhase: '142',
      liveLoopPosition: 'SETTLE',
    });
    expect(parsed.success).toBe(true);
  });

  it('AC-3: rejects a candidate missing a non-nullable field (path)', () => {
    const parsed = HandoffCandidateZ.safeParse({
      fileName: 'SESSION-2026-07-03.md',
      source: 'local',
      worktreePath: '/home/thomas/projects/cadence',
      worktreeBranch: null,
      generatedAt: null,
      label: null,
      loopPosition: null,
      activePhase: null,
      liveLoopPosition: null,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('ResumeResultZ — additive candidate fields (AC-3 backward compatibility)', () => {
  it('AC-3: a pre-existing found:true value with none of the new fields still parses', () => {
    const preExistingShape = {
      found: true,
      handoffPath: '.cadence/handoff/SESSION-2026-06-05.md',
      generatedAt: '2026-06-05T00:00:00.000Z',
      doc: '## Next action\n**Action:** go',
      context: null,
      drift: { docLoopPosition: 'BUILD', liveLoopPosition: 'SETTLE' },
      mode: 'full',
    };
    const parsed = ResumeResultZ.safeParse(preExistingShape);
    expect(parsed.success).toBe(true);
  });

  it('AC-3: a pre-existing found:false value still parses', () => {
    expect(ResumeResultZ.safeParse({ found: false }).success).toBe(true);
  });

  it('AC-3: accepts a found:true value with candidates/pickedSource/pickedWorktree', () => {
    const candidate = {
      path: '.cadence/handoff/SESSION-2026-07-03.md',
      fileName: 'SESSION-2026-07-03.md',
      source: 'local',
      worktreePath: '/home/thomas/projects/cadence',
      worktreeBranch: 'main',
      generatedAt: '2026-07-03T00:00:00.000Z',
      label: null,
      loopPosition: 'BUILD',
      activePhase: '142',
      liveLoopPosition: 'BUILD',
    };
    const parsed = ResumeResultZ.safeParse({
      found: true,
      handoffPath: '.cadence/handoff/SESSION-2026-07-03.md',
      generatedAt: '2026-07-03T00:00:00.000Z',
      doc: 'doc',
      context: null,
      drift: null,
      mode: 'full',
      candidates: [candidate],
      pickedSource: 'local',
      pickedWorktree: '/home/thomas/projects/cadence',
    });
    expect(parsed.success).toBe(true);
  });

  it('AC-3: accepts a found:false value with candidates', () => {
    const candidate = {
      path: '.cadence/handoff/SESSION-2026-07-03.md',
      fileName: 'SESSION-2026-07-03.md',
      source: 'sibling',
      worktreePath: '/home/thomas/projects/cadence-worktrees/feat-x',
      worktreeBranch: 'feat/x',
      generatedAt: null,
      label: null,
      loopPosition: null,
      activePhase: null,
      liveLoopPosition: null,
    };
    const parsed = ResumeResultZ.safeParse({ found: false, candidates: [candidate] });
    expect(parsed.success).toBe(true);
  });

  it('309-01/AC-4: accepts a found:true value with supersededHandoffPointer', () => {
    const parsed = ResumeResultZ.safeParse({
      found: true,
      handoffPath: '.cadence/handoff/SESSION-2026-07-03.md',
      generatedAt: '2026-07-03T00:00:00.000Z',
      doc: 'doc',
      context: null,
      drift: null,
      mode: 'full',
      supersededHandoffPointer: 'SESSION-2026-07-01-local.md',
    });
    expect(parsed.success).toBe(true);
  });

  it('309-01/AC-4: a pre-existing found:true value with no supersededHandoffPointer key still parses (additive backward compatibility)', () => {
    const preExistingShape = {
      found: true,
      handoffPath: '.cadence/handoff/SESSION-2026-06-05.md',
      generatedAt: '2026-06-05T00:00:00.000Z',
      doc: '## Next action\n**Action:** go',
      context: null,
      drift: null,
      mode: 'brief',
    };
    const parsed = ResumeResultZ.safeParse(preExistingShape);
    expect(parsed.success).toBe(true);
  });
});

describe('ResumeResultZ — precompactRecord (phase 345)', () => {
  const pointer = {
    path: '.cadence/local/precompact/PRECOMPACT-20261102T181923.456Z.md',
    trigger: 'auto',
    generatedAt: '2026-11-02T18:19:23.456Z',
  };
  const found = {
    found: true,
    handoffPath: 'p',
    generatedAt: null,
    doc: 'd',
    context: null,
    drift: null,
    mode: 'brief',
  };

  it('345-01/AC-7: both branches accept an optional precompactRecord and keep it on parse', () => {
    const nf = ResumeResultZ.parse({ found: false, precompactRecord: pointer });
    expect(nf).toEqual({ found: false, precompactRecord: pointer });
    const f = ResumeResultZ.parse({ ...found, precompactRecord: pointer });
    expect(f.precompactRecord).toEqual(pointer);
  });

  it('345-01/AC-7: precompactRecord stays optional (pre-phase-345 payloads still parse unchanged)', () => {
    expect(ResumeResultZ.parse({ found: false })).toEqual({ found: false });
    expect(ResumeResultZ.parse(found)).not.toHaveProperty('precompactRecord');
  });

  it('345-01/AC-7: precompactRecord requires string path, trigger and generatedAt', () => {
    expect(ResumeResultZ.safeParse({ found: false, precompactRecord: { path: 'x', trigger: 'auto' } }).success).toBe(false);
    expect(ResumeResultZ.safeParse({ ...found, precompactRecord: { ...pointer, trigger: 1 } }).success).toBe(false);
  });
});
