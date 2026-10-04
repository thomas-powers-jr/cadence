import { describe, expect, it } from 'vitest';
import {
  MILESTONES_PHASE_BULLET,
  ROADMAP_PHASE_HEADING,
  missingRoadmapEntries,
} from '../../src/roadmap/phase-entry.js';

const INIT_STUB = '# Roadmap\n\n_(no phases yet)_\n';

const roadmapWith = (...nums: number[]): string =>
  ['# Roadmap', '', ...nums.map((n) => `### Phase ${n}: something\n\nBody.\n`)].join('\n');

const milestonesWith = (...nums: number[]): string =>
  ['# Milestones', '', ...nums.map((n) => `- **Phase ${n}** — shipped thing`)].join('\n');

describe('missingRoadmapEntries (phase 320, rec-20261004-001)', () => {
  it('320-01/AC-1: reports nothing when both files carry an exact entry for N', () => {
    expect(
      missingRoadmapEntries({
        phaseNumber: 320,
        roadmapText: roadmapWith(318, 319, 320),
        milestonesText: milestonesWith(319, 320),
      }),
    ).toEqual([]);
  });

  it('320-01/AC-1: reports ROADMAP.md when its headings exist but none equals N', () => {
    expect(
      missingRoadmapEntries({
        phaseNumber: 320,
        roadmapText: roadmapWith(318, 319),
        milestonesText: milestonesWith(320),
      }),
    ).toEqual(['ROADMAP.md']);
  });

  it('320-01/AC-1: reports MILESTONES.md when its bullets exist but none equals N', () => {
    expect(
      missingRoadmapEntries({
        phaseNumber: 320,
        roadmapText: roadmapWith(320),
        milestonesText: milestonesWith(318, 319),
      }),
    ).toEqual(['MILESTONES.md']);
  });

  it('320-01/AC-1: reports both, ROADMAP.md first, when neither has N', () => {
    expect(
      missingRoadmapEntries({
        phaseNumber: 320,
        roadmapText: roadmapWith(1, 2),
        milestonesText: milestonesWith(1, 2),
      }),
    ).toEqual(['ROADMAP.md', 'MILESTONES.md']);
  });

  it('320-01/AC-1: `### Phase 32` never satisfies N = 320 (exact integer match)', () => {
    expect(
      missingRoadmapEntries({
        phaseNumber: 320,
        roadmapText: roadmapWith(32),
        milestonesText: milestonesWith(32),
      }),
    ).toEqual(['ROADMAP.md', 'MILESTONES.md']);
  });

  it('320-01/AC-1: `### Phase 320` never satisfies N = 32 (exact integer match)', () => {
    expect(
      missingRoadmapEntries({
        phaseNumber: 32,
        roadmapText: roadmapWith(320),
        milestonesText: milestonesWith(320),
      }),
    ).toEqual(['ROADMAP.md', 'MILESTONES.md']);
  });

  it('320-01/AC-1: a zero-padded heading still matches as an integer', () => {
    expect(
      missingRoadmapEntries({
        phaseNumber: 7,
        roadmapText: '### Phase 07: early\n',
        milestonesText: '- **Phase 07** — early\n',
      }),
    ).toEqual([]);
  });

  it('320-01/AC-1: a null text (absent file) contributes nothing', () => {
    expect(
      missingRoadmapEntries({ phaseNumber: 320, roadmapText: null, milestonesText: null }),
    ).toEqual([]);
    expect(
      missingRoadmapEntries({
        phaseNumber: 320,
        roadmapText: null,
        milestonesText: milestonesWith(1),
      }),
    ).toEqual(['MILESTONES.md']);
    expect(
      missingRoadmapEntries({
        phaseNumber: 320,
        roadmapText: roadmapWith(1),
        milestonesText: null,
      }),
    ).toEqual(['ROADMAP.md']);
  });

  it('320-01/AC-1: the cadence init stub (zero headings) contributes nothing', () => {
    expect(
      missingRoadmapEntries({
        phaseNumber: 320,
        roadmapText: INIT_STUB,
        milestonesText: '# Milestones\n\n_(none yet)_\n',
      }),
    ).toEqual([]);
  });

  it('320-01/AC-1: a project not using the convention (prose only) contributes nothing', () => {
    expect(
      missingRoadmapEntries({
        phaseNumber: 320,
        roadmapText: '# Roadmap\n\n## Q4\n\nWe will do Phase 1 and Phase 2.\n',
        milestonesText: '# Milestones\n\n- Phase 1 shipped (not bold)\n',
      }),
    ).toEqual([]);
  });

  it('320-01/AC-1: handles CRLF line endings', () => {
    const roadmap = roadmapWith(319, 320).replace(/\n/g, '\r\n');
    const milestones = milestonesWith(319, 320).replace(/\n/g, '\r\n');
    expect(
      missingRoadmapEntries({ phaseNumber: 320, roadmapText: roadmap, milestonesText: milestones }),
    ).toEqual([]);
    expect(
      missingRoadmapEntries({ phaseNumber: 321, roadmapText: roadmap, milestonesText: milestones }),
    ).toEqual(['ROADMAP.md', 'MILESTONES.md']);
  });

  it('320-01/AC-1: repeated calls give the same answer (no regex lastIndex leak)', () => {
    const input = {
      phaseNumber: 320,
      roadmapText: roadmapWith(320),
      milestonesText: milestonesWith(320),
    };
    expect(missingRoadmapEntries(input)).toEqual([]);
    expect(missingRoadmapEntries(input)).toEqual([]);
    const missing = { ...input, phaseNumber: 999 };
    expect(missingRoadmapEntries(missing)).toEqual(['ROADMAP.md', 'MILESTONES.md']);
    expect(missingRoadmapEntries(missing)).toEqual(['ROADMAP.md', 'MILESTONES.md']);
    expect(ROADMAP_PHASE_HEADING.lastIndex).toBe(0);
    expect(MILESTONES_PHASE_BULLET.lastIndex).toBe(0);
  });

  it('320-01/AC-1: a found-early match in a long text does not hide a miss in a following short text', () => {
    // An implementation reusing the shared `g` constants and stopping at the
    // first hit would leave lastIndex deep into the long text, so the short
    // text's scan would start past its end and wrongly report nothing missing.
    const long = roadmapWith(5, ...Array.from({ length: 200 }, (_, i) => i + 6));
    const longMilestones = milestonesWith(5, ...Array.from({ length: 200 }, (_, i) => i + 6));
    expect(
      missingRoadmapEntries({ phaseNumber: 5, roadmapText: long, milestonesText: longMilestones }),
    ).toEqual([]);
    expect(
      missingRoadmapEntries({
        phaseNumber: 7,
        roadmapText: roadmapWith(6),
        milestonesText: milestonesWith(6),
      }),
    ).toEqual(['ROADMAP.md', 'MILESTONES.md']);
  });

  it('320-01/AC-1: a slice heading (### Phase 23.1) counts as an entry for its integer phase', () => {
    expect(
      missingRoadmapEntries({
        phaseNumber: 23,
        roadmapText: '### Phase 23.1 — slice\n',
        milestonesText: null,
      }),
    ).toEqual([]);
  });

  it('320-01/AC-1: exports the literal convention patterns (copied from doctor run.ts checkRoadmapCurrency)', () => {
    expect(ROADMAP_PHASE_HEADING.source).toBe('^### Phase (\\d+)');
    expect(ROADMAP_PHASE_HEADING.flags).toBe('gm');
    expect(MILESTONES_PHASE_BULLET.source).toBe('^\\s*-\\s+\\*\\*Phase (\\d+)');
    expect(MILESTONES_PHASE_BULLET.flags).toBe('gm');
  });
});
