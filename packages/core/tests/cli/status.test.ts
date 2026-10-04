import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';

const CADENCE_CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');

function run(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

describe('cadence status', () => {
  it('IDLE: renders header + NEXT line, exit 0', async () => {
    active = await tempRepo({ initialized: true, projectName: 'status-idle' });
    const r = await run(['status'], active.root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/CADENCE — status-idle/);
    expect(r.stdout).toMatch(/loop:\s+IDLE/);
    expect(r.stdout).toMatch(/NEXT: cadence draft new/);
  });

  it('BUILD with fresh approve: tasks PENDING, ACs pending', async () => {
    active = await tempRepo({ initialized: true });
    await run(['draft', 'new', '01-foundation', '01', '--title=Demo'], active.root);
    await run(['draft', 'approve', '01-foundation', '01'], active.root);
    const r = await run(['status'], active.root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/draft: 01-01/);
    expect(r.stdout).toMatch(/TASKS/);
    expect(r.stdout).toMatch(/T1\s+PENDING/);
    expect(r.stdout).toMatch(/\[\s\]\sAC-1/);
  });

  it('--json emits parseable structured output', async () => {
    active = await tempRepo({ initialized: true, projectName: 'status-json' });
    const r = await run(['status', '--json'], active.root);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    const parsed = JSON.parse(r.stdout);
    expect(parsed.project).toBe('status-json');
    expect(parsed.loopPosition).toBe('IDLE');
    expect(parsed.schemaVersion).toBe(1);
    expect(typeof parsed.next.command).toBe('string');
    expect(parsed.next.command).toMatch(/cadence draft new/);
  });

  it('--json includes tasks and acs arrays in BUILD', async () => {
    active = await tempRepo({ initialized: true });
    await run(['draft', 'new', '01-foundation', '01', '--title=Demo'], active.root);
    await run(['draft', 'approve', '01-foundation', '01'], active.root);
    const r = await run(['status', '--json'], active.root);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(Array.isArray(parsed.tasks)).toBe(true);
    expect(parsed.tasks.length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.acs)).toBe(true);
    expect(parsed.activeDraft).toBe('01-01');
  });

  // Phase 322 (T2, AC-2): an IDLE checkout whose checkout-local activePhase
  // is stale (311) while a later phase (312) is settled on disk.
  async function seedIdleWithStaleActivePhase(root: string): Promise<void> {
    const { readFile, writeFile, mkdir } = await import('node:fs/promises');
    const statePath = join(root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activePhase = '311-old';
    state.loopPosition = 'IDLE';
    await writeFile(statePath, JSON.stringify(state, null, 2));
    const phaseDir = join(root, '.cadence/phases/312-new');
    await mkdir(phaseDir, { recursive: true });
    await writeFile(
      join(phaseDir, '312-01-SUMMARY.json'),
      JSON.stringify({
        draftId: '312-01',
        stateAtSettle: { loopPositionBeforeSettle: 'BUILD', revision: 1, sessionSubagentSpawns: 0 },
      }),
    );
  }

  it('322-01/AC-2: IDLE text names the latest settled phase, not the stale checkout-local activePhase', async () => {
    active = await tempRepo({ initialized: true, projectName: 'status-idle-stale' });
    await seedIdleWithStaleActivePhase(active.root);
    const r = await run(['status'], active.root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/loop:\s+IDLE/);
    expect(r.stdout).toMatch(/^ {2}last settled: 312-new$/m);
    expect(r.stdout).not.toMatch(/^\s+phase:/m);
    expect(r.stdout).not.toContain('311-old');
  });

  it('322-01/AC-2: --json keeps activePhase exactly as before and adds lastSettledPhase', async () => {
    active = await tempRepo({ initialized: true, projectName: 'status-json-stale' });
    await seedIdleWithStaleActivePhase(active.root);
    const r = await run(['status', '--json'], active.root);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.loopPosition).toBe('IDLE');
    expect(parsed.activePhase).toBe('311-old');
    expect(parsed.lastSettledPhase).toBe('312-new');
  });

  it('322-01/AC-2: IDLE text falls back to "last phase in this checkout" when no SUMMARY carries stateAtSettle', async () => {
    active = await tempRepo({ initialized: true, projectName: 'status-idle-fallback' });
    const { readFile, writeFile } = await import('node:fs/promises');
    const statePath = join(active.root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activePhase = '311-old';
    state.loopPosition = 'IDLE';
    await writeFile(statePath, JSON.stringify(state, null, 2));
    const r = await run(['status'], active.root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^ {2}last phase in this checkout: 311-old$/m);
    expect(r.stdout).not.toMatch(/^\s+phase:/m);
    expect(r.stdout).not.toMatch(/last settled/);
    const json = JSON.parse((await run(['status', '--json'], active.root)).stdout);
    expect(json.activePhase).toBe('311-old');
    expect(json.lastSettledPhase).toBeNull();
  });

  it('322-01/AC-2: --json carries lastSettledPhase: null when nothing is settled', async () => {
    active = await tempRepo({ initialized: true, projectName: 'status-json-none' });
    const r = await run(['status', '--json'], active.root);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toHaveProperty('lastSettledPhase', null);
    expect(parsed.activePhase).toBeNull();
  });

  it('322-01/AC-2: non-IDLE (BUILD) keeps the phase line and activePhase; JSON only gains lastSettledPhase', async () => {
    active = await tempRepo({ initialized: true });
    await run(['draft', 'new', '01-foundation', '01', '--title=Demo'], active.root);
    await run(['draft', 'approve', '01-foundation', '01'], active.root);
    const text = await run(['status'], active.root);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/^ {2}phase: 01-foundation$/m);
    expect(text.stdout).not.toMatch(/last settled/);
    const json = await run(['status', '--json'], active.root);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.loopPosition).toBe('BUILD');
    expect(parsed.activePhase).toBe('01-foundation');
    expect(parsed).toHaveProperty('lastSettledPhase', null);
  });

  it('status is read-only (state.json byte-equal before and after)', async () => {
    active = await tempRepo({ initialized: true });
    await run(['draft', 'new', '01-foundation', '01', '--title=Demo'], active.root);
    await run(['draft', 'approve', '01-foundation', '01'], active.root);
    const { readFile } = await import('node:fs/promises');
    const before = await readFile(join(active.root, '.cadence/state.json'), 'utf8');
    await run(['status'], active.root);
    await run(['status', '--json'], active.root);
    const after = await readFile(join(active.root, '.cadence/state.json'), 'utf8');
    expect(after).toBe(before);
  });
});
