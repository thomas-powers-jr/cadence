import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesizeConsumedChangeset } from '../support/changeset-evidence.js';
import type { SynthesizedChangeset } from '../support/changeset-evidence.js';
import {
  parseExceptionsTable,
  decideAdvisories,
  extractHighSeverityAdvisories,
} from '../../../../scripts/check-audit-exceptions.mjs';
import { parseLockfilePackages } from '../../../../scripts/check-lockfile-overrides.mjs';

// Resolve repo-root files from this test file's location:
// packages/core/tests/docs -> ../../../../
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CORE_PACKAGE_JSON = join(ROOT, 'packages', 'core', 'package.json');
const LOCKFILE = join(ROOT, 'pnpm-lock.yaml');
const AUDIT_EXCEPTIONS_MD = join(ROOT, 'docs', 'security', 'audit-exceptions.md');

const SDK = '@modelcontextprotocol/sdk';
const SDK_FLOOR: [number, number, number] = [1, 31, 0];

const PROXY_ADDR_ID = 'GHSA-jqcg-44mw-7w3h';
const SDK_ID = 'GHSA-6qxp-vccf-f47h';
const SOURCE_MAP_JS_ID = 'GHSA-68fv-2mgg-jv7q';
const PHASE_324_IDS = [PROXY_ADDR_ID, SDK_ID, SOURCE_MAP_JS_ID];
const DECISION_DATE = new Date('2026-10-07');

const atOrAbove = (version: string, floor: [number, number, number]): boolean => {
  const parts = version.split('.').slice(0, 3).map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const a = parts[i] ?? 0;
    const b = floor[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
};

// A minimal `pnpm audit --json` payload in the `advisories`-map shape that
// extractHighSeverityAdvisories normalizes, carrying the three advisories
// phase 324 fixes by bumping. Driving the fixture through the real extractor
// keeps the advisories in exactly the shape decideAdvisories receives in CI.
const AUDIT_JSON = {
  advisories: {
    1: { id: 1, github_advisory_id: PROXY_ADDR_ID, module_name: 'proxy-addr', severity: 'critical' },
    2: { id: 2, github_advisory_id: SDK_ID, module_name: SDK, severity: 'high' },
    3: { id: 3, github_advisory_id: SOURCE_MAP_JS_ID, module_name: 'source-map-js', severity: 'high' },
  },
};

// Phase 324 — cadence-core's production dependency on the MCP SDK is raised
// past GHSA-6qxp-vccf-f47h (affects >=1.12.0 <1.31.0), in the manifest and in
// the committed lockfile. Qualifier and AC id kept apart in comments: the
// coverage scanner records only the first qualified occurrence per token per
// file, which must be the asserting it().
describe('cadence-core MCP SDK dependency is past its advisory (324-01 / AC-2)', () => {
  const corePackageJson = JSON.parse(readFileSync(CORE_PACKAGE_JSON, 'utf8'));
  const lockfileText = readFileSync(LOCKFILE, 'utf8');

  it("core's @modelcontextprotocol/sdk dependency is a caret range whose floor is at or above 1.31.0 (324-01/AC-2)", () => {
    const range: unknown = corePackageJson.dependencies?.[SDK];
    expect(typeof range).toBe('string');
    const rangeText = String(range);
    expect(rangeText.startsWith('^')).toBe(true);
    expect(atOrAbove(rangeText.slice(1), SDK_FLOOR)).toBe(true);
  });

  it('every resolved @modelcontextprotocol/sdk instance in the real lockfile is at or above 1.31.0 (324-01/AC-2)', () => {
    const sdkInstances = parseLockfilePackages(lockfileText).filter((p: { package: string }) => p.package === SDK);
    expect(sdkInstances.length).toBeGreaterThanOrEqual(1);
    expect(sdkInstances.filter((p: { version: string }) => !atOrAbove(p.version, SDK_FLOOR))).toEqual([]);
  });
});

// Phase 324 — the three advisories are fixed by the bump, not excepted: the
// real exceptions table has no row for any of them, so the CI gate's own
// decision logic fails each one. That proves the only way the audit job goes
// green is the dependency bump itself.
describe('the three phase 324 advisories are fixed, not excepted (324-01 / AC-3)', () => {
  const rows = parseExceptionsTable(readFileSync(AUDIT_EXCEPTIONS_MD, 'utf8'));
  const advisories = extractHighSeverityAdvisories(AUDIT_JSON);

  it('has no exception row for the proxy-addr, @modelcontextprotocol/sdk or source-map-js advisories (324-01/AC-3)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const id of PHASE_324_IDS) {
      expect(rows.find((r) => r.id === id)).toBeUndefined();
    }
  });

  it('fails all three advisories as not listed when decided against the real table (324-01/AC-3)', () => {
    expect(advisories).toHaveLength(3);
    expect(advisories.map((a) => [a.id, a.package, a.severity])).toEqual([
      [PROXY_ADDR_ID, 'proxy-addr', 'critical'],
      [SDK_ID, SDK, 'high'],
      [SOURCE_MAP_JS_ID, 'source-map-js', 'high'],
    ]);

    const decision = decideAdvisories(advisories, rows, DECISION_DATE);

    expect(decision.ok).toBe(false);
    expect(decision.allowed).toEqual([]);
    expect(decision.failures.map((f) => f.id).sort()).toEqual([...PHASE_324_IDS].sort());
    for (const failure of decision.failures) {
      expect(failure.reason).toMatch(/not listed/);
    }
  });
});

// Phase 324 — the changeset is the only consumer-facing record of the bump.
// It must release core alone as a patch, name all three advisory ids and the
// new SDK range, and say plainly that the root `pnpm.overrides` pins shape
// only this repository's lockfile.
//
// Phase 325 — a release's `changeset version` deletes the changeset after
// writing its body into the released packages' CHANGELOG.md files. Once it is
// gone, the same facts are read back from those CHANGELOGs: one frontmatter
// line per package whose CHANGELOG carries the entry, under its change type.
describe('the phase 324 changeset tells consumers what changed for them (324-01 / AC-4)', () => {
  const CHANGESET = join(ROOT, '.changeset', 'audit-advisories-bump.md');
  const PUBLISHED_PACKAGES = ['core', 'types', 'host-claude-code', 'host-codex', 'host-toolkit'];
  const DISCRIMINATOR =
    "Those overrides shape only this repository's lockfile and do not propagate to consumers";
  const readChangesetFile = (): { frontmatter: string[]; body: string } => {
    const lines = readFileSync(CHANGESET, 'utf8').split(/\r?\n/);
    const open = lines.indexOf('---');
    const close = lines.indexOf('---', open + 1);
    expect(open).toBe(0);
    expect(close).toBeGreaterThan(open);
    return {
      frontmatter: lines.slice(open + 1, close).filter((line) => line.trim() !== ''),
      body: lines.slice(close + 1).join('\n'),
    };
  };
  const synthesizeFromChangelogs = (): SynthesizedChangeset =>
    synthesizeConsumedChangeset(
      PUBLISHED_PACKAGES.map((dir) => {
        const packageDir = join(ROOT, 'packages', dir);
        const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
          name: string;
        };
        return { packageName: manifest.name, text: readFileSync(join(packageDir, 'CHANGELOG.md'), 'utf8') };
      }),
      DISCRIMINATOR,
    );
  const readChangeset = (): { frontmatter: string[]; body: string } =>
    existsSync(CHANGESET) ? readChangesetFile() : synthesizeFromChangelogs();

  it('resolves its evidence from the changeset or exactly one released CHANGELOG entry (325-01/AC-2)', () => {
    if (existsSync(CHANGESET)) {
      expect(readChangesetFile().body).toContain(DISCRIMINATOR);
    } else {
      expect(synthesizeFromChangelogs().matchCount).toBe(1);
    }
  });

  it('frontmatter names exactly one package line, cadence-core as a patch (324-01/AC-4)', () => {
    const { frontmatter } = readChangeset();
    expect(frontmatter).toEqual(['"@thomas-powers-jr/cadence-core": patch']);
  });

  it('body names all three advisory ids, the new SDK range and the consumer-propagation caveat (324-01/AC-4)', () => {
    const { body } = readChangeset();
    for (const id of PHASE_324_IDS) {
      expect(body).toContain(id);
    }
    expect(body).toContain('^1.31.0');
    expect(body).toContain('do not propagate to consumers');
  });
});
