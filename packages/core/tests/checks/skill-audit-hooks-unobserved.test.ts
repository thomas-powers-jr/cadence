import { describe, it, expect } from 'vitest';
import { runSkillAuditCheck } from '../../src/checks/skill-audit.js';
import type { ProgressJson, SettleContext } from '../../src/gates/types.js';

/**
 * Phase 349 (349-01, T3): when a required skill is missing and one or more of
 * the settling draft's PROGRESS rows were recorded with `hooksObserved: false`,
 * the refusal line, the returned refusal line and the bypass reason name those
 * tasks (draft order). With no `false` row, all three stay byte-identical to
 * the pre-349 text, and the outcome never changes.
 */

type Row = ProgressJson['tasks'][string];

const row = (hooksObserved?: boolean): Row => ({
  status: 'DONE',
  notes: '',
  touchedFiles: [],
  updatedAt: '2026-11-23T00:00:00.000Z',
  ...(hooksObserved !== undefined ? { hooksObserved } : {}),
});

function ctx(over: {
  taskIds: string[];
  rows: Record<string, Row>;
  allowSkillAuditMiss?: boolean;
  errs: string[];
}): SettleContext {
  return {
    cwd: '/x',
    state: { skillAudit: { required: [], invoked: [] } } as never,
    draft: { requiredSkills: [], tasks: over.taskIds.map((id) => ({ id, files: [] })) } as never,
    progress: { draftId: '01-01', tasks: over.rows },
    config: {
      skillAudit: { required: ['tdd', 'phase-build'] },
      telemetry: { skillInvocations: true },
    } as never,
    opts: over.allowSkillAuditMiss ? { allowSkillAuditMiss: true } : {},
    emit: { skillAuditMiss: async () => {} },
    io: { err: (s: string) => over.errs.push(s) },
  } as unknown as SettleContext;
}

const SUFFIX = (ids: string) =>
  `; host hooks were not observed when task(s) ${ids} were recorded, so a skill invoked in that session would not have been recorded`;
const TODAY_REFUSAL =
  'settle run refused: required skill(s) not invoked: tdd, phase-build. Invoke them, or pass --allow-skill-audit-miss to override.';
const TODAY_REASON = 'required skill(s) not invoked: tdd, phase-build';

// Draft order T1, T2, T3; PROGRESS keys deliberately in a different order.
const TASK_IDS = ['T1', 'T2', 'T3'];
const MIXED: Record<string, Row> = { T3: row(false), T2: row(true), T1: row(false) };

describe('skill-audit names tasks recorded without live host hooks (349-01)', () => {
  it('349-01/AC-3: the refusal line carries the suffix with the unobserved ids in draft order', async () => {
    const errs: string[] = [];
    const res = await runSkillAuditCheck(ctx({ taskIds: TASK_IDS, rows: MIXED, errs }));
    expect(res.outcome).toBe('refuse');
    const expected =
      'settle run refused: required skill(s) not invoked: tdd, phase-build' +
      SUFFIX('T1, T3') +
      '. Invoke them, or pass --allow-skill-audit-miss to override.';
    expect(errs).toEqual([`${expected}\n`]);
    expect(res.refusalLine).toBe(expected);
    expect(res.bypassed).toBeUndefined();
  });

  it('349-01/AC-3: the bypass reason ends with the suffix and the outcome stays pass', async () => {
    const errs: string[] = [];
    const res = await runSkillAuditCheck(ctx({ taskIds: TASK_IDS, rows: MIXED, allowSkillAuditMiss: true, errs }));
    expect(res.outcome).toBe('pass');
    expect(res.bypassed).toBe(true);
    expect(res.reason).toBe(TODAY_REASON + SUFFIX('T1, T3'));
    expect(res.refusalLine).toBeUndefined();
    // The bypass notice on stderr is unchanged.
    expect(errs).toEqual(['skill-audit: --allow-skill-audit-miss set; proceeding past 2 missing skill(s).\n']);
  });

  it('349-01/AC-3: a progress row for an id not in the draft is not named', async () => {
    const errs: string[] = [];
    const res = await runSkillAuditCheck(
      ctx({ taskIds: ['T1'], rows: { T1: row(true), T9: row(false) }, errs }),
    );
    expect(res.outcome).toBe('refuse');
    expect(res.refusalLine).toBe(TODAY_REFUSAL);
  });

  for (const [label, rows] of [
    ['all rows hooksObserved: true', { T1: row(true), T2: row(true), T3: row(true) }],
    ['rows with no hooksObserved key', { T1: row(), T2: row(), T3: row() }],
    ['no progress rows at all', {}],
  ] as const) {
    it(`349-01/AC-3: ${label} give byte-identical refusal and bypass text to today's`, async () => {
      const errs: string[] = [];
      const refused = await runSkillAuditCheck(ctx({ taskIds: TASK_IDS, rows: { ...rows }, errs }));
      expect(refused.outcome).toBe('refuse');
      expect(errs).toEqual([`${TODAY_REFUSAL}\n`]);
      expect(refused.refusalLine).toBe(TODAY_REFUSAL);

      const errs2: string[] = [];
      const bypassed = await runSkillAuditCheck(
        ctx({ taskIds: TASK_IDS, rows: { ...rows }, allowSkillAuditMiss: true, errs: errs2 }),
      );
      expect(bypassed.outcome).toBe('pass');
      expect(bypassed.reason).toBe(TODAY_REASON);
    });
  }
});
