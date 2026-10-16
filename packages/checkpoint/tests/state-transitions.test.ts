import { describe, expect, it } from 'vitest';
import { CHECKPOINT_STATES, LEGAL_EDGES, isUnknownReading, transition } from '../src/state.js';
import type { CheckpointState } from '../src/state.js';

/**
 * The full 6×6 matrix of ordered pairs, written out by hand. This is an
 * independent statement of CMD-C's machine (docs/handoffs/
 * HANDOFF-checkpoint-phase-2.md §2) — deliberately NOT derived from
 * LEGAL_EDGES, so a wrong edge in the implementation cannot also silently
 * become a wrong expectation here.
 *
 * Legal edges (7): idle→armed, armed→written, written→settled,
 * written→armed, settled→reset, reset→resumed, resumed→idle.
 */
const MATRIX: ReadonlyArray<readonly [CheckpointState, CheckpointState, 'accept' | 'reject']> = [
  // from idle
  ['idle', 'idle', 'reject'],
  ['idle', 'armed', 'accept'],
  ['idle', 'written', 'reject'],
  ['idle', 'settled', 'reject'],
  ['idle', 'reset', 'reject'],
  ['idle', 'resumed', 'reject'],
  // from armed
  ['armed', 'idle', 'reject'],
  ['armed', 'armed', 'reject'],
  ['armed', 'written', 'accept'],
  ['armed', 'settled', 'reject'],
  ['armed', 'reset', 'reject'],
  ['armed', 'resumed', 'reject'],
  // from written
  ['written', 'idle', 'reject'],
  ['written', 'armed', 'accept'],
  ['written', 'written', 'reject'],
  ['written', 'settled', 'accept'],
  ['written', 'reset', 'reject'],
  ['written', 'resumed', 'reject'],
  // from settled
  ['settled', 'idle', 'reject'],
  ['settled', 'armed', 'reject'],
  ['settled', 'written', 'reject'],
  ['settled', 'settled', 'reject'],
  ['settled', 'reset', 'accept'],
  ['settled', 'resumed', 'reject'],
  // from reset
  ['reset', 'idle', 'reject'],
  ['reset', 'armed', 'reject'],
  ['reset', 'written', 'reject'],
  ['reset', 'settled', 'reject'],
  ['reset', 'reset', 'reject'],
  ['reset', 'resumed', 'accept'],
  // from resumed
  ['resumed', 'idle', 'accept'],
  ['resumed', 'armed', 'reject'],
  ['resumed', 'written', 'reject'],
  ['resumed', 'settled', 'reject'],
  ['resumed', 'reset', 'reject'],
  ['resumed', 'resumed', 'reject'],
];

/** A known reading, passed for every matrix call so idle→armed is exercised as a plain legal edge. */
const KNOWN = { reading: { used_percentage: 42 } } as const;

describe('checkpoint transition matrix (CMD-C)', () => {
  it('331-01/AC-4: the literal matrix covers all 36 ordered pairs, exactly 7 legal', () => {
    expect(MATRIX).toHaveLength(36);
    const keys = new Set(MATRIX.map(([from, to]) => `${from}->${to}`));
    expect(keys.size).toBe(36);
    for (const from of CHECKPOINT_STATES) {
      for (const to of CHECKPOINT_STATES) {
        expect(keys.has(`${from}->${to}`), `${from}->${to} missing from MATRIX`).toBe(true);
      }
    }
    expect(MATRIX.filter(([, , verdict]) => verdict === 'accept')).toHaveLength(7);
    expect(MATRIX.filter(([, , verdict]) => verdict === 'reject')).toHaveLength(29);
  });

  it('331-01/AC-4: CHECKPOINT_STATES and LEGAL_EDGES match the hand-written matrix', () => {
    expect([...CHECKPOINT_STATES]).toEqual(['idle', 'armed', 'written', 'settled', 'reset', 'resumed']);
    const exported = LEGAL_EDGES.map(([from, to]) => `${from}->${to}`).sort();
    const expected = MATRIX.filter(([, , v]) => v === 'accept')
      .map(([from, to]) => `${from}->${to}`)
      .sort();
    expect(exported).toEqual(expected);
  });

  it('331-01/AC-4: every one of the 36 pairs is accepted or rejected exactly as the matrix states', () => {
    for (const [from, to, verdict] of MATRIX) {
      const result = transition(from, to, KNOWN);
      if (verdict === 'accept') {
        expect(result, `${from}->${to} should be accepted`).toEqual({ ok: true, state: to });
      } else {
        expect(result.ok, `${from}->${to} should be rejected`).toBe(false);
        if (!result.ok) {
          expect(result.reason, `${from}->${to} reason names from`).toContain(from);
          expect(result.reason, `${from}->${to} reason names to`).toContain(to);
          expect(result.reason, `${from}->${to} reason names the pair`).toContain(`${from} -> ${to}`);
          expect(result.reason).not.toContain('\n');
        }
      }
    }
  });

  for (const [from, to, verdict] of MATRIX) {
    it(`331-01/AC-4: ${from} -> ${to} is ${verdict === 'accept' ? 'accepted' : 'rejected with a reason naming both states'}`, () => {
      const result = transition(from, to, KNOWN);
      if (verdict === 'accept') {
        expect(result).toEqual({ ok: true, state: to });
      } else {
        expect(result.ok).toBe(false);
        expect(result.ok ? '' : result.reason).toContain(`${from} -> ${to}`);
      }
    });
  }

  it('331-01/AC-4: named cross-state jumps and reverses of legal edges are rejected', () => {
    // Reverses: armed->idle, settled->written, reset->settled, resumed->reset,
    // idle->resumed. The armed<->written pair is the one exception — both
    // directions are legal edges in CMD-C (Stop writes; validator fail re-arms).
    for (const [from, to] of [
      ['idle', 'settled'],
      ['reset', 'armed'],
      ['settled', 'written'],
      ['armed', 'idle'],
      ['reset', 'settled'],
      ['resumed', 'reset'],
      ['idle', 'resumed'],
    ] as const) {
      const result = transition(from, to, KNOWN);
      expect(result.ok, `${from}->${to}`).toBe(false);
    }
    expect(transition('armed', 'written', KNOWN).ok).toBe(true);
    expect(transition('written', 'armed', KNOWN).ok).toBe(true);
  });
});

describe('unknown-reading predicate (one predicate for null, absent, and 0)', () => {
  it('331-01/AC-3: null, absent (undefined), and 0 all classify as unknown; 7 classifies as known', () => {
    expect(isUnknownReading(null)).toBe(true);
    expect(isUnknownReading(undefined)).toBe(true);
    expect(isUnknownReading(0)).toBe(true);
    expect(isUnknownReading(7)).toBe(false);
    expect(isUnknownReading(42)).toBe(false);
    expect(isUnknownReading(100)).toBe(false);
  });

  it('331-01/AC-3: the predicate takes no machine state — 0 is unknown whether the state is idle, settled, or reset', () => {
    // The predicate's signature is the reading alone; there is no state to
    // condition on. Pin that structurally, then pin the classification for
    // each prior state the AC names (0.4a's post-/compact reading).
    expect(isUnknownReading.length).toBe(1);
    for (const priorState of ['idle', 'settled', 'reset'] as const) {
      expect(CHECKPOINT_STATES).toContain(priorState);
      expect(isUnknownReading(0), `0 after ${priorState}`).toBe(true);
      expect(isUnknownReading(null), `null after ${priorState}`).toBe(true);
      expect(isUnknownReading(undefined), `absent after ${priorState}`).toBe(true);
    }
  });

  it('331-01/AC-3: non-finite and negative readings are not known readings', () => {
    expect(isUnknownReading(Number.NaN)).toBe(true);
    expect(isUnknownReading(-5)).toBe(true);
    expect(isUnknownReading(Number.POSITIVE_INFINITY)).toBe(true);
  });
});

describe('idle -> armed requires a known reading', () => {
  const unknownCases: ReadonlyArray<readonly [string, Parameters<typeof transition>[2]]> = [
    ['used_percentage null', { reading: { used_percentage: null } }],
    ['used_percentage absent', { reading: {} }],
    ['used_percentage 0', { reading: { used_percentage: 0 } }],
    ['ctx without a reading', {}],
  ];

  it('331-01/AC-3: idle -> armed is rejected for a null, absent, or 0 reading with a reason naming the unknown reading and both states', () => {
    for (const [label, ctx] of unknownCases) {
      const result = transition('idle', 'armed', ctx);
      expect(result.ok, label).toBe(false);
      if (!result.ok) {
        expect(result.reason, label).toMatch(/unknown reading/);
        expect(result.reason, label).toContain('idle -> armed');
        expect(result.reason).not.toContain('\n');
      }
    }
  });

  it('331-01/AC-3: idle -> armed is rejected when no reading context is passed at all', () => {
    const result = transition('idle', 'armed');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/unknown reading/);
      expect(result.reason).toContain('idle -> armed');
    }
  });

  it('331-01/AC-3: idle -> armed is accepted with a known reading such as 7', () => {
    expect(transition('idle', 'armed', { reading: { used_percentage: 7 } })).toEqual({ ok: true, state: 'armed' });
  });

  it('331-01/AC-3: a 0 reading after a settled -> reset -> resumed -> idle walk still cannot arm', () => {
    // Walk the legal path out of settled/reset (none of these edges consult
    // the reading), then attempt to arm with the post-reset 0 reading.
    const zero = { reading: { used_percentage: 0 } };
    expect(transition('settled', 'reset', zero)).toEqual({ ok: true, state: 'reset' });
    expect(transition('reset', 'resumed', zero)).toEqual({ ok: true, state: 'resumed' });
    expect(transition('resumed', 'idle', zero)).toEqual({ ok: true, state: 'idle' });
    const arm = transition('idle', 'armed', zero);
    expect(arm.ok).toBe(false);
    if (!arm.ok) expect(arm.reason).toMatch(/unknown reading/);
  });

  it('331-01/AC-3: only idle -> armed consults the reading; other legal edges accept with no ctx', () => {
    expect(transition('armed', 'written')).toEqual({ ok: true, state: 'written' });
    expect(transition('written', 'armed')).toEqual({ ok: true, state: 'armed' });
    expect(transition('settled', 'reset')).toEqual({ ok: true, state: 'reset' });
  });
});
