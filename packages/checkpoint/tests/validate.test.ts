import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from '../src/validate.js';

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
    expect(result.diagnostics.filter((d) => d.code.startsWith('AC_'))).toEqual([]);
  });

  it('does not treat ## inside a fenced code block as a section header', () => {
    const result = validate(fixture('fenced-code-with-hashes.md'));
    expect(result.diagnostics.filter((d) => d.code.startsWith('SECTION_'))).toEqual([]);
  });

  it('does not let a differently-marked nested fence (~~~ inside ```) close the outer fence early', () => {
    const result = validate(fixture('fenced-mismatched-markers.md'));
    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it('strips the real generator\'s decorated header suffix (" · ...") before matching', () => {
    const result = validate(fixture('decorated-headers.md'));
    expect(result).toEqual({ ok: true, diagnostics: [] });
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
    ['missing-section-ac.md', 'Acceptance criteria touched'],
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

  it('reports MEASURED_CONTEXT_MISSING_COMMAND only for the bare-percentage line, not the whole section', () => {
    const result = validate(fixture('measured-context-no-command.md'));
    const matches = result.diagnostics.filter((d) => d.code === 'MEASURED_CONTEXT_MISSING_COMMAND');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toContain('42%');
  });

  it('does not flag a measured percentage that already has a producing command attached', () => {
    const result = validate(fixture('measured-context-with-command.md'));
    expect(result).toEqual({ ok: true, diagnostics: [] });
  });

  it('reports exactly one OPEN_DECISIONS_EMPTY_NOT_EXPLICIT for an empty section with no None', () => {
    const result = validate(fixture('open-decisions-empty.md'));
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'OPEN_DECISIONS_EMPTY_NOT_EXPLICIT' }),
    ]);
  });

  it('reports RESUME_CORE_OVER_BUDGET with the actual measured length', () => {
    const result = validate(fixture('resume-core-over-budget.md'));
    const diag = result.diagnostics.find((d) => d.code === 'RESUME_CORE_OVER_BUDGET');
    expect(diag).toBeDefined();
    // 10267 is the real measured length of this fixture's TL;DR + Next action
    // content (10191-char generated filler + surrounding fixture text) — a
    // regex like /\d+/ would pass even if the computed length were wrong,
    // since every over-budget message also contains the literal "10000"
    // budget constant.
    expect(diag!.message).toContain('is 10267 characters');
  });

  it('reports EMPTY_FILE for a zero-byte input', () => {
    const result = validate(fixture('empty.md'));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'EMPTY_FILE' })]);
  });

  it('reports NON_UTF8_INPUT without throwing', () => {
    const buf = fixtureBuffer('non-utf8.md');
    expect(() => validate(buf.toString('utf8'))).not.toThrow();
    const result = validate(buf.toString('utf8'));
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'NON_UTF8_INPUT' })]);
  });

  it('reports SECTION_OUT_OF_ORDER when all sections are present but reordered', () => {
    const result = validate(fixture('header-order-swapped.md'));
    expect(result.diagnostics.some((d) => d.code === 'SECTION_OUT_OF_ORDER')).toBe(true);
  });

  it('reports SECTION_HEADER_MISMATCH for a wrong-case header, distinct from SECTION_MISSING', () => {
    const result = validate(fixture('header-case-mismatch.md'));
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'SECTION_HEADER_MISMATCH' }),
    );
    expect(result.diagnostics.some((d) => d.code === 'SECTION_MISSING')).toBe(false);
  });

  it('never emits a non-UTF-8/empty diagnostic for well-formed UTF-8 content with no other issues', () => {
    const result = validate(fixture('valid.md'));
    expect(result.diagnostics.some((d) => d.code === 'NON_UTF8_INPUT' || d.code === 'EMPTY_FILE')).toBe(
      false,
    );
  });
});
