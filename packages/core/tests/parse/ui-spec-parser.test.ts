import { describe, it, expect } from 'vitest';
import { parseUiSpecMd, renderUiSpecScaffold } from '../../src/parse/ui-spec-parser.js';
import { CadenceError } from '../../src/errors.js';

const FULL = `---
phase: 205-ui-spec-gate
id: 205-01
status: PENDING
---

# 205-01 — demo

## Components

### StructuredWizardShell
- modified
- adds a fourth step

#### Layout & Tokens
- spacing-4 between fields
- uses \`color.border.subtle\` for dividers

#### Precedent References
- reuse StructuredWizardShell's visual language

### ConfirmDialog
- new

#### Layout & Tokens
- (none yet)

#### Precedent References
- (none)

## Responsive & Interaction
- collapses to single column below 768px
- shows a spinner in the confirm button while pending
`;

describe('parseUiSpecMd', () => {
  it('AC-1: parses nested per-component Layout & Tokens / Precedent References', () => {
    const spec = parseUiSpecMd(FULL);
    expect(spec.id).toBe('205-01');
    expect(spec.phase).toBe('205-ui-spec-gate');
    expect(spec.status).toBe('PENDING');
    expect(spec.components).toHaveLength(2);
    expect(spec.components[0]).toEqual({
      name: 'StructuredWizardShell',
      detail: ['modified', 'adds a fourth step'],
      layoutTokens: ['spacing-4 between fields', 'uses `color.border.subtle` for dividers'],
      precedent: ["reuse StructuredWizardShell's visual language"],
    });
    expect(spec.responsiveInteraction).toEqual([
      'collapses to single column below 768px',
      'shows a spinner in the confirm button while pending',
    ]);
  });

  it('parses zero components as an empty array, not a throw', () => {
    const raw = `---\nphase: p\nid: 205-02\nstatus: PENDING\n---\n\n# 205-02 — empty\n\n## Components\n\n## Responsive & Interaction\n`;
    const spec = parseUiSpecMd(raw);
    expect(spec.components).toEqual([]);
    expect(spec.responsiveInteraction).toEqual([]);
  });

  it('throws on missing frontmatter', () => {
    expect(() => parseUiSpecMd('# no frontmatter\n')).toThrow();
  });
});

describe('renderUiSpecScaffold', () => {
  it('AC-1: round-trips through parseUiSpecMd as an empty-but-valid PENDING ui-spec', () => {
    const body = renderUiSpecScaffold('205-ui-spec-gate', '205-01');
    const spec = parseUiSpecMd(body);
    expect(spec.status).toBe('PENDING');
    expect(spec.components).toHaveLength(1); // the placeholder component block
    expect(spec.responsiveInteraction).toHaveLength(1); // the placeholder bullet
  });
});

// Phase 339 (rec-20260918-007) — a UI-SPEC.md saved with CRLF, a UTF-8 BOM or
// lone-CR endings failed with "missing frontmatter"; every encoding must parse
// to the same UiSpec as its LF form, `####` subsections included.
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

describe('parseUiSpecMd BOM / CRLF / lone-CR tolerance (phase 339)', () => {
  const lfResult = parseUiSpecMd(FULL);

  it('phase 339 fixture precondition: the LF fixture itself has components with populated #### subsections', () => {
    expect(lfResult.components.length).toBeGreaterThan(0);
    expect(lfResult.components[0]!.layoutTokens.length).toBeGreaterThan(0);
    expect(lfResult.components[0]!.precedent.length).toBeGreaterThan(0);
  });

  for (const [label, encode] of ENCODINGS) {
    it(`339-01/AC-3: a ${label} UI-SPEC.md parses to the same UiSpec as its LF form, with no \\r or BOM in any string`, () => {
      const result = parseUiSpecMd(encode(FULL));
      expect(result).toEqual(lfResult);
      expect(result.components.length).toBeGreaterThan(0);
      expect(result.components[0]!.layoutTokens.length).toBeGreaterThan(0);
      for (const s of collectStrings(result)) {
        expect(s).not.toContain('\r');
        expect(s).not.toContain(BOM);
      }
    });

    it(`339-01/AC-3: a ${label} UI-SPEC.md with no frontmatter still throws the existing CadenceError`, () => {
      const noFrontmatter = FULL.replace(/^---\n[\s\S]*?\n---\n/, '');
      let caught: unknown;
      try {
        parseUiSpecMd(encode(noFrontmatter));
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(CadenceError);
      // parseUiSpecMd's message names SPEC.md, not UI-SPEC.md — unchanged by design.
      expect((caught as Error).message).toBe('SPEC.md missing frontmatter');
    });
  }
});
