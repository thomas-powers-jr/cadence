import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import type { AbstractEvent, HookContext } from '@thomas-powers-jr/cadence-types';
import { HookDispatcher } from '../../src/hooks/dispatcher.js';
import { SimpleStateBackend } from '../../src/state/simple.js';
import { renderStateMd } from '../../src/render/state-md.js';

// Phase 349 (T1, AC-1): every event that reaches `dispatchWithState` stamps
// `session.lastHookEventAt` after its handler has returned, through a
// revision-exempt backend write that re-reads state.json from disk.

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

const T0 = new Date('2026-11-22T12:00:00.000Z');
const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs);

async function readDisk(root: string) {
  return new SimpleStateBackend(root).readState();
}

async function patchState(root: string, patch: (s: Record<string, unknown>) => void): Promise<void> {
  const path = join(root, '.cadence/state.json');
  const s = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  patch(s);
  await writeFile(path, JSON.stringify(s, null, 2));
}

async function patchConfig(root: string, patch: (c: Record<string, unknown>) => void): Promise<void> {
  const path = join(root, '.cadence/config.json');
  const c = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  patch(c);
  await writeFile(path, JSON.stringify(c, null, 2));
}

async function dispatchAt(
  root: string,
  now: Date,
  event: AbstractEvent,
  extra: Partial<HookContext> = {},
) {
  const d = new HookDispatcher(root, () => now);
  return d.dispatch(event, { cwd: root, event, ...extra });
}

describe('HookDispatcher stamps session.lastHookEventAt (phase 349)', () => {
  const plainEvents: AbstractEvent[] = [
    'session-start',
    'user-prompt',
    'pre-tool-edit',
    'session-stop',
    'subagent-start',
    'subagent-result',
  ];
  for (const event of plainEvents) {
    it(`349-01/AC-1: ${event} stamps the current time as ISO-8601`, async () => {
      active = await tempRepo({ initialized: true });
      expect((await readDisk(active.root)).session.lastHookEventAt).toBeUndefined();
      const r = await dispatchAt(active.root, T0, event);
      expect(r.ok).toBe(true);
      expect((await readDisk(active.root)).session.lastHookEventAt).toBe(T0.toISOString());
    });
  }

  it('349-01/AC-1: user-prompt stamp leaves revision unchanged and keeps STATE.md in sync', async () => {
    active = await tempRepo({ initialized: true });
    const before = await readDisk(active.root);
    await dispatchAt(active.root, T0, 'user-prompt');
    const after = await readDisk(active.root);
    expect(after.session.lastHookEventAt).toBe(T0.toISOString());
    expect(after.revision).toBe(before.revision);
    const md = await readFile(join(active.root, '.cadence/STATE.md'), 'utf8');
    expect(md).toBe(renderStateMd(after));
  });

  it('349-01/AC-1: post-tool-edit with an activeTask and files stamps after the handler commits', async () => {
    active = await tempRepo({ initialized: true });
    await patchState(active.root, (s) => {
      s.loopPosition = 'BUILD';
      s.activeTask = { id: 'T1', status: 'IN_PROGRESS', touchedFiles: [] };
    });
    const before = await readDisk(active.root);
    await dispatchAt(active.root, T0, 'post-tool-edit', { raw: { files: ['src/a.ts'] } });
    const after = await readDisk(active.root);
    // The handler's own commit landed (one revision bump)...
    expect(after.activeTask?.touchedFiles).toEqual(['src/a.ts']);
    expect(after.revision).toBe(before.revision + 1);
    // ...and the stamp landed on top of it, without a further bump (AC-1).
    expect(after.session.lastHookEventAt).toBe(T0.toISOString());
  });

  it('349-01/AC-1: a new skill-invoke stamps after the handler commits', async () => {
    active = await tempRepo({ initialized: true });
    const before = await readDisk(active.root);
    await dispatchAt(active.root, T0, 'skill-invoke', { raw: { skill: 'phase-build' } });
    const after = await readDisk(active.root);
    expect(after.skillAudit.invoked).toEqual(['phase-build']);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.session.lastHookEventAt).toBe(T0.toISOString());
  });

  it('349-01/AC-1: the stamp advances across a later committing event and is not erased by it', async () => {
    active = await tempRepo({ initialized: true });
    await dispatchAt(active.root, T0, 'user-prompt');
    expect((await readDisk(active.root)).session.lastHookEventAt).toBe(T0.toISOString());
    // 2 minutes later a skill-invoke commits; the stamp advances, never vanishes.
    await dispatchAt(active.root, at(120_000), 'skill-invoke', { raw: { skill: 'tdd' } });
    const after = await readDisk(active.root);
    expect(after.skillAudit.invoked).toEqual(['tdd']);
    expect(after.session.lastHookEventAt).toBe(at(120_000).toISOString());
  });

  it('349-01/AC-1: the stamp is written whatever the telemetry settings are', async () => {
    active = await tempRepo({ initialized: true });
    await patchConfig(active.root, (c) => {
      c.telemetry = { tokenUtilization: false, skillInvocations: false, remoteOptIn: false };
    });
    await dispatchAt(active.root, T0, 'user-prompt');
    let s = await readDisk(active.root);
    expect(s.session.tokenUtilization).toBe(0);
    expect(s.session.lastHookEventAt).toBe(T0.toISOString());
    await dispatchAt(active.root, at(61_000), 'skill-invoke', { raw: { skill: 'tdd' } });
    s = await readDisk(active.root);
    expect(s.skillAudit.invoked).toEqual([]);
    expect(s.session.lastHookEventAt).toBe(at(61_000).toISOString());
  });

  it('349-01/AC-1: a live stamp under 60 s old is not rewritten (throttle)', async () => {
    active = await tempRepo({ initialized: true });
    await dispatchAt(active.root, T0, 'user-prompt');
    await dispatchAt(active.root, at(59_999), 'user-prompt');
    expect((await readDisk(active.root)).session.lastHookEventAt).toBe(T0.toISOString());
    await dispatchAt(active.root, at(60_000), 'user-prompt');
    expect((await readDisk(active.root)).session.lastHookEventAt).toBe(at(60_000).toISOString());
  });

  it('349-01/AC-1: a stamp later than now is overwritten', async () => {
    active = await tempRepo({ initialized: true });
    await patchState(active.root, (s) => {
      (s.session as Record<string, unknown>).lastHookEventAt = at(10_000).toISOString();
    });
    await dispatchAt(active.root, T0, 'user-prompt');
    expect((await readDisk(active.root)).session.lastHookEventAt).toBe(T0.toISOString());
  });

  it('349-01/AC-1: an unparseable on-disk stamp is overwritten', async () => {
    active = await tempRepo({ initialized: true });
    await patchState(active.root, (s) => {
      (s.session as Record<string, unknown>).lastHookEventAt = 'garbage';
    });
    await dispatchAt(active.root, T0, 'user-prompt');
    expect((await readDisk(active.root)).session.lastHookEventAt).toBe(T0.toISOString());
  });

  it('349-01/AC-1: a stamp write failure never fails the hook', async () => {
    active = await tempRepo({ initialized: true });
    const backend = new SimpleStateBackend(active.root);
    const original = SimpleStateBackend.prototype.stampHookEvent;
    SimpleStateBackend.prototype.stampHookEvent = async () => {
      throw new Error('disk on fire');
    };
    try {
      const r = await dispatchAt(active.root, T0, 'skill-invoke', { raw: { skill: 'tdd' } });
      expect(r.ok).toBe(true);
      expect((await backend.readState()).skillAudit.invoked).toEqual(['tdd']);
    } finally {
      SimpleStateBackend.prototype.stampHookEvent = original;
    }
  });

  it('349-01/AC-1: pre-compact does not stamp', async () => {
    active = await tempRepo({ initialized: true });
    await dispatchAt(active.root, T0, 'pre-compact');
    expect((await readDisk(active.root)).session.lastHookEventAt).toBeUndefined();
  });
});

describe('SimpleStateBackend.stampHookEvent (phase 349)', () => {
  it('349-01/AC-1: writes the stamp, leaves revision untouched and re-reads from disk', async () => {
    active = await tempRepo({ initialized: true });
    const backend = new SimpleStateBackend(active.root);
    const seeded = await backend.readState();
    await backend.commit(seeded);
    const rev = (await backend.readState()).revision;
    await backend.stampHookEvent(T0.toISOString());
    const after = await backend.readState();
    expect(after.session.lastHookEventAt).toBe(T0.toISOString());
    expect(after.revision).toBe(rev);
    // A caller still holding the earlier in-memory copy can commit on top.
    await expect(backend.commit(seeded)).resolves.toBeUndefined();
  });

  it('349-01/AC-1: throttles under 60 s and writes at or past 60 s and for a future stamp', async () => {
    active = await tempRepo({ initialized: true });
    const backend = new SimpleStateBackend(active.root);
    await backend.stampHookEvent(T0.toISOString());
    await backend.stampHookEvent(at(30_000).toISOString());
    expect((await backend.readState()).session.lastHookEventAt).toBe(T0.toISOString());
    await backend.stampHookEvent(at(60_000).toISOString());
    expect((await backend.readState()).session.lastHookEventAt).toBe(at(60_000).toISOString());
    await backend.stampHookEvent(T0.toISOString()); // earlier than the stored stamp
    expect((await backend.readState()).session.lastHookEventAt).toBe(T0.toISOString());
  });

  it('349-01/AC-1: is a silent no-op when state.json does not exist yet', async () => {
    active = await tempRepo({ initialized: false });
    const backend = new SimpleStateBackend(active.root);
    await expect(backend.stampHookEvent(T0.toISOString())).resolves.toBeUndefined();
    expect(existsSync(join(active.root, '.cadence', 'state.json'))).toBe(false);
  });
});
