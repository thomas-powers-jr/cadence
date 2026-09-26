import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { Command } from 'commander';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';

// Subagent task-redundancy monitoring (Task 6): the `cadence hook` CLI
// command promotes `agentId`/`agentType` from the parsed stdin JSON onto the
// `HookContext` passed to `HookDispatcher.dispatch`. Every other test in this
// file drives the real, built CLI binary as a subprocess and asserts on its
// externally observable effects (stdout/exit code/state.json) — but no
// handler yet consumes `ctx.agentId`/`ctx.agentType` (that lands in later
// tasks: 8/9), so there is no black-box side effect to assert on through that
// harness. Instead, this test mocks `HookDispatcher` (from `src/`, not
// `dist/`) to inspect the actual `ctx` object the CLI command constructs and
// passes to `dispatch` — the only way to directly verify the promotion this
// task adds.
const dispatchSpy = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));

vi.mock('../../src/hooks/dispatcher.js', () => ({
  // Vitest 4 tightened vi.fn() mock implementations to real JS `new`
  // semantics — an arrow function can never be a constructor, so
  // `new HookDispatcher(...)` in the source under test now throws unless
  // the implementation is a real `function`.
  HookDispatcher: vi.fn().mockImplementation(function () {
    return { dispatch: dispatchSpy };
  }),
}));

const __dirname = dirname(fileURLToPath(import.meta.url));
const CADENCE_CLI = join(__dirname, '../../dist/cli/index.js');

function run(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.stdin.end();
    p.on('exit', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

let active: Fixture | null = null;
afterEach(async () => { if (active) { await active.cleanup(); active = null; } });

describe('cadence hook', () => {
  it('session-start prints a context payload', async () => {
    active = await tempRepo({ initialized: true, projectName: 'demo' });
    const r = await run(['hook', 'session-start'], active.root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/CADENCE session resumed/);
    expect(r.stdout).toMatch(/demo/);
  });

  it('subagent-result increments counter', async () => {
    active = await tempRepo({ initialized: true });
    await run(['hook', 'subagent-result'], active.root);
    await run(['hook', 'subagent-result'], active.root);
    const state = JSON.parse(await readFile(join(active.root, '.cadence/state.json'), 'utf8'));
    expect(state.session.subagentSpawns).toBe(2);
  });

  it('unknown event exits 2', async () => {
    active = await tempRepo({ initialized: true });
    const r = await run(['hook', 'made-up-event'], active.root);
    expect(r.code).toBe(2);
  });

  // Phase 317 (dec-20260925-001): this test used to assert exit 2. Blocking is
  // now a per-event JSON decision on stdout with exit 0; the block message is
  // still mirrored to stderr as a diagnostic.
  it('317-01/AC-1: blocking hook emits the PreToolUse deny decision on stdout, exit 0, message still on stderr', async () => {
    active = await tempRepo({ initialized: true });
    // Enable preToolUseBuildGate; loopPosition is IDLE so pre-tool-edit must block.
    const cfgPath = join(active.root, '.cadence/config.json');
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
    cfg.hooks.preToolUseBuildGate = true;
    const { writeFile } = await import('node:fs/promises');
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2));
    const r = await run(['hook', 'pre-tool-edit'], active.root);
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(doc.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(doc.hookSpecificOutput.permissionDecisionReason).toMatch(/BUILD/);
    expect(r.stderr).toMatch(/BUILD/);
  });
});

describe('cadence hook — agentId/agentType promotion (subagent task-redundancy monitoring)', () => {
  afterEach(() => {
    dispatchSpy.mockClear();
  });

  it('promotes agentId/agentType from stdin JSON onto the ctx passed to dispatch (260-01/AC-3: exercises the constructor-mocked HookDispatcher)', async () => {
    const { registerHookCommand } = await import('../../src/cli/commands/hook.js');
    const program = new Command();
    registerHookCommand(program);

    const stdinPayload = JSON.stringify({ agentId: 'agent-123', agentType: 'general-purpose' });
    const fakeStdin = Readable.from([stdinPayload]) as unknown as NodeJS.ReadStream;
    Object.defineProperty(fakeStdin, 'isTTY', { value: false, configurable: true });
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    try {
      await program.parseAsync(['node', 'cadence', 'hook', 'pre-tool-edit']);
    } finally {
      Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
    }

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const [event, ctx] = dispatchSpy.mock.calls[0]!;
    expect(event).toBe('pre-tool-edit');
    expect(ctx.agentId).toBe('agent-123');
    expect(ctx.agentType).toBe('general-purpose');
  });

  it('omits agentId/agentType from ctx when absent from stdin JSON', async () => {
    const { registerHookCommand } = await import('../../src/cli/commands/hook.js');
    const program = new Command();
    registerHookCommand(program);

    const fakeStdin = Readable.from([JSON.stringify({ files: ['src/a.ts'] })]) as unknown as NodeJS.ReadStream;
    Object.defineProperty(fakeStdin, 'isTTY', { value: false, configurable: true });
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

    try {
      await program.parseAsync(['node', 'cadence', 'hook', 'pre-tool-edit']);
    } finally {
      Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
    }

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const [, ctx] = dispatchSpy.mock.calls[0]!;
    expect(ctx.agentId).toBeUndefined();
    expect(ctx.agentType).toBeUndefined();
  });
});

// Phase 317-01: every real ok:false site reached through the built CLI emits
// its per-event JSON decision on stdout and exits 0 (dec-20260925-001).
describe('cadence hook — JSON block transport per site (phase 317)', () => {
  function runWithStdin(
    args: string[],
    cwd: string,
    stdin: string,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const p = spawn(process.execPath, [CADENCE_CLI, ...args], { cwd });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => (stdout += d.toString()));
      p.stderr.on('data', (d) => (stderr += d.toString()));
      p.stdin.write(stdin);
      p.stdin.end();
      p.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
    });
  }

  const DRAFT_MD = `---\nphase: 01-foundation\nid: 01-01\ntier: standard\nstatus: APPROVED\n---\n\n# 01-01 — Demo\n\n## Objective\n\nDemo.\n\n## Acceptance Criteria\n\n### AC-1: Demo\nGiven setup\nWhen action\nThen outcome\n\n## Tasks\n\n### T1: done thing\n- files: \`src/a.ts\`\n- action: do\n- verify: vitest\n- done: AC-1\n\n### T2: pending thing\n- files: \`src/b.ts\`\n- action: do\n- verify: vitest\n- done: AC-1\n\n## Boundaries\n\n- _(none)_\n`;

  async function seedBuild(root: string, configPatch: Record<string, unknown>): Promise<void> {
    const { writeFile, mkdir } = await import('node:fs/promises');
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

  function expectDeny(stdout: string, reason: RegExp): void {
    expect(stdout.endsWith('\n')).toBe(true);
    const doc = JSON.parse(stdout);
    expect(Object.keys(doc)).toEqual(['hookSpecificOutput']);
    expect(doc.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(doc.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(doc.hookSpecificOutput.permissionDecisionReason).toMatch(reason);
  }

  it('317-01/AC-1: boundary block (handlers.ts:177) → PreToolUse deny on stdout, exit 0', async () => {
    active = await tempRepo({ initialized: true });
    await seedBuild(active.root, { boundaryEnforcement: 'block' });
    const r = await runWithStdin(['hook', 'pre-tool-edit'], active.root, JSON.stringify({ files: ['src/undeclared.ts'] }));
    expect(r.code).toBe(0);
    expectDeny(r.stdout, /boundaryEnforcement=block/);
  });

  it('317-01/AC-1: redundant-work block (handlers.ts:230) → PreToolUse deny with its em dash intact, exit 0', async () => {
    active = await tempRepo({ initialized: true });
    await seedBuild(active.root, { redundantWorkEnforcement: 'block' });
    const r = await runWithStdin(['hook', 'pre-tool-edit'], active.root, JSON.stringify({ files: ['src/a.ts'] }));
    expect(r.code).toBe(0);
    expectDeny(r.stdout, /redundantWorkEnforcement=block: src\/a\.ts belongs to T1, already DONE — /);
  });

  it('317-01/AC-1: build-gate block (handlers.ts:256) → PreToolUse deny on stdout, exit 0', async () => {
    active = await tempRepo({ initialized: true });
    const { writeFile } = await import('node:fs/promises');
    const cfgPath = join(active.root, '.cadence/config.json');
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
    cfg.hooks.preToolUseBuildGate = true;
    await writeFile(cfgPath, JSON.stringify(cfg, null, 2));
    const r = await runWithStdin(['hook', 'pre-tool-edit'], active.root, JSON.stringify({ files: ['src/x.ts'] }));
    expect(r.code).toBe(0);
    expectDeny(r.stdout, /preToolUseBuildGate is enabled and loopPosition=IDLE/);
  });

  it('317-01/AC-2: strict-loop Stop block (handlers.ts:297) → top-level decision:block on stdout, exit 0', async () => {
    active = await tempRepo({ initialized: true });
    await seedBuild(active.root, { loopEnforcement: 'strict' });
    const r = await runWithStdin(['hook', 'session-stop'], active.root, '{}');
    expect(r.code).toBe(0);
    const doc = JSON.parse(r.stdout);
    expect(Object.keys(doc)).toEqual(['decision', 'reason']);
    expect(doc.decision).toBe('block');
    expect(doc.reason).toMatch(/loopEnforcement=strict and 1 unclosed draft/);
  });

  it('317-01/AC-10: hook.ts carries the exact new transport comment', async () => {
    const src = await readFile(join(__dirname, '../../src/cli/commands/hook.ts'), 'utf8');
    expect(src).toContain(
      '// Blocking is delivered as a per-event JSON decision on stdout, exit 0 (not exit-code 2 -- checkpoint 0.4a proved that collapses to a non-blocking 1 on Windows/PowerShell).',
    );
    expect(src).not.toContain('// Exit 2 = blocking per Claude Code hook protocol; stderr surfaces to the model.');
  });
});
