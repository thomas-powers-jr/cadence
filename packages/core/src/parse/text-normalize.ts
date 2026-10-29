// Phase 339: one place that decides how a DRAFT/SPEC/UI-SPEC file's encoding
// quirks are read and written back. Windows tooling (PowerShell's default
// UTF-8-with-BOM, editors and git autocrlf writing CRLF) produces files every
// \n-based parser regex rejects; the parsers normalize through here first, and
// the draft mutations re-apply the detected style so a CLI edit to a
// pure-LF or pure-CRLF file changes only the edited bytes
// (rec-20260918-005/006/007).

export interface TextStyle {
  bom: boolean;
  eol: 'lf' | 'crlf';
}

export interface NormalizedText extends TextStyle {
  text: string;
}

const BOM = '\uFEFF';

/**
 * Fold CRLF, then any remaining lone CR, to LF. CRLF goes first: folding lone
 * CR first would turn each CRLF into a blank line. Leaves a U+FEFF alone, so
 * the draft mutations use it on payload strings, where a BOM is content.
 */
export function foldLineEndings(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Strip one leading U+FEFF and turn CRLF, then any remaining lone CR, into LF.
 * `eol` is `'crlf'` when the input held at least one CRLF, so a mixed-ending
 * file is written back as all-CRLF and a lone-CR-only file as LF.
 */
export function normalizeText(raw: string): NormalizedText {
  const bom = raw.startsWith(BOM);
  const body = bom ? raw.slice(BOM.length) : raw;
  const eol = body.includes('\r\n') ? 'crlf' : 'lf';
  return { text: foldLineEndings(body), bom, eol };
}

/** Inverse of `normalizeText` for LF text: re-apply a detected style. */
export function applyTextStyle(text: string, style: TextStyle): string {
  const body = style.eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  return style.bom ? BOM + body : body;
}
