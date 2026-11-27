import { describe, it, expect } from 'vitest';
import { emptyState } from '@thomas-powers-jr/cadence-types';
import { coherenceCheck, UNIVERSAL_AC_WORDS } from '../../src/coherence/check.js';
import { parseDraftMd } from '../../src/parse/draft-parser.js';

// Phase 354 (354-01, T2): the UNBOUNDED_AC_THEN scan reads the Then-text the
// parser captures, so a heading holding the Then label no longer pulls the
// Given clause into the scanned text (rec-20261124-001).
describe('UNBOUNDED_AC_THEN with the Then label in the heading (phase 354)', () => {
  it('354-01/AC-5: a universal word in the Given clause raises no UNBOUNDED_AC_THEN issue', () => {
    const w = UNIVERSAL_AC_WORDS[1];
    const md = [
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
      '### AC-1: no universal word in a Then clause',
      `Given ${w} input`,
      'When it runs',
      'Then it returns 1.',
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
    const issues = coherenceCheck(parseDraftMd(md), emptyState(), '').issues;
    expect(issues.filter((i) => i.code === 'UNBOUNDED_AC_THEN')).toStrictEqual([]);
  });
});
