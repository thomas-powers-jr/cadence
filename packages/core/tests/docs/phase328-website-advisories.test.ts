import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseExceptionsTable,
  decideAdvisories,
  extractHighSeverityAdvisories,
} from '../../../../scripts/check-audit-exceptions.mjs';
import { parseLockfilePackages } from '../../../../scripts/check-lockfile-overrides.mjs';

// packages/core/tests/docs -> ../../../../
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const WEBSITE_LOCKFILE = join(ROOT, 'website', 'pnpm-lock.yaml');
const AUDIT_EXCEPTIONS_MD = join(ROOT, 'docs', 'security', 'audit-exceptions.md');
const DECISION_DATE = new Date('2026-10-13');

type Triple = [number, number, number];
type Instance = { package: string; version: string };

const parse = (version: string): Triple => {
  const parts = version.split('.').slice(0, 3).map((part) => parseInt(part, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
};
const atOrAbove = (version: string, floor: Triple): boolean => {
  const v = parse(version);
  for (let i = 0; i < 3; i += 1) {
    const a = v[i] ?? 0;
    const b = floor[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
};

const instances = parseLockfilePackages(readFileSync(WEBSITE_LOCKFILE, 'utf8')) as Instance[];

// Resolved instances of a package, optionally restricted to one major line.
const resolved = (name: string, major?: number): Instance[] =>
  instances.filter((p) => p.package === name && (major === undefined || parse(p.version)[0] === major));

// Every resolved instance (within the optional major line) must be at or above
// the floor. A package with zero instances satisfies its floor (the refresh may
// drop it entirely); it is named in the output rather than failed on.
const belowFloor = (name: string, floor: string, major?: number): string[] => {
  const found = resolved(name, major);
  if (found.length === 0) {
    console.info(
      `[328-01] ${name}${major === undefined ? '' : ` (${major}.x)`}: no resolved instances (floor satisfied by absence)`,
    );
  }
  return found.filter((p) => !atOrAbove(p.version, parse(floor))).map((p) => `${p.package}@${p.version}`);
};

const AC1_FLOORS: Array<[string, string, number?]> = [
  ['astro', '7.2.8'],
  ['devalue', '5.9.3'],
  ['sharp', '0.35.5'],
  ['svgo', '4.1.0'],
  ['js-yaml', '4.3.2', 4],
  ['smol-toml', '1.7.1'],
  ['source-map-js', '1.2.2'],
  ['http-cache-semantics', '4.3.0'],
  ['brace-expansion', '5.0.11', 5],
];

const AC2_FLOORS: Array<[string, string, number?]> = [
  ['vitest', '4.1.11'],
  ['@vitest/mocker', '4.1.11'],
  ['markdown-it', '14.3.1'],
  ['brace-expansion', '5.0.12', 5],
  ['postcss-selector-parser', '6.1.3', 6],
  ['smol-toml', '1.9.0'],
  ['astro', '7.2.8'],
];

const ADVISORIES: Array<[string, string, string]> = [
  ['GHSA-26w7-cxv4-gfx2', 'astro', 'critical'],
  ['GHSA-j22f-vq7h-c4qm', 'devalue', 'high'],
  ['GHSA-mcm9-63f2-9j32', 'devalue', 'high'],
  ['GHSA-x5rw-q4pp-hg5g', 'devalue', 'high'],
  ['GHSA-rgj7-g3m4-5g8c', 'sharp', 'high'],
  ['GHSA-wq5f-xc86-pv6w', 'sharp', 'high'],
  ['GHSA-w27v-7q3p-w38r', 'svgo', 'high'],
  ['GHSA-2883-xcg3-v3hh', 'js-yaml', 'high'],
  ['GHSA-7w5x-hrqm-74c2', 'smol-toml', 'high'],
  ['GHSA-68fv-2mgg-jv7q', 'source-map-js', 'high'],
  ['GHSA-ch52-4w7c-c8xp', 'http-cache-semantics', 'high'],
  ['GHSA-qhr7-859c-m2p7', 'brace-expansion', 'high'],
  ['GHSA-6j4f-fj2g-mc7p', 'brace-expansion', 'high'],
];

const AUDIT_JSON = {
  advisories: Object.fromEntries(
    ADVISORIES.map(([id, pkg, severity], i) => [
      i + 1,
      { id: i + 1, github_advisory_id: id, module_name: pkg, severity },
    ]),
  ),
};

describe('website high/critical advisories are fixed, not excepted (328-01 / AC-1)', () => {
  for (const [name, floor, major] of AC1_FLOORS) {
    it(`every resolved ${name}${major === undefined ? '' : ` ${major}.x`} instance in website/pnpm-lock.yaml is at or above ${floor} (328-01/AC-1)`, () => {
      expect(belowFloor(name, floor, major)).toEqual([]);
    });
  }

  const rows = parseExceptionsTable(readFileSync(AUDIT_EXCEPTIONS_MD, 'utf8'));
  const advisories = extractHighSeverityAdvisories(AUDIT_JSON);

  it('has no exception row for any of the 13 website advisories (328-01/AC-1)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const [id] of ADVISORIES) {
      expect(rows.find((r: { id: string }) => r.id === id)).toBeUndefined();
    }
  });

  it('fails each of the 13 advisories as not listed when decided against the real table (328-01/AC-1)', () => {
    expect(advisories).toHaveLength(13);
    expect(
      advisories.map((a: { id: string; package: string; severity: string }) => [a.id, a.package, a.severity]),
    ).toEqual(ADVISORIES);

    const decision = decideAdvisories(advisories, rows, DECISION_DATE);

    expect(decision.ok).toBe(false);
    expect(decision.allowed).toEqual([]);
    expect(decision.failures.map((f: { id: string }) => f.id).sort()).toEqual(ADVISORIES.map(([id]) => id).sort());
    for (const failure of decision.failures) {
      expect(failure.reason).toMatch(/not listed/);
    }
  });
});

describe('the exceptions doc says what is audited (328-01 / AC-6)', () => {
  const doc = readFileSync(AUDIT_EXCEPTIONS_MD, 'utf8');
  // The opening section: everything before the first `## ` heading.
  const opening = doc.slice(0, doc.indexOf('\n## '));

  it('names both the root pnpm-lock.yaml and website/pnpm-lock.yaml in its opening section (328-01/AC-6)', () => {
    expect(doc.indexOf('\n## ')).toBeGreaterThan(-1);
    // Root lockfile: a `pnpm-lock.yaml` mention not preceded by `website/`,
    // so the website path alone cannot satisfy it.
    expect(opening).toMatch(/(?<!website\/)`pnpm-lock\.yaml`/);
    expect(opening).toContain('`website/pnpm-lock.yaml`');
    expect(opening).toMatch(/one (exceptions )?table|same table|single table/i);
    expect(opening).toContain('scripts/check-lockfile-overrides.mjs');
  });
});

describe('website moderate/low advisories are fixed where reachable (328-01 / AC-2)', () => {
  for (const [name, floor, major] of AC2_FLOORS) {
    it(`every resolved ${name}${major === undefined ? '' : ` ${major}.x`} instance in website/pnpm-lock.yaml is at or above ${floor} (328-01/AC-2)`, () => {
      expect(belowFloor(name, floor, major)).toEqual([]);
    });
  }
});

// Phase 328 — the docs site must install frozen on docs.yml's toolchain. The
// build itself is CI evidence (the PR's Docs workflow `build` job); these
// tests pin the preconditions under which pnpm 9's `--frozen-lockfile`
// accepts the manifest, the overrides and the toolchain version.
describe('the website lockfile is installable frozen on docs.yml toolchain (328-01 / AC-5)', () => {
  const websiteManifest = JSON.parse(readFileSync(join(ROOT, 'website', 'package.json'), 'utf8')) as {
    packageManager?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    pnpm?: { overrides?: Record<string, string> };
  };
  const lockLines = readFileSync(WEBSITE_LOCKFILE, 'utf8').split(/\r?\n/);
  const unquote = (s: string): string => s.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');

  // Lines of a top-level block (`name:` at column 0), up to the next column-0 line.
  const topLevelBlock = (name: string): string[] => {
    const start = lockLines.indexOf(`${name}:`);
    if (start === -1) return [];
    const out: string[] = [];
    for (const line of lockLines.slice(start + 1)) {
      if (line !== '' && !line.startsWith(' ')) break;
      out.push(line);
    }
    return out;
  };

  it('website/package.json pins packageManager pnpm@9.12.0 and docs.yml installs pnpm 9.12.0 (328-01/AC-5)', () => {
    expect(websiteManifest.packageManager).toBe('pnpm@9.12.0');
    const docsYml = readFileSync(join(ROOT, '.github', 'workflows', 'docs.yml'), 'utf8');
    expect(docsYml).toMatch(/^\s*build:\s*$/m);
    expect(docsYml).toMatch(/uses:\s*pnpm\/action-setup@\S+\s*\r?\n\s*with:\s*\r?\n\s*version:\s*9\.12\.0\s*$/m);
  });

  it("the lockfile's top-level overrides equal website/package.json pnpm.overrides exactly (328-01/AC-5)", () => {
    const lockOverrides: Record<string, string> = {};
    for (const line of topLevelBlock('overrides')) {
      if (line.trim() === '') continue;
      const match = /^ {2}(.+?):\s+(.+)$/.exec(line);
      expect(match).not.toBeNull();
      lockOverrides[unquote(match?.[1] ?? '')] = unquote(match?.[2] ?? '');
    }
    const manifestOverrides = websiteManifest.pnpm?.overrides ?? {};
    expect(Object.keys(manifestOverrides).length).toBeGreaterThanOrEqual(1);
    expect(lockOverrides).toEqual(manifestOverrides);
  });

  it("the lockfile importer's direct dependencies carry exactly website/package.json's specifiers (328-01/AC-5)", () => {
    const block = topLevelBlock('importers');
    const rootStart = block.indexOf('  .:');
    expect(rootStart).toBeGreaterThanOrEqual(0);
    const importer: Record<string, Record<string, string>> = {};
    let section = '';
    let pkg = '';
    for (const line of block.slice(rootStart + 1)) {
      if (/^ {2}\S/.test(line)) break; // next importer
      let m = /^ {4}(dependencies|devDependencies|optionalDependencies):\s*$/.exec(line);
      if (m) {
        section = m[1] ?? '';
        importer[section] = {};
        continue;
      }
      m = /^ {6}(.+):\s*$/.exec(line);
      if (m) {
        pkg = unquote(m[1] ?? '');
        continue;
      }
      m = /^ {8}specifier:\s+(.+)$/.exec(line);
      if (m && section) (importer[section] as Record<string, string>)[pkg] = unquote(m[1] ?? '');
    }
    expect(importer['dependencies']).toEqual(websiteManifest.dependencies);
    expect(importer['devDependencies']).toEqual(websiteManifest.devDependencies);
    expect(Object.keys(importer).sort()).toEqual(['dependencies', 'devDependencies']);
  });
});
