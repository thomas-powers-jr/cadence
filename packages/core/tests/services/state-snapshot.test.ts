// packages/core/tests/services/state-snapshot.test.ts
//
// Phase 341 (341-01, T3): `cadence state save | load | list` services against
// real temp repos. Every refusal must leave state.json, STATE.md and
// .cadence/local/ byte-unchanged; a successful load restores the snapshot with
// the AC-4 resets and keeps a byte-exact backup.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyState, type CadenceState } from '@thomas-powers-jr/cadence-types';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import {
  stateListService,
  stateLoadService,
  stateSaveService,
} from '../../src/services/state-snapshot.js';
import { bufferIO } from '../../src/services/io.js';
import { renderStateMd } from '../../src/render/state-md.js';
import { SimpleStateBackend } from '../../src/state/simple.js';

const fixtures: Fixture[] = [];
afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.cleanup();
});

async function repo(projectName = 'demo'): Promise<string> {
  const f = await tempRepo({ initialized: true, projectName });
  fixtures.push(f);
  return f.root;
}

const NOW = new Date('2026-10-29T23:15:02.123Z');
const NAME = 'state-2026-10-29T231502Z-pc-a.json';
const HASH = 'a'.repeat(64);

function cad(root: string, ...p: string[]): string {
  return join(root, '.cadence', ...p);
}

async function writeState(root: string, s: CadenceState): Promise<void> {
  await writeFile(cad(root, 'state.json'), `${JSON.stringify(s, null, 2)}\n`);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

/** A mid-BUILD state with every AC-4 kept/reset field populated. */
function busyState(projectName = 'demo'): CadenceState {
  const s = emptyState(projectName);
  s.revision = 7;
  s.loopPosition = 'BUILD';
  s.tier = 'standard';
  s.activePhase = '341-state-save-load';
  s.activeDraft = '341-01';
  s.openDrafts = [{ id: '341-01', since: '2026-10-29T20:00:00.000Z' }];
  s.decisions = [{ id: 'dec-1', phase: '341', title: 'snapshots', decidedAt: '2026-10-29T20:00:00.000Z' }];
  s.deferred = [{ id: 'def-1', from: '341-01', title: 'later', createdAt: '2026-10-29T20:00:00.000Z' }];
  s.session = {
    tokenUtilization: 0.5,
    lastHandoff: 'SESSION-2026-10-29-a.md',
    subagentSpawns: 3,
    subagentBaselines: {
      agent1: { startedAt: '2026-10-29T20:00:00.000Z', taskStatuses: { T1: 'DONE' }, touchedFiles: ['a.ts'] },
    },
  };
  s.skillAudit = { required: ['tdd'], invoked: ['tdd'] };
  s.activeTask = { id: 'T3', status: 'IN_PROGRESS', touchedFiles: ['x.ts'] };
  s.draftReadAt = '2026-10-29T21:00:00.000Z';
  s.draftReadHash = HASH;
  return s;
}

function snapshotDoc(state: unknown, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshotVersion: 1,
    savedAt: '2026-10-29T23:15:02.123Z',
    host: 'pc-a',
    cadenceVersion: '1.72.0',
    state,
    ...over,
  };
}

async function putSnapshot(root: string, name: string, doc: unknown): Promise<string> {
  await mkdir(cad(root, 'snapshots'), { recursive: true });
  const path = cad(root, 'snapshots', name);
  await writeFile(path, typeof doc === 'string' ? doc : `${JSON.stringify(doc, null, 2)}\n`);
  return path;
}

/** Bytes of state.json, STATE.md and every file under .cadence/local/. */
async function guarded(root: string): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const f of ['state.json', 'STATE.md']) {
    const p = cad(root, f);
    out[f] = existsSync(p) ? (await readFile(p)).toString('base64') : null;
  }
  const local = cad(root, 'local');
  out['local/'] = existsSync(local) ? 'dir' : null;
  if (existsSync(local)) {
    for (const n of (await readdir(local)).sort()) {
      out[`local/${n}`] = (await readFile(join(local, n))).toString('base64');
    }
  }
  return out;
}

const save = (root: string, extra: { json?: boolean; hostname?: string; now?: Date } = {}) =>
  stateSaveService(root, { now: NOW, hostname: 'pc.a', runningVersion: '1.72.0', ...extra }, bufferIO());

// ---------------------------------------------------------------------------
// AC-1 — save
// ---------------------------------------------------------------------------
describe('stateSaveService (AC-1)', () => {
  it('341-01/AC-1: writes .cadence/snapshots/state-<stamp>-<host>.json with the snapshot envelope', async () => {
    const root = await repo();
    const s = busyState();
    await writeState(root, s);
    const io = bufferIO();
    const res = await stateSaveService(root, { now: NOW, hostname: 'pc.a', runningVersion: '1.72.0' }, io);
    expect(res.exitCode).toBe(0);
    const doc = await readJson<Record<string, unknown>>(cad(root, 'snapshots', NAME));
    expect(doc).toEqual({
      snapshotVersion: 1,
      savedAt: '2026-10-29T23:15:02.123Z',
      host: 'pc-a',
      cadenceVersion: '1.72.0',
      state: s,
    });
    expect(io.stdout()).toContain(`.cadence/snapshots/${NAME}`);
    expect(io.stdout()).toContain('BUILD');
    expect(io.stdout()).toContain('341-state-save-load');
    expect(io.stdout()).toContain('341-01');
    // No BOM, ever.
    expect((await readFile(cad(root, 'snapshots', NAME)))[0]).toBe(0x7b);
  });

  it('341-01/AC-1: defaults the running cadence version to the core package version', async () => {
    const root = await repo();
    const res = await stateSaveService(root, { now: NOW, hostname: 'pc-a' }, bufferIO());
    expect(res.exitCode).toBe(0);
    const pkg = await readJson<{ version: string }>(fileURLToPath(new URL('../../package.json', import.meta.url)));
    const doc = await readJson<{ cadenceVersion: string }>(cad(root, 'snapshots', NAME));
    expect(doc.cadenceVersion).toBe(pkg.version);
  });

  it('341-01/AC-1: falls back to unknown-host when the hostname sanitizes to nothing', async () => {
    const root = await repo();
    const res = await stateSaveService(root, { now: NOW, hostname: '', runningVersion: '1.72.0' }, bufferIO());
    expect(res.exitCode).toBe(0);
    expect(existsSync(cad(root, 'snapshots', 'state-2026-10-29T231502Z-unknown-host.json'))).toBe(true);
  });

  it('341-01/AC-1: --json prints exactly { path, position, pruned, warnings }', async () => {
    const root = await repo();
    await writeState(root, busyState());
    const io = bufferIO();
    const res = await stateSaveService(root, { now: NOW, hostname: 'pc-a', runningVersion: '1.72.0', json: true }, io);
    expect(res.exitCode).toBe(0);
    const out = JSON.parse(io.stdout()) as Record<string, unknown>;
    expect(out).toEqual({
      path: `.cadence/snapshots/${NAME}`,
      position: { loop: 'BUILD', phase: '341-state-save-load', draft: '341-01' },
      pruned: [],
      warnings: [],
    });
    expect(res.data).toEqual(out);
  });

  it('341-01/AC-1: refuses an existing name with exit 1 and overwrites nothing', async () => {
    const root = await repo();
    await putSnapshot(root, NAME, 'ORIGINAL');
    const io = bufferIO();
    const res = await stateSaveService(root, { now: NOW, hostname: 'pc-a', runningVersion: '1.72.0', json: true }, io);
    expect(res.exitCode).toBe(1);
    expect(io.stdout()).toBe('');
    expect(io.stderr()).toContain('already exists');
    expect(await readFile(cad(root, 'snapshots', NAME), 'utf8')).toBe('ORIGINAL');
    expect(existsSync(cad(root, 'local'))).toBe(false);
  });

  it('341-01/AC-1: prunes to the newest 3, naming each pruned file, never touching non-matching files', async () => {
    const root = await repo();
    const older = [
      'state-2026-10-01T000000Z-x.json',
      'state-2026-10-02T000000Z-x.json',
      'state-2026-10-03T000000Z-x.json',
      'state-2026-10-04T000000Z-x.json',
    ];
    for (const n of older) await putSnapshot(root, n, '{}');
    await putSnapshot(root, 'README.md', 'keep me');
    await putSnapshot(root, 'notes.json', 'keep me');
    const io = bufferIO();
    const res = await stateSaveService(root, { now: NOW, hostname: 'pc-a', runningVersion: '1.72.0', json: true }, io);
    expect(res.exitCode).toBe(0);
    const left = (await readdir(cad(root, 'snapshots'))).sort();
    expect(left).toEqual(
      ['README.md', 'notes.json', 'state-2026-10-03T000000Z-x.json', 'state-2026-10-04T000000Z-x.json', NAME].sort(),
    );
    const out = JSON.parse(io.stdout()) as { pruned: string[] };
    expect(out.pruned.sort()).toEqual(['state-2026-10-01T000000Z-x.json', 'state-2026-10-02T000000Z-x.json']);
    expect(io.stderr()).toContain('state-2026-10-01T000000Z-x.json');
    expect(io.stderr()).toContain('state-2026-10-02T000000Z-x.json');
  });

  it('341-01/AC-1: keeps the just-written snapshot even when a slow clock sorts it oldest', async () => {
    const root = await repo();
    for (const n of ['state-2027-01-01T000000Z-x.json', 'state-2027-01-02T000000Z-x.json', 'state-2027-01-03T000000Z-x.json']) {
      await putSnapshot(root, n, '{}');
    }
    const res = await save(root, { hostname: 'pc-a' });
    expect(res.exitCode).toBe(0);
    const left = (await readdir(cad(root, 'snapshots'))).sort();
    expect(left).toEqual(['state-2027-01-02T000000Z-x.json', 'state-2027-01-03T000000Z-x.json', NAME].sort());
  });

  it('341-01/AC-1: records the local revision in .cadence/local/state-sync.json', async () => {
    const root = await repo();
    await writeState(root, busyState());
    expect((await save(root)).exitCode).toBe(0);
    expect(await readJson(cad(root, 'local', 'state-sync.json'))).toEqual({ revision: 7 });
  });

  it('341-01/AC-1: warns on stderr when no handoff is linked', async () => {
    const root = await repo();
    const io = bufferIO();
    const res = await stateSaveService(root, { now: NOW, hostname: 'pc-a', runningVersion: '1.72.0', json: true }, io);
    expect(res.exitCode).toBe(0);
    expect(io.stderr()).toMatch(/no handoff is linked/);
    const out = JSON.parse(io.stdout()) as { warnings: string[] };
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/no handoff is linked/);
    // A handoff stamped after this save bumps the revision past the marker, so
    // the advice is to save again once it exists.
    expect(out.warnings[0]).toMatch(/then run `cadence state save` again/);
  });

  it('341-01/AC-1: refuses with exit 1 and writes nothing when state.json is missing', async () => {
    const root = await repo();
    await rm(cad(root, 'state.json'));
    const io = bufferIO();
    const res = await stateSaveService(root, { now: NOW, hostname: 'pc-a', runningVersion: '1.72.0', json: true }, io);
    expect(res.exitCode).toBe(1);
    expect(io.stdout()).toBe('');
    expect(io.stderr()).toMatch(/state save refused/);
    expect(existsSync(cad(root, 'snapshots'))).toBe(false);
    expect(existsSync(cad(root, 'local'))).toBe(false);
  });

  it('341-01/AC-1: refuses with exit 1 and writes nothing when state.json does not parse', async () => {
    const root = await repo();
    await writeFile(cad(root, 'state.json'), '{ nope');
    const io = bufferIO();
    const res = await stateSaveService(root, { now: NOW, hostname: 'pc-a', runningVersion: '1.72.0' }, io);
    expect(res.exitCode).toBe(1);
    expect(io.stdout()).toBe('');
    expect(io.stderr()).toMatch(/state save refused/);
    expect(io.stderr()).toMatch(/cadence doctor --fix/);
    expect(existsSync(cad(root, 'snapshots'))).toBe(false);
    expect(existsSync(cad(root, 'local'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-2 — list
// ---------------------------------------------------------------------------
describe('stateListService (AC-2)', () => {
  it('341-01/AC-2: lists snapshots newest first with name, savedAt, host and position', async () => {
    const root = await repo();
    const idle = emptyState('demo');
    await putSnapshot(root, 'state-2026-10-01T000000Z-old.json', snapshotDoc(idle, { savedAt: '2026-10-01T00:00:00.000Z', host: 'old' }));
    await putSnapshot(root, 'state-2026-10-03T000000Z-new.json', snapshotDoc(busyState(), { savedAt: '2026-10-03T00:00:00.000Z', host: 'new' }));
    await putSnapshot(root, 'state-2026-10-02T000000Z-mid.json', snapshotDoc(idle, { savedAt: '2026-10-02T00:00:00.000Z', host: 'mid' }));
    await putSnapshot(root, 'other.json', 'ignored');
    const io = bufferIO();
    const res = await stateListService(root, {}, io);
    expect(res.exitCode).toBe(0);
    const lines = io.stdout().trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('state-2026-10-03T000000Z-new.json');
    expect(lines[0]).toContain('2026-10-03T00:00:00.000Z');
    expect(lines[0]).toContain('new');
    expect(lines[0]).toContain('BUILD');
    expect(lines[1]).toContain('state-2026-10-02T000000Z-mid.json');
    expect(lines[2]).toContain('state-2026-10-01T000000Z-old.json');
    expect(io.stdout()).not.toContain('other.json');
  });

  it('341-01/AC-2: --json prints one array; unreadable entries carry error, still exit 0 with a stderr warning', async () => {
    const root = await repo();
    await putSnapshot(root, 'state-2026-10-01T000000Z-ok.json', snapshotDoc(busyState(), { savedAt: '2026-10-01T00:00:00.000Z', host: 'ok' }));
    await putSnapshot(root, 'state-2026-10-02T000000Z-bad.json', '{ not json');
    const io = bufferIO();
    const res = await stateListService(root, { json: true }, io);
    expect(res.exitCode).toBe(0);
    const arr = JSON.parse(io.stdout()) as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(2);
    expect(arr[0]?.name).toBe('state-2026-10-02T000000Z-bad.json');
    expect(typeof arr[0]?.error).toBe('string');
    expect(arr[0]).not.toHaveProperty('savedAt');
    expect(arr[0]).not.toHaveProperty('host');
    expect(arr[0]).not.toHaveProperty('position');
    expect(arr[1]).toEqual({
      name: 'state-2026-10-01T000000Z-ok.json',
      savedAt: '2026-10-01T00:00:00.000Z',
      host: 'ok',
      position: { loop: 'BUILD', phase: '341-state-save-load', draft: '341-01' },
    });
    expect(io.stderr()).toContain('state-2026-10-02T000000Z-bad.json');
    expect(io.stderr()).toMatch(/unreadable/);
  });

  it('341-01/AC-2: an unreadable entry is marked in the human listing too', async () => {
    const root = await repo();
    await putSnapshot(root, 'state-2026-10-02T000000Z-bad.json', JSON.stringify({ snapshotVersion: 2 }));
    const io = bufferIO();
    const res = await stateListService(root, {}, io);
    expect(res.exitCode).toBe(0);
    expect(io.stdout()).toMatch(/state-2026-10-02T000000Z-bad\.json.*unreadable/i);
  });

  it('341-01/AC-2: an absent snapshots directory prints "no snapshots" and exits 0', async () => {
    const root = await repo();
    const io = bufferIO();
    const res = await stateListService(root, {}, io);
    expect(res.exitCode).toBe(0);
    expect(io.stdout()).toMatch(/no snapshots/i);
  });

  it('341-01/AC-2: an empty directory prints "no snapshots"; --json prints []', async () => {
    const root = await repo();
    await mkdir(cad(root, 'snapshots'), { recursive: true });
    await putSnapshot(root, 'README.md', 'x');
    const human = bufferIO();
    expect((await stateListService(root, {}, human)).exitCode).toBe(0);
    expect(human.stdout()).toMatch(/no snapshots/i);
    const json = bufferIO();
    expect((await stateListService(root, { json: true }, json)).exitCode).toBe(0);
    expect(JSON.parse(json.stdout())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — load refusals leave every guarded file byte-unchanged
// ---------------------------------------------------------------------------
describe('stateLoadService refusals (AC-3)', () => {
  async function expectRefused(
    root: string,
    args: Parameters<typeof stateLoadService>[1],
    pattern: RegExp,
  ): Promise<string> {
    const before = await guarded(root);
    const io = bufferIO();
    const res = await stateLoadService(root, { runningVersion: '1.72.0', json: true, ...args }, io);
    expect(res.exitCode).toBe(1);
    expect(io.stdout()).toBe('');
    expect(io.stderr()).toMatch(pattern);
    expect(await guarded(root)).toEqual(before);
    return io.stderr();
  }

  it('341-01/AC-3: refuses when no snapshot exists', async () => {
    const root = await repo();
    await expectRefused(root, {}, /no snapshots in \.cadence\/snapshots\/.*cadence state save/s);
  });

  it('341-01/AC-3: refuses when the named snapshot (bare name or path) is not found', async () => {
    const root = await repo();
    await expectRefused(root, { snapshot: 'state-nope.json' }, /not found.*cadence state list/s);
    await expectRefused(root, { snapshot: join(root, 'elsewhere', 'x.json') }, /not found/);
  });

  it('341-01/AC-3: refuses a file that is not valid JSON', async () => {
    const root = await repo();
    await putSnapshot(root, NAME, '{ broken');
    await expectRefused(root, {}, /is not valid JSON.*cadence state/s);
  });

  it('341-01/AC-3: refuses a snapshotVersion other than 1', async () => {
    const root = await repo();
    await putSnapshot(root, NAME, snapshotDoc(emptyState('demo'), { snapshotVersion: 2 }));
    await expectRefused(root, { force: true }, /snapshotVersion 2.*only snapshotVersion 1/s);
  });

  it('341-01/AC-3: refuses a state that fails CadenceStateZ', async () => {
    const root = await repo();
    const bad = { ...emptyState('demo'), loopPosition: 'FLYING' };
    await putSnapshot(root, NAME, snapshotDoc(bad));
    await expectRefused(root, { force: true }, /fails the CadenceState schema.*loopPosition/s);
  });

  it("341-01/AC-3: refuses activePhase '../../tmp' even with --force, before probing any path, touching nothing", async () => {
    const root = await repo();
    const s = busyState();
    s.activePhase = '../../tmp';
    await putSnapshot(root, NAME, snapshotDoc(s));
    expect(existsSync(cad(root, 'local'))).toBe(false);
    const probed: string[] = [];
    const probe = async (p: string): Promise<boolean> => {
      probed.push(p);
      return true;
    };
    const err = await expectRefused(
      root,
      { force: true, isDirectory: probe },
      /state\.activePhase "\.\.\/\.\.\/tmp" is not a safe phase slug/,
    );
    expect(err).toMatch(/--force cannot override/);
    expect(probed).toEqual([]);
    expect(existsSync(cad(root, 'local'))).toBe(false);
  });

  it('341-01/AC-3: the phase-directory probe runs only once the snapshot passed the path check', async () => {
    const root = await repo();
    await putSnapshot(root, NAME, snapshotDoc(busyState()));
    const probed: string[] = [];
    const probe = async (p: string): Promise<boolean> => {
      probed.push(p);
      return false;
    };
    await expectRefused(root, { force: true, isDirectory: probe }, /Pull the latest commits/);
    expect(probed).toEqual([cad(root, 'phases', '341-state-save-load')]);
  });

  it("341-01/AC-3: refuses activeDraft '../x' even with --force, touching nothing", async () => {
    const root = await repo();
    const s = busyState();
    s.activeDraft = '../x';
    await putSnapshot(root, NAME, snapshotDoc(s));
    await mkdir(cad(root, 'phases', s.activePhase ?? ''), { recursive: true });
    const probed: string[] = [];
    const probe = async (p: string): Promise<boolean> => {
      probed.push(p);
      return true;
    };
    await expectRefused(
      root,
      { force: true, isDirectory: probe },
      /state\.activeDraft "\.\.\/x" is not a plain identifier/,
    );
    expect(probed).toEqual([]);
    expect(existsSync(cad(root, 'local'))).toBe(false);
  });

  it('341-01/AC-3: refuses an unsafe lastHandoff and an unsafe activeTask.id', async () => {
    const root = await repo();
    const s = emptyState('demo');
    s.session.lastHandoff = '../SESSION-x.md';
    await putSnapshot(root, NAME, snapshotDoc(s));
    await expectRefused(root, { force: true }, /lastHandoff/);
    const t = emptyState('demo');
    t.activeTask = { id: 'a/b', status: 'PENDING', touchedFiles: [] };
    await putSnapshot(root, NAME, snapshotDoc(t));
    await expectRefused(root, { force: true }, /activeTask\.id/);
  });

  it('341-01/AC-3: refuses unknown top-level state keys computed from the raw state, naming key and version', async () => {
    const root = await repo();
    const raw = { ...emptyState('demo'), futureField: 1 };
    await putSnapshot(root, NAME, snapshotDoc(raw, { cadenceVersion: '9.0.0' }));
    await expectRefused(root, {}, /futureField.*cadence 9\.0\.0.*--force/s);
  });

  it('341-01/AC-3: refuses a snapshot from a different project', async () => {
    const root = await repo('demo');
    await putSnapshot(root, NAME, snapshotDoc(emptyState('other')));
    await expectRefused(root, { force: true }, /project "other".*project "demo"/s);
  });

  it('341-01/AC-3: refuses when the active phase directory is missing on this branch', async () => {
    const root = await repo();
    await putSnapshot(root, NAME, snapshotDoc(busyState()));
    await expectRefused(root, { force: true }, /341-state-save-load.*Pull the latest commits or switch/s);
  });

  it('341-01/AC-3: refuses local work since the last sync (both revisions named, suggests save)', async () => {
    const root = await repo();
    const local = emptyState('demo');
    local.revision = 12;
    await writeState(root, local);
    await mkdir(cad(root, 'local'), { recursive: true });
    await writeFile(cad(root, 'local', 'state-sync.json'), '{ "revision": 10 }\n');
    await putSnapshot(root, NAME, snapshotDoc(emptyState('demo')));
    await expectRefused(root, {}, /revision 12.*revision 10.*cadence state save/s);
  });

  it('341-01/AC-3: a default-snapshot local-work refusal names that snapshot so the retry after save loads it, not the new save', async () => {
    const root = await repo();
    const local = emptyState('demo');
    local.revision = 12;
    await writeState(root, local);
    await mkdir(cad(root, 'local'), { recursive: true });
    await writeFile(cad(root, 'local', 'state-sync.json'), '{ "revision": 10 }\n');
    await putSnapshot(root, NAME, snapshotDoc(emptyState('demo')));
    await expectRefused(root, {}, new RegExp(`load it by name: \`cadence state load ${NAME.replace(/\./g, '\\.')}\``));
  });

  it('341-01/AC-3: a named-snapshot local-work refusal adds no retry hint', async () => {
    const root = await repo();
    const local = emptyState('demo');
    local.revision = 12;
    await writeState(root, local);
    await mkdir(cad(root, 'local'), { recursive: true });
    await writeFile(cad(root, 'local', 'state-sync.json'), '{ "revision": 10 }\n');
    await putSnapshot(root, NAME, snapshotDoc(emptyState('demo')));
    const stderr = await expectRefused(root, { snapshot: NAME }, /cadence state save/);
    expect(stderr).not.toMatch(/load it by name/);
  });

  it('341-01/AC-3: --force skips only the local-work check and says so loudly', async () => {
    const root = await repo();
    const local = emptyState('demo');
    local.revision = 12;
    await writeState(root, local);
    await mkdir(cad(root, 'local'), { recursive: true });
    await writeFile(cad(root, 'local', 'state-sync.json'), '{ "revision": 10 }\n');
    await putSnapshot(root, NAME, snapshotDoc(emptyState('demo')));
    const io = bufferIO();
    const res = await stateLoadService(root, { runningVersion: '1.72.0', force: true }, io);
    expect(res.exitCode).toBe(0);
    expect(io.stderr()).toMatch(/--force: skipping the local-work check/);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — successful load
// ---------------------------------------------------------------------------
describe('stateLoadService success (AC-4)', () => {
  it('341-01/AC-4: full A→B round trip: resets, kept fields, revision, .bak bytes, sync marker, STATE.md', async () => {
    const a = await repo('demo');
    const b = await repo('demo');
    const s = busyState();
    await writeState(a, s);
    const saved = bufferIO();
    expect((await stateSaveService(a, { now: NOW, hostname: 'pc-a', runningVersion: '1.72.0' }, saved)).exitCode).toBe(0);

    // Carry the committed snapshot to B (as git would), on a branch with the phase.
    await mkdir(cad(b, 'snapshots'), { recursive: true });
    await writeFile(cad(b, 'snapshots', NAME), await readFile(cad(a, 'snapshots', NAME)));
    await mkdir(cad(b, 'phases', '341-state-save-load'), { recursive: true });
    const bLocal = emptyState('demo');
    bLocal.revision = 2;
    await writeState(b, bLocal);
    const bBytes = await readFile(cad(b, 'state.json'));

    const io = bufferIO();
    const res = await stateLoadService(b, { runningVersion: '1.72.0', json: true }, io);
    expect(res.exitCode).toBe(0);

    const restored = await readJson<CadenceState>(cad(b, 'state.json'));
    // Resets.
    expect(restored.session.tokenUtilization).toBe(0);
    expect(restored.session.subagentSpawns).toBe(0);
    expect(restored.session.subagentBaselines).toEqual({});
    // Revision: max(local 2, snapshot 7) + 1.
    expect(restored.revision).toBe(8);
    // Everything else round-trips.
    const expected: CadenceState = structuredClone(s);
    expected.session.tokenUtilization = 0;
    expected.session.subagentSpawns = 0;
    expected.session.subagentBaselines = {};
    expected.revision = 8;
    expect(restored).toEqual(expected);
    expect(restored.skillAudit).toEqual(s.skillAudit);
    expect(restored.activeTask).toEqual(s.activeTask);
    expect(restored.decisions).toEqual(s.decisions);
    expect(restored.deferred).toEqual(s.deferred);
    expect(restored.session.lastHandoff).toBe('SESSION-2026-10-29-a.md');
    expect(restored.draftReadAt).toBe(s.draftReadAt);
    expect(restored.draftReadHash).toBe(HASH);

    // Backup holds B's exact previous bytes; sync marker the new revision.
    expect((await readFile(cad(b, 'local', 'state.json.bak'))).equals(bBytes)).toBe(true);
    expect(await readJson(cad(b, 'local', 'state-sync.json'))).toEqual({ revision: 8 });
    // STATE.md re-rendered in the same operation.
    expect(await readFile(cad(b, 'STATE.md'), 'utf8')).toBe(renderStateMd(restored));

    const out = JSON.parse(io.stdout()) as Record<string, unknown>;
    expect(out).toEqual({
      from: `.cadence/snapshots/${NAME}`,
      before: { loop: 'IDLE', phase: null, draft: null },
      after: { loop: 'BUILD', phase: '341-state-save-load', draft: '341-01' },
      backup: '.cadence/local/state.json.bak',
      warnings: [],
    });
  });

  it('341-01/AC-4: the human output names the file, before, after and backup', async () => {
    const root = await repo();
    await putSnapshot(root, NAME, snapshotDoc(emptyState('demo')));
    const io = bufferIO();
    const res = await stateLoadService(root, { runningVersion: '1.72.0', snapshot: NAME }, io);
    expect(res.exitCode).toBe(0);
    expect(io.stdout()).toContain(`.cadence/snapshots/${NAME}`);
    expect(io.stdout()).toMatch(/before:.*IDLE/);
    expect(io.stdout()).toMatch(/after:.*IDLE/);
    expect(io.stdout()).toContain('.cadence/local/state.json.bak');
  });

  it('341-01/AC-4: loads by explicit path, and with no local state.json reports "no state.json" and no backup', async () => {
    const root = await repo();
    await rm(cad(root, 'state.json'));
    const elsewhere = join(root, 'carry');
    await mkdir(elsewhere, { recursive: true });
    const snap = emptyState('demo');
    snap.revision = 4;
    await writeFile(join(elsewhere, 'snap.json'), JSON.stringify(snapshotDoc(snap)));
    const io = bufferIO();
    const res = await stateLoadService(root, { runningVersion: '1.72.0', snapshot: join(elsewhere, 'snap.json') }, io);
    expect(res.exitCode).toBe(0);
    expect(io.stdout()).toMatch(/before:.*no state\.json/);
    expect(existsSync(cad(root, 'local', 'state.json.bak'))).toBe(false);
    expect((await readJson<CadenceState>(cad(root, 'state.json'))).revision).toBe(5);
    expect(await readJson(cad(root, 'local', 'state-sync.json'))).toEqual({ revision: 5 });

    const json = bufferIO();
    // Second load: the marker matches, so no local-work refusal.
    expect((await stateLoadService(root, { runningVersion: '1.72.0', snapshot: join(elsewhere, 'snap.json'), json: true }, json)).exitCode).toBe(0);
    expect((JSON.parse(json.stdout()) as { backup: string | null }).backup).toBe('.cadence/local/state.json.bak');
  });

  it('341-01/AC-4: loads the newest snapshot by default', async () => {
    const root = await repo();
    const older = emptyState('demo');
    older.decisions = [{ id: 'old', phase: '1', title: 'o', decidedAt: '2026-01-01T00:00:00.000Z' }];
    const newer = emptyState('demo');
    newer.decisions = [{ id: 'new', phase: '1', title: 'n', decidedAt: '2026-01-01T00:00:00.000Z' }];
    await putSnapshot(root, 'state-2026-10-01T000000Z-x.json', snapshotDoc(older));
    await putSnapshot(root, 'state-2026-10-02T000000Z-x.json', snapshotDoc(newer));
    expect((await stateLoadService(root, { runningVersion: '1.72.0' }, bufferIO())).exitCode).toBe(0);
    expect((await readJson<CadenceState>(cad(root, 'state.json'))).decisions[0]?.id).toBe('new');
  });

  it('341-01/AC-4: a corrupt local state.json is backed up byte-exact, checks skipped, loud warning, snapshot restored', async () => {
    const root = await repo('demo');
    const corrupt = Buffer.from('{ "project": { "name": "someone-else" }, <<<<<<< HEAD\n');
    await writeFile(cad(root, 'state.json'), corrupt);
    // A stale marker the local-work check would trip on if it ran.
    await mkdir(cad(root, 'local'), { recursive: true });
    await writeFile(cad(root, 'local', 'state-sync.json'), '{ "revision": 0 }\n');
    const snap = emptyState('demo');
    snap.revision = 3;
    await putSnapshot(root, NAME, snapshotDoc(snap));
    const io = bufferIO();
    const res = await stateLoadService(root, { runningVersion: '1.72.0', json: true }, io);
    expect(res.exitCode).toBe(0);
    expect(io.stderr()).toMatch(/does not parse; skipping the project and local-work checks/);
    expect((await readFile(cad(root, 'local', 'state.json.bak'))).equals(corrupt)).toBe(true);
    expect((await readJson<CadenceState>(cad(root, 'state.json'))).revision).toBe(4);
    const out = JSON.parse(io.stdout()) as { before: unknown; backup: string; warnings: string[] };
    expect(out.before).toBeNull();
    expect(out.backup).toBe('.cadence/local/state.json.bak');
    expect(out.warnings.some((w) => w.includes('does not parse'))).toBe(true);
  });

  it('341-01/AC-4: warns on a mid-loop snapshot without draftReadHash and on a newer cadence', async () => {
    const root = await repo();
    const s = busyState();
    s.draftReadHash = null;
    await mkdir(cad(root, 'phases', '341-state-save-load'), { recursive: true });
    await putSnapshot(root, NAME, snapshotDoc(s, { cadenceVersion: '2.0.0' }));
    const io = bufferIO();
    const res = await stateLoadService(root, { runningVersion: '1.72.0', json: true }, io);
    expect(res.exitCode).toBe(0);
    expect(io.stderr()).toMatch(/fall back to the mtime-only check/);
    expect(io.stderr()).toMatch(/newer than the running cadence 1\.72\.0/);
    expect((JSON.parse(io.stdout()) as { warnings: string[] }).warnings).toHaveLength(2);
  });

  it('341-01/AC-4: a write conflict between plan and write exits 1 with the conflict message and empty --json stdout', async () => {
    const root = await repo();
    await putSnapshot(root, NAME, snapshotDoc(emptyState('demo')));
    const real = new SimpleStateBackend(root);
    // Another writer commits between load's plan and its write.
    const racing = Object.assign(Object.create(real) as SimpleStateBackend, {
      replaceState: async (state: CadenceState, expected: Parameters<SimpleStateBackend['replaceState']>[1]) => {
        const other = emptyState('demo');
        other.revision = 99;
        await writeState(root, other);
        return real.replaceState(state, expected);
      },
    });
    const io = bufferIO();
    const res = await stateLoadService(root, { runningVersion: '1.72.0', json: true, backend: racing }, io);
    expect(res.exitCode).toBe(1);
    expect(io.stdout()).toBe('');
    expect(io.stderr()).toContain('state.json changed since you read it (you had revision 0, current is 99)');
    expect((await readJson<CadenceState>(cad(root, 'state.json'))).revision).toBe(99);
  });
});
