import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { AnomalyTypeZ, SummaryZ } from '@thomas-powers-jr/cadence-types';
import { registerAllCommands } from '../../src/cli/register.js';
import { OUTPUT_TAIL_MAX_BYTES, OUTPUT_TAIL_MAX_LINES } from '../../src/verify/test-runner.js';
import { changesetEvidencePresent } from '../support/changeset-evidence.js';
import type { GateFlags, TestRunResult } from '../../src/gates/types.js';

// 346-01 (phase 346) — bypass honesty. A failing suite let through by
// `--allow-failing-build` or `--force` is recorded as an error-severity
// `SUMMARY.json.gateBypasses` entry carrying the bounded output tail in
// `detail` (capping assurance at mixed); a bare `--force` over real
// assertion-mode coverage gaps is recorded as a warn test-coverage bypass.
// The operator-facing docs, DESIGN.md's anomaly table, `settle run --help`
// and the changeset must say so. The tail bounds are read from the runner's
// own constants, never hardcoded here.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const CONCEPTS_MD = read('docs/concepts.md');
const DESIGN_MD = read('DESIGN.md');
const COMMANDS_MD = read('docs/reference/commands.md');
const CHANGESET_PATH = join(ROOT, '.changeset', 'bypass-honesty.md');

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

const TAIL_LINES = `${OUTPUT_TAIL_MAX_LINES} lines`;
const TAIL_KIB = `${OUTPUT_TAIL_MAX_BYTES / 1024} KiB`;

/** The single `| \`<type>\` |` row of DESIGN.md's §3.3 anomaly table. */
function anomalyRow(type: string): string {
  const section = region(DESIGN_MD, '### 3.3 Anomaly notification', '\nTransports (', 'DESIGN.md §3.3');
  // Rows from §3.3's own raw text (region() flattens line breaks), so a later table can never supply the row.
  const from = DESIGN_MD.indexOf('### 3.3 Anomaly notification');
  const raw = DESIGN_MD.slice(from, DESIGN_MD.indexOf('\nTransports (', from));
  const rows = raw.split('\n').filter((l) => l.startsWith(`| \`${type}\` |`));
  expect(section).toContain(`\`${type}\``);
  expect(rows.length).toBeGreaterThanOrEqual(1);
  return rows[0]!;
}

/** The single options-table row for `flag` inside commands.md's `settle run` section. */
function settleRunFlagRow(flag: string): string {
  const m = COMMANDS_MD.match(/(?:^|\n)#### settle run\n([\s\S]*?)(?=\n#{2,4} |$)/);
  if (!m) throw new Error('commands.md: no "#### settle run" section heading found');
  const rows = m[1]!.split('\n').filter((l) => l.startsWith(`| \`${flag}\` |`));
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

describe('docs: bypass honesty (346-01)', () => {
  it('346-01/AC-5: the output-tail bounds the docs state are the runner\'s own constants (code truth)', () => {
    expect(Number.isInteger(OUTPUT_TAIL_MAX_LINES)).toBe(true);
    expect(OUTPUT_TAIL_MAX_BYTES % 1024).toBe(0);
    expect(AnomalyTypeZ.options).toContain('build-test-bypassed');
    expect(AnomalyTypeZ.options).toContain('coverage-bypassed');
  });

  it('346-01/AC-5: concepts.md records a bypassed failing suite in gateBypasses at error severity, its detail counting the tail lines (the tail is not recorded), capping assurance at mixed', () => {
    const note = region(
      CONCEPTS_MD,
      '> **A bypassed failing suite is recorded (phase 346).**',
      '### Delta gates',
      'concepts.md build-test note',
    );
    expect(note).toContain('`build-test-must-pass`');
    expect(note).toContain('--allow-failing-build');
    expect(note).toContain('--force');
    expect(note).toContain('SUMMARY.json.gateBypasses');
    expect(note).toMatch(/`error` severity/);
    expect(note).toContain('`detail`');
    // The tail is shown on stderr and never recorded in the committed SUMMARY (dec-20261113-002).
    expect(note).toMatch(/is not recorded/);
    expect(note).toContain(TAIL_LINES);
    expect(note).toContain(TAIL_KIB);
    expect(note).toMatch(/ANSI/);
    expect(note).toContain('assurance.overall');
    expect(note).toMatch(/`'mixed'`/);
    expect(note).toMatch(/never `'strong'`/);
    // One stderr notice on a bypass; every refusal also shows the tail.
    expect(note).toMatch(/one stderr notice/);
    expect(note).toMatch(/every refusal/i);
    // The tail stays out of anomaly events and notifier transports.
    expect(note).toContain('`build-test-bypassed`');
    expect(note).toMatch(/never enters the anomaly event/);
    expect(note).toMatch(/notifier transport/);
  });

  it('346-01/AC-5: concepts.md records a bare --force over assertion-mode coverage gaps as a warn test-coverage bypass naming --force', () => {
    const note = region(
      CONCEPTS_MD,
      '> **A bare `--force` over coverage gaps is recorded (phase 346).**',
      '#### Medium',
      'concepts.md coverage note',
    );
    expect(note).toContain('`test-coverage`');
    expect(note).toContain('`assertion`');
    expect(note).toContain('SUMMARY.json.gateBypasses');
    expect(note).toMatch(/`warn` severity/);
    expect(note).toMatch(/`flag` is `--force`/);
    expect(note).toContain('--allow-missing-coverage');
  });

  it('346-01/AC-5: DESIGN.md\'s anomaly table lists build-test-bypassed (error, a build-test-must-pass gate bypass whose detail counts tail lines; the tail never in the event or the SUMMARY)', () => {
    const row = anomalyRow('build-test-bypassed');
    expect(row).toContain('--allow-failing-build');
    expect(row).toContain('--force');
    expect(row).toMatch(/`error`/);
    expect(row).toContain('`build-test-must-pass`');
    expect(row).toContain('gateBypasses');
    expect(row).toContain('`detail`');
    expect(row).toMatch(/never in the event/);
    expect(row).toMatch(/never in the SUMMARY/);
  });

  it('346-01/AC-5: DESIGN.md\'s coverage-bypassed row covers a bare --force over assertion-mode gaps at warn severity', () => {
    const row = anomalyRow('coverage-bypassed');
    expect(row).toContain('--allow-missing-coverage');
    expect(row).toContain('--force');
    expect(row).toContain('`assertion`');
    expect(row).toMatch(/`warn`/);
    expect(row).toContain('gateBypasses');
  });

  it('346-01/AC-5: commands.md\'s settle run --allow-failing-build row says the bypass is recorded at error severity and caps assurance at mixed', () => {
    const row = settleRunFlagRow('--allow-failing-build');
    expect(row).toContain('SUMMARY.json.gateBypasses');
    expect(row).toMatch(/`error`-severity/);
    expect(row).toContain('assurance.overall');
    expect(row).toMatch(/`mixed`, never `strong`/);
    expect(row).toContain('--force');
    expect(row).toContain('`detail`');
    expect(row).toMatch(/never recorded/);
  });

  it('346-01/AC-5: `settle run --help` for --allow-failing-build says the bypass is recorded at error severity and caps assurance at mixed', () => {
    const help = settleRunOptionHelp('--allow-failing-build');
    expect(help).toBeDefined();
    expect(help).toContain('SUMMARY.json.gateBypasses');
    expect(help).toContain('error-severity');
    expect(help).toContain('assurance.overall');
    expect(help).toContain('mixed, never strong');
    expect(help).toContain('--force');
  });

  it('346-01/AC-5: a minor changeset covers cadence-core and cadence-types, with upgrade notes on the grade cap, the committed tail and bare --force, or its consumed CHANGELOG entry', () => {
    if (!existsSync(CHANGESET_PATH)) {
      // `changeset version` consumed the .md at release: the entry must now be in core's CHANGELOG.
      expect(
        changesetEvidencePresent({
          changesetPath: CHANGESET_PATH,
          changesetPackage: '@thomas-powers-jr/cadence-core',
          changelogPath: join(ROOT, 'packages', 'core', 'CHANGELOG.md'),
          discriminator: 'build-test-bypassed',
        }),
      ).toBe(true);
      return;
    }
    const text = readFileSync(CHANGESET_PATH, 'utf8').replace(/\r\n/g, '\n');
    const front = text.match(/^---\n([\s\S]*?)\n---\n/);
    expect(front).not.toBeNull();
    const lines = front![1]!.split('\n');
    expect(lines).toContain('"@thomas-powers-jr/cadence-core": minor');
    expect(lines).toContain('"@thomas-powers-jr/cadence-types": minor');
    const body = flat(text.slice(front![0].length));
    expect(body).toContain('Upgrade notes');
    expect(body).toContain('`mixed`');
    expect(body).toMatch(/secrets/);
    expect(body).toContain('bare `--force`');
    expect(body).toContain(TAIL_LINES);
    expect(body).toContain(TAIL_KIB);
  });

  it('346-01/AC-5: TestRunResult.outputTail and GateFlags.buildTestBypass are optional', () => {
    // Typecheck enforces the optionality: both objects compile without the new fields.
    const run: TestRunResult = { ran: true, ok: false };
    const flags: GateFlags = { buildTestBypassed: true };
    expect('outputTail' in run).toBe(false);
    expect(flags.buildTestBypass).toBeUndefined();
  });

  it('346-01/AC-5: every committed .cadence/phases/*/*-SUMMARY.json still parses with SummaryZ', () => {
    const phasesDir = join(ROOT, '.cadence', 'phases');
    const files = readdirSync(phasesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) =>
        readdirSync(join(phasesDir, d.name))
          .filter((f) => f.endsWith('-SUMMARY.json'))
          .map((f) => join(phasesDir, d.name, f)),
      );
    expect(files.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const f of files) {
      const result = SummaryZ.safeParse(JSON.parse(readFileSync(f, 'utf8')));
      if (!result.success) failures.push(`${f}: ${result.error.message}`);
    }
    expect(failures).toEqual([]);
  });
});
