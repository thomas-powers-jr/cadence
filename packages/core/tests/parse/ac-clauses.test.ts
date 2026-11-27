import { describe, it, expect } from 'vitest';
import { parseAcClauses } from '../../src/parse/ac-clauses.js';

// Phase 354 (354-01, T1): the clause rule. The heading line is never
// searched; Given, When and Then are found in that order, each preferring a
// line-start label and falling back to an inline one (rec-20261124-001).
describe('parseAcClauses (phase 354)', () => {
  it('354-01/AC-1: (a) a heading containing the Then label does not start the Then-text', () => {
    expect(parseAcClauses('### AC-1: words in a Then clause\nGiven g\nWhen w\nThen t')).toStrictEqual({
      given: 'g',
      when: 'w',
      then: 't',
    });
  });

  it('354-01/AC-1: (b) an inline Then label inside the Given text does not start the Then-text', () => {
    expect(parseAcClauses('### AC-1: x\nGiven a list. Then more\nWhen w\nThen t')).toStrictEqual({
      given: 'a list. Then more',
      when: 'w',
      then: 't',
    });
  });

  it('354-01/AC-1: (c) a one-line AC keeps the legacy capture', () => {
    expect(parseAcClauses('### AC-1: x\nGiven g, When w, Then t.')).toStrictEqual({
      given: 'g, When w, Then t.',
      when: 'w, Then t.',
      then: 't.',
    });
  });

  it('354-01/AC-1: (d) labels only in the heading leave When and Then empty', () => {
    expect(parseAcClauses('### AC-1: When and Then\nGiven g')).toStrictEqual({ given: 'g', when: '', then: '' });
  });
});
