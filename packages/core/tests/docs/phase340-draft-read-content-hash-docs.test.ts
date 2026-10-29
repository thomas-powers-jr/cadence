import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase 340 (AC-5) — the operator-facing docs describe the draft-read gate's
 * content check as built, and the change ships with a changeset. Pairs
 * `docs/concepts.md`, the `--allow-stale-draft` help text and its
 * `docs/reference/commands.md` row, and DESIGN.md's As-built note with the
 * gate T3 shipped, so they can't drift back to describing a bare mtime check.
 */

// packages/core/tests/docs → ../../../../<asset>
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

function draftReadRow(): string {
  const row = read('docs', 'concepts.md')
    .split('\n')
    .find((line) => line.startsWith('| `draft-read` |'));
  if (row === undefined) throw new Error('docs/concepts.md has no `draft-read` gate row');
  return row;
}

describe('phase 340 draft-read content-check docs', () => {
  it('concepts.md describes the content check, not a bare mtime check (340-01/AC-5)', () => {
    const row = draftReadRow();
    expect(row).toMatch(/content hash/);
    expect(row).toMatch(/mtime is newer/);
    expect(row).toMatch(/mtime-only check/);
    expect(row).not.toMatch(/\(mtime check\)/);
    expect(row).toContain('`--allow-stale-draft`');
  });

  it('the --allow-stale-draft help text and commands.md row both name the content check (340-01/AC-5)', () => {
    const help = read('packages', 'core', 'src', 'cli', 'commands', 'settle.ts');
    const commands = read('docs', 'reference', 'commands.md');
    expect(help).toContain("skip the draft-read gate even if DRAFT.md's content changed after approve");
    expect(commands).toContain(
      "| `--allow-stale-draft` | Skip the draft-read gate even if DRAFT.md's content changed after approve |",
    );
    expect(help).not.toMatch(/DRAFT-read mtime gate/);
    expect(commands).not.toMatch(/DRAFT-read mtime gate/);
  });

  it('DESIGN.md keeps the LOCKED §4.1 row and adds an As-built note for phase 340 (340-01/AC-5)', () => {
    const design = read('DESIGN.md');
    expect(design).toContain('DRAFT-read mtime check **(Phase 23.1)**');
    expect(design).toMatch(/As built \(phase 340[^)]*\)\*\*.*normalized content hash/);
  });

  it('ships a minor changeset for cadence-types and cadence-core, or its consumed CHANGELOG entry (340-01/AC-5)', () => {
    // Fallback after release: `changeset version` consumes the .md, so the
    // entry must then be in core's CHANGELOG (rec-20261008-007's trap).
    const changeset = join(ROOT, '.changeset', 'draft-read-content-hash.md');
    if (existsSync(changeset)) {
      const text = readFileSync(changeset, 'utf8');
      expect(text).toMatch(/"@thomas-powers-jr\/cadence-types": minor/);
      expect(text).toMatch(/"@thomas-powers-jr\/cadence-core": minor/);
      expect(text).toContain('draftReadHash');
    } else {
      expect(read('packages', 'core', 'CHANGELOG.md')).toContain('draftReadHash');
    }
  });
});
