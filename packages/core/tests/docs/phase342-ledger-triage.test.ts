import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/core/tests/docs -> repo root is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const INTEL = join(REPO_ROOT, '.cadence/intelligence');

interface LedgerRecommendation {
  id: string;
  title: string;
  status: string;
  readiness: string;
  priority: string;
  affectedAreas: string[];
  decisionIds: string[];
  scoutId?: string;
  createdAt: string;
  shippedRef?: string;
}

interface LedgerDecision {
  id: string;
  title: string;
  rationale: string;
  status: string;
}

// Read the ledger files directly rather than through `recommendation list`:
// a rejected or shipped rec is soft-archived (recommendations.autoArchive),
// and the list command shows only the active set by default.
function allRecommendations(): LedgerRecommendation[] {
  const raw = JSON.parse(readFileSync(join(INTEL, 'recommendations.json'), 'utf8')) as {
    recommendations: LedgerRecommendation[];
    archived?: LedgerRecommendation[];
  };
  return [...raw.recommendations, ...(raw.archived ?? [])];
}

function allDecisions(): LedgerDecision[] {
  const raw = JSON.parse(readFileSync(join(INTEL, 'decisions.json'), 'utf8')) as {
    decisions: LedgerDecision[];
  };
  return raw.decisions;
}

const STUDIO_SCOUT = 'scout-20261030-studio-intake';

// The 56 recs that were candidate/needs-decision on main at 655b20ef, when
// phase 342 started. Fixed here so the assertion cannot shrink with the ledger.
const TRIAGED_IDS = [
  'rec-20260730-001', 'rec-20260806-006', 'rec-20260807-005', 'rec-20260813-005',
  'rec-20260820-001', 'rec-20260917-006', 'rec-20260726-005', 'rec-20260728-002',
  'rec-20260729-003', 'rec-20260729-005', 'rec-20260731-007', 'rec-20260804-003',
  'rec-20260804-004', 'rec-20260806-001', 'rec-20260806-002', 'rec-20260806-003',
  'rec-20260806-005', 'rec-20260806-007', 'rec-20260806-008', 'rec-20260808-001',
  'rec-20260809-005', 'rec-20260811-003', 'rec-20260812-001', 'rec-20260813-001',
  'rec-20260815-003', 'rec-20260820-002', 'rec-20260821-001', 'rec-20260822-002',
  'rec-20260822-007', 'rec-20260822-008', 'rec-20260907-006', 'rec-20260916-003',
  'rec-20260917-003', 'rec-20260917-005', 'rec-20260918-001', 'rec-20260918-008',
  'rec-20260926-002', 'rec-20260927-002', 'rec-20261010-004', 'rec-20261010-005',
  'rec-20261010-006', 'rec-20261016-003', 'rec-20261016-005', 'rec-20261021-001',
  'rec-20261023-001', 'rec-20261023-002', 'rec-20260731-005', 'rec-20260731-006',
  'rec-20260801-007', 'rec-20260803-001', 'rec-20260804-002', 'rec-20260809-004',
  'rec-20260809-006', 'rec-20260811-004', 'rec-20260821-002', 'rec-20261015-001',
];

const TRIAGE_TITLE = /^342 triage: (promote|defer|reject|shipped) (rec-\d{8}-\d{3}) -- /;

describe('phase 342: needs-decision backlog triage and Studio upstream intake', () => {
  it('342-01/AC-1: each Studio upstream ask is a filed rec under the intake scout id and studio-upstream area', () => {
    const studio = allRecommendations().filter((r) => r.scoutId === STUDIO_SCOUT);
    // Nine roadmap asks plus Studio's rec-20261028-008; none was fully covered.
    expect(studio).toHaveLength(10);
    for (const rec of studio) {
      expect(rec.affectedAreas).toContain('studio-upstream');
    }
    const titles = studio.map((r) => r.title);
    const expectTitle = (re: RegExp) => expect(titles.some((t) => re.test(t))).toBe(true);
    expectTitle(/--json output for the mutating loop commands/);
    expectTitle(/exit-code contract/);
    expectTitle(/services layer as a library entry point/);
    expectTitle(/verification\.fallback: "refuse"/);
    expectTitle(/deep-verify seam's session axis/);
    expectTitle(/Per-seam host-cli binary in config\.json/);
    expectTitle(/AC deferred\/parked/);
    expectTitle(/init\/onboard flags for verification\.testCommand/);
    expectTitle(/Amend an approved DRAFT/);
    expectTitle(/inherit the operator's full user config/);

    // The two asks that become phases 343 and 344 are filed high.
    const byTitle = (re: RegExp) => studio.find((r) => re.test(r.title));
    expect(byTitle(/verification\.fallback: "refuse"/)?.priority).toBe('high');
    expect(byTitle(/inherit the operator's full user config/)?.priority).toBe('high');
  });

  it('342-01/AC-2: every needs-decision rec at phase start carries one 342 triage decision, and its ledger state matches it', () => {
    const recs = new Map(allRecommendations().map((r) => [r.id, r]));
    const decisions = new Map(allDecisions().map((d) => [d.id, d]));
    expect(TRIAGED_IDS).toHaveLength(56);
    expect(new Set(TRIAGED_IDS).size).toBe(56);

    for (const id of TRIAGED_IDS) {
      const rec = recs.get(id);
      expect(rec, `${id} missing from the ledger`).toBeDefined();
      if (!rec) continue;
      const triage = rec.decisionIds
        .map((d) => decisions.get(d))
        .filter((d): d is LedgerDecision => d !== undefined && TRIAGE_TITLE.test(d.title));
      expect(triage, `${id} should carry exactly one 342 triage decision`).toHaveLength(1);
      const decision = triage[0]!;
      const [, disposition, named] = TRIAGE_TITLE.exec(decision.title)!;
      expect(named).toBe(id);
      expect(decision.rationale.length).toBeGreaterThan(40);

      // A later decision on the same rec supersedes this phase's triage, so
      // only check the ledger state while the 342 decision is still the latest.
      if (rec.decisionIds[rec.decisionIds.length - 1] !== decision.id) continue;
      switch (disposition) {
        case 'promote':
          expect(rec.readiness, id).toBe('ready-for-cadence-spec');
          break;
        case 'defer':
          expect(rec.status, id).toBe('deferred');
          expect(decision.rationale, id).toMatch(/[Rr]eopen/);
          break;
        case 'reject':
          expect(rec.status, id).toBe('rejected');
          break;
        case 'shipped':
          expect(rec.status, id).toBe('shipped');
          expect(rec.shippedRef ?? '', id).not.toBe('');
          break;
      }
    }
  });

  it('342-01/AC-3: fewer than 20 candidate recs created on or before 2026-10-30 remain at needs-decision', () => {
    const cutoff = Date.parse('2026-10-31T00:00:00.000Z');
    const open = allRecommendations().filter(
      (r) =>
        r.status === 'candidate' &&
        r.readiness === 'needs-decision' &&
        Date.parse(r.createdAt) < cutoff,
    );
    expect(open.length).toBeLessThan(20);
  });
});
