import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { HookDispatcher } from '../../src/hooks/dispatcher.js';
import { SimpleStateBackend } from '../../src/state/simple.js';
import { applySkillInvoke } from '../../src/hooks/handlers.js';

let active: Fixture | null = null;
afterEach(async () => { if (active) { await active.cleanup(); active = null; } });

describe('HookDispatcher', () => {
  it('session-start returns a context payload', async () => {
    active = await tempRepo({ initialized: true, projectName: 'demo' });
    const d = new HookDispatcher(active.root);
    const result = await d.dispatch('session-start', { cwd: active.root, event: 'session-start' });
    expect(result.ok).toBe(true);
    expect(result.contextPayload).toMatch(/demo/);
  });

  // Phase 322 (T2, AC-4): the dispatcher resolves the latest settled phase
  // from the working-tree SUMMARY files for session-start only, best-effort.
  it('322-01/AC-4: session-start on an IDLE checkout names the latest settled phase found on disk', async () => {
    active = await tempRepo({ initialized: true, projectName: 'demo' });
    const statePath = join(active.root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activePhase = '311-old';
    state.loopPosition = 'IDLE';
    await writeFile(statePath, JSON.stringify(state, null, 2));
    const phaseDir = join(active.root, '.cadence/phases/312-new');
    await mkdir(phaseDir, { recursive: true });
    await writeFile(
      join(phaseDir, '312-01-SUMMARY.json'),
      JSON.stringify({
        draftId: '312-01',
        stateAtSettle: { loopPositionBeforeSettle: 'BUILD', revision: 1, sessionSubagentSpawns: 0 },
      }),
    );
    const d = new HookDispatcher(active.root);
    const result = await d.dispatch('session-start', { cwd: active.root, event: 'session-start' });
    expect(result.ok).toBe(true);
    expect(result.contextPayload).toContain(
      'Active phase: (none — loop is IDLE)\nLatest settled phase: 312-new\n',
    );
    expect(result.contextPayload).not.toContain('311-old');
  });

  it('322-01/AC-4: session-start still succeeds when the lookup yields nothing (no phases directory at all)', async () => {
    active = await tempRepo({ initialized: true, projectName: 'demo' });
    await rm(join(active.root, '.cadence/phases'), { recursive: true, force: true });
    const d = new HookDispatcher(active.root);
    const result = await d.dispatch('session-start', { cwd: active.root, event: 'session-start' });
    expect(result.ok).toBe(true);
    expect(result.contextPayload).toContain('Active phase: (none — loop is IDLE)');
    expect(result.contextPayload).not.toContain('Latest settled phase');
  });

  it('322-01/AC-4: a refused SUMMARY (no stateAtSettle) is not named as the latest settled phase', async () => {
    active = await tempRepo({ initialized: true, projectName: 'demo' });
    const phaseDir = join(active.root, '.cadence/phases/313-refused');
    await mkdir(phaseDir, { recursive: true });
    await writeFile(join(phaseDir, '313-01-SUMMARY.json'), JSON.stringify({ draftId: '313-01', acResults: [] }));
    const d = new HookDispatcher(active.root);
    const result = await d.dispatch('session-start', { cwd: active.root, event: 'session-start' });
    expect(result.ok).toBe(true);
    expect(result.contextPayload).toContain('Active phase: (none — loop is IDLE)');
    expect(result.contextPayload).not.toContain('Latest settled phase');
  });

  it('322-01/AC-4: session-start falls back to "Last phase in this checkout:" when only pre-stateAtSettle SUMMARYs exist', async () => {
    active = await tempRepo({ initialized: true, projectName: 'demo' });
    const statePath = join(active.root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activePhase = '311-old';
    state.loopPosition = 'IDLE';
    await writeFile(statePath, JSON.stringify(state, null, 2));
    const phaseDir = join(active.root, '.cadence/phases/311-old');
    await mkdir(phaseDir, { recursive: true });
    await writeFile(join(phaseDir, '311-01-SUMMARY.json'), JSON.stringify({ draftId: '311-01', acResults: [] }));
    const d = new HookDispatcher(active.root);
    const result = await d.dispatch('session-start', { cwd: active.root, event: 'session-start' });
    expect(result.ok).toBe(true);
    expect(result.contextPayload).toContain(
      'Active phase: (none — loop is IDLE)\nLast phase in this checkout: 311-old\n',
    );
    expect(result.contextPayload).not.toContain('Latest settled phase');
  });

  it('subagent-result increments state.session.subagentSpawns', async () => {
    active = await tempRepo({ initialized: true });
    const d = new HookDispatcher(active.root);
    await d.dispatch('subagent-result', { cwd: active.root, event: 'subagent-result' });
    await d.dispatch('subagent-result', { cwd: active.root, event: 'subagent-result' });
    const state = await new SimpleStateBackend(active.root).readState();
    expect(state.session.subagentSpawns).toBe(2);
  });

  // Task 7 (Phase 158) — SubagentStart wiring.
  it('routes subagent-start to handleSubagentStart (does not throw, returns ok)', async () => {
    active = await tempRepo({ initialized: true });
    const d = new HookDispatcher(active.root);
    const result = await d.dispatch('subagent-start', { cwd: active.root, event: 'subagent-start' });
    expect(result.ok).toBe(true);
  });

  it('pre-tool-edit blocks when buildGate=true and loopPosition != BUILD', async () => {
    active = await tempRepo({ initialized: true });
    const cfgPath = join(active.root, '.cadence/config.json');
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
    cfg.hooks.preToolUseBuildGate = true;
    await writeFile(cfgPath, JSON.stringify(cfg));
    const d = new HookDispatcher(active.root);
    const r = await d.dispatch('pre-tool-edit', { cwd: active.root, event: 'pre-tool-edit' });
    expect(r.ok).toBe(false);
    expect(r.blockMessage).toMatch(/BUILD/);
  });

  // AC-3, AC-4 (Phase 23.4) — skill-invoke handler
  it('skill-invoke appends ctx.raw.skill to state.skillAudit.invoked', async () => {
    active = await tempRepo({ initialized: true });
    const d = new HookDispatcher(active.root);
    await d.dispatch('skill-invoke', {
      cwd: active.root,
      event: 'skill-invoke',
      raw: { skill: 'using-superpowers' },
    });
    const state = await new SimpleStateBackend(active.root).readState();
    expect(state.skillAudit.invoked).toEqual(['using-superpowers']);
  });

  it('skill-invoke dedups: invoking the same skill twice → still one entry', async () => {
    active = await tempRepo({ initialized: true });
    const d = new HookDispatcher(active.root);
    await d.dispatch('skill-invoke', { cwd: active.root, event: 'skill-invoke', raw: { skill: 'foo' } });
    await d.dispatch('skill-invoke', { cwd: active.root, event: 'skill-invoke', raw: { skill: 'foo' } });
    const state = await new SimpleStateBackend(active.root).readState();
    expect(state.skillAudit.invoked).toEqual(['foo']);
  });

  it('skill-invoke no-ops when telemetry.skillInvocations=false', async () => {
    active = await tempRepo({ initialized: true });
    const cfgPath = join(active.root, '.cadence/config.json');
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
    cfg.telemetry.skillInvocations = false;
    await writeFile(cfgPath, JSON.stringify(cfg));
    const d = new HookDispatcher(active.root);
    await d.dispatch('skill-invoke', {
      cwd: active.root,
      event: 'skill-invoke',
      raw: { skill: 'using-superpowers' },
    });
    const state = await new SimpleStateBackend(active.root).readState();
    expect(state.skillAudit.invoked).toEqual([]);
  });

  it('skill-invoke no-ops when ctx.raw.skill is missing or non-string', async () => {
    active = await tempRepo({ initialized: true });
    const d = new HookDispatcher(active.root);
    await d.dispatch('skill-invoke', { cwd: active.root, event: 'skill-invoke' });
    await d.dispatch('skill-invoke', { cwd: active.root, event: 'skill-invoke', raw: { skill: 123 } });
    const state = await new SimpleStateBackend(active.root).readState();
    expect(state.skillAudit.invoked).toEqual([]);
  });

  // AC-4 (Phase 266) — FIFO-cap logic exercised directly against the pure
  // function, in-memory, with no HookDispatcher/tempRepo/disk I/O. Replaces
  // a prior version of this test that drove 105 serial real dispatcher
  // round-trips (state read + config read + a two-file atomic commit per
  // call), which timed out on Windows CI (rec-20260809-002).
  it('266-01/AC-4: applySkillInvoke caps at 100 entries with FIFO drop', () => {
    let invoked: string[] = [];
    // Push 105 unique skills; first 5 should fall off the front.
    for (let i = 0; i < 105; i++) {
      invoked = applySkillInvoke(invoked, `skill-${i}`, 100);
    }
    expect(invoked).toHaveLength(100);
    expect(invoked[0]).toBe('skill-5');
    expect(invoked[99]).toBe('skill-104');
  });
});
