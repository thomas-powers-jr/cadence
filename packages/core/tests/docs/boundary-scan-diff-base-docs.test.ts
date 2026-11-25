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

describe('phase 351 — boundary-scan diff base docs, changeset and records', () => {
  it('351-01/AC-4: config.md Diff base paragraph names upstream-failed, the local-fallback notice and the shallow clone refusal', () => {
    // The end anchor is a prefix of both AC-4's spelling and the heading as
    // written in config.md (whose colon sits inside the bold markers).
    const diffBase = section(
      read('docs/reference/config.md'),
      '**Diff base**',
      '**Dispatch-scoped auto-escalation',
    );
    expect(diffBase).toContain('upstream-failed');
    expect(diffBase).toContain('did not resolve');
    expect(diffBase).toContain('shallow clone');
    for (const source of ['`upstream`', '`local`', '`none`']) expect(diffBase).toContain(source);
    expect(diffBase).toContain('scanning working-tree changes only.');
  });

  it('351-01/AC-4: the Diff base paragraph sits after the boundaryEnforcement Scope note', () => {
    const config = read('docs/reference/config.md');
    const scopeNote = config.indexOf('**Scope note:** `block` mode is enforced at three independent points');
    const diffBase = config.indexOf('**Diff base**');
    expect(scopeNote).toBeGreaterThanOrEqual(0);
    expect(diffBase).toBeGreaterThan(scopeNote);
    // Directly after: the Scope note is the only paragraph between the two.
    expect(config.slice(scopeNote, diffBase).trimEnd().split('\n\n')).toHaveLength(1);
  });

  it('351-01/AC-4: the Diff base slice ends at the Dispatch-scoped auto-escalation paragraph', () => {
    const config = read('docs/reference/config.md');
    const from = config.indexOf('**Diff base**');
    const end = config.indexOf('**Dispatch-scoped auto-escalation', from);
    expect(from).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(from);
    expect(config.slice(end)).toMatch(/^\*\*Dispatch-scoped auto-escalation:?\*\*/);
    // The Diff base paragraph is the only paragraph between the two anchors.
    expect(config.slice(from, end).trimEnd().split('\n\n')).toHaveLength(1);
  });

  it('351-01/AC-4: the boundary-scan-diff-base changeset bumps cadence-core by patch', () => {
    const rel = '.changeset/boundary-scan-diff-base.md';
    expect(existsSync(join(REPO_ROOT, rel))).toBe(true);
    expect(read(rel)).toMatch(/^---\r?\n"@thomas-powers-jr\/cadence-core": patch\r?\n---\r?\n/);
  });

  it('351-01/AC-4: ROADMAP has a Phase 351 entry and MILESTONES a Phase 351 bullet', () => {
    expect(read('.cadence/ROADMAP.md')).toContain('### Phase 351');
    expect(read('.cadence/MILESTONES.md')).toContain('- **Phase 351**');
  });
});
