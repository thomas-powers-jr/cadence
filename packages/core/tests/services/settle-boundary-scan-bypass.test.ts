import { describe, it, expect } from 'vitest';
import type { AnomalyEvent, Draft, GateProvenance } from '@thomas-powers-jr/cadence-types';
import { AnomalyEventZ } from '@thomas-powers-jr/cadence-types';
import { collectAnomalies, type CollectAnomaliesContext } from '../../src/notify/collect.js';
import { gateBypassesFromAnomalies } from '../../src/services/settle.js';
import { deriveAssuranceRecord, type AssuranceAcResult } from '../../src/gates/assurance-record.js';
import type { ProgressFile } from '../../src/status.js';

/**
 * Phase 352 (352-01, T2): a boundary-scan bypass becomes one error-severity
 * `boundary-scan-bypassed` anomaly per bypassed cause, each mapped to one
 * error-severity `boundary-scan` gateBypasses entry, which caps a `strong`
 * assurance grade at `mixed` (the phase 346 build-test-bypassed design).
 */

const draft: Draft = {
  schemaVersion: 1,
  id: '352-01',
  phase: '352-boundary-scan-bypasses-are-recorded',
  tier: 'standard',
  title: 'boundary-scan bypasses are recorded',
  objective: 'x',
  acceptanceCriteria: [{ id: 'AC-1', name: 'n', given: 'g', when: 'w', then: 't' }],
  tasks: [{ id: 'T1', name: 'first', files: ['a.ts'], action: 'a', verify: 'v', done: 'AC-1' }],
  boundaries: [],
  status: 'IN_PROGRESS',
};

const progress: ProgressFile = {
  draftId: '352-01',
  tasks: { T1: { status: 'DONE', notes: '', touchedFiles: ['a.ts'], updatedAt: 't' } },
};

const NOW = () => new Date('2026-11-25T00:00:00.000Z');

const ctx = (over: Partial<CollectAnomaliesContext>): CollectAnomaliesContext => ({
  draft,
  progress,
  coverageBypassed: false,
  force: false,
  integrationRef: 'main',
  ...over,
});

const REPORT_A = {
  flag: '--allow-boundary-scan-failure',
  causes: ['offenders'],
  offenders: ['stray.ts'],
} as const;
const REPORT_B = { flag: '--force', causes: ['merge-base'], offenders: [] } as const;

const anomaliesFor = (boundaryScanBypass: CollectAnomaliesContext['boundaryScanBypass']): AnomalyEvent[] =>
  collectAnomalies(ctx(boundaryScanBypass ? { boundaryScanBypass } : {}), { now: NOW });

const boundaryEntries = (events: AnomalyEvent[]) =>
  gateBypassesFromAnomalies(events).filter((b) => b.gate === 'boundary-scan');

const OFFENDERS_ENTRY = {
  gate: 'boundary-scan',
  flag: '--allow-boundary-scan-failure',
  reason: '1 file(s) outside the declared boundary: stray.ts',
  severity: 'error',
};
const MERGE_BASE_ENTRY = {
  gate: 'boundary-scan',
  flag: '--force',
  reason: 'the merge-base of origin/main and HEAD could not be computed; committed files were not scanned',
  severity: 'error',
};

describe('settle: boundary-scan bypasses are recorded (phase 352)', () => {
  it('352-01/AC-3: report (a) yields one error-severity boundary-scan-bypassed anomaly with the offenders context', () => {
    const events = anomaliesFor(REPORT_A).filter((e) => e.type === 'boundary-scan-bypassed');
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(AnomalyEventZ.safeParse(ev).success).toBe(true);
    expect(ev.severity).toBe('error');
    expect(ev.context).toStrictEqual({
      flag: '--allow-boundary-scan-failure',
      cause: 'offenders',
      files: ['stray.ts'],
      integrationRef: 'main',
    });
    expect(ev.message).toContain('boundary-scan gate bypassed via --allow-boundary-scan-failure');
  });

  it('352-01/AC-3: report (b) yields one error-severity boundary-scan-bypassed anomaly with the merge-base context', () => {
    const events = anomaliesFor(REPORT_B).filter((e) => e.type === 'boundary-scan-bypassed');
    expect(events).toHaveLength(1);
    expect(events[0]!.severity).toBe('error');
    expect(events[0]!.context).toStrictEqual({
      flag: '--force',
      cause: 'merge-base',
      files: [],
      integrationRef: 'main',
    });
  });

  it('352-01/AC-3: report (a) maps to exactly one boundary-scan gateBypasses entry naming the offending file', () => {
    expect(boundaryEntries(anomaliesFor(REPORT_A))).toStrictEqual([OFFENDERS_ENTRY]);
  });

  it('352-01/AC-3: report (b) maps to exactly one boundary-scan gateBypasses entry naming the merge-base', () => {
    expect(boundaryEntries(anomaliesFor(REPORT_B))).toStrictEqual([MERGE_BASE_ENTRY]);
  });

  it('352-01/AC-3: a report with both causes maps to two entries, merge-base first', () => {
    const entries = boundaryEntries(
      anomaliesFor({ flag: '--force', causes: ['merge-base', 'offenders'], offenders: ['stray.ts'] }),
    );
    expect(entries).toStrictEqual([
      MERGE_BASE_ENTRY,
      { ...OFFENDERS_ENTRY, flag: '--force' },
    ]);
  });

  it('352-01/AC-3: no boundaryScanBypass yields no boundary-scan-bypassed anomaly and no boundary-scan entry', () => {
    const events = anomaliesFor(undefined);
    expect(events.filter((e) => e.type === 'boundary-scan-bypassed')).toStrictEqual([]);
    expect(boundaryEntries(events)).toStrictEqual([]);
  });

  it('352-01/AC-3: report (a) entries cap a strong grade at mixed; without them the same pair grades strong', () => {
    // One synthetic real-provider gate plus executed evidence grades strong
    // (the phase 346 precedent in settle-build-test-bypass.test.ts).
    const gates: GateProvenance[] = [{ gate: 'code-review', status: 'ran', provider: 'anthropic' }];
    const acResults: AssuranceAcResult[] = [{ id: 'AC-1', pass: true, evidence: 'executed' }];
    const entries = boundaryEntries(anomaliesFor(REPORT_A));
    expect(entries).toHaveLength(1);
    expect(deriveAssuranceRecord(gates, acResults, { gateBypasses: entries }).overall).toBe('mixed');
    expect(deriveAssuranceRecord(gates, acResults, { gateBypasses: [] }).overall).toBe('strong');
  });
});
