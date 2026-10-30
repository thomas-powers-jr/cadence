import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { emptyState } from '@thomas-powers-jr/cadence-types';
import { SimpleStateBackend } from '../../src/state/simple.js';
import { StateCorruptError, NotInitializedError, StateConflictError } from '../../src/errors.js';
import { renderStateMd } from '../../src/render/state-md.js';
import * as fsp from 'node:fs/promises';

let active: Fixture | null = null;
afterEach(async () => { if (active) { await active.cleanup(); active = null; } });

describe('SimpleStateBackend', () => {
  it('reads an initialized state', async () => {
    active = await tempRepo({ initialized: true, projectName: 'demo' });
    const backend = new SimpleStateBackend(active.root);
    const state = await backend.readState();
    expect(state.project.name).toBe('demo');
    expect(state.loopPosition).toBe('IDLE');
  });

  it('round-trips commit → readState', async () => {
    active = await tempRepo({ initialized: true });
    const backend = new SimpleStateBackend(active.root);
    const s = emptyState('zz');
    s.loopPosition = 'DRAFT';
    s.activeDraft = '01-01';
    await backend.commit(s);
    const after = await backend.readState();
    expect(after.loopPosition).toBe('DRAFT');
    expect(after.activeDraft).toBe('01-01');
  });

  // AC-1 — missing .cadence/ is "not initialized", not "corrupt"
  it('throws NotInitializedError when .cadence/ is absent', async () => {
    active = await tempRepo(); // bare repo, no .cadence/
    const backend = new SimpleStateBackend(active.root);
    await expect(backend.readState()).rejects.toBeInstanceOf(NotInitializedError);
    await expect(backend.readState()).rejects.toThrow(/cadence init/);
  });

  // AC-1 (rec-20260726-002) — a fresh worktree/clone has .cadence/ committed
  // but never state.json (gitignored since phase 196) — the message must
  // route to `cadence onboard`, which already bootstraps this safely,
  // instead of the generic "run cadence init" advice (init refuses here).
  it('throws NotInitializedError pointing at `cadence onboard` when .cadence/ exists but state.json does not', async () => {
    active = await tempRepo({ initialized: true });
    const { rm } = await import('node:fs/promises');
    await rm(join(active.root, '.cadence/state.json'));
    const backend = new SimpleStateBackend(active.root);
    await expect(backend.readState()).rejects.toBeInstanceOf(NotInitializedError);
    await expect(backend.readState()).rejects.toThrow(/cadence onboard/);
  });

  it('throws StateCorruptError on invalid JSON', async () => {
    active = await tempRepo({ initialized: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(active.root, '.cadence/state.json'), '{ not json');
    const backend = new SimpleStateBackend(active.root);
    await expect(backend.readState()).rejects.toBeInstanceOf(StateCorruptError);
  });
});

// Phase 341 (341-01, T3): `replaceState` — the explicit-revision write path
// `cadence state load` uses. Additive beside `commit()`: writes the given
// revision exactly, refuses with commit()'s StateConflictError when the
// on-disk file no longer matches `expected`.
describe('SimpleStateBackend.replaceState (phase 341)', () => {
  async function seed(revision: number): Promise<SimpleStateBackend> {
    active = await tempRepo({ initialized: true, projectName: 'demo' });
    const s = emptyState('demo');
    s.revision = revision;
    await fsp.writeFile(join(active.root, '.cadence/state.json'), JSON.stringify(s, null, 2));
    return new SimpleStateBackend(active.root);
  }

  function replacement(revision: number) {
    const s = emptyState('demo');
    s.revision = revision;
    s.loopPosition = 'BUILD';
    s.activePhase = '9-x';
    s.activeDraft = '9-01';
    return s;
  }

  it('341-01/AC-4: writes state.revision exactly as given (no bump) and re-renders STATE.md', async () => {
    const backend = await seed(5);
    const next = replacement(42);
    await backend.replaceState(next, { revision: 5 });
    const onDisk = JSON.parse(await fsp.readFile(join(active!.root, '.cadence/state.json'), 'utf8')) as { revision: number; loopPosition: string };
    expect(onDisk.revision).toBe(42);
    expect(onDisk.loopPosition).toBe('BUILD');
    expect(next.revision).toBe(42);
    expect(await fsp.readFile(join(active!.root, '.cadence/STATE.md'), 'utf8')).toBe(renderStateMd(next));
  });

  it('341-01/AC-4: refuses { revision } with StateConflictError when the on-disk revision moved', async () => {
    const backend = await seed(6);
    const err = await backend.replaceState(replacement(9), { revision: 5 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StateConflictError);
    expect((err as Error).message).toBe(
      'state.json changed since you read it (you had revision 5, current is 6) — re-run this command to pick up the latest state.',
    );
    expect(JSON.parse(await fsp.readFile(join(active!.root, '.cadence/state.json'), 'utf8')).revision).toBe(6);
  });

  it('341-01/AC-4: refuses { revision } when the on-disk file is gone or no longer parses', async () => {
    const backend = await seed(3);
    await fsp.writeFile(join(active!.root, '.cadence/state.json'), '{ broken');
    await expect(backend.replaceState(replacement(9), { revision: 3 })).rejects.toBeInstanceOf(StateConflictError);
    await fsp.rm(join(active!.root, '.cadence/state.json'));
    await expect(backend.replaceState(replacement(9), { revision: 3 })).rejects.toBeInstanceOf(StateConflictError);
  });

  it("341-01/AC-4: 'absent' writes when no state.json exists and refuses when one appeared", async () => {
    const backend = await seed(2);
    await expect(backend.replaceState(replacement(9), 'absent')).rejects.toBeInstanceOf(StateConflictError);
    await fsp.rm(join(active!.root, '.cadence/state.json'));
    await backend.replaceState(replacement(9), 'absent');
    expect(JSON.parse(await fsp.readFile(join(active!.root, '.cadence/state.json'), 'utf8')).revision).toBe(9);
  });

  it("341-01/AC-4: 'corrupt' writes over a still-unparseable file and refuses when it parses or is gone", async () => {
    const backend = await seed(4);
    const statePath = join(active!.root, '.cadence/state.json');
    // Parses fine → the file is no longer the corrupt one the caller read.
    await expect(backend.replaceState(replacement(9), 'corrupt')).rejects.toBeInstanceOf(StateConflictError);
    await fsp.rm(statePath);
    await expect(backend.replaceState(replacement(9), 'corrupt')).rejects.toBeInstanceOf(StateConflictError);
    await fsp.writeFile(statePath, '{ still broken');
    await backend.replaceState(replacement(11), 'corrupt');
    expect(JSON.parse(await fsp.readFile(statePath, 'utf8')).revision).toBe(11);
  });
});
