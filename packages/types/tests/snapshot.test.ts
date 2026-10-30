import { describe, it, expect } from 'vitest';
import { StateSnapshotZ } from '../src/snapshot.js';
import { emptyState } from '../src/state.js';

function validSnapshot(): Record<string, unknown> {
  return {
    snapshotVersion: 1,
    savedAt: '2026-10-29T23:15:02.000Z',
    host: 'dev-box',
    cadenceVersion: '1.72.0',
    state: JSON.parse(JSON.stringify(emptyState())) as unknown,
  };
}

describe('StateSnapshotZ', () => {
  it('parses a valid snapshot (341-01/AC-4)', () => {
    const input = validSnapshot();
    const parsed = StateSnapshotZ.parse(input);
    expect(parsed.snapshotVersion).toBe(1);
    expect(parsed.host).toBe('dev-box');
    expect(parsed.cadenceVersion).toBe('1.72.0');
    expect(parsed.state).toEqual(input.state);
  });

  it('defaults a missing state.draftReadHash to null (341-01/AC-4)', () => {
    const { draftReadHash: _drop, ...legacyState } = emptyState();
    const parsed = StateSnapshotZ.parse({ ...validSnapshot(), state: legacyState });
    expect(parsed.state.draftReadHash).toBeNull();
  });

  it('rejects snapshotVersion 2 (341-01/AC-3)', () => {
    expect(StateSnapshotZ.safeParse({ ...validSnapshot(), snapshotVersion: 2 }).success).toBe(false);
  });

  it('rejects a malformed savedAt (341-01/AC-3)', () => {
    expect(StateSnapshotZ.safeParse({ ...validSnapshot(), savedAt: 'yesterday' }).success).toBe(false);
  });

  it('rejects an empty host (341-01/AC-3)', () => {
    expect(StateSnapshotZ.safeParse({ ...validSnapshot(), host: '' }).success).toBe(false);
  });

  it('rejects a missing cadenceVersion (341-01/AC-3)', () => {
    const { cadenceVersion: _drop, ...withoutVersion } = validSnapshot();
    expect(StateSnapshotZ.safeParse(withoutVersion).success).toBe(false);
  });

  it('rejects a state with schemaVersion 2 (341-01/AC-3)', () => {
    const snap = validSnapshot();
    const state = { ...(snap.state as Record<string, unknown>), schemaVersion: 2 };
    expect(StateSnapshotZ.safeParse({ ...snap, state }).success).toBe(false);
  });
});
