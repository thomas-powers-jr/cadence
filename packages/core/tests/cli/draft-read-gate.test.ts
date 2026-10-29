import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';

// AC-3, AC-4, AC-5 (Phase 23.1) — DRAFT-read mtime gate.

const CADENCE_CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');

function run(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

async function patchConfig(root: string, patch: Record<string, unknown>): Promise<void> {
  const path = join(root, '.cadence/config.json');
  const cfg = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...cfg, ...patch }, null, 2));
}

async function seedDraft(
  root: string,
  profile: 'auto' | 'standard' | 'strict',
  tier: 'quick-fix' | 'standard' | 'complex',
): Promise<string> {
  // Phase 214 (T4): no real AC-1 coverage seeded anywhere in this file, and
  // it predates gates.evidenceFloor (defaultConfig's schema-level floor is
  // 'mention') — relax it to 'unverified' so this file's draft-read-mtime
  // assertions aren't newly refused by the unrelated evidence-floor gate.
  await patchConfig(root, { gates: { sealed: [], evidenceFloor: 'unverified' } });
  const phaseDir = join(root, '.cadence/phases/01-foundation');
  await mkdir(phaseDir, { recursive: true });
  const body = `---\nphase: 01-foundation\nid: 01-01\ntier: ${tier}\nprofile: ${profile}\nstatus: PENDING\n---\n\n# 01-01 — Demo\n\n## Objective\nDemo.\n\n## Acceptance Criteria\n\n### AC-1: ok\nGiven x\nWhen y\nThen z\n\n## Tasks\n\n### T1: do\n- files: \`src/x.ts\`\n- action: a\n- verify: v\n- done: AC-1\n\n## Boundaries\n\n- _(none)_\n`;
  const path = join(phaseDir, '01-01-DRAFT.md');
  await writeFile(path, body);
  return path;
}

async function touchFuture(path: string, msInFuture = 5000): Promise<void> {
  const future = new Date(Date.now() + msInFuture);
  await utimes(path, future, future);
}

// Phase 340: a real content edit after approve (appends a line to the
// Objective), so the DRAFT's content hash no longer matches the stamp.
async function editDraftContent(path: string): Promise<void> {
  const raw = await readFile(path, 'utf8');
  const edited = raw.replace('## Objective\nDemo.\n', '## Objective\nDemo.\nEdited after approve.\n');
  if (edited === raw) throw new Error('editDraftContent: Objective anchor not found');
  await writeFile(path, edited);
}

const AC2_PASS_NOTICE =
  'settle: DRAFT.md mtime is newer than draftReadAt but its content is unchanged since approve; draft-read passes.\n';

async function readState(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, '.cadence/state.json'), 'utf8')) as Record<string, unknown>;
}

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

describe('DRAFT-read mtime gate (Phase 23.1)', () => {
  it('refuses settle when DRAFT.md content is edited after approve and its mtime is newer than draftReadAt (AC-3, 340-01/AC-3)', async () => {
    active = await tempRepo({ initialized: true });
    // standard × standard cell has draft-read in gate set per DESIGN §4.2.
    const draftPath = await seedDraft(active.root, 'standard', 'standard');
    // standard × standard carries the 'approve' gate (Phase 24.1); bypass.
    await run(['draft', 'approve', '01-foundation', '01', '--no-approve'], active.root);
    // Edit the DRAFT after approve. Pair fix for phase 340's intended
    // behavior change (a touch-only mtime bump now passes when the content
    // hash matches), not a loosened test: the content really changes here,
    // and the mtime is pushed into the future so it is unambiguously newer.
    await editDraftContent(draftPath);
    await touchFuture(draftPath, 5000);
    const r = await run(
      ['settle', 'run', '--auto', '--allow-missing-coverage'],
      active.root,
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/DRAFT\.md was edited after approve/);
    expect(r.stderr).toMatch(/--allow-stale-draft/);
    // State still BUILD; the refusal persists a SUMMARY with the refusing
    // gate's provenance (phase 170), where previously nothing was written.
    const state = JSON.parse(await readFile(join(active.root, '.cadence/state.json'), 'utf8'));
    expect(state.loopPosition).toBe('BUILD');
    const summaryPath = join(active.root, '.cadence/phases/01-foundation/01-01-SUMMARY.json');
    expect(existsSync(summaryPath)).toBe(true);
    const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
    expect(summary.gates[summary.gates.length - 1]).toMatchObject({
      gate: 'draft-read',
      status: 'refused',
    });
  });

  it('--allow-stale-draft bypasses the gate and logs INFO trace (AC-4, 340-01/AC-3)', async () => {
    active = await tempRepo({ initialized: true });
    const draftPath = await seedDraft(active.root, 'standard', 'standard');
    // standard × standard carries the 'approve' gate (Phase 24.1); bypass.
    await run(['draft', 'approve', '01-foundation', '01', '--no-approve'], active.root);
    // Pair fix for phase 340's intended behavior change (a touch-only mtime
    // bump now passes when the content hash matches), not a loosened test:
    // edit the content so the gate genuinely trips and the bypass is needed.
    await editDraftContent(draftPath);
    await touchFuture(draftPath, 5000);
    await run(['done', 'T1', '--notes=ok'], active.root);
    const r = await run(
      ['settle', 'run', '--auto', '--allow-missing-coverage', '--allow-stale-draft'],
      active.root,
    );
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/proceeding past draft-read gate/);
    const state = JSON.parse(await readFile(join(active.root, '.cadence/state.json'), 'utf8'));
    expect(state.loopPosition).toBe('IDLE');
  });

  it('DRAFT not modified after approve → no refusal (AC-5)', async () => {
    active = await tempRepo({ initialized: true });
    await seedDraft(active.root, 'standard', 'standard');
    // standard × standard carries the 'approve' gate (Phase 24.1); bypass.
    await run(['draft', 'approve', '01-foundation', '01', '--no-approve'], active.root);
    await run(['done', 'T1', '--notes=ok'], active.root);
    const r = await run(
      ['settle', 'run', '--auto', '--allow-missing-coverage'],
      active.root,
    );
    expect(r.code).toBe(0);
    expect(r.stderr).not.toMatch(/DRAFT\.md was edited/);
  });

  it('draftReadAt=null (legacy or never-approved) → no refusal regardless of mtime (AC-5)', async () => {
    active = await tempRepo({ initialized: true });
    const draftPath = await seedDraft(active.root, 'standard', 'standard');
    // Manually bypass approve: write the state.json to put us in BUILD without touching draftReadAt.
    const statePath = join(active.root, '.cadence/state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.activePhase = '01-foundation';
    state.activeDraft = '01-01';
    state.loopPosition = 'BUILD';
    state.tier = 'standard';
    state.openDrafts = [{ id: '01-01', since: new Date().toISOString() }];
    // draftReadAt stays null (or absent — legacy state.json shape).
    delete state.draftReadAt;
    await writeFile(statePath, JSON.stringify(state, null, 2));
    await touchFuture(draftPath, 5000); // would normally trip the gate
    await run(['done', 'T1', '--notes=ok'], active.root);
    const r = await run(
      ['settle', 'run', '--auto', '--allow-missing-coverage'],
      active.root,
    );
    expect(r.code).toBe(0);
    expect(r.stderr).not.toMatch(/DRAFT\.md was edited/);
  });

  it('gate not in gate set (auto profile) → no refusal regardless of mtime (AC-5)', async () => {
    active = await tempRepo({ initialized: true });
    // auto × standard cell has only test-coverage + anomaly-notify; no draft-read.
    const draftPath = await seedDraft(active.root, 'auto', 'standard');
    // standard × standard carries the 'approve' gate (Phase 24.1); bypass.
    await run(['draft', 'approve', '01-foundation', '01', '--no-approve'], active.root);
    await touchFuture(draftPath, 5000);
    await run(['done', 'T1', '--notes=ok'], active.root);
    const r = await run(
      ['settle', 'run', '--auto', '--allow-missing-coverage'],
      active.root,
    );
    expect(r.code).toBe(0);
    expect(r.stderr).not.toMatch(/DRAFT\.md was edited/);
  });

  it('touch-only mtime bump with unchanged content passes draft-read loudly (340-01/AC-2)', async () => {
    active = await tempRepo({ initialized: true });
    const draftPath = await seedDraft(active.root, 'standard', 'standard');
    await run(['draft', 'approve', '01-foundation', '01', '--no-approve'], active.root);
    // Approve must have stamped a sha256 content hash for this case to mean anything.
    const stamped = await readState(active.root);
    expect(stamped.draftReadHash).toMatch(/^[0-9a-f]{64}$/);
    await touchFuture(draftPath, 5000);
    await run(['done', 'T1', '--notes=ok'], active.root);
    const r = await run(['settle', 'run', '--auto', '--allow-missing-coverage'], active.root);
    expect(r.stderr).toContain(AC2_PASS_NOTICE);
    expect(r.stderr.split(AC2_PASS_NOTICE)).toHaveLength(2); // exactly once
    expect(r.stderr).not.toMatch(/DRAFT\.md was edited after approve/);
    expect(r.code).toBe(0);
    expect((await readState(active.root)).loopPosition).toBe('IDLE');
  });

  it('BOM + CRLF rewrite of identical text with a newer mtime passes draft-read (340-01/AC-2)', async () => {
    active = await tempRepo({ initialized: true });
    const draftPath = await seedDraft(active.root, 'standard', 'standard');
    await run(['draft', 'approve', '01-foundation', '01', '--no-approve'], active.root);
    expect((await readState(active.root)).draftReadHash).toMatch(/^[0-9a-f]{64}$/);
    const raw = await readFile(draftPath, 'utf8');
    const rewritten = '\uFEFF' + raw.replace(/\r?\n/g, '\r\n');
    expect(rewritten).not.toBe(raw);
    await writeFile(draftPath, rewritten);
    await touchFuture(draftPath, 5000);
    await run(['done', 'T1', '--notes=ok'], active.root);
    const r = await run(['settle', 'run', '--auto', '--allow-missing-coverage'], active.root);
    expect(r.stderr).toContain(AC2_PASS_NOTICE);
    expect(r.stderr.split(AC2_PASS_NOTICE)).toHaveLength(2); // exactly once
    expect(r.stderr).not.toMatch(/DRAFT\.md was edited after approve/);
    expect(r.code).toBe(0);
    expect((await readState(active.root)).loopPosition).toBe('IDLE');
  });

  it('legacy state without draftReadHash falls back to mtime-only refusal (340-01/AC-4)', async () => {
    active = await tempRepo({ initialized: true });
    const draftPath = await seedDraft(active.root, 'standard', 'standard');
    await run(['draft', 'approve', '01-foundation', '01', '--no-approve'], active.root);
    const statePath = join(active.root, '.cadence/state.json');
    const state = await readState(active.root);
    expect(state.draftReadHash).toMatch(/^[0-9a-f]{64}$/);
    delete state.draftReadHash;
    await writeFile(statePath, JSON.stringify(state, null, 2));
    await touchFuture(draftPath, 5000);
    const r = await run(['settle', 'run', '--auto', '--allow-missing-coverage'], active.root);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/DRAFT\.md was edited after approve/);
    expect(r.stderr).not.toContain(AC2_PASS_NOTICE);
    expect((await readState(active.root)).loopPosition).toBe('BUILD');
  });
});
