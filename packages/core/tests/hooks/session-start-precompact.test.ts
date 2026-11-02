// packages/core/tests/hooks/session-start-precompact.test.ts
//
// Phase 345 (T5, AC-7): the SessionStart banner ends with one pointer line
// when the newest pre-compaction record is newer than the freshest SESSION
// doc, and is byte-identical to its pre-phase-345 output otherwise.
//
// BEFORE_BANNER was captured from the built CLI (`cadence hook session-start`)
// before this task changed any code, in temp repos holding exactly the files
// `makeRepo` writes (both with and without the SESSION doc; both printed this).
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { defaultConfig, emptyState, type HookContext } from '@thomas-powers-jr/cadence-types';
import { handleSessionStart } from '../../src/hooks/handlers.js';
import { HookDispatcher } from '../../src/hooks/dispatcher.js';
import { planPrecompactRecord } from '../../src/handoff/precompact.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');
const BEFORE_BANNER =
  'CADENCE session resumed.\nProject: fixture\nLoop position: IDLE\nActive phase: (none — loop is IDLE)\nActive draft: (none)\n';
const SESSION = [
  '---',
  'cadence_handoff: 2',
  'generated_at: 2026-11-01T10:00:00.000Z',
  'label: fixture',
  'loop_position: IDLE',
  '---',
  '',
  '## Next action',
  '**Action:** keep going.',
  '',
].join('\n');

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
});

async function makeRepo(withSession: boolean): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cadence-345-banner-')));
  roots.push(root);
  await mkdir(join(root, '.cadence', 'handoff'), { recursive: true });
  await mkdir(join(root, '.cadence', 'phases'), { recursive: true });
  await writeFile(join(root, '.cadence', 'config.json'), JSON.stringify(defaultConfig, null, 2));
  await writeFile(join(root, '.cadence', 'state.json'), JSON.stringify(emptyState('fixture'), null, 2));
  if (withSession) await writeFile(join(root, '.cadence', 'handoff', 'SESSION-2026-11-01-fixture.md'), SESSION);
  return root;
}

async function writeRecord(root: string, iso: string, trigger = 'auto'): Promise<string> {
  const plan = planPrecompactRecord({ now: new Date(iso), trigger, payloadKeys: [], loop: null, git: null });
  await mkdir(join(root, '.cadence', 'local', 'precompact'), { recursive: true });
  await writeFile(join(root, '.cadence', 'local', 'precompact', plan.fileName), plan.content);
  return `.cadence/local/precompact/${plan.fileName}`;
}

function hook(cwd: string): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, 'hook', 'session-start'], { cwd });
    let stdout = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.on('exit', (code) => resolve({ stdout, code: code ?? 0 }));
    p.stdin.end('{}');
  });
}

const ctx: HookContext = { cwd: '/repo', event: 'session-start' };

describe('345-01 AC-7: SessionStart banner pointer', () => {
  it('345-01/AC-7: handleSessionStart appends exactly one pointer line when given a record; omitted/null keeps today\'s banner', async () => {
    const state = emptyState('demo');
    const base = (await handleSessionStart(ctx, state, null)).contextPayload ?? '';
    expect((await handleSessionStart(ctx, state)).contextPayload).toBe(base);
    expect((await handleSessionStart(ctx, state, null, null)).contextPayload).toBe(base);
    const r = await handleSessionStart(ctx, state, null, {
      path: '.cadence/local/precompact/PRECOMPACT-20261102T181923.456Z.md',
      trigger: 'auto',
      generatedAt: '2026-11-02T18:19:23.456Z',
    });
    expect(r.contextPayload).toBe(
      `${base}\nPre-compaction record: .cadence/local/precompact/PRECOMPACT-20261102T181923.456Z.md (trigger: auto, 2026-11-02T18:19:23.456Z) — newer than any SESSION handoff`,
    );
  });

  it('345-01/AC-7: the dispatcher passes a newer record (no SESSION doc) and the CLI banner ends with the pointer', async () => {
    const root = await makeRepo(false);
    const path = await writeRecord(root, '2026-11-02T18:19:23.456Z', 'manual');
    const line = `Pre-compaction record: ${path} (trigger: manual, 2026-11-02T18:19:23.456Z) — newer than any SESSION handoff`;
    const d = await new HookDispatcher(root).dispatch('session-start', { cwd: root, event: 'session-start' });
    expect(d.contextPayload).toBe(`${BEFORE_BANNER.slice(0, -1)}\n${line}`);
    const r = await hook(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`${BEFORE_BANNER}${line}\n`);
  });

  it('345-01/AC-7: a record newer than the SESSION doc adds the line; an older one leaves the banner byte-identical', async () => {
    const newer = await makeRepo(true);
    const path = await writeRecord(newer, '2026-11-01T10:00:00.001Z');
    expect((await hook(newer)).stdout).toBe(
      `${BEFORE_BANNER}Pre-compaction record: ${path} (trigger: auto, 2026-11-01T10:00:00.001Z) — newer than any SESSION handoff\n`,
    );

    const older = await makeRepo(true);
    await writeRecord(older, '2026-11-01T10:00:00.000Z');
    expect((await hook(older)).stdout).toBe(BEFORE_BANNER);
  });

  it('345-01/AC-7: with no record the banner is byte-identical to the pre-change fixture (with and without a SESSION doc)', async () => {
    expect((await hook(await makeRepo(false))).stdout).toBe(BEFORE_BANNER);
    expect((await hook(await makeRepo(true))).stdout).toBe(BEFORE_BANNER);
  });

  it('345-01/AC-7: a lookup failure contributes nothing and never fails the hook', async () => {
    const root = await makeRepo(false);
    await mkdir(join(root, '.cadence', 'local'), { recursive: true });
    await writeFile(join(root, '.cadence', 'local', 'precompact'), 'not a directory');
    const r = await hook(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(BEFORE_BANNER);

    const unreadableHandoff = await makeRepo(false);
    await writeRecord(unreadableHandoff, '2026-11-02T18:19:23.456Z');
    // A directory named like a SESSION doc makes locateFreshestHandoff's readFile throw.
    await mkdir(join(unreadableHandoff, '.cadence', 'handoff', 'SESSION-2026-11-01-broken.md'));
    const r2 = await hook(unreadableHandoff);
    expect(r2.code).toBe(0);
    expect(r2.stdout).toBe(BEFORE_BANNER);
  });
});
