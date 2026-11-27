import { describe, it, expect } from 'vitest';
import { parseDraftMd } from '../../src/parse/draft-parser.js';
import { parseSpecMd } from '../../src/parse/spec-parser.js';
import { addAcceptanceCriterion } from '../../src/parse/draft-mutate.js';

// Phase 354 (354-01, T2): parseDraftMd and parseSpecMd capture AC clauses by
// the clause rule, so a heading containing the Then label no longer starts
// the Then-text (rec-20261124-001).

const BLOCK_A = '### AC-1: words in a Then clause\nGiven g\nWhen w\nThen t';
const EXPECTED_A = { id: 'AC-1', name: 'words in a Then clause', given: 'g', when: 'w', then: 't' };

function draftWith(acSection: string): string {
  return [
    '---',
    'phase: 354-x',
    'id: 354-01',
    'tier: standard',
    'status: PENDING',
    '---',
    '',
    '# 354-01 — x',
    '',
    '## Objective',
    '',
    'o',
    '',
    '## Acceptance Criteria',
    '',
    acSection,
    '',
    '## Tasks',
    '',
    '### T1: t',
    '- files: `a.ts`',
    '- action: a',
    '- verify: v',
    '- done: AC-1',
    '',
    '## Boundaries',
    '',
    '- none',
    '',
  ].join('\n');
}

const SPEC = [
  '---',
  'phase: 354-x',
  'id: 354-01',
  'status: PENDING',
  '---',
  '',
  '# 354-01 — x',
  '',
  '## Objective',
  '',
  'o',
  '',
  '## Acceptance Criteria',
  '',
  BLOCK_A,
  '',
  '## Constraints',
  '',
  '- none',
  '',
].join('\n');

describe('AC clause capture in the parsers (phase 354)', () => {
  it('354-01/AC-2: parseDraftMd reads example block (a) by the clause rule', () => {
    expect(parseDraftMd(draftWith(BLOCK_A)).acceptanceCriteria[0]).toStrictEqual(EXPECTED_A);
  });

  it('354-01/AC-2: parseSpecMd reads example block (a) by the clause rule', () => {
    expect(parseSpecMd(SPEC).acceptanceCriteria[0]).toStrictEqual(EXPECTED_A);
  });

  it('354-01/AC-2: a BOM-and-CRLF copy of the DRAFT reads the same AC', () => {
    const bomCrlf = '\uFEFF' + draftWith(BLOCK_A).replace(/\n/g, '\r\n');
    expect(parseDraftMd(bomCrlf).acceptanceCriteria[0]).toStrictEqual(EXPECTED_A);
  });

  it('354-01/AC-3: an AC added with a name holding the Then label round-trips', () => {
    const out = addAcceptanceCriterion(draftWith('### AC-1: a\nGiven g\nWhen w\nThen t'), {
      name: 'words in a Then clause',
      given: 'g2',
      when: 'w2',
      then: 't2',
    });
    expect(parseDraftMd(out).acceptanceCriteria[1]).toStrictEqual({
      id: 'AC-2',
      name: 'words in a Then clause',
      given: 'g2',
      when: 'w2',
      then: 't2',
    });
  });
});
