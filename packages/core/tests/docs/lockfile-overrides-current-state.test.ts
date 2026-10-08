import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractOverrideTargets, parseLockfilePackages, checkOverrideCoverage } from '../../../../scripts/check-lockfile-overrides.mjs';

// 253-01, AC-1 and AC-2 (phase 253, task T4) — the real disk-reading proof
// that the corrected override targets in the REAL, committed package.json
// satisfy every REAL resolved instance in the REAL, refreshed
// pnpm-lock.yaml. Unlike check-lockfile-overrides.test.ts (T1's fixture-based
// unit tests for the pure functions themselves, modeling both the
// pre-remediation and anticipated post-remediation shapes), this test reads
// the two actual repo files off disk — mirrors release-integrity.test.ts's
// "Release workflow integrity wiring" pattern of asserting against real
// files rather than a fixture.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PACKAGE_JSON = join(ROOT, 'package.json');
const LOCKFILE = join(ROOT, 'pnpm-lock.yaml');

const atOrAbove = (version: string, floor: [number, number, number]): boolean => {
  const parts = version.split('.').slice(0, 3).map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const a = parts[i] ?? 0;
    const b = floor[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
};

describe('lockfile overrides — real, current repo state (253-01, AC-1 and AC-2)', () => {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
  const lockfileText = readFileSync(LOCKFILE, 'utf8');

  it("names the corrected patched-floor targets in package.json's pnpm.overrides (253-01/AC-1, 321-01/AC-1, 324-01/AC-1)", () => {
    const targets = extractOverrideTargets(packageJson);

    // fast-uri: retargeted to the real patched floor -- for real this time.
    // Phase 253 wrote `^3.1.5` under this same "real patched floor" comment,
    // but 3.1.5 is still vulnerable: GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc,
    // GHSA-fph4-wmhf-6fwf and GHSA-jqff-g426-hqxp are all patched in >=3.1.6.
    // The old key was doubly broken -- having bumped the tree to 3.1.5, the
    // pinned key `fast-uri@3.1.2` then matched nothing at all, so it was the
    // silent-no-op stale key this very file exists to guard against. Phase 297
    // uses a RANGE key so it cannot rot the same way on the next bump.
    expect(targets).toContainEqual({ package: 'fast-uri', sourceVersion: '<3.1.6', range: '^3.1.6' });
    // brace-expansion 5.x line: retargeted to the real patched floor, as a
    // RANGE key. Phase 253 pinned `brace-expansion@5.0.6: ^5.0.9`; once the
    // tree moved to 5.0.9 that exact-version key matched nothing, and 5.0.9
    // is itself still vulnerable (GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p,
    // both fixed in >=5.0.11). Phase 321 keys the override on `^5.0.0` so it
    // keeps binding every 5.x dependent across future bumps.
    expect(targets).toContainEqual({ package: 'brace-expansion', sourceVersion: '^5.0.0', range: '^5.0.11' });
    // The stale exact-version key is gone, not left alongside the new one.
    expect(targets.filter((t: { package: string; sourceVersion: string }) => t.package === 'brace-expansion' && t.sourceVersion === '5.0.6')).toEqual([]);
    // brace-expansion 2.x line: its own new override, distinct from the 5.x
    // line's key — not an unversioned key that would wrongly force one line
    // toward the other's target. A caret range (major-capped), not an
    // unbounded `>=`: an earlier draft of this override used `>=2.1.4` and it
    // empirically, silently collapsed the 2.x line into the unrelated 5.x
    // line's resolution (an unbounded `>=` target has no upper bound, so
    // pnpm satisfies it with whatever's latest anywhere in the graph, even
    // across a major boundary — see 253-01-T3-EVIDENCE.md's "declared-range
    // intersection" finding). `^2.1.4` pins the resolution to major 2.
    expect(targets).toContainEqual({ package: 'brace-expansion', sourceVersion: '^2.0.0', range: '^2.1.4' });
    const braceExpansionTargets = targets.filter((t: { package: string }) => t.package === 'brace-expansion');
    expect(braceExpansionTargets).toHaveLength(2);
    expect(new Set(braceExpansionTargets.map((t: { sourceVersion: string }) => t.sourceVersion)).size).toBe(2);
    // ip-address: previously had no override at all — a new one closing the
    // patched floor. This repo's dependency graph has only one ip-address
    // major today, so an unbounded `>=10.3.1` would not currently collapse
    // anything the way brace-expansion's unbounded range did above — but a
    // caret range is applied here too, proactively, for the same
    // future-drift-resistance reason (a future second ip-address major
    // entering the graph would otherwise silently repeat the collapse).
    expect(targets).toContainEqual({ package: 'ip-address', sourceVersion: '^10.0.0', range: '^10.3.1' });
    // js-yaml: floor raised past CVE-2026-84375 (GHSA-2883-xcg3-v3hh, high),
    // which affects 4.0.0-4.3.1 and is fixed in 4.3.2. The source-version key
    // (js-yaml@4.2.0) is unchanged from phase 253/260 — check-lockfile-overrides.mjs
    // already reports it satisfied against today's resolved instances, so this
    // is purely a too-low target floor, not a stale-key problem (298-01/AC-1, AC-4).
    expect(targets).toContainEqual({ package: 'js-yaml', sourceVersion: '4.2.0', range: '^4.3.2' });
    // proxy-addr: GHSA-jqcg-44mw-7w3h (critical, IP spoofing via IPv4-mapped
    // addresses) affects >=1.1.0 <2.0.8. express@5.2.1 declares `^2.0.7`, so a
    // plain install keeps the locked 2.0.7; the range key moves it to 2.0.8.
    expect(targets).toContainEqual({ package: 'proxy-addr', sourceVersion: '<2.0.8', range: '^2.0.8' });
    // source-map-js: GHSA-68fv-2mgg-jv7q (high, event-loop DoS) affects <1.2.2;
    // dev-only, via @vitest/coverage-v8 -> magicast and vite -> postcss.
    expect(targets).toContainEqual({ package: 'source-map-js', sourceVersion: '<1.2.2', range: '^1.2.2' });
  });

  it('every resolved instance of fast-uri, brace-expansion (both lines), ip-address, js-yaml, proxy-addr and source-map-js satisfies its override target (253-01/AC-2, 298-01/AC-4, 321-01/AC-1)', () => {
    const overrideTargets = extractOverrideTargets(packageJson);
    const lockfilePackages = parseLockfilePackages(lockfileText);

    // Sanity: brace-expansion resolves to at least one live instance in the
    // real lockfile. At 253-01 time it resolved to two (minimatch@9.x's 2.x
    // line and minimatch@10.x's 5.x line), which is what originally
    // motivated this test's "not just the first instance found" phrasing for
    // AC-2. Phase 260's vitest v4 bump (and its transitive vite/vitest dep
    // graph) dropped minimatch@9.x from the resolved graph entirely, so only
    // the 5.x line remains (as of phase 321) — a real, expected dependency-graph shift,
    // not a regression (the `brace-expansion@^2.0.0` override in
    // package.json's pnpm.overrides stays in place regardless, ready to
    // cover a 2.x line again if one re-enters the graph later). The
    // multi-instance "don't stop at the first match" behavior itself stays
    // covered by check-lockfile-overrides.test.ts's fixture-based unit tests,
    // which model that shape directly rather than depending on today's real
    // graph happening to contain two majors of the same package.
    const braceExpansionInstances = lockfilePackages.filter((p: { package: string }) => p.package === 'brace-expansion');
    expect(braceExpansionInstances.length).toBeGreaterThanOrEqual(1);

    const result = checkOverrideCoverage(overrideTargets, lockfilePackages);

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('every resolved brace-expansion 5.x instance in the real lockfile is at or above the patched floor 5.0.11 (321-01/AC-1)', () => {
    // An explicit numeric floor check, independent of checkOverrideCoverage's
    // own range logic: GHSA-qhr7-859c-m2p7 and GHSA-6j4f-fj2g-mc7p affect
    // brace-expansion 5.x below 5.0.11.
    const lockfilePackages = parseLockfilePackages(lockfileText);
    const fiveX = lockfilePackages.filter(
      (p: { package: string; version: string }) => p.package === 'brace-expansion' && p.version.split('.')[0] === '5',
    );
    expect(fiveX.length).toBeGreaterThanOrEqual(1);

    const belowFloor = fiveX.filter((p: { version: string }) => !atOrAbove(p.version, [5, 0, 11]));
    expect(belowFloor).toEqual([]);
  });

  it('every resolved proxy-addr instance is at or above 2.0.8 and every source-map-js instance at or above 1.2.2 (324-01/AC-1)', () => {
    // Explicit numeric floor checks, independent of checkOverrideCoverage's own
    // range logic: GHSA-jqcg-44mw-7w3h affects proxy-addr <2.0.8 and
    // GHSA-68fv-2mgg-jv7q affects source-map-js <1.2.2.
    const lockfilePackages = parseLockfilePackages(lockfileText);

    const proxyAddr = lockfilePackages.filter((p: { package: string }) => p.package === 'proxy-addr');
    expect(proxyAddr.length).toBeGreaterThanOrEqual(1);
    expect(proxyAddr.filter((p: { version: string }) => !atOrAbove(p.version, [2, 0, 8]))).toEqual([]);

    const sourceMapJs = lockfilePackages.filter((p: { package: string }) => p.package === 'source-map-js');
    expect(sourceMapJs.length).toBeGreaterThanOrEqual(1);
    expect(sourceMapJs.filter((p: { version: string }) => !atOrAbove(p.version, [1, 2, 2]))).toEqual([]);
  });
});
