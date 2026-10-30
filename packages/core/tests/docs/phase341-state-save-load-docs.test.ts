import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changesetEvidencePresent } from '../support/changeset-evidence.js';

/**
 * Phase 341 (AC-6) — `cadence state save | load | list` is documented as
 * built: the commands.md marker block and `### state` section, the
 * cadence-owned gitignore enumerations (now including `.cadence/local/`),
 * concepts.md's "State files" section, DESIGN.md's D10 addendum, and a minor
 * changeset for cadence-core and cadence-types (or, once `changeset version`
 * has consumed it, core's CHANGELOG entry).
 */

// packages/core/tests/docs → ../../../../<asset>
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

/** The text between a heading line and the next heading of the same or a
 *  higher level (`## ` or `### `). */
function section(md: string, heading: string): string {
  const lines = md.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start === -1) throw new Error(`no "${heading}" heading found`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{2,3} /.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

function markerCommands(md: string): string[] {
  const m = md.match(/<!-- cadence:commands:start -->\s*([\s\S]*?)\s*<!-- cadence:commands:end -->/);
  if (!m) throw new Error('commands.md: cadence:commands marker block missing');
  return m[1]!.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

describe('phase 341 cadence state save/load/list docs', () => {
  it('commands.md lists `state` in the cadence:commands marker block and the table of contents (341-01/AC-6)', () => {
    const md = read('docs', 'reference', 'commands.md');
    expect(markerCommands(md)).toContain('state');
    expect(md).toContain('  - [state](#state)');
  });

  it('the `### state` section documents save, load, list, their flags, the snapshot directory, .cadence/local/ and keep-3 retention (341-01/AC-6)', () => {
    const s = section(read('docs', 'reference', 'commands.md'), '### state');
    for (const word of ['`save`', '`load [snapshot]`', '`list`', '`--json`', '`--force`']) {
      expect(s, `missing ${word}`).toContain(word);
    }
    expect(s).toContain('.cadence/snapshots/');
    expect(s).toContain('state-<stamp>-<host>.json');
    expect(s).toContain('.cadence/local/');
    expect(s).toContain('state.json.bak');
    expect(s).toContain('state-sync.json');
    expect(s).toMatch(/newest 3/);
    // The AC-4 resets and revision rule.
    for (const field of ['tokenUtilization', 'subagentSpawns', 'subagentBaselines']) {
      expect(s, `missing reset ${field}`).toContain(field);
    }
    expect(s).toContain('max(local revision, snapshot revision) + 1');
    // --force never overrides the unsafe-path refusal; resume stays read-only.
    expect(s).toMatch(/`--force` never overrides/);
    expect(s).toMatch(/`cadence resume`[^.]*read-only/);
    expect(s).toMatch(/\*\*Exit codes\*\*/);
  });

  it('commands.md init and doctor passages list `local/` with the other cadence-owned gitignore paths (341-01/AC-6)', () => {
    const md = read('docs', 'reference', 'commands.md');
    const owned = '(`state.json`, `STATE.md`, `mcp-trust.json`, `intelligence/context/`, `local/`)';
    const init = section(md, '### init');
    expect(init).toContain(owned);
    const doctor = section(md, '### doctor');
    const row = doctor.split('\n').find((l) => l.startsWith('| `state-tracked` |'));
    expect(row).toBeDefined();
    expect(row).toContain(owned);
    expect(md).not.toMatch(/four CADENCE-owned/);
  });

  it('concepts.md "State files" names .cadence/snapshots/ (committed) and .cadence/local/ (gitignored) (341-01/AC-6)', () => {
    const s = section(read('docs', 'concepts.md'), '### State files');
    expect(s).toMatch(/`\.cadence\/snapshots\/`[^\n]*committed/);
    expect(s).toMatch(/`\.cadence\/local\/`[^\n]*gitignored/);
  });

  it('DESIGN.md keeps the LOCKED D10 row and adds the phase 341 addendum (341-01/AC-6)', () => {
    const design = read('DESIGN.md');
    expect(design).toContain('`resume` is **read-only by design**');
    const note = design.split('\n').find((l) => l.startsWith('> **As built (phase 341'));
    expect(note).toBeDefined();
    expect(note).toContain('D10');
    expect(note).toContain('`cadence state load`');
    expect(note).toMatch(/refuse-first/);
    expect(note).toMatch(/constant of 3/);
    expect(note).toMatch(/dropped, not deferred/);
  });

  it('ships a minor changeset for cadence-core and cadence-types, or its consumed CHANGELOG entry (341-01/AC-6)', () => {
    const changesetPath = join(ROOT, '.changeset', 'state-save-load.md');
    const changelogPath = join(ROOT, 'packages', 'core', 'CHANGELOG.md');
    if (existsSync(changesetPath)) {
      const text = readFileSync(changesetPath, 'utf8');
      expect(text).toMatch(/^"@thomas-powers-jr\/cadence-core": minor$/m);
      expect(text).toMatch(/^"@thomas-powers-jr\/cadence-types": minor$/m);
      expect(text).toContain('cadence state');
    } else {
      // `changeset version` consumed the .md: the entry must now be in core's CHANGELOG.
      expect(
        changesetEvidencePresent({
          changesetPath,
          changesetPackage: '@thomas-powers-jr/cadence-core',
          changelogPath,
          discriminator: 'cadence state',
        }),
      ).toBe(true);
    }
  });
});
