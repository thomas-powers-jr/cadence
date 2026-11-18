import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerAllCommands } from '../../src/cli/register.js';
import { dryRunCliUsageError } from '../../src/cli/commands/settle.js';
import { changesetEvidencePresent } from '../support/changeset-evidence.js';

// 347-01 (phase 347) — `settle run --dry-run`. The help text, commands.md,
// exit-codes.md, concepts.md (beside the code-review convergence budget) and
// the changeset must say what a dry run runs, that cadence writes and
// notifies nothing, that it spends no convergence attempt, its exit codes
// 0/1/2 and the two flags it refuses.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const CONCEPTS_MD = read('docs/concepts.md');
const COMMANDS_MD = read('docs/reference/commands.md');
const EXIT_CODES_MD = read('docs/reference/exit-codes.md');
const CHANGESET_PATH = join(ROOT, '.changeset', 'settle-dry-run.md');

/** Collapse blockquote markers and line wrapping so a wrapped phrase still matches. */
function flat(text: string): string {
  return text.replace(/^> ?/gm, '').replace(/\s+/g, ' ');
}

/** Slice from `start` to the first `end` after it; throws when either is missing. */
function region(md: string, start: string, end: string, label: string): string {
  const from = md.indexOf(start);
  if (from < 0) throw new Error(`${label}: start marker not found: ${start}`);
  const to = md.indexOf(end, from + start.length);
  if (to < 0) throw new Error(`${label}: end marker not found after start: ${end}`);
  return flat(md.slice(from, to));
}

/** commands.md's `#### settle run` section, up to the next heading. */
function settleRunSection(): string {
  const m = COMMANDS_MD.match(/(?:^|\n)#### settle run\n([\s\S]*?)(?=\n#{2,4} |$)/);
  if (!m) throw new Error('commands.md: no "#### settle run" section heading found');
  return m[1]!;
}

/** The single options-table row for `flag` inside commands.md's `settle run` section. */
function settleRunFlagRow(flag: string): string {
  const rows = settleRunSection()
    .split('\n')
    .filter((l) => l.startsWith(`| \`${flag}\` |`));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

function settleRunOptionHelp(flag: string): string | undefined {
  const program = new Command();
  registerAllCommands(program);
  const settle = program.commands.find((c) => c.name() === 'settle');
  const run = settle?.commands.find((c) => c.name() === 'run');
  return run?.options.find((o) => o.long === flag)?.description;
}

/** The single `| \`<code>\` |` row of exit-codes.md's table. */
function exitCodeRow(code: number): string {
  const rows = EXIT_CODES_MD.split('\n').filter((l) => l.startsWith(`| \`${code}\` |`));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe('docs: settle run --dry-run (347-01)', () => {
  it('347-01/AC-5: the refused flags the docs name are the ones the CLI refuses (code truth)', () => {
    expect(dryRunCliUsageError({ dryRun: true })).toBeNull();
    expect(dryRunCliUsageError({ dryRun: true, interactive: false })).toBeNull();
    expect(dryRunCliUsageError({ dryRun: true, interactive: true })).toContain('--interactive');
    expect(dryRunCliUsageError({ dryRun: true, shipRef: 'PR #1' })).toContain('--ship-ref');
    expect(dryRunCliUsageError({ interactive: true, shipRef: 'PR #1' })).toBeNull();
  });

  it('347-01/AC-5: `settle run --help` describes --dry-run: what it runs, writes and notifies nothing, no convergence attempt, exits 0/1/2 and the two refused flags', () => {
    const help = settleRunOptionHelp('--dry-run');
    expect(help).toBeDefined();
    expect(help).toContain("settle's preconditions, gates and post-gate checks");
    expect(help).toContain('same gate set, providers and bypass flags');
    expect(help).toContain('never prompts');
    expect(help).toContain('stops before finalize');
    expect(help).toContain('cadence writes and notifies nothing');
    expect(help).toContain('the test command and review agents still run');
    expect(help).toContain('spends no convergence attempt');
    expect(help).toContain('exit 0 if settle would pass');
    expect(help).toContain('1 if it would refuse');
    expect(help).toContain('2 when combined with --interactive or --ship-ref');
  });

  it('347-01/AC-5: commands.md\'s settle run --dry-run row says what it runs, writes and notifies nothing, no attempt, exit 0/1/2 and the refused flags', () => {
    const row = settleRunFlagRow('--dry-run');
    expect(row).toContain("settle's preconditions, gates and post-gate checks");
    expect(row).toContain('same gate set, providers and bypass flags');
    expect(row).toContain('stopping before finalize');
    expect(row).toContain('Cadence writes and notifies nothing');
    expect(row).toContain('the test command and review agents still run');
    expect(row).toContain('spends no convergence attempt');
    expect(row).toContain('Never prompts');
    expect(row).toMatch(/Exits `0` if settle would pass, `1` if it would refuse, `2` when combined with `--interactive` or `--ship-ref`/);
  });

  it('347-01/AC-5: commands.md\'s settle run "Dry run" prose covers the gate run, the no-write/no-notify guarantee, the report, the prompt rule and the exit codes', () => {
    const prose = region(settleRunSection(), '**Dry run**', '**Exit codes**', 'commands.md dry-run prose');
    // What it runs.
    expect(prose).toMatch(/same gates in the same order/);
    expect(prose).toContain('`verification.fallback`');
    expect(prose).toMatch(/stops at the first refusal, as settle does/);
    expect(prose).toMatch(/AC derivation, the anomaly and skill-audit checks and the evidence floor/);
    expect(prose).toMatch(/stops before finalize/);
    // Writes and notifies nothing; no convergence attempt.
    expect(prose).toMatch(/Cadence writes nothing and notifies nothing/);
    expect(prose).toContain('`<id>-CODE-REVIEW.json`');
    expect(prose).toMatch(/spends no convergence attempt/);
    expect(prose).toContain('`state.json`/`STATE.md`');
    expect(prose).toMatch(/No anomaly event reaches any notifier transport, stderr included/);
    expect(prose).toMatch(/still run, and their own writes are outside this guarantee/);
    // The report.
    expect(prose).toContain('`would be attempt N of M`');
    expect(prose).toContain('`would notify:`');
    expect(prose).toContain('`settle would pass`');
    expect(prose).toContain('`settle would refuse at <gate or check>: <reason>`');
    expect(prose).toMatch(/a passing or abstained review consumes no attempt/);
    // Never prompts; the require-tty exception.
    expect(prose).toMatch(/A dry run never prompts/);
    expect(prose).toContain('`CADENCE_REQUIRE_TTY=1`');
    // The two refused flags, exit 2.
    expect(prose).toMatch(/`--interactive` and `--ship-ref` are refused with exit `2` before anything runs/);
  });

  it('347-01/AC-5: commands.md\'s settle run exit-code paragraph lists the dry run\'s 0, 1 and 2, and a parse error still exits 1', () => {
    const exits = region(settleRunSection(), '**Exit codes**', '\n---', 'commands.md settle run exit codes');
    expect(exits).toMatch(
      /With `--dry-run`, exits `0` if settle would pass, `1` if it would refuse, and `2` when combined with `--interactive` or `--ship-ref`/,
    );
    expect(exits).toMatch(/parse error .* exits `1`/);
  });

  it('347-01/AC-5: exit-codes.md lists settle run --dry-run with --interactive or --ship-ref under exit 2, and its would-refuse under exit 1', () => {
    const two = exitCodeRow(2);
    expect(two).toContain('`cadence settle run --dry-run` combined with `--interactive` or `--ship-ref`');
    const one = exitCodeRow(1);
    expect(one).toContain('`cadence settle run --dry-run` exits `1` when settle would refuse');
  });

  it('347-01/AC-5: concepts.md notes the dry run beside the code-review convergence budget: no attempt spent', () => {
    const note = region(
      CONCEPTS_MD,
      '> **The code-review convergence budget, and a dry run that spends none',
      '#### Expensive',
      'concepts.md convergence note',
    );
    expect(note).toContain('`<id>-CODE-REVIEW.json`');
    expect(note).toContain('`convergence.maxAttempts`');
    expect(note).toMatch(/A passing or\s+(?:>\s+)?abstained review spends none/);
    expect(note).toContain('`cadence settle run --dry-run`');
    expect(note).toContain('`would be attempt N of M`');
    expect(note).toMatch(/spends no convergence attempt/);
    expect(note).toMatch(/notifies nothing/);
    // The note sits in the Medium-cost table section, right after the code-review row.
    const codeReviewRow = CONCEPTS_MD.indexOf('| `code-review` | AI code-review agent runs at `cadence settle run`');
    const noteAt = CONCEPTS_MD.indexOf('> **The code-review convergence budget');
    expect(codeReviewRow).toBeGreaterThan(0);
    expect(noteAt).toBeGreaterThan(codeReviewRow);
    expect(CONCEPTS_MD.slice(codeReviewRow, noteAt)).not.toContain('\n#');
  });

  it('347-01/AC-5: a minor changeset for cadence-core states the dry run (writes and notifies nothing, no attempt, exit codes, refused flags), or its consumed CHANGELOG entry', () => {
    if (!existsSync(CHANGESET_PATH)) {
      // `changeset version` consumed the .md at release: the entry must now be in core's CHANGELOG.
      expect(
        changesetEvidencePresent({
          changesetPath: CHANGESET_PATH,
          changesetPackage: '@thomas-powers-jr/cadence-core',
          changelogPath: join(ROOT, 'packages', 'core', 'CHANGELOG.md'),
          discriminator: 'cadence settle run --dry-run',
        }),
      ).toBe(true);
      return;
    }
    const text = readFileSync(CHANGESET_PATH, 'utf8').replace(/\r\n/g, '\n');
    const front = text.match(/^---\n([\s\S]*?)\n---\n/);
    expect(front).not.toBeNull();
    const lines = front![1]!.split('\n');
    expect(lines).toContain('"@thomas-powers-jr/cadence-core": minor');
    const body = flat(text.slice(front![0].length));
    expect(body).toContain('`cadence settle run --dry-run`');
    expect(body).toMatch(/Cadence writes nothing and notifies nothing/);
    expect(body).toMatch(/spends no convergence attempt/);
    expect(body).toMatch(/still run, and their own writes are outside this guarantee/);
    expect(body).toMatch(/exits 0 if settle would pass, 1 if it would refuse, and 2 when combined with `--interactive` or `--ship-ref`/);
    // The Speculative Stamp: no version number in a changeset body.
    expect(body).not.toMatch(/\bv?\d+\.\d+\.\d+\b/);
  });
});
