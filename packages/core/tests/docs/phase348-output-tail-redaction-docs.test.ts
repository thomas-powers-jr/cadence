import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { CadenceConfigZ, defaultConfig } from '@thomas-powers-jr/cadence-types';
import { registerAllCommands } from '../../src/cli/register.js';
import { runBuildTestGate } from '../../src/gates/build-test-must-pass.js';
import { changesetEvidencePresent } from '../support/changeset-evidence.js';
import type { SettleContext } from '../../src/gates/types.js';

// 348-01 (phase 348) — output-tail redaction. config.md, the
// `--allow-failing-build` rows of commands.md and cli.md, concepts.md's
// phase-346 bypass note, `settle run --help` and the changeset must say that
// redaction of the output tail is best-effort and that the tail is shown
// unless `verification.buildTestOutputTail` is "hide". The hidden-notice and
// `detail` texts the docs quote are checked against the gate and settle.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const CONFIG_MD = read('docs/reference/config.md');
const COMMANDS_MD = read('docs/reference/commands.md');
const CLI_MD = read('docs/cli.md');
const CONCEPTS_MD = read('docs/concepts.md');
const SETTLE_SERVICE_TS = read('packages/core/src/services/settle.ts');
const CHANGESET_PATH = join(ROOT, '.changeset', 'output-tail-redaction.md');

const SETTING = '`verification.buildTestOutputTail`';
/** "shown unless … `"hide"`", close together. */
const SHOWN_UNLESS_HIDE = /shown.{0,40}\bunless\b.{0,60}`"hide"`/;
/** The `detail` text settle writes under hide, after its line count. */
const HIDDEN_DETAIL_SUFFIX =
  'captured, hidden by config (verification.buildTestOutputTail); not recorded, since test output can hold secrets';

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

/** The single table row of `md` that starts with `prefix`. */
function singleRow(md: string, prefix: string): string {
  const rows = md.split('\n').filter((l) => l.startsWith(prefix));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** config.md's `### Build-test output tail` section, up to the next rule. */
function configSection(): string {
  return region(CONFIG_MD, '\n### Build-test output tail\n', '\n---', 'config.md build-test output tail');
}

/** The single options-table row for `flag` inside commands.md's `settle run` section. */
function settleRunFlagRow(flag: string): string {
  const m = COMMANDS_MD.match(/(?:^|\n)#### settle run\n([\s\S]*?)(?=\n#{2,4} |$)/);
  if (!m) throw new Error('commands.md: no "#### settle run" section heading found');
  return singleRow(m[1]!, `| \`${flag}\` |`);
}

function settleRunOptionHelp(flag: string): string | undefined {
  const program = new Command();
  registerAllCommands(program);
  const settle = program.commands.find((c) => c.name() === 'settle');
  const run = settle?.commands.find((c) => c.name() === 'run');
  return run?.options.find((o) => o.long === flag)?.description;
}

/** What the gate prints for a failing three-line tail under `config`. */
async function gateStderr(
  config: SettleContext['config'],
  opts: { allowFailingBuild?: boolean },
): Promise<string> {
  const errs: string[] = [];
  const ctx = {
    cwd: '/x',
    state: { draftReadAt: null },
    draft: { acceptanceCriteria: [], tasks: [] },
    progress: { draftId: 'd', tasks: {} },
    config,
    gateSet: { gates: ['build-test-must-pass'], softCap: false },
    opts,
    explicitIds: new Set<string>(),
    touchedFiles: [],
    runner: {
      test: async () => ({ ran: true, ok: false, exitCode: 1, command: 'pnpm test', outputTail: 'one\ntwo\nthree' }),
    },
    io: { err: (s: string) => errs.push(s) },
  } as unknown as SettleContext;
  await runBuildTestGate(ctx);
  return errs.join('');
}

describe('docs: output-tail redaction (348-01)', () => {
  it('348-01/AC-8: the config schema accepts exactly show and hide for verification.buildTestOutputTail, and absent stays absent (code truth)', () => {
    const parse = (value: unknown) =>
      CadenceConfigZ.safeParse({
        ...defaultConfig,
        verification: { ...defaultConfig.verification, buildTestOutputTail: value },
      });
    expect(parse('show').success).toBe(true);
    expect(parse('hide').success).toBe(true);
    for (const bad of ['Hide', 'SHOW', 'hidden', '', true, false, null, 0]) {
      expect(parse(bad).success).toBe(false);
    }
    // Absent is valid and stays absent: no default is filled in, here or in defaultConfig.
    const absent = CadenceConfigZ.parse(defaultConfig);
    expect('buildTestOutputTail' in absent.verification).toBe(false);
    expect('buildTestOutputTail' in defaultConfig.verification).toBe(false);
  });

  it('348-01/AC-8: the hidden notice and hidden detail that config.md quotes are what the gate prints and settle writes (code truth)', async () => {
    const hide = { verification: { buildTestOutputTail: 'hide' } } as unknown as SettleContext['config'];
    const show = { verification: { buildTestOutputTail: 'show' } } as unknown as SettleContext['config'];
    const section = configSection();
    // Refusal and bypass under hide: the notice, and no line of the tail.
    for (const opts of [{}, { allowFailingBuild: true }]) {
      const err = await gateStderr(hide, opts);
      expect(err).toContain('  output tail: (hidden by config; 3 lines captured)\n');
      expect(err).not.toMatch(/\b(?:one|two|three)\b/);
      expect(err).not.toContain('output tail (last lines):');
    }
    expect(section).toContain('`output tail: (hidden by config; N lines captured)`');
    expect(section).toContain('`1 line captured`');
    // Show, and no config at all, print the tail block the section names.
    for (const config of [show, null]) {
      const err = await gateStderr(config, {});
      expect(err).toContain('  output tail (last lines):\n    one\n    two\n    three\n');
      expect(err).not.toContain('hidden by config');
    }
    expect(section).toContain('`output tail (last lines):`');
    // The detail text is built in settle.ts; the section quotes it with N for the count.
    expect(SETTLE_SERVICE_TS).toContain(HIDDEN_DETAIL_SUFFIX);
    expect(section).toContain(`\`output tail: N lines ${HIDDEN_DETAIL_SUFFIX}\``);
  });

  it('348-01/AC-8: config.md documents verification.buildTestOutputTail with its two values and absent meaning "show"', () => {
    const row = singleRow(CONFIG_MD, `| ${SETTING} |`);
    expect(row).toContain('`"show"` \\| `"hide"` (optional)');
    expect(row).toContain('absent, which behaves as `"show"`');
    expect(row).toContain('`cadence init` does not write the key');
    expect(row).toContain('`build-test-must-pass`');
    expect(row).toContain('(#build-test-output-tail)');

    const section = configSection();
    expect(section).toContain(SETTING);
    expect(section).toContain('| `"show"` |');
    expect(section).toContain('| `"hide"` |');
    expect(section).toMatch(/This is the behavior when the key is absent, which is the default/);
    expect(section).toMatch(/in place of the whole tail block, its header line included, on every refusal and on the bypass notice/);
    expect(section).toMatch(/`detail` says the tail was hidden/);
    expect(section).toContain('"buildTestOutputTail": "hide"');
    // The row sits in the verification table, right after verification.fallback.
    const lines = CONFIG_MD.split('\n');
    const at = lines.findIndex((l) => l.startsWith(`| ${SETTING} |`));
    expect(lines[at - 1]).toMatch(/^\| `verification\.fallback` \|/);
  });

  it('348-01/AC-8: config.md says redaction is best-effort, names the four shapes and says the tail is shown unless the setting is "hide"', () => {
    const row = singleRow(CONFIG_MD, `| ${SETTING} |`);
    expect(row).toContain('best-effort');
    expect(row).toMatch(SHOWN_UNLESS_HIDE);

    const section = configSection();
    expect(section).toContain('best-effort');
    expect(section).toContain(SETTING);
    expect(section).toMatch(SHOWN_UNLESS_HIDE);
    expect(section).toMatch(/at the very start of the captured text/);
    expect(section).toMatch(/starts with `\/` and contains `\+` or `=`/);
    expect(section).toMatch(/quoted `Authorization`, `Proxy-Authorization`, `Cookie` or `Set-Cookie` key/);
    expect(section).toMatch(/two or more consecutive words of a multi-word secret value/);
    expect(section).toMatch(/Only the named shapes are covered/);
  });

  it('348-01/AC-8: commands.md\'s settle run --allow-failing-build row says best-effort, names the setting and says the tail is shown unless it is "hide"', () => {
    const row = settleRunFlagRow('--allow-failing-build');
    expect(row).toContain('best-effort');
    expect(row).toContain(SETTING);
    expect(row).toMatch(SHOWN_UNLESS_HIDE);
    expect(row).toMatch(/`detail` says the tail was hidden/);
  });

  it('348-01/AC-8: cli.md\'s --allow-failing-build row says best-effort, names the setting and says the tail is shown unless it is "hide"', () => {
    const row = singleRow(CLI_MD, '| `--allow-failing-build` |');
    expect(row).toContain('best-effort');
    expect(row).toContain(SETTING);
    expect(row).toMatch(SHOWN_UNLESS_HIDE);
  });

  it('348-01/AC-8: concepts.md\'s phase-346 bypass note says best-effort, names the setting and says the tail is shown unless it is "hide"', () => {
    const note = region(
      CONCEPTS_MD,
      '> **A bypassed failing suite is recorded (phase 346).**',
      '### Delta gates',
      'concepts.md build-test note',
    );
    expect(note).toMatch(/Redaction of the output tail is best-effort/);
    expect(note).toContain(SETTING);
    expect(note).toMatch(SHOWN_UNLESS_HIDE);
    expect(note).toContain('`output tail: (hidden by config; N lines captured)`');
    expect(note).toMatch(/absent means `"show"`/);
    // The two sentences that hide makes conditional are qualified, not left absolute.
    expect(note).toMatch(/the notice showed \(or, when the tail is hidden as described below, how many it captured and hid\)/);
    expect(note).toMatch(/also prints the output tail \(or the hidden notice, below\)/);
  });

  it('348-01/AC-8: `settle run --help` for --allow-failing-build names verification.buildTestOutputTail', () => {
    const help = settleRunOptionHelp('--allow-failing-build');
    expect(help).toBeDefined();
    expect(help).toContain('verification.buildTestOutputTail');
    expect(help).toContain('best-effort');
    expect(help).toMatch(/shown unless verification\.buildTestOutputTail is "hide"/);
  });

  it('348-01/AC-8: a minor changeset for cadence-core and cadence-types names the four shapes, best-effort redaction and the setting, or its consumed CHANGELOG entries', () => {
    if (!existsSync(CHANGESET_PATH)) {
      // `changeset version` consumed the .md at release: the entry must now be in both CHANGELOGs.
      for (const pkg of ['core', 'types']) {
        expect(
          changesetEvidencePresent({
            changesetPath: CHANGESET_PATH,
            changesetPackage: `@thomas-powers-jr/cadence-${pkg}`,
            changelogPath: join(ROOT, 'packages', pkg, 'CHANGELOG.md'),
            discriminator: 'verification.buildTestOutputTail',
          }),
        ).toBe(true);
      }
      return;
    }
    const text = readFileSync(CHANGESET_PATH, 'utf8').replace(/\r\n/g, '\n');
    const front = text.match(/^---\n([\s\S]*?)\n---\n/);
    expect(front).not.toBeNull();
    const lines = front![1]!.split('\n');
    expect(lines).toContain('"@thomas-powers-jr/cadence-core": minor');
    expect(lines).toContain('"@thomas-powers-jr/cadence-types": minor');
    const body = flat(text.slice(front![0].length));
    expect(body).toContain('phase 348');
    expect(body).toContain('rec-20261116-001');
    expect(body).toContain('rec-20261117-002');
    // The four shapes.
    expect(body).toMatch(/at the very start of the captured text/);
    expect(body).toMatch(/starts with `\/` and contains `\+` or `=`/);
    expect(body).toMatch(/quoted `Authorization`, `Proxy-Authorization`, `Cookie` or `Set-Cookie` key/);
    expect(body).toMatch(/two or more consecutive words of a multi-word secret value/);
    // Best-effort, and the setting.
    expect(body).toMatch(/Redaction of the output tail is best-effort/);
    expect(body).toContain(SETTING);
    expect(body).toContain('`"show"` or `"hide"`');
    expect(body).toMatch(/absent means `"show"`/);
    expect(body).toMatch(SHOWN_UNLESS_HIDE);
    expect(body).toContain('`output tail: (hidden by config; N lines captured)`');
    // The Speculative Stamp: no version number in a changeset body.
    expect(body).not.toMatch(/\bv?\d+\.\d+\.\d+\b/);
  });
});
