import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAcClauses } from '../../src/parse/ac-clauses.js';
import { normalizeText } from '../../src/parse/text-normalize.js';

// Phase 354 (354-01, T2): over the pinned corpus (DRAFT and SPEC files of
// phases numbered at most 353), the clause rule differs from the legacy
// capture in exactly two fields, both heading-induced. Read-only walk.
//
// An edit to a pinned file that changes an AC block re-pins EXPECTED in the
// phase that makes it.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const PHASES_DIR = join(REPO_ROOT, '.cadence', 'phases');
const MAX_PINNED_PHASE = 353;

/** The legacy capture, verbatim from draft-parser.ts / spec-parser.ts before phase 354. */
function legacyClauses(block: string): { given: string; when: string; then: string } {
  const given = /Given\s+([\s\S]+?)(?=\nWhen\s|\nThen\s|$)/.exec(block)?.[1]?.trim() ?? '';
  const when = /When\s+([\s\S]+?)(?=\nThen\s|$)/.exec(block)?.[1]?.trim() ?? '';
  const then = /Then\s+([\s\S]+)/.exec(block)?.[1]?.trim() ?? '';
  return { given, when, then };
}

/** As draft-parser.ts's extractSection. */
function extractSection(body: string, heading: string): string {
  const re = new RegExp(`(^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const m = re.exec(body);
  return m ? m[2]!.trim() : '';
}

/** As parseAcceptanceCriteria splits and filters its blocks. */
function acBlocks(section: string): string[] {
  return section.split(/\n(?=### AC-)/).filter((b) => b.trim().startsWith('### AC-'));
}

function pinnedFiles(): string[] {
  const out: string[] = [];
  for (const dir of readdirSync(PHASES_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const m = /^(\d+)(?:-|$)/.exec(dir.name);
    if (!m || Number(m[1]) > MAX_PINNED_PHASE) continue;
    for (const f of readdirSync(join(PHASES_DIR, dir.name))) {
      if (/-(DRAFT|SPEC)\.md$/.test(f)) out.push(`${dir.name}/${f}`);
    }
  }
  return out.sort();
}

const EXPECTED: Array<[string, string, string]> = [
  ['157-fix-multi-line-truncation-in-spec-draft-parsers/157-01-DRAFT.md', 'AC-2', 'then'],
  ['157-fix-multi-line-truncation-in-spec-draft-parsers/157-01-DRAFT.md', 'AC-3', 'then'],
];

describe('AC clause capture over the pinned corpus (phase 354)', () => {
  it('354-01/AC-4: the clause rule differs from the legacy capture in exactly two fields', () => {
    const files = pinnedFiles();
    expect(files.length).toBe(430);
    const diffs: Array<[string, string, string]> = [];
    for (const rel of files) {
      const text = normalizeText(readFileSync(join(PHASES_DIR, rel), 'utf8')).text;
      for (const block of acBlocks(extractSection(text, 'Acceptance Criteria'))) {
        const id = /^### (AC-\d+):/m.exec(block)?.[1] ?? block.split('\n')[0]!;
        const legacy = legacyClauses(block);
        const now = parseAcClauses(block);
        for (const field of ['given', 'when', 'then'] as const) {
          if (legacy[field] !== now[field]) diffs.push([rel, id, field]);
        }
      }
    }
    expect(diffs).toStrictEqual(EXPECTED);
  });
});
