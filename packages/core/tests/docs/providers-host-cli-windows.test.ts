import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/core/tests/docs → repo root is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Isolates the `## host-cli — …` section from `docs/providers.md`, i.e.
 *  everything from its heading up to (not including) the next `## ` heading —
 *  so assertions here can't accidentally pass on unrelated text elsewhere in
 *  the doc (e.g. the `local` provider's own invocation examples). */
function readHostCliSection(): string {
  const text = readFileSync(join(REPO_ROOT, 'docs/providers.md'), 'utf8');
  const start = text.indexOf('\n## host-cli');
  expect(start, 'docs/providers.md is missing its "## host-cli" section heading').toBeGreaterThan(-1);
  const nextHeading = text.indexOf('\n## ', start + 1);
  expect(nextHeading, 'could not find the heading after "## host-cli" to bound the section').toBeGreaterThan(start);
  return text.slice(start, nextHeading);
}

describe('319-01/AC-6: docs/providers.md host-cli section describes win32 resolution', () => {
  it('319-01/AC-6: states native .com/.exe are tried before .bat/.cmd launchers', () => {
    const section = readHostCliSection();
    expect(section).toMatch(/native[\s\S]{0,120}\.com[\s\S]{0,40}\.exe/i);
    expect(section).toMatch(/\.bat[\s\S]{0,20}\.cmd/i);
  });

  it('319-01/AC-6: states the current directory is never searched', () => {
    const section = readHostCliSection();
    expect(section).toMatch(/current directory is never searched/i);
  });

  it('319-01/AC-6: states npm cmd-shim launchers run their JavaScript target via Node without a shell', () => {
    const section = readHostCliSection();
    expect(section).toMatch(/npm[^\n]*(?:cmd-shim|`\.cmd`)[^\n]*/i);
    expect(section).toMatch(/without a shell|never (?:uses?|invokes?) (?:a )?shell|no shell/i);
  });

  it('319-01/AC-6: states an unrecognised or escaping launcher is refused loudly', () => {
    const section = readHostCliSection();
    expect(section).toMatch(/refus(?:e|es|ed|ing)/i);
    expect(section).toMatch(/unrecognis(?:ed|e)|escap(?:e|es|ing)/i);
  });

  it('319-01/AC-6: names the native-executable CADENCE_HOST_CLI_BIN override', () => {
    const section = readHostCliSection();
    expect(section).toContain('CADENCE_HOST_CLI_BIN');
    expect(section).toMatch(/native executable|\.exe/i);
    expect(section).toMatch(/codex\.exe/);
  });

  it('319-01/AC-6: shows the real claude invocation example', () => {
    const section = readHostCliSection();
    expect(section).toContain('claude -p --output-format json');
  });

  it('319-01/AC-6: shows the real codex invocation example', () => {
    const section = readHostCliSection();
    expect(section).toContain('codex exec --json --skip-git-repo-check -');
  });

  it('319-01/AC-6: describes the prompt as written to stdin then closed, not "not piped"', () => {
    const section = readHostCliSection();
    expect(section).not.toMatch(/stdin is not piped/i);
    expect(section).toMatch(/written to\s+(?:the\s+)?child'?s?\s+stdin/i);
    expect(section).toMatch(/stdin[\s\S]{0,40}(?:then\s+)?closed|closed[\s\S]{0,40}stdin/i);
  });

  it('319-01/AC-6: no argv-style "<prompt>" example remains in the host-cli section', () => {
    const section = readHostCliSection();
    expect(section).not.toMatch(/"<prompt>"/);
  });
});
