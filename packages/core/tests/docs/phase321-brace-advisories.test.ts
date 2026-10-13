import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseExceptionsTable,
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
// The retired exception's old expiry was 2026-11-18; these dates sit either side of it.
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

// Phase 321 excepted the braces advisory (no patched release) with an expiry
// of 2026-11-18 and a named unblock: `@changesets/cli` 3.x (Dependabot #474).
// Phase 329 met that unblock — changesets 3.x drops braces from the tree — so
// the exception row is retired, as phase 260 and 297 retired theirs, and these
// assertions are superseded to pin the retired state. The two brace-expansion
// advisories are fixed by the pnpm override and must never be excepted.
// Qualifier and AC id kept apart in this comment (see security-ci.test.ts's
// 253-01 / AC-5 note): the coverage scanner records only the first
// qualified occurrence per token per file, which must be the asserting it().
describe('audit exceptions doc — braces exception retired, brace-expansion fixed (321-01 / AC-2, superseded by 329-01 / AC-2)', () => {
  const md = readFileSync(AUDIT_EXCEPTIONS_MD, 'utf8');
  const rows = parseExceptionsTable(md);

  it('no longer excepts GHSA-vfj7-8cjw-p6xm: the row was retired once @changesets/cli 3.x dropped braces, before its 2026-11-18 expiry (321-01/AC-2)', () => {
    expect(rows.find((r) => r.id === BRACES_ID)).toBeUndefined();
    expect(rows.find((r) => r.package === 'braces')).toBeUndefined();
    // Non-vacuity: the table itself is still present (empty is healthy).
    expect(md).toContain('| Advisory ID | Package | Justification | Expiry |');
  });

  it('has no exception row for either brace-expansion advisory (321-01/AC-2)', () => {
    for (const id of BRACE_EXPANSION_IDS) {
      expect(rows.find((r) => r.id === id)).toBeUndefined();
    }
  });
});

// Phase 321 — the CI gate's own decision logic, run against the real parsed
// table. Phase 321 accepted braces by its exception until the expiry; since
// phase 329 retired that row, a reappearing braces advisory fails as not
// listed on any date, exactly like brace-expansion (fixed, not tolerated).
describe('check-audit-exceptions decision over the real table (321-01 / AC-3, superseded by 329-01 / AC-2)', () => {
  const rows = parseExceptionsTable(readFileSync(AUDIT_EXCEPTIONS_MD, 'utf8'));
  const advisories = extractHighSeverityAdvisories(AUDIT_JSON);

  it('fails braces and both brace-expansion advisories as not listed before the old expiry (321-01/AC-3)', () => {
    expect(advisories).toHaveLength(3);
    expect(advisories.every((a) => a.severity === 'high')).toBe(true);

    const decision = decideAdvisories(advisories, rows, BEFORE_EXPIRY);

    expect(decision.ok).toBe(false);
    expect(decision.allowed).toHaveLength(0);
    expect(decision.failures.map((f) => f.id).sort()).toEqual([BRACES_ID, ...BRACE_EXPANSION_IDS].sort());
    for (const failure of decision.failures) {
      expect(failure.reason).toMatch(/not listed/);
    }
  });

  it('still fails all three after the old expiry date, with no exception left to lapse (321-01/AC-3)', () => {
    const decision = decideAdvisories(advisories, rows, AFTER_EXPIRY);

    expect(decision.ok).toBe(false);
    expect(decision.allowed).toHaveLength(0);
    expect(decision.failures.map((f) => f.id).sort()).toEqual([BRACES_ID, ...BRACE_EXPANSION_IDS].sort());
    const bracesFailure = decision.failures.find((f) => f.id === BRACES_ID);
    expect(bracesFailure?.reason).toMatch(/not listed/);
  });
});
