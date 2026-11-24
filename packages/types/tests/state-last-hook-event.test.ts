import { describe, it, expect } from 'vitest';
import { CadenceStateZ, emptyState } from '../src/state.js';

// Phase 349 (T1, AC-1): `session.lastHookEventAt` is a per-machine liveness
// stamp written by the hook dispatcher. It is `.optional()` with no default,
// so every pre-349 state.json (no key) still parses and stays key-absent.
describe('CadenceStateZ session.lastHookEventAt (phase 349)', () => {
  it('349-01/AC-1: parses a pre-349 state with no lastHookEventAt key and injects none', () => {
    const s = emptyState('demo');
    expect('lastHookEventAt' in s.session).toBe(false);
    const parsed = CadenceStateZ.parse(JSON.parse(JSON.stringify(s)));
    expect('lastHookEventAt' in parsed.session).toBe(false);
    expect(parsed.session.lastHookEventAt).toBeUndefined();
  });

  it('349-01/AC-1: parses and keeps an ISO lastHookEventAt string', () => {
    const s = emptyState('demo');
    const raw = { ...s, session: { ...s.session, lastHookEventAt: '2026-11-22T10:00:00.000Z' } };
    const parsed = CadenceStateZ.parse(raw);
    expect(parsed.session.lastHookEventAt).toBe('2026-11-22T10:00:00.000Z');
  });

  it('349-01/AC-1: rejects a non-string lastHookEventAt', () => {
    const s = emptyState('demo');
    const raw = { ...s, session: { ...s.session, lastHookEventAt: 123 } };
    expect(CadenceStateZ.safeParse(raw).success).toBe(false);
  });
});
