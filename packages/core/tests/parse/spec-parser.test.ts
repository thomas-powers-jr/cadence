import { describe, it, expect } from 'vitest';
import { parseSpecMd } from '../../src/parse/spec-parser.js';
import { CadenceError } from '../../src/errors.js';

const SPEC = `---
phase: 36-x
id: 36-01
status: PENDING
---

# 36-01 — t

## Objective

Build the thing.

## Acceptance Criteria

### AC-1: a
Given g
When w
Then t

## Constraints

- no new deps
- host-agnostic

## Open Questions

- which provider default?
`;

describe('parseSpecMd (AC-2)', () => {
  it('AC-2: parses objective/AC/constraints/openQuestions', () => {
    const s = parseSpecMd(SPEC);
    expect(s.objective).toBe('Build the thing.');
    expect(s.acceptanceCriteria).toEqual([{ id: 'AC-1', name: 'a', given: 'g', when: 'w', then: 't' }]);
    expect(s.constraints).toEqual(['no new deps', 'host-agnostic']);
    expect(s.openQuestions).toEqual(['which provider default?']);
    expect(s.status).toBe('PENDING');
    expect(s.id).toBe('36-01');
    expect(s.phase).toBe('36-x');
  });
  it('AC-2: absent optional sections → []', () => {
    const bare = `---
phase: 36-x
id: 36-01
status: PENDING
---

# 36-01 — t

## Objective

O

## Acceptance Criteria

### AC-1: a
Given g
When w
Then t
`;
    const s = parseSpecMd(bare);
    expect(s.constraints).toEqual([]);
    expect(s.openQuestions).toEqual([]);
  });
});

// Phase 157 (AC-1, AC-2, AC-4) — rec-20260704-002: multi-line Objective/AC
// clauses were silently truncated to their first line.
describe('parseSpecMd multi-line preservation (Phase 157)', () => {
  it('AC-1: preserves a multi-line Objective in full', () => {
    const spec = `---
phase: 36-x
id: 36-01
status: PENDING
---

# 36-01 — t

## Objective

Build the thing correctly.
It must also handle the edge case
where input spans multiple sentences.

## Acceptance Criteria

### AC-1: a
Given g
When w
Then t
`;
    const s = parseSpecMd(spec);
    expect(s.objective).toBe(
      'Build the thing correctly.\nIt must also handle the edge case\nwhere input spans multiple sentences.',
    );
  });

  it('AC-2: preserves multi-line Given/When/Then clauses', () => {
    const spec = `---
phase: 36-x
id: 36-01
status: PENDING
---

# 36-01 — t

## Objective

Build the thing.

## Acceptance Criteria

### AC-1: a
Given a precondition that spans
more than one line of prose
When an action happens
across two lines too
Then the outcome is observed
on its own wrapped second line
`;
    const s = parseSpecMd(spec);
    expect(s.acceptanceCriteria).toEqual([
      {
        id: 'AC-1',
        name: 'a',
        given: 'a precondition that spans\nmore than one line of prose',
        when: 'an action happens\nacross two lines too',
        then: 'the outcome is observed\non its own wrapped second line',
      },
    ]);
  });

  it('AC-2: a wrapped clause stops at the next label, not mid-clause', () => {
    const spec = `---
phase: 36-x
id: 36-01
status: PENDING
---

# 36-01 — t

## Objective

Build the thing.

## Acceptance Criteria

### AC-1: a
Given g1
g2
When w1
w2
Then t1
t2

### AC-2: b
Given g
When w
Then t
`;
    const s = parseSpecMd(spec);
    expect(s.acceptanceCriteria).toEqual([
      { id: 'AC-1', name: 'a', given: 'g1\ng2', when: 'w1\nw2', then: 't1\nt2' },
      { id: 'AC-2', name: 'b', given: 'g', when: 'w', then: 't' },
    ]);
  });

  it('AC-4: existing single-line Objective/AC output is byte-identical', () => {
    const s = parseSpecMd(SPEC);
    expect(s.objective).toBe('Build the thing.');
    expect(s.acceptanceCriteria).toEqual([{ id: 'AC-1', name: 'a', given: 'g', when: 'w', then: 't' }]);
  });
});

// Phase 339 (rec-20260918-007) — a SPEC.md saved with CRLF, a UTF-8 BOM or
// lone-CR endings failed with "missing frontmatter"; every encoding must parse
// to the same Spec as its LF form.
const BOM = '\uFEFF';

const ENCODINGS: ReadonlyArray<readonly [string, (lf: string) => string]> = [
  ['BOM+LF', (lf) => BOM + lf],
  ['BOM+CRLF', (lf) => BOM + lf.replace(/\n/g, '\r\n')],
  ['CRLF', (lf) => lf.replace(/\n/g, '\r\n')],
  ['lone-CR', (lf) => lf.replace(/\n/g, '\r')],
];

/** Every string reachable from `v`, so no parsed field escapes the \r/BOM check. */
function collectStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(collectStrings);
  if (v !== null && typeof v === 'object') return Object.values(v).flatMap(collectStrings);
  return [];
}

const RICH_SPEC = `---
phase: 36-x
id: 36-01
status: APPROVED
---

# 36-01 — encoding-tolerant spec

## Objective

Build the thing.
Across two lines.

## Acceptance Criteria

### AC-1: wrapped
Given a precondition that spans
more than one line
When an action happens
Then an outcome follows

### AC-2: plain
Given g
When w
Then t

## Constraints

- no new deps

## Open Questions

- which provider default?
`;

describe('parseSpecMd BOM / CRLF / lone-CR tolerance (phase 339)', () => {
  const lfResult = parseSpecMd(RICH_SPEC);

  it('phase 339 fixture precondition: the LF fixture itself has two ACs, one multi-line', () => {
    expect(lfResult.acceptanceCriteria).toHaveLength(2);
    expect(lfResult.acceptanceCriteria[0]!.given).toContain('\n');
  });

  for (const [label, encode] of ENCODINGS) {
    it(`339-01/AC-3: a ${label} SPEC.md parses to the same Spec as its LF form, with no \\r or BOM in any string`, () => {
      const result = parseSpecMd(encode(RICH_SPEC));
      expect(result).toEqual(lfResult);
      expect(result.acceptanceCriteria.length).toBeGreaterThan(0);
      for (const s of collectStrings(result)) {
        expect(s).not.toContain('\r');
        expect(s).not.toContain(BOM);
      }
    });

    it(`339-01/AC-3: a ${label} SPEC.md with no frontmatter still throws the existing CadenceError`, () => {
      const noFrontmatter = RICH_SPEC.replace(/^---\n[\s\S]*?\n---\n/, '');
      let caught: unknown;
      try {
        parseSpecMd(encode(noFrontmatter));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CadenceError);
      expect((caught as Error).message).toBe('SPEC.md missing frontmatter');
    });
  }
});
