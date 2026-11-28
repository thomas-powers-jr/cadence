import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 353 (353-01): test files are type-checked. Each package carries a
// `tsconfig.test.json` that its `typecheck` script runs after the build
// config check.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const TSC = join(REPO_ROOT, 'node_modules/typescript/bin/tsc');

const PACKAGES = ['checkpoint', 'core', 'host-claude-code', 'host-codex', 'host-toolkit', 'testkit', 'types'] as const;
const TEST_TYPECHECK_SCRIPT = 'tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json';
const DEFAULT_EXCLUDES = ['node_modules', 'dist'];

/**
 * Core test files (relative to packages/core) that failed the test config on
 * main ed1489d1, less the 14 that phase 357 released. This list may only shrink: a phase that fixes one of these
 * files removes it here and from packages/core/tsconfig.test.json together.
 */
const BASELINE: readonly string[] = [
  'tests/checks/skill-audit.test.ts',
  'tests/cli/dispatch-plan.test.ts',
  'tests/cli/settle-auto.test.ts',
  'tests/coherence/check-unbounded-then.test.ts',
  'tests/coherence/check.test.ts',
  'tests/config-explain/render.test.ts',
  'tests/config-explain/warnings.test.ts',
  'tests/docs/criteria-anchoring-docs.test.ts',
  'tests/doctor/run.test.ts',
  'tests/gates/assurance-record.test.ts',
  'tests/gates/build-context.test.ts',
  'tests/gates/code-review-criteria-gap.test.ts',
  'tests/gates/code-review.test.ts',
  'tests/gates/coherence.test.ts',
  'tests/gates/engine.test.ts',
  'tests/gates/per-task-verify.test.ts',
  'tests/gates/plan-review.test.ts',
  'tests/init/init-plan.test.ts',
  'tests/integration/end-to-end.test.ts',
  'tests/intelligence/compute-intelligence-audit.test.ts',
  'tests/intelligence/compute-intelligence-stats.test.ts',
  'tests/intelligence/context.test.ts',
  'tests/intelligence/graph-decision.test.ts',
  'tests/intelligence/milestone.test.ts',
  'tests/intelligence/recommendation-promote.test.ts',
  'tests/intelligence/render-context.test.ts',
  'tests/intelligence/render-decision-graph.test.ts',
  'tests/intelligence/render-decision.test.ts',
  'tests/intelligence/render-intelligence-stats.test.ts',
  'tests/intelligence/render-recommendation-detail.test.ts',
  'tests/intelligence/render-recommendations.test.ts',
  'tests/intelligence/store-decision-transition.test.ts',
  'tests/intelligence/store-recommendation-transition.test.ts',
  'tests/intelligence/store.test.ts',
  'tests/notify/collect.test.ts',
  'tests/notify/notifier.test.ts',
  'tests/notify/webhook.test.ts',
  'tests/progress.test.ts',
  'tests/services/retro.test.ts',
  'tests/services/settle-dry-run.test.ts',
  'tests/services/settle.test.ts',
  'tests/status.test.ts',
  'tests/verify/criteria-anchor-corpus.test.ts',
  'tests/verify/factory.test.ts',
  'tests/verify/host-cli-verifier.test.ts',
  'tests/verify/local-gates.test.ts',
  'tests/verify/plan-review.test.ts',
  'tests/verify/prompter.test.ts',
];
// Lower this cap with each file removed from BASELINE, so the freed slot
// cannot be refilled.
const BASELINE_CAP = 48;

type RatchetProblem =
  | { kind: 'not-in-baseline'; path: string }
  | { kind: 'fixed-but-listed'; path: string }
  | { kind: 'missing-file'; path: string }
  | { kind: 'over-cap'; count: number; cap: number };

/** Pure ratchet check of core's test-config excludes against the baseline. */
function checkTestTypecheckRatchet(
  excludes: readonly string[],
  baseline: readonly string[],
  exists: (path: string) => boolean,
  cap: number,
): RatchetProblem[] {
  const problems: RatchetProblem[] = [];
  const inBaseline = new Set(baseline);
  const excluded = new Set(excludes);
  for (const path of excludes) {
    if (!inBaseline.has(path)) problems.push({ kind: 'not-in-baseline', path });
  }
  for (const path of baseline) {
    if (!excluded.has(path)) problems.push({ kind: 'fixed-but-listed', path });
    else if (!exists(path)) problems.push({ kind: 'missing-file', path });
  }
  if (baseline.length > cap) problems.push({ kind: 'over-cap', count: baseline.length, cap });
  return problems;
}

interface TestConfig {
  extends?: string;
  compilerOptions?: Record<string, unknown>;
  include?: string[];
  exclude?: string[];
}

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8')) as T;
}

function testConfig(pkg: string): TestConfig {
  return readJson<TestConfig>(`packages/${pkg}/tsconfig.test.json`);
}

function coreExcludes(): string[] {
  return (testConfig('core').exclude ?? []).filter((e) => !DEFAULT_EXCLUDES.includes(e));
}

const coreExists = (path: string): boolean => existsSync(join(REPO_ROOT, 'packages/core', path));

describe('test typecheck (phase 353)', () => {
  it('353-01/AC-4: the compiler accepts types\' test config with no errors', () => {
    // Types only, never core: core's compile is far slower than a test budget.
    const res = spawnSync(process.execPath, [TSC, '-p', join(REPO_ROOT, 'packages/types/tsconfig.test.json')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    expect(output).not.toContain('error TS');
    expect(res.status).toBe(0);
  });

  it('353-01/AC-1: the seven packages\' typecheck scripts run the test config', () => {
    const scripts = PACKAGES.map((pkg) => [
      pkg,
      readJson<{ scripts?: Record<string, string> }>(`packages/${pkg}/package.json`).scripts?.typecheck,
    ]);
    expect(scripts).toStrictEqual(PACKAGES.map((pkg) => [pkg, TEST_TYPECHECK_SCRIPT]));
  });

  it('353-01/AC-2: the seven test configs have the test config shape', () => {
    for (const pkg of PACKAGES) {
      const cfg = testConfig(pkg);
      expect({ pkg, keys: Object.keys(cfg).sort() }).toStrictEqual({
        pkg,
        keys: ['compilerOptions', 'exclude', 'extends', 'include'],
      });
      expect({ pkg, extends: cfg.extends, compilerOptions: cfg.compilerOptions, include: cfg.include }).toStrictEqual({
        pkg,
        extends: '../../tsconfig.base.json',
        compilerOptions: { noEmit: true, rootDir: '../..', composite: false, declaration: false, declarationMap: false },
        include: ['src/**/*', 'tests/**/*'],
      });
    }
  });

  it('353-01/AC-2: only core excludes more than node_modules and dist', () => {
    const others = PACKAGES.filter((pkg) => pkg !== 'core').map((pkg) => [pkg, testConfig(pkg).exclude]);
    expect(others).toStrictEqual(PACKAGES.filter((pkg) => pkg !== 'core').map((pkg) => [pkg, DEFAULT_EXCLUDES]));
  });

  it('353-01/AC-3: core\'s real excludes match the 48-entry baseline', () => {
    expect(BASELINE).toHaveLength(48);
    expect(checkTestTypecheckRatchet(coreExcludes(), BASELINE, coreExists, BASELINE_CAP)).toStrictEqual([]);
  });

  it('353-01/AC-3: core\'s baseline excludes are sorted and free of duplicates', () => {
    const excludes = coreExcludes();
    expect(new Set(excludes).size).toBe(excludes.length);
    expect(excludes).toStrictEqual([...excludes].sort());
  });

  it('353-01/AC-3: a new exclusion outside the baseline is refused', () => {
    const excludes = [...BASELINE, 'tests/cli/new-file.test.ts'];
    expect(checkTestTypecheckRatchet(excludes, BASELINE, () => true, BASELINE_CAP)).toStrictEqual([
      { kind: 'not-in-baseline', path: 'tests/cli/new-file.test.ts' },
    ]);
  });

  it('353-01/AC-3: a baseline file dropped from the excludes but kept in the baseline is refused', () => {
    const excludes = BASELINE.filter((p) => p !== 'tests/checks/skill-audit.test.ts');
    expect(checkTestTypecheckRatchet(excludes, BASELINE, () => true, BASELINE_CAP)).toStrictEqual([
      { kind: 'fixed-but-listed', path: 'tests/checks/skill-audit.test.ts' },
    ]);
  });

  it('353-01/AC-3: a deleted baseline file is refused', () => {
    const exists = (p: string): boolean => p !== 'tests/checks/skill-audit.test.ts';
    expect(checkTestTypecheckRatchet([...BASELINE], BASELINE, exists, BASELINE_CAP)).toStrictEqual([
      { kind: 'missing-file', path: 'tests/checks/skill-audit.test.ts' },
    ]);
  });

  it('353-01/AC-3: a 49-entry baseline is refused as over the cap', () => {
    const grown = [...BASELINE, 'tests/cli/new-file.test.ts'];
    expect(checkTestTypecheckRatchet(grown, grown, () => true, BASELINE_CAP)).toStrictEqual([
      { kind: 'over-cap', count: 49, cap: 48 },
    ]);
  });

  it('357-01/AC-2: the batch leaves the baseline, which now holds 48 entries', () => {
    expect(checkTestTypecheckRatchet(coreExcludes(), BASELINE, coreExists, BASELINE_CAP)).toStrictEqual([]);
    expect(BASELINE).toHaveLength(48);
    for (const path of ['tests/docs/security-ci.test.ts', 'tests/scripts/release-integrity.test.ts']) {
      expect(BASELINE).not.toContain(path);
      expect(coreExcludes()).not.toContain(path);
    }
  });

  it('357-01/AC-3: a 49-entry baseline is refused against the cap of 48', () => {
    const grown = [...BASELINE, 'tests/cli/new-file.test.ts'];
    expect(checkTestTypecheckRatchet(grown, grown, () => true, BASELINE_CAP)).toStrictEqual([
      { kind: 'over-cap', count: 49, cap: 48 },
    ]);
  });
});
