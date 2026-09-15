import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Phase 299 / AC-1 + AC-4.
 *
 * The weekly CI security scan runs gitleaks over the full git history. Several
 * test fixtures under `packages/core/tests/` are deliberately shaped like real
 * credentials so the redaction code has something to redact — gitleaks cannot
 * tell them apart from a genuine leak, so each one carries a trailing
 * `// gitleaks:allow — <reason>` comment on its own line.
 *
 * That convention only holds if somebody keeps checking it. This test is that
 * check: it walks the whole test tree and asserts that every line containing a
 * known fake-secret literal also carries the `gitleaks:allow` token.
 *
 * Note this file's own literals below are annotated for exactly the same
 * reason, so the scan covers itself.
 */

/** Fake-credential literals that gitleaks' rules match on. */
const FAKE_SECRET_LITERALS = [
  'AKIAABCDEFGHIJKLMNOP', // gitleaks:allow — fixture literal, scan input
  'ghp_ABCDEFGHIJ1234567890abcd', // gitleaks:allow — fixture literal, scan input
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', // gitleaks:allow — fixture literal, scan input
  'sk-abc123XYZ456verylong', // gitleaks:allow — fixture literal, scan input
  'hunter2xyzLONG', // gitleaks:allow — fixture literal, scan input
  'abcdef0123456789', // gitleaks:allow — fixture literal, scan input
  'abc123def456', // gitleaks:allow — fixture literal, scan input
];

const ALLOW_TOKEN = 'gitleaks:allow';

const SELF = fileURLToPath(import.meta.url);
/** `packages/core/tests` — resolved from this file, never from `process.cwd()`. */
const TESTS_ROOT = resolve(SELF, '..', '..');

interface Occurrence {
  /** Path relative to `TESTS_ROOT`, forward-slashed. */
  readonly file: string;
  /** Absolute path, used to tell self-references apart from fixtures. */
  readonly absolute: string;
  readonly lineNumber: number;
  readonly literal: string;
  readonly annotated: boolean;
}

function listTypeScriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...listTypeScriptFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function findOccurrences(): Occurrence[] {
  const found: Occurrence[] = [];
  for (const absolute of listTypeScriptFiles(TESTS_ROOT)) {
    const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const literal of FAKE_SECRET_LITERALS) {
        if (!line.includes(literal)) continue;
        found.push({
          file: relative(TESTS_ROOT, absolute).split(sep).join('/'),
          absolute,
          lineNumber: index + 1,
          literal,
          annotated: line.includes(ALLOW_TOKEN),
        });
      }
    }
  }
  return found;
}

describe('gitleaks fixture annotations', () => {
  it('299-01/AC-1: every fake-secret fixture literal under packages/core/tests sits on a line carrying a gitleaks:allow comment', () => {
    const occurrences = findOccurrences();

    // Guard against a vacuous pass: a broken walk finds nothing and the
    // property below holds trivially.
    expect(occurrences.length).toBeGreaterThan(0);

    // Report by index rather than echoing the literal, so a failure message
    // never reprints the credential-shaped string.
    const unannotated = occurrences
      .filter((o) => !o.annotated)
      .map((o) => {
        const index = FAKE_SECRET_LITERALS.indexOf(o.literal) + 1;
        return `${o.file}:${o.lineNumber} (matched fixture literal #${index})`;
      });

    expect(unannotated).toEqual([]);
  });

  it('299-01/AC-4: the fixture scan is non-vacuous — each known literal is reached in at least one file other than this one', () => {
    const occurrences = findOccurrences().filter((o) => o.absolute !== SELF);

    const unreached = FAKE_SECRET_LITERALS.map((literal, index) => ({ literal, index }))
      .filter(({ literal }) => !occurrences.some((o) => o.literal === literal))
      .map(({ index }) => `fixture literal #${index + 1}`);

    expect(unreached).toEqual([]);
    expect(occurrences.length).toBeGreaterThanOrEqual(FAKE_SECRET_LITERALS.length);
  });

  it('299-01/AC-2: finding-routing.test.ts carries its gitleaks:allow comment on the same line as the match, not the line above', () => {
    const occurrences = findOccurrences().filter((o) =>
      o.file.endsWith('intelligence/finding-routing.test.ts'),
    );

    expect(occurrences.length).toBeGreaterThan(0);
    expect(occurrences.every((o) => o.annotated)).toBe(true);
  });

  it('299-01/AC-3: recommendations.test.ts annotates every occurrence, including the one distinct from the pre-existing 150/257 pair', () => {
    const occurrences = findOccurrences().filter((o) =>
      o.file.endsWith('intelligence/store/recommendations.test.ts'),
    );

    // Three known occurrences in this file: the pre-existing pair at 150/257
    // plus the one this phase fixed at ~line 30 — assert there are at least
    // that many and that every one of them is annotated, rather than pinning
    // exact line numbers that a future edit could shift.
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
    expect(occurrences.every((o) => o.annotated)).toBe(true);
  });

  describe('.gitleaksignore fingerprints', () => {
    // Inline comments (AC-1..AC-4) cannot retroactively suppress a historical
    // commit that introduced a fixture line before the annotation existed —
    // verified empirically this session, see dec-20260915-003. The real
    // proof that suppression works is a full-history `gitleaks detect` run
    // reporting 0 findings (recorded manually in this task's PROGRESS notes,
    // not gated by vitest — a format-only test here would pass on plausible
    // but wrong fingerprints). These tests assert only the narrower,
    // genuinely unit-testable invariant: every line is well-formed and
    // unique. They deliberately do NOT check that each fingerprint's commit
    // resolves via `git cat-file` — CI's ci.yml checks out with the default
    // shallow depth (no `fetch-depth: 0`, unlike security.yml), so that
    // check would pass locally and fail on every PR.
    const REPO_ROOT = resolve(TESTS_ROOT, '..', '..', '..');
    const FINGERPRINT_RE = /^[0-9a-f]{40}:[^:]+:[a-z0-9-]+:\d+$/;

    function readFingerprints(): string[] {
      const raw = readFileSync(join(REPO_ROOT, '.gitleaksignore'), 'utf8');
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
    }

    it('299-01/AC-5: every .gitleaksignore fingerprint line is well-formed (<commit>:<file>:<rule>:<line>)', () => {
      const fingerprints = readFingerprints();
      expect(fingerprints.length).toBeGreaterThan(0);

      const malformed = fingerprints.filter((fp) => !FINGERPRINT_RE.test(fp));
      expect(malformed).toEqual([]);
    });

    it('299-01/AC-5: every .gitleaksignore fingerprint is unique — no duplicate suppressions', () => {
      const fingerprints = readFingerprints();
      const seen = new Set(fingerprints);
      expect(seen.size).toBe(fingerprints.length);
    });
  });
});
