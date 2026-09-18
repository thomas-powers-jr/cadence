import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
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
// Phase 314: cases (a)/(d) below need a second, independent temp repo (the
// payload's `cwd`, standing in for a worktree) alongside `active` (the
// shim's own spawn cwd, standing in for wherever the automatic hook process
// happened to launch from). `active` stays single-slot so the three
// pre-existing tests above are untouched; this array is purely additive
// cleanup infrastructure for the new cases.
let extra: Fixture[] = [];
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
  for (const f of extra) await f.cleanup();
  extra = [];
});

describe('codex shim → core integration (AC-3)', () => {
  it('AC-3: SessionStart through the shim prints CADENCE session context', async () => {
    active = await tempRepo({ initialized: true, projectName: 'integcodex' });
    const stdin = JSON.stringify({ hook_event_name: 'SessionStart' });
    const r = await runShim(['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`], active.root, stdin);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/CADENCE session/i);
    expect(r.stdout).toMatch(/integcodex/);
  });

  it('AC-3: PostToolUse apply_patch records touchedFiles when a task is active', async () => {
    active = await tempRepo({ initialized: true });
    const statePath = join(active.root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activeTask = { id: 'T1', status: 'IN_PROGRESS', touchedFiles: [] };
    await writeFile(statePath, JSON.stringify(state, null, 2));

    const patch = '*** Begin Patch\n*** Update File: /proj/src/foo.ts\n*** End Patch';
    const stdin = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { input: patch } });
    const r = await runShim(['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`], active.root, stdin);
    expect(r.code).toBe(0);
    const after = JSON.parse(await readFile(statePath, 'utf8'));
    expect(after.activeTask.touchedFiles).toEqual(['/proj/src/foo.ts']);
  });

  it('AC-2/AC-3: an unmapped event is a no-op (exit 0, no output)', async () => {
    active = await tempRepo({ initialized: true });
    const stdin = JSON.stringify({ hook_event_name: 'PreCompact' });
    const r = await runShim(['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`], active.root, stdin);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
  });
});

// Phase 314 (rec-20260918-003): the shim spawns `cadence hook <event>` without
// an explicit `cwd` option, so the child silently inherits whatever
// process.cwd() the shim itself was launched with — never the payload's own
// `cwd` field (present on every Codex hook payload per
// https://code.claude.com/docs/en/hooks's "Common input fields", and passed
// through untouched by routeHookEvent's spread in ./shim.ts). This produced a
// live bug in phase 313: a hook firing while genuinely inside a worktree
// recorded its effect into the primary checkout's `.cadence/state.json`
// instead of the worktree's own. These are regression tests for AC-2/AC-3;
// T4 (a separate task) adds the fix. `active` plays the shim's own spawn
// cwd — a stand-in for wherever the automatic hook process happened to
// launch from (e.g. the primary checkout) — and is deliberately left without
// an `activeTask`, so an accidental write landing there (today's actual
// behavior) is inert rather than corrupting a real in-progress task.
describe('codex shim cwd passthrough (phase 314)', () => {
  it('314-01/AC-2: a payload cwd naming an existing worktree directory receives the state write, not the shim\'s own cwd', async () => {
    active = await tempRepo({ initialized: true });
    const worktree = await tempRepo({ initialized: true, projectName: 'payloadcwd' });
    extra.push(worktree);
    const statePath = join(worktree.root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activeTask = { id: 'T1', status: 'IN_PROGRESS', touchedFiles: [] };
    await writeFile(statePath, JSON.stringify(state, null, 2));

    const patch = '*** Begin Patch\n*** Update File: /proj/src/payload-cwd.ts\n*** End Patch';
    const stdin = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: { input: patch },
      cwd: worktree.root,
    });
    const r = await runShim(['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`], active.root, stdin);
    expect(r.code).toBe(0);
    const after = JSON.parse(await readFile(statePath, 'utf8'));
    expect(after.activeTask.touchedFiles).toEqual(['/proj/src/payload-cwd.ts']);
  });

  it('314-01/AC-3: a payload with no cwd field falls back to the shim\'s own process.cwd() and exits 0', async () => {
    active = await tempRepo({ initialized: true });
    const statePath = join(active.root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activeTask = { id: 'T1', status: 'IN_PROGRESS', touchedFiles: [] };
    await writeFile(statePath, JSON.stringify(state, null, 2));

    const patch = '*** Begin Patch\n*** Update File: /proj/src/no-cwd.ts\n*** End Patch';
    const stdin = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: { input: patch },
    });
    const r = await runShim(['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`], active.root, stdin);
    expect(r.code).toBe(0);
    const after = JSON.parse(await readFile(statePath, 'utf8'));
    expect(after.activeTask.touchedFiles).toEqual(['/proj/src/no-cwd.ts']);
  });

  it('314-01/AC-3: a payload cwd naming a nonexistent directory falls back to the shim\'s own process.cwd() and exits 0', async () => {
    active = await tempRepo({ initialized: true });
    const statePath = join(active.root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activeTask = { id: 'T1', status: 'IN_PROGRESS', touchedFiles: [] };
    await writeFile(statePath, JSON.stringify(state, null, 2));

    const staleCwd = join(active.root, '..', 'cadence-test-stale-does-not-exist-314');
    const patch = '*** Begin Patch\n*** Update File: /proj/src/stale-cwd.ts\n*** End Patch';
    const stdin = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: { input: patch },
      cwd: staleCwd,
    });
    const r = await runShim(['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`], active.root, stdin);
    expect(r.code).toBe(0);
    const after = JSON.parse(await readFile(statePath, 'utf8'));
    expect(after.activeTask.touchedFiles).toEqual(['/proj/src/stale-cwd.ts']);
  });

  it('314-01/AC-3: a real cwd divergence prints a one-line stderr notice naming both the payload cwd and the shim\'s own cwd', async () => {
    active = await tempRepo({ initialized: true });
    const worktree = await tempRepo({ initialized: true, projectName: 'noticecwd' });
    extra.push(worktree);
    const statePath = join(worktree.root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activeTask = { id: 'T1', status: 'IN_PROGRESS', touchedFiles: [] };
    await writeFile(statePath, JSON.stringify(state, null, 2));

    const patch = '*** Begin Patch\n*** Update File: /proj/src/notice-cwd.ts\n*** End Patch';
    const stdin = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'apply_patch',
      tool_input: { input: patch },
      cwd: worktree.root,
    });
    const r = await runShim(['hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`], active.root, stdin);
    expect(r.stderr).toContain(worktree.root);
    expect(r.stderr).toContain(active.root);
  });
});
