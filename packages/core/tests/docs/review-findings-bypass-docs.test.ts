import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerAllCommands } from '../../src/cli/register.js';

// Phase 332 (332-01, T5) — a code-review or security-audit findings bypass
// (`--allow-code-review-failure` / `--allow-security-audit-failure` / `--force`
// waving through HIGH / CRITICAL findings) is recorded as an error-severity
// `SUMMARY.json.gateBypasses` entry, which caps `assurance.overall` below
// `strong`. Both operator-facing docs must say so where a reader of those two
// gates looks: `docs/concepts.md`'s gate tables and `docs/reference/commands.md`'s
// `settle run` flag rows.
//
// Every assertion is scoped to that exact region, never the whole file:
// concepts.md's phase-283 bullet and evidence-floor row, and commands.md's
// `--allow-skill-audit-miss` / `--allow-unresolvable-pack` rows, already
// mention `gateBypasses`, so a whole-file check would pass without the new text.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string): string =>
  readFileSync(join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const CONCEPTS_MD = read('docs/concepts.md');
const COMMANDS_MD = read('docs/reference/commands.md');
const CLI_MD = read('docs/cli.md');

/** concepts.md's findings-bypass note, which follows the `code-review` and
 *  `security-audit` gate-table rows, up to the stage-scoped gates heading.
 *  Starts at the note itself, not the table rows, because the rows already
 *  name every bypass flag and would satisfy the flag checks on their own.
 *  Reflowed (blockquote markers dropped, whitespace collapsed) so prose
 *  wrapping cannot split a phrase. */
function conceptsReviewGatesRegion(md: string): string {
  const table = md.indexOf('| `code-review` | AI code-review agent');
  if (table === -1) throw new Error('concepts.md: `code-review` gate-table row not found');
  const start = md.indexOf('> **Findings bypasses are recorded', table);
  if (start === -1) throw new Error('concepts.md: findings-bypass note not found after the code-review row');
  const end = md.indexOf('### Stage-scoped gates', start);
  if (end === -1) throw new Error('concepts.md: "### Stage-scoped gates" heading not found after the findings-bypass note');
  return md
    .slice(start, end)
    .replace(/^> ?/gm, '')
    .replace(/\s+/g, ' ');
}

/** The `#### settle run` section of commands.md, up to the next heading. */
function settleRunSection(md: string): string {
  const m = md.match(/(?:^|\n)#### settle run\n([\s\S]*?)(?=\n#{2,4} |$)/);
  if (!m) throw new Error('commands.md: no "#### settle run" section heading found');
  return m[1]!;
}

/** The single options-table row for `flag` inside the `settle run` section. */
function settleRunFlagRow(md: string, flag: string): string {
  const rows = settleRunSection(md)
    .split('\n')
    .filter((l) => l.startsWith(`| \`${flag}\` |`));
  if (rows.length !== 1) {
    throw new Error(`commands.md settle run: expected exactly one "${flag}" row, found ${rows.length}`);
  }
  return rows[0]!;
}

describe('phase 332 — findings bypasses are documented as recorded and grade-capping', () => {
  it('332-01/AC-8: concepts.md states, at the code-review / security-audit gate rows, that a findings bypass is recorded in gateBypasses at error severity and caps assurance below strong', () => {
    const region = conceptsReviewGatesRegion(CONCEPTS_MD);
    expect(region).toContain('`security-audit`');
    expect(region).toContain('SUMMARY.json.gateBypasses');
    expect(region).toMatch(/`error`[- ]severity/);
    expect(region).toContain('assurance.overall');
    expect(region).toMatch(/never `'?strong'?`/);
    // All three flags that can wave findings through are named.
    for (const flag of ['--allow-code-review-failure', '--allow-security-audit-failure', '--force']) {
      expect(region).toContain(flag);
    }
  });

  it.each(['--allow-code-review-failure', '--allow-security-audit-failure'])(
    '332-01/AC-8: commands.md `settle run` row for %s states the bypass is recorded in gateBypasses at error severity and caps assurance below strong',
    (flag) => {
      const row = settleRunFlagRow(COMMANDS_MD, flag);
      expect(row).toContain('SUMMARY.json.gateBypasses');
      expect(row).toMatch(/`error`[- ]severity/);
      expect(row).toContain('assurance.overall');
      expect(row).toMatch(/never `'?strong'?`/);
      // The bare-`--force` path is recorded the same way, so the row says so.
      expect(row).toContain('--force');
    },
  );

  // Amended T5: `settle run --help` and docs/cli.md's bypass table are
  // hand-kept mirrors of these rows (phase 311 edited all three together), so
  // they must carry the same statement.
  it.each(['--allow-code-review-failure', '--allow-security-audit-failure'])(
    '332-01/AC-8: `settle run --help` for %s states the bypass is recorded in gateBypasses at error severity and caps assurance below strong',
    (flag) => {
      const program = new Command();
      registerAllCommands(program);
      const settle = program.commands.find((c) => c.name() === 'settle');
      const run = settle?.commands.find((c) => c.name() === 'run');
      const description = run?.options.find((o) => o.long === flag)?.description;
      expect(description).toBeDefined();
      expect(description).toContain('SUMMARY.json.gateBypasses');
      expect(description).toContain('error-severity');
      expect(description).toContain('assurance.overall');
      expect(description).toContain('never strong');
      expect(description).toContain('--force');
    },
  );

  it.each(['--allow-code-review-failure', '--allow-security-audit-failure'])(
    '332-01/AC-8: docs/cli.md bypass-table row for %s states the bypass is recorded in gateBypasses at error severity and caps assurance below strong',
    (flag) => {
      const rows = CLI_MD.split('\n').filter((l) => l.startsWith(`| \`${flag}\` |`));
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row).toContain('SUMMARY.gateBypasses');
      expect(row).toMatch(/`error`[- ]severity/);
      expect(row).toContain('assurance.overall');
      expect(row).toMatch(/never `'?strong'?`/);
      expect(row).toContain('--force');
    },
  );
});
