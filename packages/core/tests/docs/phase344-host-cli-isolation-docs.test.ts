import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CadenceConfigZ, GateProvenanceZ, defaultConfig } from '@thomas-powers-jr/cadence-types';
import { evaluateHostCliIsolation } from '../../src/doctor/run.js';
import { hostCliIsolationFlags } from '../../src/verify/host-cli-client.js';
import { changesetEvidencePresent } from '../support/changeset-evidence.js';

// 344-01 (phase 344) — host-cli isolation flags. providers.md's host-cli
// section, config.md, commands.md's doctor section, concepts.md's
// gate-provenance list and the changeset must say which flags are passed,
// what was measured and what still reaches the reviewer. The command lines
// are built from `hostCliIsolationFlags` and the doctor messages from the
// check itself, so the docs cannot drift from the code. Nothing here selects
// or spawns a host-cli verifier.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const PROVIDERS_MD = read('docs/providers.md');
const CONFIG_MD = read('docs/reference/config.md');
const COMMANDS_MD = read('docs/reference/commands.md');
const CONCEPTS_MD = read('docs/concepts.md');
const CLIENT_TS = read('packages/core/src/verify/host-cli-client.ts');
const CHANGESET_PATH = join(ROOT, '.changeset', 'host-cli-isolation.md');

const SETTING = '`verification.hostCliIsolation`';
const CODEX_FLAGS = hostCliIsolationFlags('codex').join(' ');
const CLAUDE_FLAGS = hostCliIsolationFlags('claude').join(' ');
/** The command lines with isolation on and no model, built from the helper `buildInvocation` uses. */
const CODEX_LINE = `codex exec --json --skip-git-repo-check ${CODEX_FLAGS} -`;
const CLAUDE_LINE = `claude -p --output-format json ${CLAUDE_FLAGS}`;

/** Collapse line wrapping so a wrapped phrase still matches. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** Slice from `start` to the first `end` after it (unflattened); throws when either is missing. */
function region(md: string, start: string, end: string, label: string): string {
  const from = md.indexOf(start);
  if (from < 0) throw new Error(`${label}: start marker not found: ${start}`);
  const to = md.indexOf(end, from + start.length);
  if (to < 0) throw new Error(`${label}: end marker not found after start: ${end}`);
  return md.slice(from, to);
}

/** The single table row of `md` that starts with `prefix`. */
function singleRow(md: string, prefix: string): string {
  const rows = md.split('\n').filter((l) => l.startsWith(prefix));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** providers.md's whole `## host-cli` section, up to the next `## ` heading. */
const HOST_CLI_RAW = region(PROVIDERS_MD, '\n## host-cli', '\n## ', 'providers.md host-cli');
const HOST_CLI = flat(HOST_CLI_RAW);
/** Its `### Isolation` subsection, up to the next `### ` heading. */
const ISOLATION_RAW = region(HOST_CLI_RAW, '\n### Isolation\n', '\n### ', 'providers.md isolation');
const ISOLATION = flat(ISOLATION_RAW);

/** One bold-led paragraph (or paragraph + list) of the Isolation subsection:
 *  from `**<lead>` up to the next paragraph that starts with `**`. */
function isolationPart(lead: string): string {
  const from = ISOLATION_RAW.indexOf(`\n**${lead}`);
  if (from < 0) throw new Error(`providers.md isolation: no paragraph starting **${lead}`);
  const next = ISOLATION_RAW.indexOf('\n\n**', from + 1);
  return flat(next < 0 ? ISOLATION_RAW.slice(from) : ISOLATION_RAW.slice(from, next));
}

/** commands.md's `### doctor` section, up to the next `### ` heading. */
const DOCTOR_RAW = region(COMMANDS_MD, '\n### doctor\n', '\n### ', 'commands.md doctor');
/** config.md's `### Host-cli isolation` section, up to the next rule. */
const CONFIG_SECTION = flat(
  region(CONFIG_MD, '\n### Host-cli isolation\n', '\n---', 'config.md host-cli isolation'),
);

describe('docs: host-cli isolation flags (344-01)', () => {
  it('344-01/AC-7: the config schema accepts exactly on and off for verification.hostCliIsolation, and absent stays absent (code truth)', () => {
    const verification = CadenceConfigZ.shape.verification.unwrap();
    expect([...verification.shape.hostCliIsolation.unwrap().options].sort()).toEqual(['off', 'on']);
    const parse = (value: unknown) =>
      CadenceConfigZ.safeParse({
        ...defaultConfig,
        verification: { ...defaultConfig.verification, hostCliIsolation: value },
      });
    expect(parse('on').success).toBe(true);
    expect(parse('off').success).toBe(true);
    for (const bad of ['Off', 'ON', 'none', '', true, false, null, 0]) {
      expect(parse(bad).success).toBe(false);
    }
    const absent = CadenceConfigZ.parse(defaultConfig);
    expect('hostCliIsolation' in absent.verification).toBe(false);
    expect('hostCliIsolation' in defaultConfig.verification).toBe(false);
  });

  it('344-01/AC-7: the flag lists the docs are checked against are the ones the client spawns with (code truth)', () => {
    expect(hostCliIsolationFlags('codex')).toEqual(['--ignore-user-config']);
    expect(hostCliIsolationFlags('claude')).toEqual([
      '--setting-sources',
      'project',
      '--strict-mcp-config',
    ]);
    expect(CODEX_LINE).toBe('codex exec --json --skip-git-repo-check --ignore-user-config -');
    expect(CLAUDE_LINE).toBe(
      'claude -p --output-format json --setting-sources project --strict-mcp-config',
    );
  });

  it('344-01/AC-7: providers.md host-cli section contains both command lines, built from hostCliIsolationFlags', () => {
    // In the section's opening paragraph and in the Isolation table.
    const intro = flat(region(HOST_CLI_RAW, '\n## host-cli', '\n### ', 'providers.md host-cli intro'));
    for (const part of [intro, ISOLATION]) {
      expect(part).toContain(`\`${CODEX_LINE}\``);
      expect(part).toContain(`\`${CLAUDE_LINE}\``);
    }
    expect(singleRow(ISOLATION_RAW, '| codex |')).toContain(`| \`${CODEX_FLAGS}\` |`);
    expect(singleRow(ISOLATION_RAW, '| claude |')).toContain(`| \`${CLAUDE_FLAGS}\` |`);
    // The model flag goes after the isolation flags, as buildInvocation orders it.
    expect(ISOLATION).toMatch(/model flag \(`-m <model>` for codex, `--model <model>` for claude\) follows the isolation flags/);
  });

  it('344-01/AC-7: for codex, providers.md states only what --help says and that the global AGENTS.md still reaches the reviewer', () => {
    const codex = isolationPart('codex.');
    expect(codex).toContain('`--help`');
    expect(codex).toMatch(/`\$CODEX_HOME\/config\.toml` is not loaded/);
    expect(codex).toMatch(/auth still uses `CODEX_HOME`/);
    expect(codex).toMatch(/global `AGENTS\.md` was measured to still reach the reviewer/);
    expect(codex).toMatch(/was not measured for codex/);
  });

  it('344-01/AC-7: the codex paragraph makes no claim that MCP servers, plugins or hooks were dropped', () => {
    const codex = isolationPart('codex.');
    // Nothing of the kind was measured for codex, so the paragraph names none of them.
    expect(codex).not.toMatch(/\bMCP\b/i);
    expect(codex).not.toMatch(/\bplugins?\b/i);
    expect(codex).not.toMatch(/\bhooks?\b/i);
    expect(codex).not.toMatch(/\b\d+ (?:servers?|tools?)\b/i);
  });

  it('344-01/AC-7: for claude, providers.md states what the flags were measured to stop and that the global CLAUDE.md still reaches the reviewer', () => {
    const claude = isolationPart('claude.');
    expect(claude).toMatch(/`--setting-sources project` was measured to stop a user-level hook/);
    expect(claude).toMatch(/the user's installed plugins/);
    expect(claude).toMatch(/MCP servers those plugins bring/);
    expect(claude).toMatch(/With `--strict-mcp-config` on top, no MCP server was left at all/);
    // The probe's counts.
    expect(claude).toContain('14 plugins down to 4');
    expect(claude).toContain('24 servers down to 0');
    expect(claude).toContain('from 119 to 25');
    expect(claude).toMatch(/global `CLAUDE\.md` was measured to still reach the reviewer/);
  });

  it('344-01/AC-7: providers.md says project-level instruction files and hooks still apply', () => {
    const still = isolationPart('What still reaches the reviewer');
    expect(still).toMatch(/`AGENTS\.md` for codex, `CLAUDE\.md` for claude/);
    expect(still).toMatch(/Project-level instruction files and project-level hooks/);
    expect(still).toMatch(/The child runs in the project directory, so these still apply/);
  });

  it('344-01/AC-7: providers.md says a user-configuration model or effort level no longer applies, and names <seam>.model and "off" as the remedies', () => {
    const change = isolationPart('What you may need to change');
    expect(change).toMatch(/A model or an effort level chosen in your user configuration no longer applies/);
    // Real config keys: every named `<seam>.model` is a seam block with a `model` key.
    for (const key of ['verifier.model', 'codeReview.model']) {
      expect(change).toContain(`\`${key}\``);
      const seam = key.split('.')[0] as 'verifier' | 'codeReview';
      const parsed = CadenceConfigZ.parse({
        ...defaultConfig,
        [seam]: { ...defaultConfig[seam], model: 'some-model' },
      });
      expect(parsed[seam].model).toBe('some-model');
    }
    expect(change).toContain('`verification.hostCliIsolation: "off"`');
  });

  it('344-01/AC-7: providers.md says sign-in settings kept in user configuration are skipped too', () => {
    const change = isolationPart('What you may need to change');
    expect(change).toMatch(/Sign-in settings kept in user configuration are skipped too/);
    // Both points are stated as inferred, not measured.
    expect(change).toMatch(/Neither point was measured/);
    // And it does not present these two points as measured.
    expect(change).toMatch(/The measurement covered an ordinary login only/);
  });

  it('344-01/AC-7: providers.md quotes the hint a too-old CLI produces, as the client builds it', () => {
    const template =
      'this CLI may not accept the isolation flag "${rejected}"; update it, or set verification.hostCliIsolation to "off"';
    expect(CLIENT_TS).toContain(template);
    const hint = template.replace('${rejected}', hostCliIsolationFlags('codex')[0]!);
    expect(ISOLATION_RAW).toContain(`\n${hint}\n`);
    expect(ISOLATION).toMatch(/it is not retried without the flag/);
  });

  it('344-01/AC-7: providers.md says the SUMMARY gate entry records the flags, and GateProvenanceZ accepts the field', () => {
    const recorded = isolationPart('Where it is recorded.');
    expect(recorded).toContain('`hostCliIsolation`');
    expect(recorded).toMatch(/`deep-verify`, `code-review` and `security-audit`/);
    expect(recorded).toContain(JSON.stringify(hostCliIsolationFlags('claude')).replace(/,/g, ', '));
    expect(recorded).toMatch(/records that the flags were passed and nothing more/);
    expect('hostCliIsolation' in GateProvenanceZ.shape).toBe(true);
  });

  it('344-01/AC-7: providers.md names the CLI versions as the versions measured, not a minimum', () => {
    expect(ISOLATION).toContain('codex-cli 0.156.1');
    expect(ISOLATION).toContain('Claude Code 2.1.330');
    expect(ISOLATION).toMatch(/the versions measured, not a minimum requirement/);
  });

  it('344-01/AC-7: the host-cli section never calls the reviewer isolated without qualification', () => {
    expect(HOST_CLI).not.toMatch(/fully isolated/i);
    expect(HOST_CLI).not.toMatch(/completely isolated/i);
    // The bare adjective is not used at all; the section speaks of flags.
    expect(HOST_CLI).not.toMatch(/\bisolated\b/i);
    expect(CONFIG_SECTION).not.toMatch(/\bisolated\b/i);
  });

  it('344-01/AC-7: config.md documents verification.hostCliIsolation with its two values and absent meaning "on"', () => {
    const row = singleRow(CONFIG_MD, `| ${SETTING} |`);
    expect(row).toContain('`"on"` \\| `"off"` (optional)');
    expect(row).toContain('absent, which behaves as `"on"`');
    expect(row).toContain('`cadence init` does not write the key');
    expect(row).toContain(`\`${CODEX_FLAGS}\``);
    expect(row).toContain(`\`${CLAUDE_FLAGS}\``);
    expect(row).toContain('(#host-cli-isolation)');
    // The row sits after the other verification.* rows.
    const lines = CONFIG_MD.split('\n');
    const at = lines.findIndex((l) => l.startsWith(`| ${SETTING} |`));
    expect(lines[at - 1]).toMatch(/^\| `verification\.buildTestOutputTail` \|/);
    expect(lines[at + 1]).not.toMatch(/^\| `verification\./);

    expect(CONFIG_SECTION).toContain(SETTING);
    expect(CONFIG_SECTION).toContain('| `"on"` |');
    expect(CONFIG_SECTION).toContain('| `"off"` |');
    expect(CONFIG_SECTION).toMatch(/an absent key means `"on"`/);
    expect(CONFIG_SECTION).toMatch(/spawned exactly as before phase 344, so it inherits your user configuration/);
    expect(CONFIG_SECTION).toContain(`\`${CODEX_FLAGS}\``);
    expect(CONFIG_SECTION).toContain(`\`${CLAUDE_FLAGS}\``);
    expect(CONFIG_SECTION).toMatch(/they do not keep everything out/);
    expect(CONFIG_SECTION).toContain('"hostCliIsolation": "off"');
    expect(CONFIG_SECTION).toContain('(../providers.md#isolation)');
    // The link target exists.
    expect(PROVIDERS_MD).toContain('\n### Isolation\n');
    expect(PROVIDERS_MD).toContain('(reference/config.md#host-cli-isolation)');
  });

  it('344-01/AC-7: commands.md lists the host-cli-isolation doctor check with its severities, quoting the messages the check returns', () => {
    const row = singleRow(DOCTOR_RAW, '| `host-cli-isolation` |');
    expect(row.trimEnd().endsWith('| ok / warning |')).toBe(true);
    const none = evaluateHostCliIsolation({ usesHostCli: false, isolation: 'off', bin: 'codex' });
    const codex = evaluateHostCliIsolation({ usesHostCli: true, isolation: undefined, bin: 'codex' });
    const claude = evaluateHostCliIsolation({ usesHostCli: true, isolation: 'on', bin: 'claude' });
    const off = evaluateHostCliIsolation({ usesHostCli: true, isolation: 'off', bin: 'claude' });
    expect([none.severity, codex.severity, claude.severity, off.severity]).toEqual([
      'ok',
      'ok',
      'ok',
      'warning',
    ]);
    for (const check of [none, codex, claude, off]) {
      expect(check.name).toBe('host-cli-isolation');
      expect(row).toContain(`\`${check.detail}\``);
    }
    // Listed with the other verification checks, right after verification-fallback.
    const lines = DOCTOR_RAW.split('\n');
    const at = lines.findIndex((l) => l.startsWith('| `host-cli-isolation` |'));
    expect(lines[at - 1]).toMatch(/^\| `verification-fallback` \|/);
  });

  it('344-01/AC-7: commands.md says the "off" warning has no automatic fix, and the check carries no fixId', () => {
    const fix = flat(region(DOCTOR_RAW, '**`--fix` (v1.34)**', '\n---', 'commands.md doctor --fix'));
    expect(fix).toMatch(
      /The `host-cli-isolation` warning \(`verification\.hostCliIsolation` is `"off"`\) has no automatic fix/,
    );
    const manual = singleRow(DOCTOR_RAW, '| **manual** |');
    expect(manual).toContain('`host-cli-isolation`');
    const off = evaluateHostCliIsolation({ usesHostCli: true, isolation: 'off', bin: 'claude' });
    expect(off.fixId).toBeNull();
    expect(off.remediation).not.toBeNull();
  });

  it("344-01/AC-7: concepts.md's gate-provenance field list gains hostCliIsolation", () => {
    const bullet = flat(
      region(CONCEPTS_MD, '\n- Phase 344: `gates[]` entries', '\n- Phase ', 'concepts.md phase 344 bullet'),
    );
    expect(bullet).toContain('`hostCliIsolation`');
    expect(bullet).toContain(JSON.stringify(hostCliIsolationFlags('codex')));
    expect(bullet).toContain(JSON.stringify(hostCliIsolationFlags('claude')).replace(/,/g, ', '));
    expect(bullet).toMatch(/`deep-verify`, `code-review` and `security-audit`/);
    expect(bullet).toMatch(/Absent when isolation was off/);
    expect(bullet).toMatch(/provider was not `host-cli`/);
    expect(bullet).toMatch(/fell back to mock/);
    expect(bullet).toMatch(/no child was spawned/);
    expect(bullet).toMatch(/No `schemaVersion` bump, additive and content-hash-safe/);
    // It sits in the gate-provenance list, after the phase-275 fields.
    expect(CONCEPTS_MD.indexOf('- Phase 344: `gates[]` entries')).toBeGreaterThan(
      CONCEPTS_MD.indexOf('- Phase 275: `gates[]` entries'),
    );
  });

  it('344-01/AC-7: a minor changeset for cadence-core and cadence-types names both flag sets, the setting and what still reaches the reviewer, or its consumed CHANGELOG entries', () => {
    if (!existsSync(CHANGESET_PATH)) {
      // `changeset version` consumed the .md at release: the entry must now be in both CHANGELOGs.
      for (const pkg of ['core', 'types']) {
        expect(
          changesetEvidencePresent({
            changesetPath: CHANGESET_PATH,
            changesetPackage: `@thomas-powers-jr/cadence-${pkg}`,
            changelogPath: join(ROOT, 'packages', pkg, 'CHANGELOG.md'),
            discriminator: 'verification.hostCliIsolation',
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
    expect(body).toContain('phase 344');
    expect(body).toContain('rec-20261030-010');
    // Both flag sets, as whole command lines.
    expect(body).toContain(`\`${CODEX_LINE}\``);
    expect(body).toContain(`\`${CLAUDE_LINE}\``);
    // The setting, the gate-entry field and the doctor check.
    expect(body).toContain(SETTING);
    expect(body).toContain('`"on"` or `"off"`');
    expect(body).toMatch(/absent means `"on"`/);
    expect(body).toContain('`hostCliIsolation` field');
    expect(body).toContain('`host-cli-isolation` check');
    // What still reaches the reviewer.
    expect(body).toMatch(/global `AGENTS\.md` \(codex\) and the global `CLAUDE\.md` \(claude\) still reach the reviewer/);
    expect(body).toMatch(/project-level instruction files and hooks/);
    expect(body).not.toMatch(/\bisolated\b/i);
    // Upgrade notes.
    expect(body).toMatch(/Upgrade notes: the flags make the host CLI skip its user-level settings/);
    expect(body).toMatch(/it was not measured/);
    expect(body).toMatch(/when the CLI's error output names an isolation flag that was passed/);
    expect(body).toMatch(/model or effort level/);
    expect(body).toMatch(/sign-in setting/);
    expect(body).toMatch(/set `verification\.hostCliIsolation` to `"off"`/);
    // The Speculative Stamp: no version number and no date in a changeset body.
    expect(body).not.toMatch(/\bv?\d+\.\d+\.\d+\b/);
    expect(body).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  });
});
