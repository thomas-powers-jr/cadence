import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseExceptionsTable,
  isExpired,
  decideAdvisories,
  extractHighSeverityAdvisories,
} from '../../../../scripts/check-audit-exceptions.mjs';

// Resolve the repo-root audit exceptions doc from this test file's location:
// packages/core/tests/docs → ../../../../docs/security/audit-exceptions.md
const AUDIT_EXCEPTIONS_MD = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'docs',
  'security',
  'audit-exceptions.md',
);

const BRACES_ID = 'GHSA-vfj7-8cjw-p6xm';
const BRACE_EXPANSION_IDS = ['GHSA-qhr7-859c-m2p7', 'GHSA-6j4f-fj2g-mc7p'];
const LATEST_ALLOWED_EXPIRY = '2026-11-18';
const BEFORE_EXPIRY = new Date('2026-10-04');
const AFTER_EXPIRY = new Date('2026-11-19');

// A minimal `pnpm audit --json` payload in the `advisories`-map shape that
// extractHighSeverityAdvisories normalizes, carrying the three high-severity
// DoS advisories phase 321 addresses. Driving the fixture through the real
// extractor (rather than hand-building `{ id, package, severity }` objects)
// keeps the advisories in exactly the shape decideAdvisories receives in CI.
const AUDIT_JSON = {
  advisories: {
    1: { id: 1, github_advisory_id: BRACES_ID, module_name: 'braces', severity: 'high' },
    2: { id: 2, github_advisory_id: 'GHSA-qhr7-859c-m2p7', module_name: 'brace-expansion', severity: 'high' },
    3: { id: 3, github_advisory_id: 'GHSA-6j4f-fj2g-mc7p', module_name: 'brace-expansion', severity: 'high' },
  },
};

// Phase 321 — the braces advisory has no patched release, so it is excepted
// with a firm expiry and a named unblock condition; the two brace-expansion
// advisories are fixed by the pnpm override and must never be excepted.
// Qualifier and AC id kept apart in this comment (see security-ci.test.ts's
// 253-01 / AC-5 note): the coverage scanner records only the first
// qualified occurrence per token per file, which must be the asserting it().
describe('audit exceptions doc — braces excepted, brace-expansion fixed (321-01 / AC-2)', () => {
  const md = readFileSync(AUDIT_EXCEPTIONS_MD, 'utf8');
  const rows = parseExceptionsTable(md);

  it('excepts GHSA-vfj7-8cjw-p6xm for braces with a firm, unexpired expiry and a named unblock condition (321-01/AC-2)', () => {
    const row = rows.find((r) => r.id === BRACES_ID);
    expect(row).toBeDefined();
    expect(row?.package).toBe('braces');

    const expiry = row?.expiry ?? '';
    expect(expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(expiry <= LATEST_ALLOWED_EXPIRY).toBe(true);
    expect(isExpired(expiry, BEFORE_EXPIRY)).toBe(false);

    const justification = row?.justification ?? '';
    expect(justification).toContain('@changesets/cli');
    expect(justification).toContain('#474');
    expect(justification.toLowerCase()).toContain('no patched release');
    // Both unblock conditions, and the dev-only scope the exception rests on.
    expect(justification).toMatch(/patched `braces` release/);
    expect(justification).toContain('`@changesets/cli` 3.x');
    expect(justification).toContain('pnpm why braces -r --prod');
  });

  it('has no exception row for either brace-expansion advisory (321-01/AC-2)', () => {
    for (const id of BRACE_EXPANSION_IDS) {
      expect(rows.find((r) => r.id === id)).toBeUndefined();
    }
  });
});

// Phase 321 — the CI gate's own decision logic, run against the real parsed
// table: braces is accepted by its exception until the expiry lapses, while
// brace-expansion fails regardless (it must be fixed, not tolerated).
describe('check-audit-exceptions decision over the real table (321-01 / AC-3)', () => {
  const rows = parseExceptionsTable(readFileSync(AUDIT_EXCEPTIONS_MD, 'utf8'));
  const advisories = extractHighSeverityAdvisories(AUDIT_JSON);

  it('accepts braces and fails both brace-expansion advisories before the expiry (321-01/AC-3)', () => {
    expect(advisories).toHaveLength(3);
    expect(advisories.every((a) => a.severity === 'high')).toBe(true);

    const decision = decideAdvisories(advisories, rows, BEFORE_EXPIRY);

    expect(decision.ok).toBe(false);
    expect(decision.allowed.map((a) => a.id)).toEqual([BRACES_ID]);
    expect(decision.allowed[0]?.package).toBe('braces');
    expect(decision.failures.map((f) => f.id).sort()).toEqual([...BRACE_EXPANSION_IDS].sort());
    for (const failure of decision.failures) {
      expect(failure.package).toBe('brace-expansion');
      expect(failure.reason).toMatch(/not listed/);
    }
  });

  it('fails braces too once its exception has expired (321-01/AC-3)', () => {
    const decision = decideAdvisories(advisories, rows, AFTER_EXPIRY);

    expect(decision.ok).toBe(false);
    expect(decision.allowed).toHaveLength(0);
    expect(decision.failures.map((f) => f.id).sort()).toEqual([BRACES_ID, ...BRACE_EXPANSION_IDS].sort());
    const bracesFailure = decision.failures.find((f) => f.id === BRACES_ID);
    expect(bracesFailure?.reason).toMatch(/expired/);
  });
});
