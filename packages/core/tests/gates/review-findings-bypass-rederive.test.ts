import { describe, it, expect } from 'vitest';
import type { DeepVerdict, GateBypass, GateProvenance } from '@thomas-powers-jr/cadence-types';
import { deriveAssuranceRecord, type AssuranceAcResult } from '../../src/gates/assurance-record.js';
import { computeAssuranceReport, parseSummaryRecord } from '../../src/services/assurance-report.js';

// ---------------------------------------------------------------------------
// Phase 332 (332-01, T6): re-derivation characterization (D-CD,
// dec-20261016-007). A SUMMARY written before this phase records a
// code-review findings bypass only as a `status: 'ran'` gate entry with no
// `gateBypasses` key, so `assurance report`'s re-derivation cannot see it and
// grades it exactly as stored. The same record carrying the `code-review`
// entry this phase now writes caps at `'mixed'` (D-S). Self-contained: the
// shape mirrors 331-01's SUMMARY (one real-provider gate, ten `ai-verified`
// ACs, all-pass real deepVerify) without reading it.
// ---------------------------------------------------------------------------

const AC_IDS = Array.from({ length: 10 }, (_, i) => `AC-${i + 1}`);

const GATES_331_SHAPE: GateProvenance[] = [
  { gate: 'draft-read', status: 'ran' },
  { gate: 'structural-verifier', status: 'ran' },
  { gate: 'boundary-scan', status: 'ran' },
  { gate: 'task-verify-required', status: 'ran' },
  { gate: 'build-test-must-pass', status: 'ran' },
  { gate: 'test-coverage', status: 'ran' },
  {
    gate: 'interactive-verdict',
    status: 'skipped',
    skipReason: 'not requested (no --deep / --interactive, not in gate set)',
  },
  { gate: 'deep-verify', status: 'ran', observedProvider: 'host-cli' },
  { gate: 'code-review', status: 'ran', provider: 'host-cli', providerSelection: 'configured' },
  { gate: 'security-audit', status: 'skipped', skipReason: 'not in the active tier × profile gate set' },
];

const AC_RESULTS: AssuranceAcResult[] = AC_IDS.map((id) => ({ id, pass: true, evidence: 'ai-verified' }));

const DEEP_VERIFY: Record<string, DeepVerdict> = Object.fromEntries(
  AC_IDS.map((id) => [id, { pass: true, reason: 'verified', provider: 'host-cli' }]),
);

/** The `GateBypass` phase 332 records for a code-review findings bypass. */
const CODE_REVIEW_FINDINGS_BYPASS: GateBypass = {
  gate: 'code-review',
  flag: '--allow-code-review-failure',
  reason: 'bypassed 2 finding(s), highest severity high',
  severity: 'error',
};

interface SummaryShape {
  gates?: GateProvenance[];
  acResults: AssuranceAcResult[];
  gateBypasses?: GateBypass[];
  deepVerify?: Record<string, DeepVerdict>;
}

/** A pre-fix SUMMARY shaped like 331-01's: no `gateBypasses` key at all. */
function preFixSummary(): SummaryShape {
  return { gates: GATES_331_SHAPE, acResults: AC_RESULTS, deepVerify: DEEP_VERIFY };
}

/** Exactly the call `computeAssuranceReport` makes (assurance-report.ts). */
function rederiveAsReport(s: SummaryShape) {
  return deriveAssuranceRecord(s.gates ?? [], s.acResults, {
    gateBypasses: s.gateBypasses ?? [],
    ...(s.deepVerify !== undefined ? { deepVerify: s.deepVerify } : {}),
  });
}

/** A full schema-valid SUMMARY.json body around `s`, with a stored grade. */
function summaryJson(s: SummaryShape): string {
  return JSON.stringify({
    schemaVersion: 2,
    draftId: '331-01',
    completedAt: '2026-10-16T16:44:59.903Z',
    acResults: s.acResults,
    gates: s.gates,
    taskResults: [],
    decisions: [],
    deferred: [],
    skillAudit: { required: [], invoked: [] },
    ...(s.gateBypasses !== undefined ? { gateBypasses: s.gateBypasses } : {}),
    ...(s.deepVerify !== undefined ? { deepVerify: s.deepVerify } : {}),
    assurance: {
      verifierRollup: [{ provider: 'host-cli', gateCount: 1 }],
      evidenceTally: { 'ai-verified': 10, executed: 0, assertion: 0, mention: 0, unverified: 0 },
      overall: 'strong',
    },
  });
}

const REL_PATH = '.cadence/phases/331-checkpoint-sensor-state-store/331-01-SUMMARY.json';

describe('review findings bypass re-derivation (332-01/AC-9)', () => {
  it('332-01/AC-9: a pre-fix 331-01-shaped SUMMARY (no gateBypasses key) re-derives strong as assurance report does', () => {
    const s = preFixSummary();
    expect('gateBypasses' in s).toBe(false);
    const again = rederiveAsReport(s);
    expect(again.overall).toBe('strong');
    expect(again.verifierRollup).toEqual([{ provider: 'host-cli', gateCount: 1 }]);
  });

  it('332-01/AC-9: the same SUMMARY with the code-review entry phase 332 records re-derives mixed', () => {
    const s: SummaryShape = { ...preFixSummary(), gateBypasses: [CODE_REVIEW_FINDINGS_BYPASS] };
    const again = rederiveAsReport(s);
    expect(again.overall).toBe('mixed');
    // Only the cap moved: the rollup and tally are unchanged by the bypass.
    const before = rederiveAsReport(preFixSummary());
    expect(again.verifierRollup).toEqual(before.verifierRollup);
    expect(again.evidenceTally).toEqual(before.evidenceTally);
  });

  it('332-01/AC-9: computeAssuranceReport shows no drift for the pre-fix record and one strong→mixed delta with the entry', () => {
    const pre = parseSummaryRecord(REL_PATH, summaryJson(preFixSummary()));
    expect(pre).toMatchObject({ ok: true });
    if (!pre.ok) return;
    const preReport = computeAssuranceReport([pre.record], [], {});
    expect(preReport.grades.stored.strong).toBe(1);
    expect(preReport.grades.rederived.strong).toBe(1);
    expect(preReport.grades.delta).toEqual([]);
    expect(preReport.recordsWithBypasses).toBe(0);

    const post = parseSummaryRecord(
      REL_PATH,
      summaryJson({ ...preFixSummary(), gateBypasses: [CODE_REVIEW_FINDINGS_BYPASS] }),
    );
    expect(post).toMatchObject({ ok: true });
    if (!post.ok) return;
    const postReport = computeAssuranceReport([post.record], [], {});
    expect(postReport.grades.rederived.mixed).toBe(1);
    expect(postReport.grades.delta).toEqual([
      { id: '331-01', path: REL_PATH, stored: 'strong', rederived: 'mixed' },
    ]);
  });
});
