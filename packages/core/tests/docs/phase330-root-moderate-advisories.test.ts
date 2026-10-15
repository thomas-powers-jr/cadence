import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractOverrideTargets, parseLockfilePackages, checkOverrideCoverage } from '../../../../scripts/check-lockfile-overrides.mjs';

// Phase 330 — the 13 moderate advisory entries `pnpm audit` reported against
// the root lockfile on 2026-10-15 (rec-20261008-002; hono x4, ip-address x4,
// qs x2, fast-uri, vitest, @vitest/mocker) are cleared by durable pnpm.overrides floors in the
// private root package.json, each a caret range at the strictest patched
// version the audit named. Everything here reads the real, committed repo
// files off disk; nothing calls `pnpm audit` (offline determinism), so the
// 13 -> 0 audit drop is recorded as SUMMARY/PR evidence, not asserted here.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

type Floor = [number, number, number];
type Target = { package: string; sourceVersion: string; range: string };
type Resolved = { package: string; version: string };

const atOrAbove = (version: string, floor: Floor): boolean => {
  const parts = version.split('.').slice(0, 3).map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const a = parts[i] ?? 0;
    const b = floor[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
};

// The phase 330 override keys and the patched floor each must hold.
const PHASE_330_TARGETS: { target: Target; floor: Floor }[] = [
  { target: { package: 'hono', sourceVersion: '<4.13.7', range: '^4.13.7' }, floor: [4, 13, 7] },
  { target: { package: 'qs', sourceVersion: '<6.16.0', range: '^6.16.0' }, floor: [6, 16, 0] },
  { target: { package: 'fast-uri', sourceVersion: '<3.1.8', range: '^3.1.8' }, floor: [3, 1, 8] },
  { target: { package: 'ip-address', sourceVersion: '^10.0.0', range: '^10.7.1' }, floor: [10, 7, 1] },
  { target: { package: 'vitest', sourceVersion: '<4.1.11', range: '^4.1.11' }, floor: [4, 1, 11] },
  { target: { package: '@vitest/coverage-v8', sourceVersion: '<4.1.11', range: '^4.1.11' }, floor: [4, 1, 11] },
];

// @vitest/mocker has no override key of its own: vitest pins it exactly, so
// the vitest floor carries it. It is still floor-checked in the lockfile.
const LOCKFILE_FLOORS: { package: string; floor: Floor }[] = [
  ...PHASE_330_TARGETS.map(({ target, floor }) => ({ package: target.package, floor })),
  { package: '@vitest/mocker', floor: [4, 1, 11] },
];

const VITEST_FAMILY = ['vitest', '@vitest/mocker', '@vitest/coverage-v8'];

describe('root overrides declare the phase 330 floors', () => {
  const targets: Target[] = extractOverrideTargets(JSON.parse(read('package.json')));

  it('names each caret floor at its advisory\'s strictest patched version and drops the stale fast-uri key (330-01/AC-1)', () => {
    for (const { target } of PHASE_330_TARGETS) {
      expect(targets).toContainEqual(target);
      // Caret-capped, never an unbounded `>=`: phase 253 saw an unbounded
      // target silently collapse one major line into another. Checked on the
      // parsed targets, not this file's own expected constants.
      const parsed = targets.filter((t) => t.package === target.package);
      expect(parsed.filter((t) => !t.range.startsWith('^')), `${target.package} non-caret targets`).toEqual([]);
    }

    // The superseded fast-uri key is gone, not left alongside the new one,
    // and each phase 330 package has exactly one override key.
    expect(targets.filter((t) => t.package === 'fast-uri' && t.sourceVersion === '<3.1.6')).toEqual([]);
    for (const { target } of PHASE_330_TARGETS) {
      expect(targets.filter((t) => t.package === target.package)).toHaveLength(1);
    }
  });
});

describe('committed lockfile satisfies the phase 330 floors', () => {
  const targets: Target[] = extractOverrideTargets(JSON.parse(read('package.json')));
  const lockfilePackages: Resolved[] = parseLockfilePackages(read('pnpm-lock.yaml'));

  it('has zero override-coverage failures and every floor package resolved at or above its patched version (330-01/AC-2)', () => {
    const result = checkOverrideCoverage(targets, lockfilePackages);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);

    for (const { package: name, floor } of LOCKFILE_FLOORS) {
      const instances = lockfilePackages.filter((p) => p.package === name);
      // Non-vacuity: each package is actually in the tree.
      expect(instances.length, `${name} resolves in pnpm-lock.yaml`).toBeGreaterThanOrEqual(1);
      expect(instances.filter((p) => !atOrAbove(p.version, floor)), `${name} below floor`).toEqual([]);
    }
  });

  it('resolves exactly one distinct version of each vitest-family package (330-01/AC-2)', () => {
    // parseLockfilePackages reads only the `packages:` section (it stops at
    // `snapshots:`), one entry per name@version, so a second resolved version
    // shows up as a second distinct version. Counting distinct versions keeps
    // the check independent of that parser detail.
    for (const name of VITEST_FAMILY) {
      const versions = new Set(lockfilePackages.filter((p) => p.package === name).map((p) => p.version));
      expect([...versions], `${name} distinct versions`).toHaveLength(1);
    }
  });
});

// A preservation check, green before and after the floors land by design:
// the fix lives only in the private root manifest, so no published package
// changes and no changeset is owed.
describe('published package manifests untouched', () => {
  const packagesDir = join(ROOT, 'packages');
  const manifests = readdirSync(packagesDir)
    .map((name) => join(packagesDir, name, 'package.json'))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')))
    .filter((manifest) => manifest.private !== true);

  it("keeps cadence-core's MCP SDK range and every published package's vitest specifier unchanged (330-01/AC-3)", () => {
    const core = manifests.find((m) => m.name === '@thomas-powers-jr/cadence-core');
    expect(core?.dependencies?.['@modelcontextprotocol/sdk']).toBe('^1.31.0');

    const withVitest = manifests.filter((m) => m.devDependencies?.vitest !== undefined);
    // Non-vacuity: today four published packages declare vitest (core and the
    // three host packages; types declares none).
    expect(withVitest.length).toBeGreaterThanOrEqual(4);
    for (const manifest of withVitest) {
      expect(manifest.devDependencies.vitest, `${manifest.name} vitest specifier`).toBe('^4.1.10');
    }
  });
});
