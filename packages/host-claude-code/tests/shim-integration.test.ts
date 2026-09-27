import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHIM = join(__dirname, '../dist/cli.js');
const CADENCE_CLI = join(__dirname, '../../core/dist/cli/index.js');

interface Result {
  stdout: string;
  stderr: string;
  code: number;
}

function runShim(args: string[], cwd: string, stdin: string): Promise<Result> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SHIM, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.stdin.write(stdin);
    p.stdin.end();
    p.on('exit', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

let active: Fixture | null = null;
let activeMulti: Fixture[] = [];
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
  if (activeMulti.length > 0) {
    await Promise.all(activeMulti.map((f) => f.cleanup()));
    activeMulti = [];
  }
});

describe('shim → core integration', () => {
  it('SessionStart through shim prints CADENCE session context', async () => {
    active = await tempRepo({ initialized: true, projectName: 'integ' });
    const stdin = JSON.stringify({ hook_event_name: 'SessionStart' });
    const r = await runShim(
      ['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`],
      active.root,
      stdin,
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/CADENCE session resumed/);
    expect(r.stdout).toMatch(/integ/);
  });

  it('PostToolUse Edit through shim records touchedFiles when a task is active', async () => {
    active = await tempRepo({ initialized: true });
    // Force activeTask in state to exercise post-tool-edit path.
    const statePath = join(active.root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activeTask = { id: 'T1', status: 'IN_PROGRESS', touchedFiles: [] };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(statePath, JSON.stringify(state, null, 2));

    const stdin = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/proj/src/foo.ts', old_string: 'a', new_string: 'b' },
    });
    const r = await runShim(
      ['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`],
      active.root,
      stdin,
    );
    expect(r.code).toBe(0);
    const after = JSON.parse(await readFile(statePath, 'utf8'));
    expect(after.activeTask.touchedFiles).toEqual(['/proj/src/foo.ts']);
  });

  it('Notification through shim is a no-op (exit 0, no spawn)', async () => {
    active = await tempRepo({ initialized: true });
    const stdin = JSON.stringify({ hook_event_name: 'Notification', message: 'hi' });
    const r = await runShim(
      ['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`],
      active.root,
      stdin,
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });
});

// Regression tests for phase 314 (rec-20260918-003): the shim spawns
// `cadence hook <event>` without an explicit `cwd`, so the child silently
// inherits whatever process.cwd() the shim itself was launched with instead
// of honoring the hook payload's own `cwd` field. This produced a live bug:
// invoking a skill from inside a worktree-resident session recorded the
// automatic Skill-tool hook into the *primary checkout's* state instead of
// the worktree's own. These tests only prove the bug exists — T2 (a
// separate task) implements the fix.
describe('shim cwd passthrough (regression, phase 314)', () => {
  function skillInvokePayload(extra: Record<string, unknown>): string {
    return JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Skill',
      tool_input: { skill: 'phase-build' },
      session_id: 'test',
      ...extra,
    });
  }

  it('314-01/AC-1: (a) honors the payload cwd: state lands in the payload cwd, not the shim process cwd', async () => {
    const outer = await tempRepo({ initialized: true, projectName: 'outer-a' });
    const target = await tempRepo({ initialized: true, projectName: 'target-a' });
    activeMulti.push(outer, target);

    const stdin = skillInvokePayload({ cwd: target.root });
    const r = await runShim(
      ['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`],
      outer.root,
      stdin,
    );
    expect(r.code).toBe(0);

    const targetState = JSON.parse(
      await readFile(join(target.root, '.cadence/state.json'), 'utf8'),
    );
    expect(targetState.skillAudit.invoked).toContain('phase-build');

    const outerState = JSON.parse(
      await readFile(join(outer.root, '.cadence/state.json'), 'utf8'),
    );
    expect(outerState.skillAudit.invoked).not.toContain('phase-build');
  });

  it('314-01/AC-3: (b) no cwd field in payload: falls back to the shim process cwd and exits 0', async () => {
    const outer = await tempRepo({ initialized: true, projectName: 'outer-b' });
    activeMulti.push(outer);

    const stdin = skillInvokePayload({});
    const r = await runShim(
      ['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`],
      outer.root,
      stdin,
    );
    expect(r.code).toBe(0);

    const outerState = JSON.parse(
      await readFile(join(outer.root, '.cadence/state.json'), 'utf8'),
    );
    expect(outerState.skillAudit.invoked).toContain('phase-build');
  });

  it('314-01/AC-3: (c) payload cwd names a nonexistent directory: falls back to the shim process cwd and exits 0', async () => {
    const outer = await tempRepo({ initialized: true, projectName: 'outer-c' });
    activeMulti.push(outer);

    const bogusCwd = join(outer.root, 'does-not-exist-on-disk');
    const stdin = skillInvokePayload({ cwd: bogusCwd });
    const r = await runShim(
      ['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`],
      outer.root,
      stdin,
    );
    expect(r.code).toBe(0);

    const outerState = JSON.parse(
      await readFile(join(outer.root, '.cadence/state.json'), 'utf8'),
    );
    expect(outerState.skillAudit.invoked).toContain('phase-build');
  });

  it('314-01/AC-3: (d) when the payload cwd and shim process cwd diverge, stderr names both', async () => {
    const outer = await tempRepo({ initialized: true, projectName: 'outer-d' });
    const target = await tempRepo({ initialized: true, projectName: 'target-d' });
    activeMulti.push(outer, target);

    const stdin = skillInvokePayload({ cwd: target.root });
    const r = await runShim(
      ['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`],
      outer.root,
      stdin,
    );

    expect(r.stderr).toContain(target.root);
    expect(r.stderr).toContain(outer.root);
  });
});

// Phase 318-01 (T2): end-to-end regression for the subagent task-redundancy
// safety net through the REAL shim. Claude Code sends snake_case
// `agent_id`/`agent_type`; core's `cadence hook` reads camelCase
// `agentId`/`agentType`. These tests drive SubagentStart → PostToolUse(Edit)
// → SubagentStop with snake_case fields only, so they fail until the shim's
// routing forwards agent identity into the translated stdin.
describe('shim → core subagent agent-identity routing (phase 318)', () => {
  const AGENT = { agent_id: 'agent-318', agent_type: 'general-purpose' } as const;

  async function patchConfig(root: string, patch: Record<string, unknown>): Promise<void> {
    const { writeFile } = await import('node:fs/promises');
    const path = join(root, '.cadence/config.json');
    const cfg = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...cfg, ...patch }, null, 2));
  }

  // Seeds BUILD state with a DRAFT (T1 owns src/a.ts, T2 owns src/b.ts) and a
  // PROGRESS.json marking T1 DONE / T2 PENDING. Deliberately does NOT seed a
  // subagent baseline — the real SubagentStart hook must create it.
  async function seedBuildState(root: string): Promise<void> {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const phaseDir = join(root, '.cadence/phases/01-foundation');
    await mkdir(phaseDir, { recursive: true });
    const draftMd = `---\nphase: 01-foundation\nid: 01-01\ntier: standard\nstatus: APPROVED\n---\n\n# 01-01 — Demo\n\n## Objective\n\nDemo.\n\n## Acceptance Criteria\n\n### AC-1: Demo\nGiven setup\nWhen action\nThen outcome\n\n## Tasks\n\n### T1: done thing\n- files: \`src/a.ts\`\n- action: do\n- verify: vitest\n- done: AC-1\n\n### T2: pending thing\n- files: \`src/b.ts\`\n- action: do\n- verify: vitest\n- done: AC-1\n\n## Boundaries\n\n- _(none)_\n`;
    await writeFile(join(phaseDir, '01-01-DRAFT.md'), draftMd);
    const now = new Date().toISOString();
    const progress = {
      draftId: '01-01',
      tasks: {
        T1: { status: 'DONE', notes: '', touchedFiles: ['src/a.ts'], updatedAt: now },
        T2: { status: 'PENDING', notes: '', touchedFiles: [], updatedAt: now },
      },
    };
    await writeFile(join(phaseDir, '01-01-PROGRESS.json'), JSON.stringify(progress, null, 2));
    const statePath = join(root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activePhase = '01-foundation';
    state.activeDraft = '01-01';
    state.loopPosition = 'BUILD';
    state.tier = 'standard';
    state.openDrafts = [{ id: '01-01', since: now }];
    await writeFile(statePath, JSON.stringify(state, null, 2));
  }

  async function readAnomalies(
    root: string,
  ): Promise<Array<{ type: string; context: Record<string, unknown> }>> {
    const { existsSync } = await import('node:fs');
    const path = join(root, '.cadence/anomalies.log');
    if (!existsSync(path)) return [];
    return (await readFile(path, 'utf8'))
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as { type: string; context: Record<string, unknown> });
  }

  async function driveSubagentLifecycle(root: string): Promise<{
    start: Result;
    edit: Result;
    stop: Result;
  }> {
    const cadence = ['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`];
    const base = { session_id: 'test', cwd: root, ...AGENT };
    const start = await runShim(
      cadence,
      root,
      JSON.stringify({ hook_event_name: 'SubagentStart', ...base }),
    );
    const edit = await runShim(
      cadence,
      root,
      JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: join(root, 'src', 'a.ts'), old_string: 'a', new_string: 'b' },
        ...base,
      }),
    );
    const stop = await runShim(
      cadence,
      root,
      JSON.stringify({ hook_event_name: 'SubagentStop', ...base }),
    );
    return { start, edit, stop };
  }

  it('318-01/AC-2: snake_case agent_id through the shim seeds a baseline, nudges, and flags redundant work (warn)', async () => {
    active = await tempRepo({ initialized: true });
    const root = active.root;
    await patchConfig(root, {
      notify: { transport: 'file', file: join(root, '.cadence/anomalies.log') },
    });
    await seedBuildState(root);

    const { start, edit, stop } = await driveSubagentLifecycle(root);

    expect(start.code).toBe(0);
    expect(edit.code).toBe(0);
    expect(stop.code).toBe(0);
    expect(start.stdout).toContain('Do not redo T1');

    const events = await readAnomalies(root);
    const redundant = events.filter((e) => e.type === 'redundant-task-work');
    expect(redundant).toHaveLength(1);
    expect(redundant[0]!.context).toMatchObject({ taskId: 'T1', status: 'DONE' });

    const after = JSON.parse(await readFile(join(root, '.cadence/state.json'), 'utf8'));
    expect(Object.keys(after.session.subagentBaselines)).not.toContain('agent-318');
  });

  it('318-01/AC-3: snake_case agent_id through the shim blocks the SubagentStop under redundantWorkEnforcement=block', async () => {
    active = await tempRepo({ initialized: true });
    const root = active.root;
    await patchConfig(root, {
      notify: { transport: 'file', file: join(root, '.cadence/anomalies.log') },
      redundantWorkEnforcement: 'block',
    });
    await seedBuildState(root);

    const { stop } = await driveSubagentLifecycle(root);

    const combined = stop.stdout + stop.stderr;
    expect(combined).toContain('redundantWorkEnforcement=block');
    expect(combined).toContain('belongs to T1, already DONE');
  });
});
