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

describe('phase 352 — boundary-scan bypass docs, changeset and records', () => {
  it('352-01/AC-4: DESIGN.md anomaly table has a boundary-scan-bypassed row', () => {
    expect(read('DESIGN.md')).toContain('| `boundary-scan-bypassed` |');
  });

  it('352-01/AC-4: config.md Diff base paragraph says a bypass is recorded in gateBypasses and drops the old --force wording', () => {
    const diffBase = section(
      read('docs/reference/config.md'),
      '**Diff base**',
      '**Dispatch-scoped auto-escalation',
    );
    expect(diffBase).toContain('gateBypasses');
    expect(diffBase).not.toContain('naming `--force` when that flag is set');
  });

  it('352-01/AC-4: the boundary-scan-bypass-recorded changeset bumps cadence-core and cadence-types by minor', () => {
    const rel = '.changeset/boundary-scan-bypass-recorded.md';
    expect(existsSync(join(REPO_ROOT, rel))).toBe(true);
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(read(rel));
    expect(frontmatter, 'changeset frontmatter block not found').not.toBeNull();
    const block = frontmatter?.[1] ?? '';
    expect(block).toMatch(/^"@thomas-powers-jr\/cadence-core": minor$/m);
    expect(block).toMatch(/^"@thomas-powers-jr\/cadence-types": minor$/m);
  });

  it('352-01/AC-4: ROADMAP has a Phase 352 entry and MILESTONES a Phase 352 bullet', () => {
    expect(read('.cadence/ROADMAP.md')).toContain('### Phase 352');
    expect(read('.cadence/MILESTONES.md')).toContain('- **Phase 352**');
  });

  it('352-01/AC-4: config.md Diff base paragraph states the flag rule', () => {
    const diffBase = section(
      read('docs/reference/config.md'),
      '**Diff base**',
      '**Dispatch-scoped auto-escalation',
    ).replace(/\s+/g, ' ');
    expect(diffBase).toContain('names `--allow-boundary-scan-failure` when that flag is set, else `--force`');
    expect(diffBase).toContain('caps a `strong` `assurance.overall` at `mixed`');
  });
});
