import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/core/tests/docs → repo root is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/**
 * Slice `text` from the first occurrence of `start` up to (not including) the
 * first occurrence of `end` after it. Fails loudly when either anchor is
 * missing so a renamed heading cannot silently turn the assertions vacuous.
 */
function section(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from, `start anchor not found: ${start}`).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to, `end anchor not found after ${start}: ${end}`).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe('phase 350 — UNBOUNDED_AC_THEN reference docs, changeset and records', () => {
  it('350-01/AC-6: commands.md draft check section documents UNBOUNDED_AC_THEN, its five words, the stop line and the warning-only exit 0', () => {
    const draftCheck = section(
      read('docs/reference/commands.md'),
      '#### draft check',
      '#### draft approve',
    );
    expect(draftCheck).toContain('UNBOUNDED_AC_THEN');
    expect(draftCheck).toContain('Not covered:');
    for (const word of ['`any`', '`every`', '`each`', '`same`', '`unchanged`']) {
      expect(draftCheck).toContain(word);
    }
    expect(draftCheck).toContain('only warnings exits 0');
    // The old blanket sentence is gone: warnings alone do not fail the command.
    expect(draftCheck).not.toContain('exits non-zero when coherence violations are found');
  });

  it('350-01/AC-6: the bounded-ac-then changeset bumps cadence-core by minor', () => {
    const rel = '.changeset/bounded-ac-then.md';
    expect(existsSync(join(REPO_ROOT, rel))).toBe(true);
    expect(read(rel)).toMatch(/^---\r?\n"@thomas-powers-jr\/cadence-core": minor\r?\n---\r?\n/);
  });

  it('350-01/AC-6: ROADMAP has a Phase 350 entry and MILESTONES a Phase 350 bullet', () => {
    expect(read('.cadence/ROADMAP.md')).toContain('### Phase 350');
    expect(read('.cadence/MILESTONES.md')).toContain('- **Phase 350**');
  });
});
