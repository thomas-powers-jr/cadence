import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

const SKILL = '.claude/skills/phase-build/SKILL.md';

describe('phase 350 — the literal DRAFT review, the literal AC pass and bounded ACs are documented', () => {
  it('350-01/AC-4: phase-build Preconditions require a literal DRAFT review before `cadence draft approve`', () => {
    const pre = section(read(SKILL), '## Preconditions', '## Pipeline');
    expect(pre).toContain('**Literal DRAFT review**');
    expect(pre).toContain('fresh');
    expect(pre).toContain('clause by clause');
    expect(pre).toContain('`cadence draft approve`');
  });

  it('350-01/AC-4: phase-build step 6 adds a read-only literal AC pass whose predicted failures are fixed tests first', () => {
    const step6 = section(read(SKILL), '6. **Whole-branch review.**', '7. **Settle, one commit.**');
    expect(step6).toContain('**Literal AC pass**');
    expect(step6).toContain('read-only');
    expect(step6).toContain('atomic clauses');
    expect(step6).toContain('UNPROVEN');
    expect(step6).toContain('WEAK');
    expect(step6).toContain('falsif');
    expect(step6).toContain('tests first');
  });

  it('350-01/AC-4: phase-build step 7 makes the first settle run a dry run', () => {
    const step7 = section(read(SKILL), '7. **Settle, one commit.**', '8. **Land.**');
    expect(step7).toContain('cadence settle run --auto --dry-run');
  });

  it('350-01/AC-5: CLAUDE.md "The loop and its artifacts" names the AC-authoring rules', () => {
    const loop = section(read('CLAUDE.md'), '### The loop and its artifacts', '### Gates');
    expect(loop).toContain('one claim');
    expect(loop).toContain('named example');
    for (const word of ['any', 'every', 'each', 'same', 'unchanged']) {
      expect(loop, `universal word in backticks: ${word}`).toContain(`\`${word}\``);
    }
    expect(loop).toContain('Not covered:');
    expect(loop).toContain('UNBOUNDED_AC_THEN');
    expect(loop).toContain('draft check');
  });
});
