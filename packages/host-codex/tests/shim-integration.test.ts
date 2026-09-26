import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { routeHookEvent } from '../src/shim.js';
import { codexCapabilities } from '../src/capabilities.js';

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

// Phase 317-01 (AC-9): core now delivers blocks as a per-event JSON decision
// on stdout with exit 0. The Codex shim spawns core with
// stdio ['pipe','inherit','inherit'] and copies its exit code, so whatever
// core writes must reach Codex byte-for-byte. Each case runs the real built
// shim, then runs the built core CLI directly with the exact stdin the shim
// would send — produced by the shim's own src translation (`routeHookEvent`
// plus the `hostCapabilities` embed from cli.ts), not a hand-copied
// approximation — and compares the two stdout Buffers. state.json is
// restored between the two runs so both see identical inputs.
describe('codex shim relays core JSON decisions byte-identically (phase 317)', () => {
  interface BufResult {
    stdout: Buffer;
    stderr: string;
    code: number;
  }

  function runBuf(argv: string[], cwd: string, stdin: string): Promise<BufResult> {
    return new Promise((resolve) => {
      const p = spawn(process.execPath, argv, { cwd });
      const out: Buffer[] = [];
      let stderr = '';
      p.stdout.on('data', (d: Buffer) => out.push(d));
      p.stderr.on('data', (d) => (stderr += d.toString()));
      p.stdin.write(stdin);
      p.stdin.end();
      p.on('close', (code) => resolve({ stdout: Buffer.concat(out), stderr, code: code ?? 0 }));
    });
  }

  /** Reproduce exactly what cli.ts's `hook` action pipes into core. */
  function shimTranslation(raw: string): { abstractEvent: string | null; stdin: string } {
    const { abstractEvent, translatedStdin } = routeHookEvent(raw);
    const parsed = JSON.parse(translatedStdin) as Record<string, unknown>;
    return { abstractEvent, stdin: JSON.stringify({ ...parsed, hostCapabilities: codexCapabilities }) };
  }

  /** Run the shim, restore state.json, run core directly; assert byte identity and return the shim result. */
  async function shimVsCore(root: string, raw: string, expectedEvent: string): Promise<BufResult> {
    const { abstractEvent, stdin } = shimTranslation(raw);
    expect(abstractEvent).toBe(expectedEvent);
    const statePath = join(root, '.cadence/state.json');
    const stateBefore = await readFile(statePath);
    const shim = await runBuf([SHIM, 'hook', '--cadence', `${process.execPath} ${CADENCE_CLI}`], root, raw);
    await writeFile(statePath, stateBefore);
    const core = await runBuf([CADENCE_CLI, 'hook', expectedEvent], root, stdin);
    expect(core.code).toBe(0);
    expect(shim.code).toBe(0);
    expect(core.stdout.length).toBeGreaterThan(0);
    expect(shim.stdout.toString('utf8')).toBe(core.stdout.toString('utf8'));
    expect(shim.stdout.equals(core.stdout)).toBe(true);
    return shim;
  }

  const DRAFT_MD = `---\nphase: 01-foundation\nid: 01-01\ntier: standard\nstatus: APPROVED\n---\n\n# 01-01 — Demo\n\n## Objective\n\nDemo.\n\n## Acceptance Criteria\n\n### AC-1: Demo\nGiven setup\nWhen action\nThen outcome\n\n## Tasks\n\n### T1: done thing\n- files: \`src/a.ts\`\n- action: do\n- verify: vitest\n- done: AC-1\n\n### T2: pending thing\n- files: \`src/b.ts\`\n- action: do\n- verify: vitest\n- done: AC-1\n\n## Boundaries\n\n- _(none)_\n`;

  async function seedBuild(root: string, configPatch: Record<string, unknown>): Promise<void> {
    const cfgPath = join(root, '.cadence/config.json');
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
    await writeFile(cfgPath, JSON.stringify({ ...cfg, ...configPatch }, null, 2));
    const phaseDir = join(root, '.cadence/phases/01-foundation');
    await mkdir(phaseDir, { recursive: true });
    await writeFile(join(phaseDir, '01-01-DRAFT.md'), DRAFT_MD);
    const now = new Date().toISOString();
    await writeFile(
      join(phaseDir, '01-01-PROGRESS.json'),
      JSON.stringify({
        draftId: '01-01',
        tasks: {
          T1: { status: 'DONE', notes: '', touchedFiles: ['src/a.ts'], updatedAt: now },
          T2: { status: 'PENDING', notes: '', touchedFiles: [], updatedAt: now },
        },
      }),
    );
    const statePath = join(root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activePhase = '01-foundation';
    state.activeDraft = '01-01';
    state.loopPosition = 'BUILD';
    state.tier = 'standard';
    state.openDrafts = [{ id: '01-01', since: now }];
    await writeFile(statePath, JSON.stringify(state, null, 2));
  }

  it('317-01/AC-9: PreToolUse apply_patch build-gate block relays core\'s deny document byte-identically, exit 0', async () => {
    active = await tempRepo({ initialized: true });
    const cfgPath = join(active.root, '.cadence/config.json');
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
    cfg.hooks.preToolUseBuildGate = true;
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2));

    const patch = '*** Begin Patch\n*** Update File: src/x.ts\n*** End Patch';
    const raw = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { input: patch } });
    const shim = await shimVsCore(active.root, raw, 'pre-tool-edit');

    const text = shim.stdout.toString('utf8');
    expect(text.endsWith('\n')).toBe(true);
    const doc = JSON.parse(text);
    expect(Object.keys(doc)).toEqual(['hookSpecificOutput']);
    expect(doc.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(doc.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(doc.hookSpecificOutput.permissionDecisionReason).toMatch(/preToolUseBuildGate is enabled and loopPosition=IDLE/);
  });

  it('317-01/AC-9: Stop strict-loop block relays core\'s top-level decision:block document byte-identically, exit 0', async () => {
    active = await tempRepo({ initialized: true });
    await seedBuild(active.root, { loopEnforcement: 'strict' });

    const raw = JSON.stringify({ hook_event_name: 'Stop' });
    const shim = await shimVsCore(active.root, raw, 'session-stop');

    const doc = JSON.parse(shim.stdout.toString('utf8'));
    expect(Object.keys(doc)).toEqual(['decision', 'reason']);
    expect(doc.decision).toBe('block');
    expect(doc.reason).toMatch(/loopEnforcement=strict and 1 unclosed draft/);
  });

  it('317-01/AC-9: non-block SessionStart relays core\'s context payload byte-identically, exit 0', async () => {
    active = await tempRepo({ initialized: true, projectName: 'relay317' });

    const raw = JSON.stringify({ hook_event_name: 'SessionStart' });
    const shim = await shimVsCore(active.root, raw, 'session-start');

    const text = shim.stdout.toString('utf8');
    expect(text).toMatch(/CADENCE session/);
    expect(text).toMatch(/relay317/);
  });
});
