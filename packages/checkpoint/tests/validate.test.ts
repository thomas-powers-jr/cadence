import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REQUIRED_SECTIONS_V1,
  REQUIRED_SECTIONS_V2,
  SECTIONS_V1,
  SECTIONS_V2,
  extractHeaderLabels,
  validate,
} from '../src/validate.js';

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

function fixtureBuffer(name: string): Buffer {
  return readFileSync(join(__dirname, 'fixtures', name));
}

describe('validate', () => {
  it('accepts a well-formed handoff', () => {
    const result = validate(fixture('valid.md'));
    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it('accepts bold and asterisk AC bullet formats', () => {
    const result = validate(fixture('ac-bold-bullet.md'));
    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it('does not treat ## inside a fenced code block as a section header', () => {
    const result = validate(fixture('fenced-code-with-hashes.md'));
    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it('does not let a differently-marked nested fence (~~~ inside ```) close the outer fence early', () => {
    const result = validate(fixture('fenced-mismatched-markers.md'));
    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it('does not let a same-char marker with an info string (```typescript) close the outer fence early', () => {
    const result = validate(fixture('fenced-info-string-closer.md'));
    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it('strips the real generator\'s decorated header suffix (" · ...") before matching', () => {
    const result = validate(fixture('decorated-headers.md'));
    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it('handles a header line with excess trailing/internal whitespace without a ReDoS-prone regex (CodeQL js/polynomial-redos)', () => {
    // The original `/^##\s+(.+?)\s*$/` had an overlapping-quantifier shape
    // CodeQL flagged as polynomial-time on adversarial input. Rewritten to
    // a single greedy \s+ then .* to end-of-line, with trimEnd() in code.
    // This pins the resulting behavior: trailing whitespace after a header
    // label is still stripped, on both a very long run and a normal case.
    const longRun = ' '.repeat(20000);
    const result = validate(`# doc\n\n## TL;DR for the next session${longRun}\n\nbody\n`);
    expect(result.diagnostics.some((d) => d.code === 'SECTION_MISSING' && d.section === 'TL;DR for the next session')).toBe(false);
  });

  it('treats CRLF line endings the same as LF for section/line-number parsing', () => {
    const lf = fixture('valid.md');
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(validate(crlf)).toEqual(validate(lf));
    expect(validate(crlf)).toEqual({ ok: true, diagnostics: [] });
  });

  it.each([
    ['missing-section-tldr.md', 'TL;DR for the next session'],
    ['missing-section-state.md', 'State on handoff'],
    ['missing-section-cadence-context.md', 'CADENCE context'],
    ['missing-section-landed.md', 'What landed this session'],
    ['missing-section-gotchas.md', 'Carry-forward gotchas'],
    ['missing-section-decisions.md', 'Open decisions'],
    ['missing-section-next.md', 'Next action'],
  ])('reports exactly one SECTION_MISSING for %s', (file, sectionName) => {
    const result = validate(fixture(file));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'SECTION_MISSING', section: sectionName }),
    ]);
  });

  it('316-01/AC-6: missing-section-ac.md is now valid, because "Acceptance criteria touched" is optional', () => {
    // Before phase 316 this fixture reported SECTION_MISSING [Acceptance
    // criteria touched]; it is the one pre-existing fixture whose outcome
    // the version-gated schema deliberately changes.
    const result = validate(fixture('missing-section-ac.md'));
    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it('reports exactly one AC_ID_NON_NUMERIC for a letter-prefixed AC id', () => {
    const result = validate(fixture('ac-letter-prefixed.md'));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'AC_ID_NON_NUMERIC' })]);
  });

  it('reports exactly one AC_ID_DUPLICATE for a repeated AC id', () => {
    const result = validate(fixture('ac-duplicate.md'));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'AC_ID_DUPLICATE' })]);
  });

  it('reports exactly one AC_LIST_EMPTY for zero acceptance criteria', () => {
    const result = validate(fixture('ac-empty.md'));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'AC_LIST_EMPTY' })]);
  });

  describe('AC_ID_MALFORMED (phase 316, AC-5)', () => {
    const withAcBullets = (bullets: string): string =>
      fixture('valid.md').replace('- AC-1: done\n- AC-2: done\n', bullets);
    const acSection = (bullets: string): number =>
      withAcBullets(bullets).split('\n').indexOf('## Acceptance criteria touched') + 1;

    it('316-01/AC-5: flags an AC-looking bullet the id regex cannot read, on its own line, instead of skipping it', () => {
      for (const bad of ['- AC-: x', '- AC-1 : x', '- **AC-: x', '* AC-1 x', '- AC-1**: x', '- **AC-1: x']) {
        const doc = withAcBullets(`- AC-1: done\n${bad}\n`);
        expect(validate(doc).diagnostics).toEqual([
          {
            code: 'AC_ID_MALFORMED',
            section: 'Acceptance criteria touched',
            line: acSection(`- AC-1: done\n${bad}\n`) + 3,
            message: `AC bullet "${bad}" does not match the form "- AC-<number>: <text>".`,
          },
        ]);
      }
    });

    it('316-01/AC-5: bold is a matched pair — "**AC-1**:" and "**AC-1:**" are read, a lone closing "AC-1**:" is AC_ID_MALFORMED only', () => {
      expect(validate(withAcBullets('- **AC-1**: x\n- **AC-2:** y\n'))).toEqual({ ok: true, diagnostics: [] });
      expect(validate(withAcBullets('- AC-1**: x\n')).diagnostics.map((d) => d.code)).toEqual(['AC_ID_MALFORMED']);
    });

    it('316-01/AC-5: a section holding only malformed AC bullets reports AC_ID_MALFORMED, not also AC_LIST_EMPTY', () => {
      const result = validate(withAcBullets('- AC-: x\n'));
      expect(result.diagnostics.map((d) => d.code)).toEqual(['AC_ID_MALFORMED']);
    });

    it('316-01/AC-5: a bullet the id regex reads but that is non-numeric gets only AC_ID_NON_NUMERIC, never also AC_ID_MALFORMED', () => {
      for (const bullet of ['- AC-1a: x', '- AC-K1: x', '- **AC-a1**: x']) {
        const result = validate(withAcBullets(`${bullet}\n`));
        expect(result.diagnostics.map((d) => d.code)).toEqual(['AC_ID_NON_NUMERIC']);
      }
    });

    it('316-01/AC-5: bullets that do not open with AC- (prose mentioning an AC) are not AC entries and are not flagged', () => {
      const result = validate(withAcBullets('- AC-1: done\n- see AC-2 for context\n- note: AC- ids are numeric\n'));
      expect(result).toEqual({ ok: true, diagnostics: [] });
    });
  });

  it('reports MEASURED_CONTEXT_MISSING_COMMAND only for the bare-percentage line, not the whole section', () => {
    const result = validate(fixture('measured-context-no-command.md'));
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'MEASURED_CONTEXT_MISSING_COMMAND', message: expect.stringContaining('42%') }),
    ]);
  });

  it('does not flag a measured percentage that already has a producing command attached', () => {
    const result = validate(fixture('measured-context-with-command.md'));
    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it('still flags a measured percentage when a command keyword sits outside the code span', () => {
    const result = validate(fixture('measured-context-command-outside-span.md'));
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'MEASURED_CONTEXT_MISSING_COMMAND', message: expect.stringContaining('42%') }),
    ]);
  });

  it('reports exactly one OPEN_DECISIONS_EMPTY_NOT_EXPLICIT for an empty section with no None', () => {
    const result = validate(fixture('open-decisions-empty.md'));
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'OPEN_DECISIONS_EMPTY_NOT_EXPLICIT' }),
    ]);
  });

  it('reports RESUME_CORE_OVER_BUDGET with the actual measured length', () => {
    const result = validate(fixture('resume-core-over-budget.md'));
    // 10267 is the real measured length of this fixture's TL;DR + Next action
    // content (10191-char generated filler + surrounding fixture text) — a
    // regex like /\d+/ would pass even if the computed length were wrong,
    // since every over-budget message also contains the literal "10000"
    // budget constant.
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'RESUME_CORE_OVER_BUDGET', message: expect.stringContaining('is 10267 characters') }),
    ]);
  });

  it('reports EMPTY_FILE for a zero-byte input', () => {
    const result = validate(fixture('empty.md'));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'EMPTY_FILE' })]);
  });

  it('reports NON_UTF8_INPUT for genuinely malformed bytes, without throwing', () => {
    const buf = fixtureBuffer('non-utf8.md');
    expect(() => validate(buf)).not.toThrow();
    const result = validate(buf);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'NON_UTF8_INPUT' })]);
  });

  it('does not flag a string that legitimately contains a literal U+FFFD replacement character', () => {
    // Only Buffer input goes through byte-level UTF-8 validation. A string
    // has already been decoded by its caller, so a literal "�" character in
    // it is just text — it must not be conflated with a decode failure.
    const result = validate(fixture('literal-replacement-char.md'));
    expect(result.diagnostics.some((d) => d.code === 'NON_UTF8_INPUT')).toBe(false);
  });

  it('reports exactly one SECTION_OUT_OF_ORDER when all sections are present but reordered', () => {
    const result = validate(fixture('header-order-swapped.md'));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'SECTION_OUT_OF_ORDER' })]);
  });

  it('reports exactly one SECTION_HEADER_MISMATCH for a wrong-case header, distinct from SECTION_MISSING', () => {
    const result = validate(fixture('header-case-mismatch.md'));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'SECTION_HEADER_MISMATCH' })]);
  });

  it('never emits a non-UTF-8/empty diagnostic for well-formed UTF-8 content with no other issues', () => {
    const result = validate(fixture('valid.md'));
    expect(result.diagnostics.some((d) => d.code === 'NON_UTF8_INPUT' || d.code === 'EMPTY_FILE')).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Version-gated section schema (phase 316, AC-2)
// ---------------------------------------------------------------------------

const V1_REQUIRED = [
  'TL;DR for the next session',
  'State on handoff',
  'CADENCE context',
  'What landed this session',
  'Carry-forward gotchas',
  'Next action',
];

const V2_REQUIRED = [
  'TL;DR for the next session',
  'State on handoff',
  'CADENCE context',
  'What landed this session',
  'Carry-forward gotchas',
  'Open decisions',
  'Next action',
];

const AC_BLOCK = '## Acceptance criteria touched\n\n- AC-1: done\n- AC-2: done\n\n';
const OPEN_DECISIONS_BLOCK = '## Open decisions\n\nNone\n\n';

/** Insert `block` immediately before the `## <before>` header line. */
function insertBefore(doc: string, before: string, block: string): string {
  const marker = `## ${before}`;
  const idx = doc.indexOf(marker);
  if (idx === -1) throw new Error(`test helper: header "${marker}" not found`);
  return doc.slice(0, idx) + block + doc.slice(idx);
}

/** Remove the `## <name>` section (header line through the line before the next `## ` header). */
function dropSection(doc: string, name: string): string {
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## ${name}`));
  if (start === -1) throw new Error(`test helper: section "${name}" not found`);
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end === -1) end = lines.length;
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

function stripFrontmatter(doc: string): string {
  const lines = doc.split('\n');
  const close = lines.indexOf('---', 1);
  return lines.slice(close + 1).join('\n');
}

function dropVersionKey(doc: string): string {
  return doc.replace(/^cadence_handoff:.*\n/m, '');
}

function setVersion(doc: string, value: string): string {
  return doc.replace(/^cadence_handoff:.*$/m, `cadence_handoff:${value === '' ? '' : ` ${value}`}`);
}

function codes(doc: string): [string, string | undefined][] {
  return validate(doc).diagnostics.map((d) => [d.code, d.section]);
}

describe('version-gated section schema', () => {
  const v1 = (): string => fixture('version-1-six-sections.md');
  const v2Missing = (): string => fixture('version-2-missing-open-decisions.md');
  const v2Valid = (): string => insertBefore(v2Missing(), 'Next action', OPEN_DECISIONS_BLOCK);

  it('316-01/AC-1 (real v1 half): the tracked 2026-09-22 SESSION doc, copied verbatim, validates clean', () => {
    expect(validate(fixture('real-v1-session-2026-09-22.md'))).toEqual({ ok: true, diagnostics: [] });
    expect(validate(fixtureBuffer('real-v1-session-2026-09-22.md'))).toEqual({ ok: true, diagnostics: [] });
  });

  it('316-01/AC-2: exports ordered per-version section specs whose required lists are the six v1 sections and six-plus-Open-decisions for v2', () => {
    expect(REQUIRED_SECTIONS_V1).toEqual(V1_REQUIRED);
    expect(REQUIRED_SECTIONS_V2).toEqual(V2_REQUIRED);
    expect(SECTIONS_V1.filter((s) => s.required).map((s) => s.name)).toEqual(V1_REQUIRED);
    expect(SECTIONS_V2.filter((s) => s.required).map((s) => s.name)).toEqual(V2_REQUIRED);
    // "Acceptance criteria touched" is optional in both, and keeps its slot
    // between "CADENCE context" and "What landed this session".
    for (const spec of [SECTIONS_V1, SECTIONS_V2]) {
      const names = spec.map((s) => s.name);
      const ac = spec.find((s) => s.name === 'Acceptance criteria touched');
      expect(ac).toEqual({ name: 'Acceptance criteria touched', required: false });
      expect(names.indexOf('Acceptance criteria touched')).toBe(names.indexOf('CADENCE context') + 1);
      expect(names.indexOf('What landed this session')).toBe(names.indexOf('Acceptance criteria touched') + 1);
    }
    // Open decisions sits between Carry-forward gotchas and Next action in v2.
    const v2Names = SECTIONS_V2.map((s) => s.name);
    expect(v2Names.indexOf('Open decisions')).toBe(v2Names.indexOf('Carry-forward gotchas') + 1);
    expect(v2Names.indexOf('Next action')).toBe(v2Names.indexOf('Open decisions') + 1);
    expect(SECTIONS_V1.map((s) => s.name)).not.toContain('Open decisions');
  });

  it('316-01/AC-2: extractHeaderLabels is fence-aware, frontmatter-aware, and strips " · " decoration', () => {
    const doc = [
      '---',
      'cadence_handoff: 2',
      '## a YAML comment, not a header',
      '---',
      '',
      '## State on handoff   ·  pre-filled — verify',
      '```md',
      '## fenced, not a header',
      '```',
      '## Next action',
    ].join('\n');
    expect(extractHeaderLabels(doc)).toEqual(['State on handoff', 'Next action']);
    expect(extractHeaderLabels(fixture('real-v1-session-2026-09-22.md'))).toEqual(V1_REQUIRED);
  });

  it('316-01/AC-2: a cadence_handoff: 1 document with exactly the six v1 sections validates clean (no Open decisions needed)', () => {
    expect(validate(v1())).toEqual({ ok: true, diagnostics: [] });
  });

  it('316-01/AC-2: a CRLF-line-ended cadence_handoff: 1 document selects v1 exactly like its LF twin', () => {
    const crlf = v1().replace(/\n/g, '\r\n');
    expect(crlf).toContain('\r\n');
    expect(validate(crlf)).toEqual({ ok: true, diagnostics: [] });
    const crlfMissing = dropSection(v1(), 'Next action').replace(/\n/g, '\r\n');
    expect(validate(crlfMissing)).toEqual(validate(dropSection(v1(), 'Next action')));
    expect(codes(crlfMissing)).toEqual([['SECTION_MISSING', 'Next action']]);
  });

  it.each(V1_REQUIRED)('316-01/AC-2: v1 requires "%s" (exactly one SECTION_MISSING when it is dropped)', (name) => {
    expect(codes(dropSection(v1(), name))).toEqual([['SECTION_MISSING', name]]);
  });

  it('316-01/AC-2: v1 enforces order across its six sections', () => {
    const swapped = insertBefore(dropSection(v1(), 'Next action'), 'What landed this session', '## Next action\n\nx\n\n');
    expect(codes(swapped)).toEqual([['SECTION_OUT_OF_ORDER', 'Next action']]);
  });

  it('316-01/AC-2: a cadence_handoff: 2 document requires Open decisions (exactly one SECTION_MISSING without it)', () => {
    expect(codes(v2Missing())).toEqual([['SECTION_MISSING', 'Open decisions']]);
    expect(validate(v2Valid())).toEqual({ ok: true, diagnostics: [] });
  });

  it.each(V2_REQUIRED)('316-01/AC-2: v2 requires "%s" (exactly one SECTION_MISSING when it is dropped)', (name) => {
    expect(codes(dropSection(v2Valid(), name))).toEqual([['SECTION_MISSING', name]]);
  });

  it('316-01/AC-2: v2 requires Open decisions between Carry-forward gotchas and Next action', () => {
    const late = `${dropSection(v2Valid(), 'Open decisions')}\n${OPEN_DECISIONS_BLOCK}`;
    // The order check names the first out-of-place position (here "Next
    // action", which now sits where Open decisions belongs) — the same
    // first-mismatch rule the pre-existing header-order-swapped fixture pins.
    expect(codes(late)).toEqual([['SECTION_OUT_OF_ORDER', 'Next action']]);
  });

  it('316-01/AC-2: frontmatter with no cadence_handoff key reads as the latest version (v2)', () => {
    const keylessMissing = dropVersionKey(v2Missing());
    expect(keylessMissing).toMatch(/^---\n/);
    expect(keylessMissing).not.toContain('cadence_handoff');
    expect(codes(keylessMissing)).toEqual([['SECTION_MISSING', 'Open decisions']]);
    expect(validate(dropVersionKey(v2Valid()))).toEqual({ ok: true, diagnostics: [] });
    // Even when the body is a perfect v1 document.
    expect(codes(dropVersionKey(v1()))).toEqual([['SECTION_MISSING', 'Open decisions']]);
  });

  it('316-01/AC-2: a document with no frontmatter at all reads as the latest version (v2)', () => {
    const bareMissing = stripFrontmatter(v2Missing());
    expect(bareMissing).not.toContain('---');
    expect(codes(bareMissing)).toEqual([['SECTION_MISSING', 'Open decisions']]);
    expect(validate(stripFrontmatter(v2Valid()))).toEqual({ ok: true, diagnostics: [] });
    expect(codes(stripFrontmatter(v1()))).toEqual([['SECTION_MISSING', 'Open decisions']]);
  });

  it('316-01/AC-2: an unclosed leading --- block is not frontmatter, so the document reads as latest', () => {
    const unclosed = `---\ncadence_handoff: 3\n\n${stripFrontmatter(v2Valid())}`;
    expect(validate(unclosed)).toEqual({ ok: true, diagnostics: [] });
  });

  it('316-01/AC-2: Acceptance criteria touched is optional but keeps its order slot and AC-id checks, in v1 and v2', () => {
    for (const doc of [v1(), v2Valid()]) {
      // Present in its slot: clean.
      expect(validate(insertBefore(doc, 'What landed this session', AC_BLOCK))).toEqual({ ok: true, diagnostics: [] });
      // Present but after Next action: out of order.
      // First out-of-place position is "What landed this session", where
      // the AC section's slot is.
      expect(codes(`${doc}\n${AC_BLOCK}`)).toEqual([['SECTION_OUT_OF_ORDER', 'What landed this session']]);
      // Present with bad ids: the AC checks still run.
      const nonNumeric = insertBefore(doc, 'What landed this session', '## Acceptance criteria touched\n\n- AC-1a: x\n\n');
      expect(codes(nonNumeric)).toEqual([['AC_ID_NON_NUMERIC', 'Acceptance criteria touched']]);
      const dup = insertBefore(doc, 'What landed this session', '## Acceptance criteria touched\n\n- AC-1: x\n- AC-1: y\n\n');
      expect(codes(dup)).toEqual([['AC_ID_DUPLICATE', 'Acceptance criteria touched']]);
      const empty = insertBefore(doc, 'What landed this session', '## Acceptance criteria touched\n\nnothing\n\n');
      expect(codes(empty)).toEqual([['AC_LIST_EMPTY', 'Acceptance criteria touched']]);
    }
  });

  it('316-01/AC-2: a wrong-case optional Acceptance criteria header still reports SECTION_HEADER_MISMATCH', () => {
    const doc = insertBefore(v1(), 'What landed this session', '## acceptance criteria touched\n\n- AC-1: x\n\n');
    expect(codes(doc)).toEqual([['SECTION_HEADER_MISMATCH', 'Acceptance criteria touched']]);
  });

  it('316-01/AC-2: cadence_handoff: 3 returns a single HANDOFF_VERSION_UNSUPPORTED instead of guessing a schema', () => {
    const result = validate(fixture('version-unsupported.md'));
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'HANDOFF_VERSION_UNSUPPORTED', line: 2, message: expect.stringContaining('"3"') }),
    ]);
    const crlf = fixture('version-unsupported.md').replace(/\n/g, '\r\n');
    expect(validate(crlf)).toEqual(result);
  });

  // Matching is on the exact trimmed value text: quoted, zero-padded,
  // decimal, negative, empty, and trailing-comment forms are all refused
  // rather than coerced (the generator only ever writes a bare integer).
  it.each(['two', '', '"1"', '01', '1.0', '-1', '2 # comment'])(
    'AC-2: a non-supported cadence_handoff value (%j) returns a single HANDOFF_VERSION_UNSUPPORTED',
    (value) => {
      const result = validate(setVersion(v1(), value));
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'HANDOFF_VERSION_UNSUPPORTED', line: 2 })]);
    },
  );
});
