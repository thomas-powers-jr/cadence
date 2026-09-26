import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';

// Phase 317-01, T1 (AC-5): golden stdout bytes for the only two hook sites
// that return `ok: true` + `contextPayload` — `handleSessionStart` and
// `handleSubagentStart` (packages/core/src/hooks/handlers.ts). The fixtures
// were captured from the built CLI on UNMODIFIED `hook.ts` transport code,
// before any transport change, and must never be regenerated to make a later
// transport change pass: byte-identical stdout is the contract.

const __dirname = dirname(fileURLToPath(import.meta.url));
const CADENCE_CLI = join(__dirname, '../../dist/cli/index.js');
const FIXTURES = join(__dirname, '../fixtures/hook-stdout-golden');

interface RunResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

function run(args: string[], cwd: string, stdin?: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], { cwd });
    const chunks: Buffer[] = [];
    let stderr = '';
    p.stdout.on('data', (d: Buffer) => chunks.push(d));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    if (stdin !== undefined) p.stdin.write(stdin);
    p.stdin.end();
    p.on('close', (code) => resolve({ stdout: Buffer.concat(chunks), stderr, code: code ?? 0 }));
  });
}

const DRAFT_MD = `---\nphase: 01-foundation\nid: 01-01\ntier: standard\nstatus: APPROVED\n---\n\n# 01-01 — Demo\n\n## Objective\n\nDemo.\n\n## Acceptance Criteria\n\n### AC-1: Demo\nGiven setup\nWhen action\nThen outcome\n\n## Tasks\n\n### T1: done thing\n- files: \`src/a.ts\`\n- action: do\n- verify: vitest\n- done: AC-1\n\n### T2: pending thing\n- files: \`src/b.ts\`\n- action: do\n- verify: vitest\n- done: AC-1\n\n## Boundaries\n\n- _(none)_\n`;

/** Fixed BUILD-position state: phase 01-foundation, draft 01-01, one open draft. */
async function seedState(root: string): Promise<void> {
  const statePath = join(root, '.cadence/state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.activePhase = '01-foundation';
  state.activeDraft = '01-01';
  state.loopPosition = 'BUILD';
  state.tier = 'standard';
  state.openDrafts = [{ id: '01-01', since: '2026-09-26T00:00:00.000Z' }];
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

/** Draft with T1 (src/a.ts) DONE and T2 (src/b.ts) PENDING via PROGRESS.json. */
async function seedDraftAndProgress(root: string): Promise<void> {
  const phaseDir = join(root, '.cadence/phases/01-foundation');
  await mkdir(phaseDir, { recursive: true });
  await writeFile(join(phaseDir, '01-01-DRAFT.md'), DRAFT_MD);
  const progress = {
    draftId: '01-01',
    tasks: {
      T1: { status: 'DONE', notes: '', touchedFiles: ['src/a.ts'], updatedAt: '2026-09-26T00:00:00.000Z' },
      T2: { status: 'PENDING', notes: '', touchedFiles: [], updatedAt: '2026-09-26T00:00:00.000Z' },
    },
  };
  await writeFile(join(phaseDir, '01-01-PROGRESS.json'), JSON.stringify(progress, null, 2));
}

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

describe('cadence hook stdout golden bytes (ok:true + contextPayload sites)', () => {
  it('317-01/AC-5: session-start stdout is byte-identical to the committed golden fixture', async () => {
    active = await tempRepo({ initialized: true, projectName: 'golden' });
    await seedState(active.root);
    const r = await run(['hook', 'session-start'], active.root);
    const expected = await readFile(join(FIXTURES, 'session-start.txt'));
    expect(r.code).toBe(0);
    expect(r.stdout.toString('utf8')).toBe(expected.toString('utf8'));
    expect(r.stdout.equals(expected)).toBe(true);
  });

  it('317-01/AC-5: subagent-start stdout is byte-identical to the committed golden fixture', async () => {
    active = await tempRepo({ initialized: true, projectName: 'golden' });
    await seedState(active.root);
    await seedDraftAndProgress(active.root);
    const r = await run(
      ['hook', 'subagent-start'],
      active.root,
      JSON.stringify({ agentId: 'agent-317', agentType: 'general-purpose' }),
    );
    const expected = await readFile(join(FIXTURES, 'subagent-start.txt'));
    expect(r.code).toBe(0);
    expect(r.stdout.toString('utf8')).toBe(expected.toString('utf8'));
    expect(r.stdout.equals(expected)).toBe(true);
  });
});
