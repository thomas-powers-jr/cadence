import { describe, it, expect } from 'vitest';
import { isHookLive, HOOK_LIVENESS_WINDOW_MS } from '../../src/hooks/hook-liveness.js';

// Phase 349 (T1, AC-1): the pure liveness check behind the build-task notice,
// the doctor check and the settle skill-audit explanation.
describe('isHookLive (phase 349)', () => {
  const now = new Date('2026-11-22T12:00:00.000Z');

  it('349-01/AC-1: the window is a 30-minute constant', () => {
    expect(HOOK_LIVENESS_WINDOW_MS).toBe(30 * 60 * 1000);
  });

  it('349-01/AC-1: true for a stamp equal to now', () => {
    expect(isHookLive(now.toISOString(), now)).toBe(true);
  });

  it('349-01/AC-1: true exactly at the window edge', () => {
    const edge = new Date(now.getTime() - HOOK_LIVENESS_WINDOW_MS).toISOString();
    expect(isHookLive(edge, now)).toBe(true);
  });

  it('349-01/AC-1: false just past the window edge', () => {
    const past = new Date(now.getTime() - HOOK_LIVENESS_WINDOW_MS - 1).toISOString();
    expect(isHookLive(past, now)).toBe(false);
  });

  it('349-01/AC-1: false for an absent stamp (undefined or null)', () => {
    expect(isHookLive(undefined, now)).toBe(false);
    expect(isHookLive(null, now)).toBe(false);
  });

  it('349-01/AC-1: false for an unparseable or empty stamp', () => {
    expect(isHookLive('not-a-date', now)).toBe(false);
    expect(isHookLive('', now)).toBe(false);
  });

  it('349-01/AC-1: false for a stamp later than now', () => {
    const future = new Date(now.getTime() + 1).toISOString();
    expect(isHookLive(future, now)).toBe(false);
  });
});
