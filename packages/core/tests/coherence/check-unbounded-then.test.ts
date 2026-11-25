import { describe, it, expect } from 'vitest';
import { emptyState } from '@thomas-powers-jr/cadence-types';
import type { Draft } from '@thomas-powers-jr/cadence-types';
import { coherenceCheck, UNIVERSAL_AC_WORDS, findUniversalAcWords } from '../../src/coherence/check.js';
import { parseDraftMd } from '../../src/parse/draft-parser.js';
import { DRAFT_TEMPLATE_NAMES, renderDraftTemplateBody } from '../../src/parse/draft-templates.js';

function draftWithAcs(acs: Array<{ id: string; then: string }>): Draft {
  return {
    schemaVersion: 1 as const,
    id: '350-01',
    phase: '350-bounded-acs',
    tier: 'standard' as const,
    title: 'demo',
    objective: 'do thing',
    acceptanceCriteria: acs.map((a) => ({ id: a.id, given: 'x', when: 'y', then: a.then })),
    tasks: [],
    boundaries: [],
    status: 'PENDING' as const,
  };
}

const suffix = '; bound it with named example inputs and outputs, or move the boundary to a "Not covered:" line.';

describe('coherenceCheck UNBOUNDED_AC_THEN', () => {
  it('350-01/AC-1: exports the five universal words in order', () => {
    expect(UNIVERSAL_AC_WORDS).toEqual(['any', 'every', 'each', 'same', 'unchanged']);
  });

  it('350-01/AC-1: (a) "Every row stays unchanged" warns with "every", "unchanged"', () => {
    const result = coherenceCheck(draftWithAcs([{ id: 'AC-2', then: 'Every row stays unchanged' }]), emptyState(), '');
    expect(result.issues).toEqual([
      {
        severity: 'warn',
        code: 'UNBOUNDED_AC_THEN',
        message:
          'AC-2\'s Then-text uses universal word(s) "every", "unchanged"; bound it with named example inputs and outputs, or move the boundary to a "Not covered:" line.',
      },
    ]);
  });

  it('350-01/AC-1: (b) "Each row" warns with "each"', () => {
    const result = coherenceCheck(draftWithAcs([{ id: 'AC-2', then: 'Each row' }]), emptyState(), '');
    expect(result.issues).toEqual([
      {
        severity: 'warn',
        code: 'UNBOUNDED_AC_THEN',
        message:
          'AC-2\'s Then-text uses universal word(s) "each"; bound it with named example inputs and outputs, or move the boundary to a "Not covered:" line.',
      },
    ]);
  });

  it('350-01/AC-1: (c) "same-day rows" warns with "same"', () => {
    const result = coherenceCheck(draftWithAcs([{ id: 'AC-2', then: 'same-day rows' }]), emptyState(), '');
    expect(result.issues).toEqual([
      {
        severity: 'warn',
        code: 'UNBOUNDED_AC_THEN',
        message:
          'AC-2\'s Then-text uses universal word(s) "same"; bound it with named example inputs and outputs, or move the boundary to a "Not covered:" line.',
      },
    ]);
  });

  it('350-01/AC-2: bounded Then-texts and stop lines produce no issues', () => {
    const draft = draftWithAcs([
      { id: 'AC-1', then: 'the row reads hooksObserved: false\nNot covered: every other row' },
      { id: 'AC-2', then: 'the tally counts anything recorded and its sameness' },
      { id: 'AC-3', then: 'the row is kept\n  not covered: each row' },
      { id: 'AC-4', then: 'the message names T1, T2' },
    ]);
    expect(coherenceCheck(draft, emptyState(), '').issues).toEqual([]);
  });

  it('350-01/AC-1: two warning ACs yield two issues in AC order', () => {
    const draft = draftWithAcs([
      { id: 'AC-1', then: 'any `Same` value' },
      { id: 'AC-2', then: 'the row is kept' },
      { id: 'AC-3', then: "each's row" },
    ]);
    expect(coherenceCheck(draft, emptyState(), '').issues).toEqual([
      {
        severity: 'warn',
        code: 'UNBOUNDED_AC_THEN',
        message: `AC-1's Then-text uses universal word(s) "any", "same"${suffix}`,
      },
      {
        severity: 'warn',
        code: 'UNBOUNDED_AC_THEN',
        message: `AC-3's Then-text uses universal word(s) "each"${suffix}`,
      },
    ]);
  });

  it('350-01/AC-1: helper dedupes, lowercases, and stops at a tab-indented stop line', () => {
    expect(findUniversalAcWords('EACH any Each\n\tNOT COVERED: every')).toEqual(['each', 'any']);
  });

  it('350-01/AC-2: a "- Not covered:" line does not stop the scan, and a lone CR is a line break', () => {
    expect(findUniversalAcWords('- Not covered: every')).toEqual(['every']);
    expect(findUniversalAcWords('the row\rNot covered: each row')).toEqual([]);
  });

  it('350-01/AC-1: a word is a maximal run of ASCII letters, so underscores, digits and non-ASCII letters separate words', () => {
    expect(findUniversalAcWords('any_thing each2 éevery sameñ')).toEqual(['any', 'each', 'every', 'same']);
    expect(findUniversalAcWords('anything sameness everyone')).toEqual([]);
  });

  it('350-01/AC-2: the scan stops at the first stop line, so universal words on later lines are not read', () => {
    expect(findUniversalAcWords('the row is kept\nNot covered: x\nevery row\nNot covered: y')).toEqual([]);
    const draft = draftWithAcs([{ id: 'AC-1', then: 'the row is kept\nNot covered: x\nevery row' }]);
    expect(coherenceCheck(draft, emptyState(), '').issues).toEqual([]);
  });

  it('350-01/AC-3: bugfix, feature and refactor templates produce no UNBOUNDED_AC_THEN warning', () => {
    for (const template of DRAFT_TEMPLATE_NAMES) {
      const md = renderDraftTemplateBody(template, '01-foundation', '01-01', 'standard', 'widget');
      const draft = parseDraftMd(md);
      expect(draft.acceptanceCriteria.length).toBe(3);
      const codes = coherenceCheck(draft, emptyState(), '').issues.map((i) => i.code);
      expect({ template, codes: codes.filter((c) => c === 'UNBOUNDED_AC_THEN') }).toEqual({ template, codes: [] });
    }
  });
});
