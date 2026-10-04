import { describe, it, expect } from 'vitest';
import { emptyState } from '@thomas-powers-jr/cadence-types';
import { renderStateMd } from '../../src/render/state-md.js';

describe('renderStateMd', () => {
  it('renders an IDLE state with the basics', () => {
    const md = renderStateMd(emptyState('demo'));
    expect(md).toContain('# CADENCE State');
    expect(md).toContain('**Project:** demo');
    expect(md).toContain('**Loop position:** IDLE');
  });

  it('renders active draft when present', () => {
    const s = emptyState('demo');
    s.activePhase = '01-foundation';
    s.activeDraft = '01-01';
    s.loopPosition = 'BUILD';
    const md = renderStateMd(s);
    expect(md).toContain('01-foundation');
    expect(md).toContain('01-01');
    expect(md).toContain('BUILD');
  });

  // Phase 322 (T2, AC-3): `activePhase` survives settle and is per-checkout,
  // so on IDLE it is relabelled for what it is rather than shown as active.
  it('322-01/AC-3: IDLE with a leftover activePhase → Active phase reads none, old value kept under an accurate label', () => {
    const s = emptyState('demo');
    s.activePhase = '311-old';
    const md = renderStateMd(s);
    expect(md).toContain(
      '**Active phase:** (none — loop is IDLE)\n**Last phase in this checkout:** 311-old\n**Active draft:**',
    );
    expect(md).not.toContain('**Active phase:** 311-old');
  });

  it('322-01/AC-3: IDLE with no activePhase → Last phase in this checkout reads (none)', () => {
    const md = renderStateMd(emptyState('demo'));
    expect(md).toContain(
      '**Active phase:** (none — loop is IDLE)\n**Last phase in this checkout:** (none)\n**Active draft:** (none)',
    );
  });

  it('322-01/AC-3: non-IDLE states render exactly as before — no Last phase line', () => {
    const s = emptyState('demo');
    s.activePhase = '01-foundation';
    s.activeDraft = '01-01';
    s.loopPosition = 'BUILD';
    s.tier = 'standard';
    const md = renderStateMd(s);
    expect(md).toContain(
      '**Loop position:** BUILD\n**Active phase:** 01-foundation\n**Active draft:** 01-01\n**Tier:** standard\n',
    );
    expect(md).not.toContain('Last phase in this checkout');
    expect(md).not.toContain('loop is IDLE');
    for (const pos of ['SPEC', 'DRAFT', 'SETTLE'] as const) {
      const other = emptyState('demo');
      other.loopPosition = pos;
      const out = renderStateMd(other);
      expect(out).toContain('**Active phase:** (none)\n**Active draft:** (none)\n');
      expect(out).not.toContain('Last phase in this checkout');
    }
  });

  it('renders decisions count', () => {
    const s = emptyState('demo');
    s.decisions = [
      { id: 'D-001', phase: '01', title: 'pick X', decidedAt: '2026-01-01' },
      { id: 'D-002', phase: '01', title: 'pick Y', decidedAt: '2026-01-02' },
    ];
    expect(renderStateMd(s)).toContain('Decisions: 2');
  });
});
