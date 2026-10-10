import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssuranceRecordZ, type GateProvenance, type Summary } from '@thomas-powers-jr/cadence-types';
import { deriveAssuranceRecord } from '../../src/gates/assurance-record.js';
import {
  computeAssuranceReport,
  parseSummaryRecord,
  type AssuranceCorpusRecord,
  type AssuranceUnreadableRecord,
} from '../../src/services/assurance-report.js';

// Phase 327 T4 — `docs/reference/commands.md` documents `cadence assurance
// report` and its `--json` shape. The documented key paths (one per line,
// between the assurance-report-schema markers) must equal the key paths of a
// REAL report object computed over a small synthetic corpus that populates
// every list, so array item keys are exercised rather than assumed.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const COMMANDS_MD = readFileSync(join(REPO_ROOT, 'docs/reference/commands.md'), 'utf8');

/** The first whitespace-delimited token of every non-blank, non-fence line
 *  between the schema markers. */
function documentedKeyPaths(md: string): string[] {
  const m = md.match(
    /<!-- cadence:assurance-report-schema:start -->([\s\S]*?)<!-- cadence:assurance-report-schema:end -->/,
  );
  if (!m) throw new Error('commands.md: assurance-report-schema marker block missing');
  return m[1]!
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('```'))
    .map((l) => l.split(/\s+/)[0]!);
}

/** Leaf key paths of a JSON value: `a.b` for object keys, `a[].b` for the
 *  keys of array items (unioned across every item), and `null` or any
 *  primitive is a leaf. */
function leafKeyPaths(value: unknown, prefix = ''): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(value)) {
    for (const item of value) for (const p of leafKeyPaths(item, `${prefix}[]`)) out.add(p);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      for (const p of leafKeyPaths(v, prefix === '' ? k : `${prefix}.${k}`)) out.add(p);
    }
    return out;
  }
  out.add(prefix);
  return out;
}

/** The `### <name>` section: up to the next `## ` or `### ` heading, keeping
 *  nested `#### <name> <subcommand>` blocks (same rule as cli-reference.test.ts). */
function commandSection(md: string, name: string): string {
  const re = new RegExp(`(?:^|\\n)### ${name}(?=\\n|$)\\n([\\s\\S]*?)(?=\\n(?:## |### )|$)`);
  const m = md.match(re);
  if (!m) throw new Error(`commands.md: no "### ${name}" section heading found`);
  return m[1]!;
}

function syntheticRecord(phaseNumber: number, overrides: Partial<Summary> = {}): AssuranceCorpusRecord {
  const phase = `${phaseNumber}-synthetic`;
  const id = `${phaseNumber}-01`;
  return {
    phase,
    phaseNumber,
    id,
    path: `.cadence/phases/${phase}/${id}-SUMMARY.json`,
    summary: {
      schemaVersion: 2,
      draftId: id,
      completedAt: '2026-01-01T00:00:00.000Z',
      acResults: [],
      taskResults: [],
      decisions: [],
      deferred: [],
      skillAudit: { required: [], invoked: [] },
      ...overrides,
    },
  };
}

/** A synthetic corpus that fills every report list: a late never-graded
 *  record, a graded record whose stored grade differs from the re-derived
 *  one, a refused record and an unreadable file. */
function syntheticReport() {
  const ranGates: GateProvenance[] = [
    { gate: 'structural-verifier', status: 'ran' },
    { gate: 'deep-verify', status: 'ran', providerSelection: 'configured' },
    { gate: 'code-review', status: 'skipped', reason: 'not in tier' },
  ];
  const acResults: Summary['acResults'] = [{ id: 'AC-1', pass: true, evidence: 'executed' }];
  const gateBypasses: NonNullable<Summary['gateBypasses']> = [
    { gate: 'boundary-scan', flag: '--allow-boundary', reason: 'synthetic', severity: 'warn' },
  ];
  const derived = deriveAssuranceRecord(ranGates, acResults, { gateBypasses });
  const flipped = AssuranceRecordZ.shape.overall.options.find((g) => g !== derived.overall)!;

  const records: AssuranceCorpusRecord[] = [
    syntheticRecord(10),
    syntheticRecord(20, { gates: ranGates }),
    syntheticRecord(30, { gates: ranGates, acResults, gateBypasses, assurance: { ...derived, overall: flipped } }),
    syntheticRecord(40, { gates: ranGates }),
    syntheticRecord(50, { gates: [{ gate: 'test-coverage', status: 'refused', reason: 'uncovered AC' }] }),
  ];
  const bad = parseSummaryRecord('.cadence/phases/60-synthetic/60-01-SUMMARY.json', '{ not json');
  const unreadable: AssuranceUnreadableRecord[] = bad.ok ? [] : [bad.unreadable];
  return computeAssuranceReport(records, unreadable, {});
}

describe('docs/reference/commands.md documents cadence assurance report', () => {
  it('327-01/AC-5: the documented JSON key paths equal the key paths of a real computed report', () => {
    const report = JSON.parse(JSON.stringify(syntheticReport())) as ReturnType<typeof syntheticReport>;
    // Every list is populated, so the `[]` item paths below are real, not assumed.
    expect(report.categories.neverGraded.afterFirstGraded.length).toBeGreaterThan(0);
    expect(report.grades.delta.length).toBeGreaterThan(0);
    expect(report.gates.length).toBeGreaterThan(0);
    expect(report.refused.length).toBeGreaterThan(0);
    expect(report.unreadable.length).toBeGreaterThan(0);

    const documented = documentedKeyPaths(COMMANDS_MD);
    expect(documented.length).toBe(new Set(documented).size);
    expect([...documented].sort()).toEqual([...leafKeyPaths(report)].sort());
  });

  it('327-01/AC-9: assurance is in the command marker block and its section documents report, --json and --since', () => {
    const block = COMMANDS_MD.match(/<!-- cadence:commands:start -->([\s\S]*?)<!-- cadence:commands:end -->/);
    expect(block).not.toBeNull();
    expect(block![1]!.split('\n').map((l) => l.trim())).toContain('assurance');

    const section = commandSection(COMMANDS_MD, 'assurance');
    expect(section).toMatch(/\n#### assurance report\n/);
    expect(section).toMatch(/\n\| `--json` \| /);
    expect(section).toMatch(/\n\| `--since <phase>` \| /);
    expect(section).toContain('<!-- cadence:assurance-report-schema:start -->');
    expect(section).toContain('<!-- cadence:assurance-report-schema:end -->');
  });
});
