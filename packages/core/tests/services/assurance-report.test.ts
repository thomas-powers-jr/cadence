import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { GateProvenance, Summary } from '@thomas-powers-jr/cadence-types';
import {
  computeAssuranceReport,
  parseSummaryRecord,
  type AssuranceCorpusRecord,
  type AssuranceUnreadableRecord,
} from '../../src/services/assurance-report.js';

// Phase 327 T2 — `computeAssuranceReport` pinned against a FROZEN copy of
// this repo's SUMMARY.json corpus at 7d96650 (2026-10-10), never against the
// live `.cadence/phases` tree, which grows with every settle. Every fixture
// record goes through `parseSummaryRecord`, the same parse the CLI uses.
// The fixture is gzipped (1 MB of JSON, 147 KB compressed) so settle's
// review diff sees one binary line rather than the whole corpus; each
// record's `text` inside is the verbatim `git show 7d96650:<path>` blob.
// Each asserting `it()` title carries the phase-qualified token.

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/assurance-corpus/corpus-7d96650.json.gz',
);

interface FixtureFile {
  source: { commit: string };
  records: { path: string; text: string }[];
}

function readFixture(): FixtureFile {
  return JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString('utf8')) as FixtureFile;
}

function loadFixture(): { records: AssuranceCorpusRecord[]; unreadable: AssuranceUnreadableRecord[] } {
  const fixture = readFixture();
  const records: AssuranceCorpusRecord[] = [];
  const unreadable: AssuranceUnreadableRecord[] = [];
  for (const r of fixture.records) {
    const res = parseSummaryRecord(r.path, r.text);
    if (res.ok) records.push(res.record);
    else unreadable.push(res.unreadable);
  }
  return { records, unreadable };
}

const corpus = loadFixture();
const full = computeAssuranceReport(corpus.records, corpus.unreadable, {});

function gateRow(report: typeof full, gate: string) {
  return report.gates.find((g) => g.gate === gate);
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

const ranGate: GateProvenance = { gate: 'deep-verify', status: 'ran' };

/** Deterministic Fisher–Yates with a fixed LCG seed — no Math.random. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  let seed = 327;
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('computeAssuranceReport over the frozen 7d96650 corpus', () => {
  it('327-01/AC-1: the fixture is the 337-record corpus at 7d96650 and every record parses', () => {
    const fixture = readFixture();
    expect(fixture.source.commit).toBe('7d96650e72cb9f1aa1eac3305ea0079bda1ae52a');
    expect(fixture.records).toHaveLength(337);
    expect(corpus.unreadable).toEqual([]);
  });

  it('327-01/AC-1: partitions 337 records into 155 un-gradable, 96 never graded and 86 graded, with phase boundaries', () => {
    expect(full.totals).toEqual({ files: 337, settled: 337, refused: 0, unreadable: 0 });
    const { unGradable, neverGraded, graded } = full.categories;
    expect([unGradable.count, unGradable.firstPhase, unGradable.lastPhase]).toEqual([155, 2, 139]);
    expect([neverGraded.count, neverGraded.firstPhase, neverGraded.lastPhase]).toEqual([96, 140, 243]);
    expect([graded.count, graded.firstPhase, graded.lastPhase]).toEqual([86, 235, 326]);
    expect(neverGraded.afterFirstGraded.map((r) => r.id)).toEqual(['238-01', '239-01', '240-01', '243-01']);
    expect(unGradable.count + neverGraded.count + graded.count).toBe(full.totals.settled);
    expect(full.totals.settled + full.totals.refused + full.totals.unreadable).toBe(full.totals.files);
    expect(unGradable.reason).toMatch(/no gate provenance/);
    expect(neverGraded.reason).toMatch(/no assurance block/);
  });

  it('327-01/AC-2: reports stored and re-derived grade distributions and exactly two strong-to-mixed deltas', () => {
    expect(full.grades.stored).toEqual({ strong: 10, mixed: 74, weak: 0, unverified: 2 });
    expect(full.grades.rederived).toEqual({ strong: 8, mixed: 76, weak: 0, unverified: 2 });
    expect(full.grades.delta).toEqual([
      {
        id: '272-01',
        path: '.cadence/phases/272-assurance-record-correctness/272-01-SUMMARY.json',
        stored: 'strong',
        rederived: 'mixed',
      },
      {
        id: '282-01',
        path: '.cadence/phases/282-coverage-scanner-determinism/282-01-SUMMARY.json',
        stored: 'strong',
        rederived: 'mixed',
      },
    ]);
    const rederivedTotal = Object.values(full.grades.rederived).reduce((a, b) => a + b, 0);
    expect(rederivedTotal).toBe(full.categories.graded.count);
  });

  it('327-01/AC-3: per-gate ran / skipped / not-recorded counts match the fixture and each row sums to 182', () => {
    expect(full.provenanceRecords).toBe(182);
    expect(gateRow(full, 'deep-verify')).toEqual({ gate: 'deep-verify', ran: 19, skipped: 163, notRecorded: 0 });
    expect(gateRow(full, 'code-review')).toEqual({ gate: 'code-review', ran: 15, skipped: 167, notRecorded: 0 });
    expect(gateRow(full, 'security-audit')).toEqual({ gate: 'security-audit', ran: 3, skipped: 179, notRecorded: 0 });
    expect(gateRow(full, 'boundary-scan')).toEqual({ gate: 'boundary-scan', ran: 13, skipped: 153, notRecorded: 16 });
    expect(gateRow(full, 'interactive-verdict')).toEqual({
      gate: 'interactive-verdict',
      ran: 4,
      skipped: 178,
      notRecorded: 0,
    });
    for (const row of full.gates) {
      expect(row.ran + row.skipped + row.notRecorded).toBe(182);
    }
  });

  it('327-01/AC-3: provider mix counts gate entries; bypasses and evidence tally match the fixture', () => {
    expect(full.providerSelection).toEqual({ configured: 9, fallback: 3, 'empty-diff': 0 });
    expect(full.recordsWithBypasses).toBe(18);
    expect(full.evidenceTally).toEqual({
      'ai-verified': 73,
      executed: 319,
      assertion: 0,
      mention: 0,
      unverified: 20,
    });
  });

  it('327-01/AC-4: --since 283 restricts every count and reproduces the post-283 split', () => {
    const windowed = computeAssuranceReport(corpus.records, corpus.unreadable, { since: 283 });
    expect(windowed.window).toEqual({ since: 283 });
    expect(windowed.grades.stored).toEqual({ strong: 4, mixed: 39, weak: 0, unverified: 0 });
    expect(windowed.categories.unGradable.count).toBe(0);
    expect(windowed.categories.neverGraded.count).toBe(0);
    expect(windowed.categories.graded.count).toBe(43);
    expect(windowed.categories.graded.firstPhase).toBe(283);
    expect(windowed.totals.files).toBe(43);
    expect(windowed.grades.delta).toEqual([]);
    expect(windowed.providerSelection).toEqual({ configured: 5, fallback: 1, 'empty-diff': 0 });
    expect(windowed.evidenceTally).toEqual({
      'ai-verified': 56,
      executed: 139,
      assertion: 0,
      mention: 0,
      unverified: 11,
    });
    expect(windowed.recordsWithBypasses).toBe(5);
    for (const row of windowed.gates) {
      expect(row.ran + row.skipped + row.notRecorded).toBe(windowed.provenanceRecords);
    }
  });

  it('327-01/AC-7: the report is identical whatever order the records arrive in', () => {
    const fromShuffled = computeAssuranceReport(shuffled(corpus.records), corpus.unreadable, {});
    expect(JSON.stringify(fromShuffled)).toBe(JSON.stringify(full));
    expect(JSON.stringify(computeAssuranceReport(corpus.records, corpus.unreadable, {}))).toBe(JSON.stringify(full));
  });

  it('327-01/AC-7: the report carries no timestamp and no absolute path', () => {
    const json = JSON.stringify(full);
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(json).not.toMatch(/[A-Za-z]:(?:\\\\|\/)|"\/(?:Users|home|tmp)\//);
  });
});

describe('computeAssuranceReport over synthetic records', () => {
  it('327-01/AC-4: compares phase numbers numerically, so 99 is out and 1000 is in at --since 283', () => {
    const records = [syntheticRecord(99), syntheticRecord(283), syntheticRecord(1000)];
    const windowed = computeAssuranceReport(records, [], { since: 283 });
    expect(windowed.totals.files).toBe(2);
    expect(windowed.categories.unGradable.firstPhase).toBe(283);
    expect(windowed.categories.unGradable.lastPhase).toBe(1000);
  });

  it('327-01/AC-7: unreadable files are ordered by phase number then path, un-numbered last, whatever the input order', () => {
    const entry = (phase: string): AssuranceUnreadableRecord => ({
      phase,
      id: `${phase}-01`,
      path: `.cadence/phases/${phase}/${phase}-01-SUMMARY.json`,
      reason: 'SUMMARY.json is not valid JSON',
    });
    const input = [entry('untitled'), entry('1000-z'), entry('100-a'), entry('99-b'), entry('100-0')];
    const expected = ['99-b', '100-0', '100-a', '1000-z', 'untitled'].map(
      (p) => `.cadence/phases/${p}/${p}-01-SUMMARY.json`,
    );
    expect(computeAssuranceReport([], input, {}).unreadable.map((u) => u.path)).toEqual(expected);
    expect(computeAssuranceReport([], shuffled(input), {}).unreadable.map((u) => u.path)).toEqual(expected);
  });

  it('327-01/AC-4: --since windows unreadable files by phase number and keeps un-numbered ones', () => {
    const entry = (phase: string): AssuranceUnreadableRecord => ({
      phase,
      id: `${phase}-01`,
      path: `.cadence/phases/${phase}/${phase}-01-SUMMARY.json`,
      reason: 'SUMMARY.json is not valid JSON',
    });
    const windowed = computeAssuranceReport([], [entry('99-b'), entry('283-a'), entry('untitled')], { since: 283 });
    expect(windowed.unreadable.map((u) => u.path)).toEqual([
      '.cadence/phases/283-a/283-a-01-SUMMARY.json',
      '.cadence/phases/untitled/untitled-01-SUMMARY.json',
    ]);
    expect(windowed.totals.unreadable).toBe(2);
  });

  it('327-01/AC-10: a record with a refused gate is its own category, excluded from grading, gates and evidence', () => {
    const refused = syntheticRecord(50, {
      gates: [ranGate, { gate: 'test-coverage', status: 'refused', reason: 'uncovered AC' }],
      gateBypasses: [],
      assurance: {
        overall: 'unverified',
        verifierRollup: [],
        evidenceTally: { 'ai-verified': 0, executed: 0, assertion: 0, mention: 0, unverified: 3 },
      },
    });
    const settled = syntheticRecord(51, { gates: [ranGate] });
    const report = computeAssuranceReport([settled, refused], [], {});
    expect(report.totals).toEqual({ files: 2, settled: 1, refused: 1, unreadable: 0 });
    expect(report.refused).toEqual([{ id: '50-01', path: '.cadence/phases/50-synthetic/50-01-SUMMARY.json' }]);
    expect(report.categories.graded.count).toBe(0);
    expect(report.categories.neverGraded.count).toBe(1);
    expect(report.grades.stored.unverified).toBe(0);
    expect(report.evidenceTally.unverified).toBe(0);
    expect(report.provenanceRecords).toBe(1);
    expect(gateRow(report, 'deep-verify')).toEqual({ gate: 'deep-verify', ran: 1, skipped: 0, notRecorded: 0 });
  });

  it('327-01/AC-3: a record with several entries for one gate counts once, as ran if any entry ran', () => {
    const multi = syntheticRecord(60, {
      gates: [
        { gate: 'deep-verify', status: 'skipped' },
        { gate: 'deep-verify', status: 'ran' },
      ],
    });
    const skippedOnly = syntheticRecord(61, {
      gates: [
        { gate: 'deep-verify', status: 'skipped' },
        { gate: 'deep-verify', status: 'skipped' },
      ],
    });
    const report = computeAssuranceReport([multi, skippedOnly], [], {});
    expect(gateRow(report, 'deep-verify')).toEqual({ gate: 'deep-verify', ran: 1, skipped: 1, notRecorded: 0 });
  });

  it('327-01/AC-10: the frozen corpus reports zero refused records', () => {
    expect(full.totals.refused).toBe(0);
    expect(full.refused).toEqual([]);
  });

  it('327-01/AC-1: an empty window reports every category at zero with null boundaries', () => {
    const empty = computeAssuranceReport([], [], {});
    expect(empty.categories.graded).toMatchObject({ count: 0, firstPhase: null, lastPhase: null });
    expect(empty.grades.stored).toEqual({ strong: 0, mixed: 0, weak: 0, unverified: 0 });
    expect(empty.gates.length).toBe(full.gates.length);
  });
});
