import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/core/tests/docs → repo root is four levels up.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Phase 326 (rec-20261007-002): `main`'s branch protection requires three
 * status checks, not just `ci-success`. The canonical list is parsed from
 * `docs/security/audit-exceptions.md`, the one in-repo record of the
 * protection setting. It is deliberately NOT derived from the workflows'
 * `*-success` job names: those jobs existed for weeks before they were
 * registered as required, which is how the docs drifted in the first place.
 *
 * That record is only as good as its last check against GitHub. Whenever
 * branch protection changes, re-verify it with
 * `gh api repos/thomas-powers-jr/cadence/branches/main/protection`
 * (`required_status_checks.contexts`) and update audit-exceptions.md in the
 * same change.
 *
 * Most files here are hard-wrapped prose, so per-passage assertions collapse
 * whitespace first: a phrase split across a line break still matches, and a
 * leftover phrase cannot hide from a negative check behind a wrap. The
 * paragraph guard (`unqualifiedRequiredClaims`) needs the raw text instead,
 * because blank lines are what separate its paragraphs.
 */
function readCollapsed(...segments: string[]): string {
  return readRaw(...segments).replace(/\s+/g, ' ');
}

function readRaw(...segments: string[]): string {
  return readFileSync(join(ROOT, ...segments), 'utf8');
}

interface ParsedChecks {
  /** How many times the anchored `contexts is [...]` form appears. */
  readonly matches: number;
  /** The raw text between the brackets of the first match, if any. */
  readonly inner: string | undefined;
  /** The quoted names inside the brackets of the first match. */
  readonly names: readonly string[];
}

const CONTEXTS_ANCHOR = /`required_status_checks\.contexts` is `\[([^\]]*)\]`/g;

function parseRequiredChecks(collapsed: string): ParsedChecks {
  const all = [...collapsed.matchAll(CONTEXTS_ANCHOR)];
  const inner = all[0]?.[1];
  const names =
    inner === undefined ? [] : [...inner.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
  return { matches: all.length, inner, names };
}

/** Top-level job keys (two-space indent) under a workflow's `jobs:` block. */
function jobKeys(...segments: string[]): string[] {
  const raw = readRaw(...segments);
  const jobsAt = raw.search(/^jobs:[ \t]*\r?$/m);
  if (jobsAt < 0) return [];
  return raw
    .slice(jobsAt)
    .split(/\r?\n/)
    .flatMap((line) => {
      const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
      return m?.[1] === undefined ? [] : [m[1]];
    });
}

/**
 * The recurrence guard (AC-5). Splits raw text into blank-line-separated
 * paragraphs (CRLF-safe; a bare `#` line counts as blank, so YAML comment
 * paragraphs split too), and also at the start of every Markdown list item,
 * then returns every chunk that mentions `ci-success`, talks about something
 * being required, and omits at least one name from the required-check list:
 * the exact shape of the drift this phase fixes.
 *
 * The list-item split matters for CLAUDE.md, whose lists have no blank lines
 * between items: on blank lines alone a whole 60-line list is one chunk, so a
 * new bullet claiming only `ci-success` is required would hide behind a
 * sibling bullet that names all three.
 */
function unqualifiedRequiredClaims(text: string, names: readonly string[]): string[] {
  return text
    .split(/\r?\n[ \t]*#?[ \t]*\r?\n|\r?\n(?=[ \t]*(?:[-*]|\d+\.)[ \t])/)
    .filter(
      (p) =>
        p.includes('ci-success') && /requir/i.test(p) && names.some((n) => !p.includes(n)),
    );
}

const auditDoc = readCollapsed('docs', 'security', 'audit-exceptions.md');
const parsed = parseRequiredChecks(auditDoc);
const names = parsed.names;

/** Every test that consumes the list first proves the parse is usable. */
function expectUsableList(): void {
  expect(names.length, 'parsed required-check list').toBeGreaterThanOrEqual(2);
  expect(names).toContain('ci-success');
}

/**
 * Slices `text` from `startMarker` up to (not including) the first
 * `endMarker` after it. Both markers must be found; a missing marker is an
 * assertion failure naming the passage, never a silent empty slice.
 */
function slicePassage(text: string, startMarker: string, endMarker: string, label: string): string {
  const start = text.indexOf(startMarker);
  expect(start, `${label}: start marker ${JSON.stringify(startMarker)} not found`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(endMarker, start + startMarker.length);
  expect(end, `${label}: end marker ${JSON.stringify(endMarker)} not found`).toBeGreaterThan(start);
  return text.slice(start, end);
}

/**
 * The required-check names `passage` does not mention. Pure, so each test
 * asserts on the result in its own body: the assertion-mode coverage scanner
 * only credits an `expect(` written inside the `it()` block, not one reached
 * through a helper.
 */
function missingNames(passage: string, backticked: boolean): string[] {
  return names
    .map((name) => (backticked ? `\`${name}\`` : name))
    .filter((needle) => !passage.includes(needle));
}

/** The stale phrases `passage` still contains. */
function stalePhrases(passage: string, stale: readonly string[]): string[] {
  return stale.filter((phrase) => passage.includes(phrase));
}

/**
 * The run of `#` comment lines immediately above a top-level job key, with
 * the leading `#`s stripped and whitespace collapsed.
 */
function commentAboveJob(job: string, ...segments: string[]): string {
  const lines = readRaw(...segments).split(/\r?\n/);
  const jobLine = new RegExp(`^ {2}${job}:\\s*$`);
  const at = lines.findIndex((l) => jobLine.test(l));
  expect(at, `${segments.join('/')}: job ${job} not found`).toBeGreaterThan(0);
  const block: string[] = [];
  for (let i = at - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined || !/^\s*#/.test(line)) break;
    block.unshift(line.replace(/^\s*#+/, ''));
  }
  return block.join(' ').replace(/\s+/g, ' ').trim();
}

const CLAUDE_STALE = [
  'the `ci-success` check is required',
  'Branch protection requires `ci-success` and applies',
] as const;

const SKILL_STALE = [
  '`main` requires the `ci-success` check',
  '`ci-success` required;',
  'so the required `ci-success` check is green',
] as const;

const WORKFLOW_STALE = [
  'not yet wired in',
  'blocks nothing',
  'exactly ["ci-success"]',
  'actually registered',
] as const;

describe('required status checks are named in full (phase 326)', () => {
  it('326-01/AC-1: audit-exceptions.md records the contexts list once, with at least two names including ci-success', () => {
    expect(parsed.matches).toBe(1);
    expect(parsed.inner).toBeDefined();
    // The brackets hold only comma-separated quoted names: nothing unparsed.
    expect((parsed.inner ?? '').trim()).toMatch(/^"[^"]+"(\s*,\s*"[^"]+")*$/);
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names).toContain('ci-success');
    expect(new Set(names).size).toBe(names.length);
  });

  it('326-01/AC-1: every recorded required check is a top-level job in ci.yml, security.yml or codeql.yml', () => {
    // One-way only: an aggregator job that is not yet registered as required
    // does not fail this test.
    const jobs = new Set([
      ...jobKeys('.github', 'workflows', 'ci.yml'),
      ...jobKeys('.github', 'workflows', 'security.yml'),
      ...jobKeys('.github', 'workflows', 'codeql.yml'),
    ]);
    expect(jobs.size).toBeGreaterThan(0);
    expect(names.length).toBeGreaterThanOrEqual(2);
    for (const name of names) {
      expect(jobs.has(name), `${name} is a top-level workflow job`).toBe(true);
    }
  });

  describe('CLAUDE.md', () => {
    const manual = readCollapsed('CLAUDE.md');

    it('326-01/AC-2: the "Land via branch + PR" workflow item names every required check', () => {
      expectUsableList();
      const label = 'CLAUDE.md "Land via branch + PR"';
      const passage = slicePassage(
        manual,
        '**Land via branch + PR, squash-merged.**',
        ' 8. **',
        label,
      );
      expect(missingNames(passage, true), label).toEqual([]);
      expect(stalePhrases(passage, CLAUDE_STALE), label).toEqual([]);
    });

    it('326-01/AC-2: the "CI" bullet under "Enforcement layers" names every required check', () => {
      expectUsableList();
      const label = 'CLAUDE.md Enforcement layers "CI"';
      const passage = slicePassage(
        manual,
        '**CI** (`.github/workflows/ci.yml`)',
        '- **Doc-content tests**',
        label,
      );
      expect(missingNames(passage, true), label).toEqual([]);
      expect(stalePhrases(passage, CLAUDE_STALE), label).toEqual([]);
    });

    it('326-01/AC-2: "The Direct Push" failure mode names every required check', () => {
      expectUsableList();
      const label = 'CLAUDE.md "The Direct Push"';
      const passage = slicePassage(
        manual,
        '**The Direct Push.**',
        '- **The Wrong-Checkout Commit.**',
        label,
      );
      expect(missingNames(passage, true), label).toEqual([]);
      expect(stalePhrases(passage, CLAUDE_STALE), label).toEqual([]);
    });
  });

  describe('skills and docs/release.md', () => {
    it('326-01/AC-3: the pr-land frontmatter description names every required check', () => {
      expectUsableList();
      const label = 'pr-land description';
      const lines = readRaw('.claude', 'skills', 'pr-land', 'SKILL.md').split(/\r?\n/);
      const description = lines.find((l) => l.startsWith('description:'));
      expect(description, `${label}: no description: line`).toBeDefined();
      // Frontmatter is plain YAML, so the names may appear without backticks.
      expect(missingNames(description ?? '', false), label).toEqual([]);
      expect(stalePhrases(description ?? '', SKILL_STALE), label).toEqual([]);
    });

    it('326-01/AC-3: the pr-land opening paragraph names every required check', () => {
      expectUsableList();
      const label = 'pr-land opening paragraph';
      const skill = readCollapsed('.claude', 'skills', 'pr-land', 'SKILL.md');
      const passage = slicePassage(skill, '# PR land (protected main)', '## 1', label);
      expect(missingNames(passage, true), label).toEqual([]);
      expect(stalePhrases(passage, SKILL_STALE), label).toEqual([]);
    });

    it('326-01/AC-3: release-cut step 4 (Release PR) names every required check', () => {
      expectUsableList();
      const label = 'release-cut step 4';
      const skill = readCollapsed('.claude', 'skills', 'release-cut', 'SKILL.md');
      const passage = slicePassage(skill, '## 4 ', '## 5 ', label);
      expect(passage).toContain('Release PR');
      expect(missingNames(passage, true), label).toEqual([]);
      expect(stalePhrases(passage, SKILL_STALE), label).toEqual([]);
    });

    it('326-01/AC-3: docs/release.md "Prepare A Version" names every required check', () => {
      expectUsableList();
      const label = 'docs/release.md "Prepare A Version"';
      const doc = readCollapsed('docs', 'release.md');
      const passage = slicePassage(doc, '5. Merge through a PR', 'The workflow uses', label);
      expect(missingNames(passage, true), label).toEqual([]);
      expect(stalePhrases(passage, SKILL_STALE), label).toEqual([]);
    });
  });

  describe('workflow aggregator comments', () => {
    const cases = [
      { job: 'security-success', file: 'security.yml' },
      { job: 'codeql-success', file: 'codeql.yml' },
    ] as const;

    for (const { job, file } of cases) {
      it(`326-01/AC-4: the comment above ${job} in ${file} says it is a required check on main`, () => {
        expectUsableList();
        const label = `${file} comment above ${job}`;
        const comment = commentAboveJob(job, '.github', 'workflows', file);
        expect(comment.length, `${label} is empty`).toBeGreaterThan(0);
        expect(stalePhrases(comment, WORKFLOW_STALE), label).toEqual([]);
        // Names checked inside the contexts clause only: the old comments
        // already mentioned all three elsewhere in the block.
        const clause = slicePassage(comment, 'required_status_checks.contexts is', '(registered', label);
        expect(missingNames(clause, false), `${label} contexts clause`).toEqual([]);
        // The claim itself, anchored on the job name: a bare /required/ would
        // also match the old "not yet ... required contexts" wording.
        expect(comment).toMatch(new RegExp(`${job} is one of main's \\w+ required status checks`));
        expect(comment).toContain('docs/security/audit-exceptions.md');
      });
    }

    it('326-01/AC-4: both aggregator comment blocks are found and non-empty', () => {
      expect(commentAboveJob('security-success', '.github', 'workflows', 'security.yml').length).toBeGreaterThan(0);
      expect(commentAboveJob('codeql-success', '.github', 'workflows', 'codeql.yml').length).toBeGreaterThan(0);
    });
  });

  describe('unqualifiedRequiredClaims recurrence guard', () => {
    const FIXTURE_NAMES = ['ci-success', 'security-success', 'codeql-success'] as const;
    const offending = '`ci-success` is required.';
    const compliant =
      'all three `ci-success` `security-success` `codeql-success` are required on `main`.';

    it('326-01/AC-5: returns a paragraph that names ci-success as required without the others', () => {
      const text = '`ci-success` is required on `main`.';
      expect(unqualifiedRequiredClaims(text, FIXTURE_NAMES)).toEqual([text]);
    });

    it('326-01/AC-5: returns nothing for a paragraph naming every required check', () => {
      expect(unqualifiedRequiredClaims(compliant, FIXTURE_NAMES)).toEqual([]);
    });

    it('326-01/AC-5: returns nothing for a paragraph mentioning ci-success without "requir"', () => {
      expect(
        unqualifiedRequiredClaims('Babysit `ci-success` until it goes green.', FIXTURE_NAMES),
      ).toEqual([]);
    });

    it('326-01/AC-5: on CRLF text returns exactly the offending paragraph between two compliant ones', () => {
      const text = `A ok\r\n\r\n${offending}\r\n\r\n${compliant}`;
      const hits = unqualifiedRequiredClaims(text, FIXTURE_NAMES);
      expect(hits).toHaveLength(1);
      expect(hits[0]).toBe(offending);
    });

    it('326-01/AC-5: on LF text with a whitespace-only separator line splits the same way', () => {
      const text = `${compliant}\n \t\n${offending}\n\nA ok`;
      expect(unqualifiedRequiredClaims(text, FIXTURE_NAMES)).toEqual([offending]);
    });

    it('326-01/AC-5: splits at list items, so a bad bullet cannot hide in a list with a compliant sibling', () => {
      const list = `- ${compliant}\n- ${offending}\n  continued on a wrapped line\n- A ok`;
      expect(unqualifiedRequiredClaims(list, FIXTURE_NAMES)).toEqual([
        `- ${offending}\n  continued on a wrapped line`,
      ]);
      const numbered = `1. ${compliant}\r\n2. ${offending}`;
      expect(unqualifiedRequiredClaims(numbered, FIXTURE_NAMES)).toEqual([`2. ${offending}`]);
    });

    it('326-01/AC-5: splits YAML comment paragraphs at bare # lines', () => {
      const yaml = `  # ${compliant}\n  #\n  # ${offending}\r\n  #\r\n  # A ok\n  job:`;
      expect(unqualifiedRequiredClaims(yaml, FIXTURE_NAMES)).toEqual([`  # ${offending}`]);
    });

    // The guard is scoped to the six files that carried the drift; history
    // (DESIGN.md, CHANGELOGs, docs/handoffs/*, .cadence/**) and ci.yml are
    // deliberately out of scope. CLAUDE.md, the sixth file, gets its own
    // statically titled test after the loop.
    const guarded: Record<string, readonly string[]> = {
      '.claude/skills/pr-land/SKILL.md': ['.claude', 'skills', 'pr-land', 'SKILL.md'],
      '.claude/skills/release-cut/SKILL.md': ['.claude', 'skills', 'release-cut', 'SKILL.md'],
      'docs/release.md': ['docs', 'release.md'],
      '.github/workflows/security.yml': ['.github', 'workflows', 'security.yml'],
      '.github/workflows/codeql.yml': ['.github', 'workflows', 'codeql.yml'],
    };

    for (const [file, segments] of Object.entries(guarded)) {
      it(`326-01/AC-5: ${file} has no paragraph naming ci-success as required without the others`, () => {
        expectUsableList();
        expect(unqualifiedRequiredClaims(readRaw(...segments), names)).toEqual([]);
      });
    }

    it('326-01/AC-5: CLAUDE.md has no paragraph naming ci-success as required without the others', () => {
      expectUsableList();
      expect(unqualifiedRequiredClaims(readRaw('CLAUDE.md'), names)).toEqual([]);
    });
  });
});
