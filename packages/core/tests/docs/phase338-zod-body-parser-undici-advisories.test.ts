import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractOverrideTargets, parseLockfilePackages, checkOverrideCoverage } from '../../../../scripts/check-lockfile-overrides.mjs';

// Phase 338 — three high advisories turn `security-success` red on every PR:
// GHSA-mrhx-c7xc-m3w5 (zod <4.6.6, patched 4.6.6; root via @anthropic-ai/sdk
// and website via @astrojs/starlight>@astrojs/sitemap), GHSA-27r3-jxmh-p828
// (body-parser >=2.0.0 <2.4.0, patched 2.4.0; root via @modelcontextprotocol/sdk)
// and GHSA-xjj6-f33q-929c (undici >=8.0.0 <8.12.2, patched 8.12.2; website via
// astro>unifont). They are cleared by major-scoped caret pnpm.overrides floors
// in the two private manifests. Everything here reads the real, committed repo
// files off disk; nothing calls `pnpm audit` (offline determinism), so the
// high -> 0 audit drop is recorded as SUMMARY/PR evidence.
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

const major = (version: string): number => parseInt(version.split('.')[0] ?? '', 10);

const ZOD_FLOOR: Floor = [4, 6, 6];
const BODY_PARSER_FLOOR: Floor = [2, 4, 0];
const UNDICI_FLOOR: Floor = [8, 12, 2];

const ZOD_TARGET: Target = { package: 'zod', sourceVersion: '^4.0.0', range: '^4.6.6' };
const BODY_PARSER_TARGET: Target = { package: 'body-parser', sourceVersion: '^2.0.0', range: '^2.4.0' };
const UNDICI_TARGET: Target = { package: 'undici', sourceVersion: '^8.0.0', range: '^8.12.2' };

// Asserts that the resolved instances of `name` exist (non-vacuity), all sit on
// `onMajor`, and are all at or above `floor`.
const expectResolvedAtFloor = (lockfilePackages: Resolved[], name: string, onMajor: number, floor: Floor, label: string): void => {
  const instances = lockfilePackages.filter((p) => p.package === name);
  expect(instances.length, `${name} resolves in ${label}`).toBeGreaterThanOrEqual(1);
  expect(instances.filter((p) => !atOrAbove(p.version, floor)), `${name} below floor in ${label}`).toEqual([]);
  expect(instances.filter((p) => major(p.version) !== onMajor), `${name} off the ${onMajor}.x line in ${label}`).toEqual([]);
};

describe('root overrides declare the phase 338 floors', () => {
  const targets: Target[] = extractOverrideTargets(JSON.parse(read('package.json')));

  it('names the zod and body-parser caret floors at the advisories\' patched versions with one key per package (338-01/AC-1)', () => {
    for (const target of [ZOD_TARGET, BODY_PARSER_TARGET]) {
      const parsed = targets.filter((t) => t.package === target.package);
      // Exactly one key per package, scoped to the affected major, so no other
      // major can be dragged across a boundary. Checked on the parsed targets.
      expect(parsed, `${target.package} override keys`).toEqual([target]);
      expect(parsed.filter((t) => !t.range.startsWith('^')), `${target.package} non-caret targets`).toEqual([]);
      expect(parsed.filter((t) => !t.sourceVersion.startsWith('^')), `${target.package} non-caret source selectors`).toEqual([]);
    }
  });
});

describe('committed root lockfile satisfies the phase 338 floors', () => {
  const targets: Target[] = extractOverrideTargets(JSON.parse(read('package.json')));
  const lockfilePackages: Resolved[] = parseLockfilePackages(read('pnpm-lock.yaml'));

  it('has zero override-coverage failures with zod >= 4.6.6 and body-parser >= 2.4.0 resolved (338-01/AC-2)', () => {
    const result = checkOverrideCoverage(targets, lockfilePackages);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);

    expectResolvedAtFloor(lockfilePackages, 'zod', 4, ZOD_FLOOR, 'pnpm-lock.yaml');
    expectResolvedAtFloor(lockfilePackages, 'body-parser', 2, BODY_PARSER_FLOOR, 'pnpm-lock.yaml');
  });
});

// The security workflow audits website/'s own lockfile in a later step, which
// the root failure masked in CI; both lockfiles must be fixed together.
describe('website lockfile clears the zod and undici high advisories', () => {
  const websiteManifest = JSON.parse(read('website', 'package.json'));
  const targets: Target[] = extractOverrideTargets(websiteManifest);
  const lockfilePackages: Resolved[] = parseLockfilePackages(read('website', 'pnpm-lock.yaml'));

  it('floors every resolved zod at 4.6.6 and undici at 8.12.2 on their majors via one caret key each (338-01/AC-3)', () => {
    expect(websiteManifest.private).toBe(true);

    expect(targets.filter((t) => t.package === 'zod')).toEqual([ZOD_TARGET]);
    expect(targets.filter((t) => t.package === 'undici')).toEqual([UNDICI_TARGET]);

    const result = checkOverrideCoverage(targets, lockfilePackages);
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);

    expectResolvedAtFloor(lockfilePackages, 'zod', 4, ZOD_FLOOR, 'website/pnpm-lock.yaml');
    expectResolvedAtFloor(lockfilePackages, 'undici', 8, UNDICI_FLOOR, 'website/pnpm-lock.yaml');
  });
});

// A preservation check, green before and after the floors land by design: the
// fix is repo-local, so the published packages keep their current zod
// specifier (pinned from main) and no changeset is owed. Raising the published
// floor would be a separate, changeset-carrying decision.
describe('published package manifests untouched', () => {
  const packagesDir = join(ROOT, 'packages');
  const manifests = readdirSync(packagesDir)
    .map((name) => join(packagesDir, name, 'package.json'))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')))
    .filter((manifest) => manifest.private !== true);

  it('keeps zod at ^4.4.3 in exactly core and types and declares no body-parser or undici (338-01/AC-4)', () => {
    const withZod = manifests.filter((m) =>
      ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some((field) => m[field]?.zod !== undefined),
    );
    expect(withZod.map((m) => m.name).sort()).toEqual([
      '@thomas-powers-jr/cadence-core',
      '@thomas-powers-jr/cadence-types',
    ]);
    // Non-vacuity: both zod-declaring published packages were actually found.
    expect(withZod.length).toBeGreaterThanOrEqual(2);
    for (const manifest of withZod) {
      expect(manifest.dependencies?.zod, `${manifest.name} dependencies.zod`).toBe('^4.4.3');
    }

    for (const manifest of manifests) {
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const name of ['body-parser', 'undici']) {
          expect(manifest[field]?.[name], `${manifest.name} ${field}.${name}`).toBeUndefined();
        }
      }
    }
  });
});
