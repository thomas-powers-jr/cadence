import { describe, it, expect } from 'vitest';
import { normalizeText, applyTextStyle, foldLineEndings } from '../../src/parse/text-normalize.js';

const BOM = '\uFEFF';

describe('normalizeText (phase 339)', () => {
  it('339-01/AC-1: strips a BOM and folds CRLF to LF, reporting the style; LF input passes through unchanged', () => {
    const input = '---\nstatus: PENDING\n---\n\n# Title\n';
    expect(normalizeText(`${BOM}${input.replace(/\n/g, '\r\n')}`)).toEqual({ text: input, bom: true, eol: 'crlf' });
    expect(normalizeText(input)).toEqual({ text: input, bom: false, eol: 'lf' });
  });

  it('339-01/AC-1: strips exactly one leading BOM and reports it', () => {
    expect(normalizeText(`${BOM}a\nb\n`)).toEqual({ text: 'a\nb\n', bom: true, eol: 'lf' });
    // Only the first U+FEFF is a BOM; a second one is content.
    expect(normalizeText(`${BOM}${BOM}a`)).toEqual({ text: `${BOM}a`, bom: true, eol: 'lf' });
  });

  it('339-01/AC-1: handles the empty string and BOM-only input', () => {
    expect(normalizeText('')).toEqual({ text: '', bom: false, eol: 'lf' });
    expect(normalizeText(BOM)).toEqual({ text: '', bom: true, eol: 'lf' });
    expect(applyTextStyle('', { bom: true, eol: 'lf' })).toBe(BOM);
  });

  it('339-01/AC-1: leaves a U+FEFF that is not at index 0 alone', () => {
    const r = normalizeText(`a${BOM}b\n`);
    expect(r).toEqual({ text: `a${BOM}b\n`, bom: false, eol: 'lf' });
  });

  it('339-01/AC-1: converts CRLF to LF and reports eol crlf', () => {
    expect(normalizeText('a\r\nb\r\n')).toEqual({ text: 'a\nb\n', bom: false, eol: 'crlf' });
  });

  it('339-01/AC-1: handles BOM and CRLF together', () => {
    expect(normalizeText(`${BOM}a\r\nb\r\n`)).toEqual({ text: 'a\nb\n', bom: true, eol: 'crlf' });
  });

  it('339-01/AC-1: converts lone CR to LF and reports eol lf (no CRLF present)', () => {
    expect(normalizeText('a\rb\r')).toEqual({ text: 'a\nb\n', bom: false, eol: 'lf' });
  });

  it('339-01/AC-1: replaces CRLF before lone CR, so CRLF never becomes a blank line', () => {
    const r = normalizeText('a\r\nb');
    expect(r.text).toBe('a\nb');
  });

  it('339-01/AC-1: normalizes mixed CRLF, lone CR and LF, reporting crlf because a CRLF is present', () => {
    expect(normalizeText('a\r\nb\rc\nd')).toEqual({ text: 'a\nb\nc\nd', bom: false, eol: 'crlf' });
  });

  it('339-01/AC-1: leaves no \\r and no leading U+FEFF in the normalized text', () => {
    const { text } = normalizeText(`${BOM}x\r\ny\rz\r\n`);
    expect(text).not.toContain('\r');
    expect(text.startsWith(BOM)).toBe(false);
  });
});

describe('foldLineEndings (phase 339)', () => {
  it('339-01/AC-1: folds CRLF then lone CR to LF and keeps a leading U+FEFF', () => {
    expect(foldLineEndings('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
    expect(foldLineEndings(`${BOM}x\r\n`)).toBe(`${BOM}x\n`);
  });
});

describe('applyTextStyle (phase 339)', () => {
  it('339-01/AC-1: is the identity for { bom: false, eol: lf }', () => {
    expect(applyTextStyle('a\nb\n', { bom: false, eol: 'lf' })).toBe('a\nb\n');
  });

  it('339-01/AC-1: turns every LF into CRLF for eol crlf and prepends a BOM when bom is true', () => {
    expect(applyTextStyle('a\nb\n', { bom: false, eol: 'crlf' })).toBe('a\r\nb\r\n');
    expect(applyTextStyle('a\nb\n', { bom: true, eol: 'lf' })).toBe(`${BOM}a\nb\n`);
    expect(applyTextStyle('a\nb\n', { bom: true, eol: 'crlf' })).toBe(`${BOM}a\r\nb\r\n`);
  });

  it('339-01/AC-1: round-trips pure-CRLF and BOM+CRLF inputs byte for byte', () => {
    for (const input of [
      '---\r\nstatus: PENDING\r\n---\r\n\r\n# T\r\n\r\nbody\r\n',
      `${BOM}---\r\nstatus: PENDING\r\n---\r\n\r\n# T\r\n`,
      `${BOM}no trailing newline\r\nlast`,
    ]) {
      const { text, bom, eol } = normalizeText(input);
      expect(applyTextStyle(text, { bom, eol })).toBe(input);
    }
  });
});
