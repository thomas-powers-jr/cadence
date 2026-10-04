import { describe, it, expect } from 'vitest';
import { emptyState, type HookContext } from '@thomas-powers-jr/cadence-types';
import { handleSessionStart } from '../../src/hooks/handlers.js';

// Phase 322 (T2, AC-4): the SessionStart banner on an IDLE checkout. The
// checkout-local `state.activePhase` survives settle, so the IDLE banner no
// longer presents it as the active phase; it names the latest settled phase
// (derived by the dispatcher from working-tree SUMMARY files) when one is known.

const ctx: HookContext = { cwd: '/repo', event: 'session-start' };

describe('handleSessionStart — IDLE banner (phase 322)', () => {
  it('322-01/AC-4: IDLE with a latest settled phase → "(none — loop is IDLE)" followed by "Latest settled phase:"', async () => {
    const state = emptyState('demo');
    state.activePhase = '311-old';
    const r = await handleSessionStart(ctx, state, '319-new');
    expect(r.ok).toBe(true);
    expect(r.contextPayload).toBe(
      [
        'CADENCE session resumed.',
        'Project: demo',
        'Loop position: IDLE',
        'Active phase: (none — loop is IDLE)',
        'Latest settled phase: 319-new',
        'Active draft: (none)',
      ].join('\n'),
    );
    expect(r.contextPayload).not.toContain('311-old');
  });

  it('322-01/AC-4: IDLE, no settled phase found but a checkout-local activePhase → "Last phase in this checkout:" fallback', async () => {
    const state = emptyState('demo');
    state.activePhase = '311-old';
    const r = await handleSessionStart(ctx, state, null);
    expect(r.ok).toBe(true);
    expect(r.contextPayload).toBe(
      [
        'CADENCE session resumed.',
        'Project: demo',
        'Loop position: IDLE',
        'Active phase: (none — loop is IDLE)',
        'Last phase in this checkout: 311-old',
        'Active draft: (none)',
      ].join('\n'),
    );
    expect(r.contextPayload).not.toContain('Latest settled phase');
  });

  it('322-01/AC-4: IDLE with neither a settled phase nor an activePhase → no extra phase line', async () => {
    const r = await handleSessionStart(ctx, emptyState('demo'), null);
    expect(r.ok).toBe(true);
    expect(r.contextPayload).toContain('Active phase: (none — loop is IDLE)\nActive draft: (none)');
    expect(r.contextPayload).not.toContain('Latest settled phase');
    expect(r.contextPayload).not.toContain('Last phase in this checkout');
  });

  it('322-01/AC-4: IDLE with the lookup argument omitted defaults to no "Latest settled phase:" line', async () => {
    const r = await handleSessionStart(ctx, emptyState('demo'));
    expect(r.contextPayload).toContain('Active phase: (none — loop is IDLE)');
    expect(r.contextPayload).not.toContain('Latest settled phase');
  });

  it('322-01/AC-4: non-IDLE banner is unchanged, even when a latest settled phase is supplied', async () => {
    const state = emptyState('golden');
    state.activePhase = '01-foundation';
    state.activeDraft = '01-01';
    state.loopPosition = 'BUILD';
    state.openDrafts = [{ id: '01-01', since: '2026-09-26T00:00:00.000Z' }];
    const expected = [
      'CADENCE session resumed.',
      'Project: golden',
      'Loop position: BUILD',
      'Active phase: 01-foundation',
      'Active draft: 01-01',
      'Open drafts: 01-01',
    ].join('\n');
    expect((await handleSessionStart(ctx, state, '319-new')).contextPayload).toBe(expected);
    expect((await handleSessionStart(ctx, state)).contextPayload).toBe(expected);
  });

  it('322-01/AC-4: non-IDLE banner with no activePhase keeps the old "(none)" line and never names a settled phase', async () => {
    const state = emptyState('demo');
    state.loopPosition = 'SPEC';
    const expected = [
      'CADENCE session resumed.',
      'Project: demo',
      'Loop position: SPEC',
      'Active phase: (none)',
      'Active draft: (none)',
    ].join('\n');
    expect((await handleSessionStart(ctx, state, '319-new')).contextPayload).toBe(expected);
  });
});
