import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractOverrideTargets, parseLockfilePackages, checkOverrideCoverage } from '../../../../scripts/check-lockfile-overrides.mjs';
import {
  parseExceptionsTable,
  decideAdvisories,
  extractHighSeverityAdvisories,
} from '../../../../scripts/check-audit-exceptions.mjs';

// Phase 329 — Dependabot #474's substance, landed on a fresh branch:
// @changesets/cli 3.x no longer pulls read-yaml-file, js-yaml or braces, so
// the two override keys that pinned the first two go dead (the overrides
// checker reports them as unresolved-target) and the braces audit exception
// that expired on 2026-11-18 is retired. Everything here reads the real,
// committed repo files off disk.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const BRACES_ID = 'GHSA-vfj7-8cjw-p6xm';

describe('changesets 3.x adoption — manifest and lockfile', () => {
  const packageJson = JSON.parse(read('package.json'));
  const lockfilePackages = parseLockfilePackages(read('pnpm-lock.yaml'));

  it('declares @changesets/cli at ^3.x and has no dead read-yaml-file or js-yaml override key (329-01/AC-1)', () => {
    expect(packageJson.devDependencies['@changesets/cli']).toMatch(/^\^3\./);

    const targets = extractOverrideTargets(packageJson);
    const dead = targets.filter((t: { package: string }) => t.package === 'read-yaml-file' || t.package === 'js-yaml');
    expect(dead).toEqual([]);

    const result = checkOverrideCoverage(targets, lockfilePackages);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('resolves no braces, js-yaml, read-yaml-file or @changesets/cli 2.x package in pnpm-lock.yaml (329-01/AC-1)', () => {
    const gone = lockfilePackages.filter((p: { package: string }) =>
      ['braces', 'js-yaml', 'read-yaml-file'].includes(p.package),
    );
    expect(gone).toEqual([]);

    const cli = lockfilePackages.filter((p: { package: string }) => p.package === '@changesets/cli');
    expect(cli.length).toBeGreaterThanOrEqual(1);
    expect(cli.filter((p: { version: string }) => !p.version.startsWith('3.'))).toEqual([]);
  });
});

describe('braces audit exception retired', () => {
  const md = read('docs', 'security', 'audit-exceptions.md');
  const rows = parseExceptionsTable(md);

  it('has no GHSA-vfj7-8cjw-p6xm row, keeps the table, and fails a reappearing braces advisory as not listed (329-01/AC-2)', () => {
    expect(rows.find((r: { id: string }) => r.id === BRACES_ID)).toBeUndefined();

    // Non-vacuity: the section and its column header are still there, so the
    // absence above means "retired", not "the parser found no table". An
    // empty table is the healthy state (phases 260 and 297).
    expect(md).toContain('## Exceptions');
    expect(md).toContain('| Advisory ID | Package | Justification | Expiry |');

    const advisories = extractHighSeverityAdvisories({
      advisories: { 1: { id: 1, github_advisory_id: BRACES_ID, module_name: 'braces', severity: 'high' } },
    });
    const decision = decideAdvisories(advisories, rows, new Date('2026-10-13'));
    expect(decision.ok).toBe(false);
    expect(decision.allowed).toEqual([]);
    expect(decision.failures.map((f: { id: string }) => f.id)).toEqual([BRACES_ID]);
    expect(decision.failures[0]?.reason).toMatch(/not listed/);
  });
});

// A compatibility precondition: .changeset/config.json does not change in
// this phase, so these are green before and after the bump by design. They
// guard the 3.x upgrade against config drift (3.x removed the `prettier`
// option in favor of `format`).
describe('changesets config compatible with 3.x', () => {
  const config = JSON.parse(read('.changeset', 'config.json'));

  it('has no prettier key, keeps the five-package fixed group with testkit ignored, and resolves its changelog generator (329-01/AC-3)', () => {
    expect(Object.keys(config)).not.toContain('prettier');

    expect(config.fixed).toHaveLength(1);
    expect([...config.fixed[0]].sort()).toEqual(
      [
        '@thomas-powers-jr/cadence-core',
        '@thomas-powers-jr/cadence-host-claude-code',
        '@thomas-powers-jr/cadence-host-codex',
        '@thomas-powers-jr/cadence-host-toolkit',
        '@thomas-powers-jr/cadence-types',
      ].sort(),
    );
    expect(config.ignore).toEqual(['@thomas-powers-jr/cadence-testkit']);

    expect(config.changelog).toBe('@changesets/cli/changelog');
    const requireFromRoot = createRequire(join(ROOT, 'package.json'));
    expect(() => requireFromRoot.resolve(config.changelog)).not.toThrow();
  });
});
