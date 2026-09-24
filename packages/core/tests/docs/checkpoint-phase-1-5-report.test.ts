import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/core/tests/docs → repo root is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPORT_MD = join(REPO_ROOT, 'docs/checkpoint/REPORT-checkpoint-phase-1.5.md');

// Phase 316 closes checkpoint Phase 1's provisional-schema flag. Its report
// must carry a named `##` heading for every item the phase promised to
// record, so a reader (or Phase 3) can find each one without re-deriving it.
// Headings are matched by prefix, deliberately without any trailing
// parenthetical, so this file carries no bare acceptance-criterion tokens.
const REQUIRED_HEADINGS = [
  '## Red-before evidence',
  '## D-BI outcome',
  '## Section drift desync run',
  '## AC-grammar drift desync run',
  '## Changed fixtures',
  '## Provisional-schema resolution',
  '## Phase 3 preconditions',
];

function readLines(): string[] {
  return readFileSync(REPORT_MD, 'utf8').split(/\r?\n/);
}

function headingIndex(lines: string[], prefix: string): number {
  return lines.findIndex((line) => line.startsWith(prefix));
}

describe('checkpoint Phase 1.5 report', () => {
  it('316-01/AC-8: the report exists and carries a named ## heading for each required item', () => {
    expect(existsSync(REPORT_MD)).toBe(true);
    const lines = readLines();
    for (const prefix of REQUIRED_HEADINGS) {
      expect(headingIndex(lines, prefix), `missing heading: ${prefix}`).toBeGreaterThan(-1);
    }
  });

  it('316-01/AC-8: the Phase 3 preconditions section names the version-downgrade vector and the unfilled-placeholder gap', () => {
    expect(existsSync(REPORT_MD)).toBe(true);
    const lines = readLines();
    const start = headingIndex(lines, '## Phase 3 preconditions');
    expect(start).toBeGreaterThan(-1);
    const rest = lines.slice(start + 1);
    const nextHeading = rest.findIndex((line) => line.startsWith('## '));
    const section = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).join('\n');

    expect(section).toContain('version-downgrade');
    expect(section).toContain('unfilled-placeholder');
    expect(section).toContain('cadence handoff --check');
  });
});
