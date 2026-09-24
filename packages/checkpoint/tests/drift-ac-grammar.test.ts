import { describe, expect, it } from 'vitest';
// Test-only relative SOURCE imports, not package imports: core and types are
// devDependencies of checkpoint purely so turbo builds them first, and phase
// 316's boundaries forbid adding public exports to either package. Importing
// source by path pins checkpoint against the exact grammar core and types
// ship, without widening their public surface.
import { parseDraftMd } from '../../core/src/parse/draft-parser.js';
import { CadenceError } from '../../core/src/errors.js';
import { AcceptanceCriterionZ } from '../../types/src/plan.js';
import { validate } from '../src/validate.js';

/**
 * AC-id grammar drift test (phase 316, AC-5).
 *
 * One shared corpus of AC-id texts, each run through three grammars:
 *   a. core's parseDraftMd() as `### AC-<entry>: name` (reject = throws
 *      CadenceError COHERENCE_FAILED);
 *   b. types' AcceptanceCriterionZ id schema (reject = safeParse fails);
 *   c. checkpoint's validate() as `- AC-<entry>: text` under
 *      "Acceptance criteria touched" (reject = a named AC_* diagnostic
 *      pointing at that bullet's line — never a silent skip).
 *
 * Each entry is the raw, untrimmed text between the `AC-` prefix and the `:`
 * separator, and every leg is built from that same text by one template.
 * Leg (b) is fed `AC-<entry>` because core stores the full `AC-N` string as
 * the criterion id (`id = head[1]` from `(AC-\d+)`), so that is the shape the
 * schema validates. For the `'1 '` entry (space before the colon) Zod is fed
 * `"AC-1 "`, not a trimmed `"AC-1"`: the id token is whatever sits before the
 * separator, and trimming it would compare a separator-format rule (which Zod
 * never sees — it has no colon) rather than id grammar.
 *
 * Duplicate-id detection is deliberately OUT OF SCOPE here. Duplication is a
 * property of the whole list (every id checked against every other), not of a
 * single id's grammar, and core's parseDraftMd has no duplicate-AC-id check
 * at all — so there is nothing on the core side to pin checkpoint's
 * AC_ID_DUPLICATE against.
 */

type Verdict = 'accept' | 'reject';

const CORPUS: readonly { entry: string; expected: Verdict }[] = [
  { entry: '1', expected: 'accept' },
  { entry: '12', expected: 'accept' },
  { entry: '01', expected: 'accept' },
  { entry: '1a', expected: 'reject' },
  { entry: 'a1', expected: 'reject' },
  { entry: '', expected: 'reject' }, // `AC-` with no digits
  { entry: '1 ', expected: 'reject' }, // `AC-1 :` — space before the colon
  // `AC-1**:` — a closing bold with no opening bold. Checkpoint's old regex had
  // two independent optional `**` groups and read this as id `1` (accepted)
  // while core and types both reject it.
  { entry: '1**', expected: 'reject' },
];

function draftWith(acBlock: string): string {
  return `---
phase: 01-foundation
id: 01-01
tier: standard
status: PENDING
---

# 01-01 — Demo

## Objective

Make widget glow.

## Acceptance Criteria

${acBlock}

## Tasks

### T1: Add glow flag
- files: \`src/widget.ts\`
- action: add boolean glow prop
- verify: vitest passes
- done: AC-1

## Boundaries

- Do not change \`src/legacy.ts\`
`;
}

function acHeading(entry: string): string {
  return `### AC-${entry}: Glows
Given widget exists
When user enables glow mode
Then widget emits photons`;
}

function coreVerdict(entry: string): Verdict {
  try {
    parseDraftMd(draftWith(acHeading(entry)));
    return 'accept';
  } catch (err) {
    // Only the malformed-AC refusal counts as a reject; any other throw is an
    // unrelated skeleton failure and must fail the test, not pose as a verdict.
    if (err instanceof CadenceError && err.code === 'COHERENCE_FAILED') return 'reject';
    throw err;
  }
}

function typesVerdict(entry: string): Verdict {
  return AcceptanceCriterionZ.shape.id.safeParse(`AC-${entry}`).success ? 'accept' : 'reject';
}

// An anchor bullet with a known-good id keeps the list non-empty, so a
// silently skipped corpus bullet cannot be masked by AC_LIST_EMPTY.
const ANCHOR = '- AC-999: anchor';

function checkpointDoc(entry: string): { doc: string; bulletLine: number } {
  const lines = [
    '# Session Handoff — drift test',
    '',
    '## TL;DR for the next session',
    '',
    'Summary.',
    '',
    '## State on handoff',
    '',
    '- Branch: `main`',
    '',
    '## CADENCE context',
    '',
    '- Active phase: none',
    '',
    '## Acceptance criteria touched',
    '',
    ANCHOR,
    `- AC-${entry}: text`,
    '',
    '## What landed this session',
    '',
    '- nothing',
    '',
    '## Carry-forward gotchas',
    '',
    '- none',
    '',
    '## Open decisions',
    '',
    'None',
    '',
    '## Next action',
    '',
    'Continue.',
    '',
  ];
  const bulletLine = lines.indexOf(`- AC-${entry}: text`) + 1;
  return { doc: lines.join('\n'), bulletLine };
}

function checkpointVerdict(entry: string): Verdict {
  const { doc, bulletLine } = checkpointDoc(entry);
  const result = validate(doc);
  if (result.ok) return 'accept';
  const named = result.diagnostics.some((d) => d.code.startsWith('AC_') && d.line === bulletLine);
  if (named) return 'reject';
  throw new Error(
    `checkpoint returned ok:false for "AC-${entry}" without an AC_* diagnostic on its bullet line: ` +
      JSON.stringify(result.diagnostics),
  );
}

describe('AC-id grammar drift: core parseDraftMd vs types AcceptanceCriterionZ vs checkpoint validate', () => {
  it('sanity: the anchor-only checkpoint doc validates clean, so any reject is attributable to the corpus bullet', () => {
    const { doc } = checkpointDoc('1');
    expect(validate(doc)).toEqual({ ok: true, diagnostics: [] });
  });

  it.each(CORPUS)(
    '316-01/AC-5: "AC-$entry:" — core, types, and checkpoint all return $expected',
    ({ entry, expected }) => {
      const verdicts = {
        core: coreVerdict(entry),
        types: typesVerdict(entry),
        checkpoint: checkpointVerdict(entry),
      };
      expect(verdicts).toEqual({ core: expected, types: expected, checkpoint: expected });
    },
  );

  it('316-01/AC-5: bullets checkpoint used to skip silently ("- AC-: x", "- AC-1 : x") now get a named AC_ID_MALFORMED diagnostic', () => {
    for (const entry of ['', '1 ']) {
      const { doc, bulletLine } = checkpointDoc(entry);
      expect(validate(doc).diagnostics).toEqual([
        expect.objectContaining({ code: 'AC_ID_MALFORMED', section: 'Acceptance criteria touched', line: bulletLine }),
      ]);
    }
  });

  it('316-01/AC-5: duplicate-id detection is out of scope for this drift test — a whole-list property, and core has no duplicate-AC check to pin against', () => {
    // Pins the reason, not just the decision: core parses a DRAFT carrying two
    // `### AC-1:` headings without complaint, so there is no core-side
    // duplicate rule for checkpoint's list-level AC_ID_DUPLICATE (covered in
    // validate.test.ts) to be compared against. If core ever grows one, this
    // assertion fails and duplicates should join the drift comparison.
    const draft = parseDraftMd(draftWith(`${acHeading('1')}\n\n${acHeading('1')}`));
    expect(draft.acceptanceCriteria.map((ac) => ac.id)).toEqual(['AC-1', 'AC-1']);
  });
});
