import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 335-01 (phase 335) — the handoff retention prune never deletes a git-tracked
// SESSION doc (rec-20261016-004). Both prune entry points, `cadence handoff`
// and the `doctor --fix` handoff-retention repair, go through
// `pruneHandoffDir`, so the config reference and the doctor --fix table must
// both say so, and the config section must stop claiming "no git
// introspection".
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const configMd = readFileSync(join(ROOT, 'docs', 'reference', 'config.md'), 'utf8');
const commandsMd = readFileSync(join(ROOT, 'docs', 'reference', 'commands.md'), 'utf8');

// The handoff retention prose runs from its intro line to the doctor check paragraph.
function handoffSection(md: string): string {
  const start = md.indexOf('Handoff retention (v1.20).');
  const end = md.indexOf('`cadence doctor` includes a `handoff-retention` check', start);
  return start >= 0 && end > start ? md.slice(start, end) : '';
}

describe('docs: the handoff prune keeps git-tracked docs (335-01)', () => {
  it('335-01/AC-7: the handoff.retain row deletes only untracked docs and never a git-tracked one', () => {
    const row = configMd.split(/\r?\n/).find((line) => line.startsWith('| `handoff.retain` |')) ?? '';
    expect(row).not.toBe('');
    expect(row).toMatch(/hard-deletes \*\*untracked\*\* `SESSION-\*\.md` docs past the budget/);
    expect(row).toMatch(/git-tracked docs are never deleted by the pruner/);
  });

  it('335-01/AC-7: the handoff section drops "no git introspection" and names the kept-docs notice', () => {
    const section = handoffSection(configMd);
    expect(section).not.toBe('');
    expect(section).not.toMatch(/no git introspection/);
    expect(section).toMatch(/git ls-files/);
    expect(section).toMatch(/handoff: kept N git-tracked SESSION doc\(s\) past handoff\.retain/);
  });

  it('335-01/AC-7: the doctor retention paragraph no longer promises pruning a tracked excess down to budget', () => {
    const start = configMd.indexOf('`cadence doctor` includes a `handoff-retention` check');
    const paragraph = start >= 0 ? configMd.slice(start, configMd.indexOf('```', start)) : '';
    expect(paragraph).not.toBe('');
    expect(paragraph).not.toMatch(/next write will self-heal the excess/);
    expect(paragraph).not.toMatch(/prunes the archive down to budget/);
    expect(paragraph).toMatch(/prunes untracked docs down to budget/);
    expect(paragraph).toMatch(/Git-tracked docs are kept/);
  });

  it('335-01/AC-7: the doctor --fix auto row says committed docs are kept when it prunes to budget', () => {
    const row =
      commandsMd
        .split(/\r?\n/)
        .find((line) => line.startsWith('| **auto** |') && line.includes('`handoff-retention`')) ?? '';
    expect(row).not.toBe('');
    expect(row).toMatch(/prune the `SESSION-\*\.md` archive down to that budget[^|]*git-tracked docs are kept/);
  });
});
