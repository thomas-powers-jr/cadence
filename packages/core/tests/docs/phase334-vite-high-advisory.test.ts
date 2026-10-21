import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractOverrideTargets, parseLockfilePackages, checkOverrideCoverage } from '../../../../scripts/check-lockfile-overrides.mjs';

// Phase 334 — GHSA-587h-7wmj-h5pm (high, published 2026-10-20) and its two
// moderate siblings GHSA-698v-4r3x-3vcv and GHSA-r825-w8mm-5pxw hit the
// dev-only vite 7.3.6 that vitest pulls in as a peer (vulnerable >=7.0.0
// <=7.3.6, patched 7.3.7); the high one also names launch-editor <=2.14.1
// (patched 2.14.2). They are cleared by caret pnpm.overrides floors in the
// private root package.json; the website leg (AC-4) is described below.
// Everything here reads the real, committed repo files off disk; nothing
// calls `pnpm audit` (offline determinism), so the 1 high + 2 moderate -> 0
// audit drop is recorded as SUMMARY/PR evidence.
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

// The vite key is phase 260's existing selector (it matches vitest's
// `^6 || ^7 || ^8` peer and is what holds vite on the 7.x line), raised in
// place from ^7.3.5 rather than stacked with a second overlapping vite key.
const PHASE_334_TARGETS: { target: Target; floor: Floor }[] = [
  { target: { package: 'vite', sourceVersion: '^6.0.0 || ^7.0.0 || ^8.0.0', range: '^7.3.7' }, floor: [7, 3, 7] },
  { target: { package: 'launch-editor', sourceVersion: '<2.14.2', range: '^2.14.2' }, floor: [2, 14, 2] },
];

describe('root overrides declare the phase 334 floors', () => {
  const targets: Target[] = extractOverrideTargets(JSON.parse(read('package.json')));

  it("names each caret floor at the advisory's patched version with one key per package (334-01/AC-1)", () => {
    for (const { target } of PHASE_334_TARGETS) {
      expect(targets).toContainEqual(target);
      // Exactly one key per package, so the superseded vite ^7.3.5 target is
      // gone rather than left alongside the new one, and caret-capped, never
      // an unbounded `>=` (phase 253 saw one collapse a major line). Checked
      // on the parsed targets, not this file's own expected constants.
      const parsed = targets.filter((t) => t.package === target.package);
      expect(parsed, `${target.package} override keys`).toHaveLength(1);
      expect(parsed.filter((t) => !t.range.startsWith('^')), `${target.package} non-caret targets`).toEqual([]);
    }
  });
});

describe('committed lockfile satisfies the phase 334 floors', () => {
  const targets: Target[] = extractOverrideTargets(JSON.parse(read('package.json')));
  const lockfilePackages: Resolved[] = parseLockfilePackages(read('pnpm-lock.yaml'));

  it('has zero override-coverage failures and every floor package resolved at or above its patched version (334-01/AC-2)', () => {
    const result = checkOverrideCoverage(targets, lockfilePackages);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);

    for (const { target, floor } of PHASE_334_TARGETS) {
      const instances = lockfilePackages.filter((p) => p.package === target.package);
      // Non-vacuity: each package is actually in the tree.
      expect(instances.length, `${target.package} resolves in pnpm-lock.yaml`).toBeGreaterThanOrEqual(1);
      expect(instances.filter((p) => !atOrAbove(p.version, floor)), `${target.package} below floor`).toEqual([]);
    }
  });

  it('resolves exactly one vite version, still on the 7.x line (334-01/AC-2)', () => {
    // parseLockfilePackages reads only the `packages:` section, one entry per
    // name@version, so a second resolved version shows up as a second
    // distinct version. Adopting vite 8 is its own phase, not this fix.
    const versions = [...new Set(lockfilePackages.filter((p) => p.package === 'vite').map((p) => p.version))];
    expect(versions, 'vite distinct versions').toHaveLength(1);
    expect(versions[0]).toMatch(/^7\./);
  });
});

// The security workflow runs the same audit against website/'s own lockfile
// in a later step, which the vite failure masked: GHSA-gfr2-rv44-r23c (high,
// published 2026-10-20) hits markdown-it 14.3.2 there, reached only through
// the website's direct typedoc devDependency (`markdown-it: ^14.3.0`), which
// starlight-typedoc also peers. The floor is scoped
// to the 14.x line, phase 328 style, so it cannot pull another major across.
describe('website lockfile clears the markdown-it high advisory', () => {
  const websiteManifest = JSON.parse(read('website', 'package.json'));
  const targets: Target[] = extractOverrideTargets(websiteManifest);
  const lockfilePackages: Resolved[] = parseLockfilePackages(read('website', 'pnpm-lock.yaml'));

  it('floors every resolved markdown-it at 14.3.3 on the 14.x line via one caret override key (334-01/AC-4)', () => {
    expect(websiteManifest.private).toBe(true);

    const markdownIt = targets.filter((t) => t.package === 'markdown-it');
    expect(markdownIt).toEqual([{ package: 'markdown-it', sourceVersion: '^14.0.0', range: '^14.3.3' }]);

    const result = checkOverrideCoverage(targets, lockfilePackages);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);

    const instances = lockfilePackages.filter((p) => p.package === 'markdown-it');
    // Non-vacuity: markdown-it is actually in the website tree.
    expect(instances.length, 'markdown-it resolves in website/pnpm-lock.yaml').toBeGreaterThanOrEqual(1);
    expect(instances.filter((p) => !atOrAbove(p.version, [14, 3, 3])), 'markdown-it below floor').toEqual([]);
    expect(instances.filter((p) => !p.version.startsWith('14.')), 'markdown-it off the 14.x line').toEqual([]);
  });
});

// A preservation check, green before and after the floors land by design:
// the fix lives only in the private root and website manifests, so no
// published package changes and no changeset is owed.
describe('published package manifests untouched', () => {
  const packagesDir = join(ROOT, 'packages');
  const manifests = readdirSync(packagesDir)
    .map((name) => join(packagesDir, name, 'package.json'))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')))
    .filter((manifest) => manifest.private !== true);

  it('declares no direct vite or launch-editor dependency and keeps every vitest specifier (334-01/AC-3)', () => {
    for (const manifest of manifests) {
      for (const name of ['vite', 'launch-editor']) {
        expect(manifest.dependencies?.[name], `${manifest.name} dependencies.${name}`).toBeUndefined();
        expect(manifest.devDependencies?.[name], `${manifest.name} devDependencies.${name}`).toBeUndefined();
      }
    }

    const withVitest = manifests.filter((m) => m.devDependencies?.vitest !== undefined);
    // Non-vacuity: today four published packages declare vitest (core and the
    // three host packages; types declares none).
    expect(withVitest.length).toBeGreaterThanOrEqual(4);
    for (const manifest of withVitest) {
      expect(manifest.devDependencies.vitest, `${manifest.name} vitest specifier`).toBe('^4.1.10');
    }
  });
});
