import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpointStatePath, transitionStore } from '../src/state.js';
import type { CheckpointState } from '../src/state.js';
import {
  RESET_SOURCES,
  lockHeldNotice,
  nextResetEdge,
  parseSessionStartPayload,
  runSessionStart,
  sessionStartLockPath,
} from '../src/session-start.js';
import type { SessionStartRunOptions, SessionStartStore } from '../src/session-start.js';

const BIN = join(__dirname, '..', 'bin', 'checkpoint.cjs');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FORCED_AT = '2026-10-21T09:30:00.000Z';
const OLD_SINCE = '2026-10-21T09:30:00.000Z';

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A fresh canonical temp project holding a `.cadence/` directory. */
function newProject(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'checkpoint-session-start-')));
  roots.push(root);
  const project = join(root, 'project');
  mkdirSync(join(project, '.cadence'), { recursive: true });
  return project;
}

/** A fresh canonical temp directory with no `.cadence/` anywhere in it. */
function newBareDir(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'checkpoint-session-start-bare-')));
  roots.push(root);
  return root;
}

function seedStore(project: string, record: Record<string, unknown>): void {
  mkdirSync(join(project, '.cadence', 'checkpoint'), { recursive: true });
  writeFileSync(checkpointStatePath(project), `${JSON.stringify(record, null, 2)}\n`);
}

function storeBytes(project: string): Buffer | null {
  const path = checkpointStatePath(project);
  return existsSync(path) ? readFileSync(path) : null;
}

function storeJson(project: string): Record<string, unknown> {
  return JSON.parse(readFileSync(checkpointStatePath(project), 'utf8')) as Record<string, unknown>;
}

function lockOf(project: string): string {
  return join(project, '.cadence', 'checkpoint', 'session-start.lock');
}

function settledRecord(): Record<string, unknown> {
  return { state: 'settled', since: FORCED_AT, forced: true, forcedAt: FORCED_AT, lastForcedAt: FORCED_AT };
}

function sessionStartPayload(cwd: string, source: string): string {
  return JSON.stringify({
    session_id: 'session-start-test',
    transcript_path: join(cwd, 'transcript.jsonl'),
    cwd,
    hook_event_name: 'SessionStart',
    source,
  });
}

function childEnv(): NodeJS.ProcessEnv {
  // CADENCE_HOME is dropped so a developer's own setting can never exclude
  // (or include) the temp project.
  const env = { ...process.env };
  delete env['CADENCE_HOME'];
  return env;
}

interface BinResult {
  status: number | null;
  stdout: Buffer;
  stderr: string;
}

/** The built bin: `node bin/checkpoint.cjs session-start <args...>`, no shell. */
function runBin(args: readonly string[], input: string): BinResult {
  const r = spawnSync(process.execPath, [BIN, 'session-start', ...args], {
    input,
    env: childEnv(),
    windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr.toString('utf8') };
}

/** An async spawn of the built bin whose stdin stays open until the caller ends it. */
function startBin(): { child: ChildProcessWithoutNullStreams; done: Promise<BinResult> } {
  const child = spawn(process.execPath, [BIN, 'session-start'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv(),
    windowsHide: true,
  });
  const done = new Promise<BinResult>((resolvePromise, reject) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (status) => {
      resolvePromise({ status, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') });
    });
  });
  return { child, done };
}

function stderrLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}

interface InProcessResult {
  code: number;
  stderr: string;
}

async function runInProcess(
  argv: readonly string[],
  payload: string,
  extra: Partial<Pick<SessionStartRunOptions, 'store' | 'openLock' | 'unlinkLock' | 'now'>> = {},
): Promise<InProcessResult> {
  const err: string[] = [];
  const code = await runSessionStart({
    argv,
    stdin: [Buffer.from(payload, 'utf8')],
    stderr: {
      write(chunk: string): boolean {
        err.push(chunk);
        return true;
      },
    },
    ...extra,
  });
  return { code, stderr: err.join('') };
}

/** A store seam that records every `transition` target and otherwise delegates to the real store. */
function recordingStore(calls: CheckpointState[], before?: (to: CheckpointState) => Promise<void>): SessionStartStore {
  return {
    transition: async (projectDir, to, opts) => {
      calls.push(to);
      if (before !== undefined) await before(to);
      return transitionStore(projectDir, to, opts);
    },
  };
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// AC-11: single winner.
// ---------------------------------------------------------------------------

describe('checkpoint session-start: AC-11 single winner', () => {
  it('336-01/AC-11: a forced race - a second handler run while the winner is held inside its first edge exits 0 with exactly one lock line and no state write; the winner then walks settled -> reset -> resumed -> idle and removes the lock', async () => {
    const project = newProject();
    seedStore(project, settledRecord());
    const lock = lockOf(project);
    const payload = sessionStartPayload(project, 'clear');

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let entered!: () => void;
    const heldInside = new Promise<void>((r) => {
      entered = r;
    });
    const winnerCalls: CheckpointState[] = [];
    const winner = runInProcess([], payload, {
      store: recordingStore(winnerCalls, async () => {
        if (winnerCalls.length === 1) {
          entered();
          await gate;
        }
      }),
    });
    // Fail fast, never hang: a winner that ends before its first edge rejects the race.
    await Promise.race([
      heldInside,
      winner.then((r) => {
        throw new Error(`winner ended before its first edge: ${r.stderr}`);
      }),
    ]);

    // The winner holds the lock and has not written yet.
    expect(existsSync(lock)).toBe(true);
    const lockBody = readFileSync(lock, 'utf8');
    expect(lockBody).toContain(String(process.pid));
    expect(lockBody).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    const held = storeBytes(project);

    const loserCalls: CheckpointState[] = [];
    const loser = await runInProcess([], payload, { store: recordingStore(loserCalls) });
    expect(loser.code).toBe(0);
    expect(stderrLines(loser.stderr)).toEqual([lockHeldNotice(lock)]);
    expect(loser.stderr).toBe(`${lockHeldNotice(lock)}\n`);
    expect(loserCalls).toEqual([]);
    expect(storeBytes(project)).toEqual(held);
    expect(existsSync(lock)).toBe(true);
    expect(readFileSync(lock, 'utf8')).toBe(lockBody);

    release();
    const won = await winner;
    expect(won.code).toBe(0);
    expect(won.stderr).toBe('');
    expect(winnerCalls).toEqual(['reset', 'resumed', 'idle']);
    const store = storeJson(project);
    expect(Object.keys(store)).toEqual(['state', 'since', 'lastForcedAt']);
    expect(store['state']).toBe('idle');
    expect(store['since']).toMatch(ISO);
    expect(store['lastForcedAt']).toBe(FORCED_AT);
    expect(existsSync(lock)).toBe(false);
  });

  it('336-01/AC-11: a handler that claims the lock after another handler finished re-reads the state under the lock and writes nothing', async () => {
    const project = newProject();
    seedStore(project, settledRecord());
    const lock = lockOf(project);
    const payload = sessionStartPayload(project, 'startup');

    const firstCalls: CheckpointState[] = [];
    const lateCalls: CheckpointState[] = [];
    let first: InProcessResult | null = null;
    const late = await runInProcess([], payload, {
      store: recordingStore(lateCalls),
      // Between the late handler's fast read (settled) and its claim, another
      // handler runs the whole reset to completion.
      openLock: async (path) => {
        first = await runInProcess([], payload, { store: recordingStore(firstCalls) });
        return open(path, 'wx');
      },
    });

    expect(first).toEqual({ code: 0, stderr: '' });
    expect(firstCalls).toEqual(['reset', 'resumed', 'idle']);
    const afterFirst = storeJson(project);
    expect(afterFirst['state']).toBe('idle');
    expect(late).toEqual({ code: 0, stderr: '' });
    expect(lateCalls).toEqual([]);
    expect(storeJson(project)).toEqual(afterFirst);
    expect(storeJson(project)['lastForcedAt']).toBe(FORCED_AT);
    expect(existsSync(lock)).toBe(false);
  });

  it('336-01/AC-11: two built handlers started concurrently against one settled store (rounds 1-5) both exit 0 with empty stdout, at most one walks, the store ends idle with lastForcedAt kept, and the lock is gone', async () => {
    const { unexpected } = await spawnedRace('rounds 1-5');
    expect(unexpected).toEqual([]);
  });

  it('336-01/AC-11: two built handlers started concurrently against one settled store (rounds 6-10) both exit 0 with empty stdout, at most one walks, the store ends idle with lastForcedAt kept, and the lock is gone', async () => {
    const { unexpected } = await spawnedRace('rounds 6-10');
    expect(unexpected).toEqual([]);
  });
});

/** Rounds per spawned-race it(): two node spawns each, kept small for a loaded 3-core CI runner. */
const SPAWNED_RACE_ROUNDS = 5;

/** The only stderr lines a handler that LOST the spawned race may print, in outcome order. */
function raceAllowList(project: string): RegExp[] {
  const lock = lockOf(project);
  const statePath = checkpointStatePath(project);
  return [
    new RegExp(`^${escapeRe(lockHeldNotice(lock))}$`),
    // Windows: the loser's lock-free fast read can meet the winner's rename.
    new RegExp(`^checkpoint state refused: cannot read ${escapeRe(statePath)} \\((EPERM|EACCES|EBUSY)\\)$`),
    // Windows: the loser's open(.., 'wx') claim on a lock the winner is unlinking
    // can report EPERM/EACCES. Anchored to the claim's `open '<lock>'`, so the
    // winner's own "could not remove its own lock" notice never matches.
    new RegExp(`^checkpoint session-start: .*(EPERM|EACCES)[^;]*open '${escapeRe(lock)}'$`),
  ];
}

/**
 * Runs SPAWNED_RACE_ROUNDS rounds of two concurrent built handlers against
 * one freshly seeded settled store, asserting every round's invariants, and
 * returns the stderr lines that matched no allowed shape.
 */
async function spawnedRace(label: string): Promise<{ unexpected: string[] }> {
  const project = newProject();
  const lock = lockOf(project);
  const allowed = raceAllowList(project);
  const outcomes: Record<string, number> = { silentPair: 0, lockLine: 0, transientRead: 0, transientLock: 0 };
  const unexpected: string[] = [];
  const payload = sessionStartPayload(project, 'clear');

  for (let round = 0; round < SPAWNED_RACE_ROUNDS; round++) {
    seedStore(project, settledRecord());
    const a = startBin();
    const b = startBin();
    a.child.stdin.end(payload);
    b.child.stdin.end(payload);
    const results = await Promise.all([a.done, b.done]);

    for (const r of results) {
      expect(r.status).toBe(0);
      expect(r.stdout.length).toBe(0);
      const lines = stderrLines(r.stderr);
      expect(lines.length).toBeLessThanOrEqual(1);
      for (const line of lines) {
        // A second walk that skipped the re-read would hit `idle -> reset`.
        expect(line).not.toContain('transition refused');
        const which = allowed.findIndex((re) => re.test(line));
        if (which === -1) unexpected.push(line);
        if (which === 0) outcomes['lockLine'] = (outcomes['lockLine'] ?? 0) + 1;
        if (which === 1) outcomes['transientRead'] = (outcomes['transientRead'] ?? 0) + 1;
        if (which === 2) outcomes['transientLock'] = (outcomes['transientLock'] ?? 0) + 1;
      }
    }
    const noisy = results.filter((r) => r.stderr.length > 0).length;
    // At most one handler can lose: the winner is always silent.
    expect(noisy).toBeLessThanOrEqual(1);
    if (noisy === 0) outcomes['silentPair'] = (outcomes['silentPair'] ?? 0) + 1;

    const store = storeJson(project);
    expect(Object.keys(store)).toEqual(['state', 'since', 'lastForcedAt']);
    expect(store['state']).toBe('idle');
    expect(store['since']).toMatch(ISO);
    expect(store['lastForcedAt']).toBe(FORCED_AT);
    expect(existsSync(lock)).toBe(false);
  }

  process.stderr.write(
    `[336-01/AC-11] ${label} rounds=${SPAWNED_RACE_ROUNDS} outcomes=${JSON.stringify(outcomes)}\n`,
  );
  return { unexpected };
}

// ---------------------------------------------------------------------------
// AC-17: a new session never inherits a stale armed state.
// ---------------------------------------------------------------------------

describe('checkpoint session-start: AC-17 reset sources and leftovers', () => {
  // Unit pins for the helpers below; the AC-17 proofs are the store/bin tests
  // that follow (settle links the first AC token per file, so these carry none).
  it('helper: the reset sources are exactly startup, clear and compact', () => {
    expect([...RESET_SOURCES]).toEqual(['startup', 'clear', 'compact']);
  });

  it('helper: nextResetEdge walks every non-idle state to idle with existing edges, sessionReset only on armed -> idle', () => {
    expect(nextResetEdge('idle')).toBeNull();
    expect(nextResetEdge('settled')).toEqual({ to: 'reset' });
    expect(nextResetEdge('reset')).toEqual({ to: 'resumed' });
    expect(nextResetEdge('resumed')).toEqual({ to: 'idle' });
    expect(nextResetEdge('armed')).toEqual({ to: 'idle', ctx: { sessionReset: true } });
    expect(nextResetEdge('written')).toEqual({ to: 'armed' });
  });

  it.each(['startup', 'clear', 'compact'])(
    '336-01/AC-17: armed (instruction issued, chain of 2) + source %s leaves the store idle with the instruction cleared (built bin)',
    (source) => {
      const project = newProject();
      seedStore(project, { state: 'armed', since: OLD_SINCE, instructed: true, blocks: 2, lastForcedAt: FORCED_AT });
      const r = runBin([], sessionStartPayload(project, source));
      expect(r.status).toBe(0);
      expect(r.stdout.length).toBe(0);
      expect(r.stderr).toBe('');
      const store = storeJson(project);
      expect(Object.keys(store)).toEqual(['state', 'since', 'lastForcedAt']);
      expect(store['state']).toBe('idle');
      expect(store['instructed']).toBeUndefined();
      expect(store['blocks']).toBeUndefined();
      expect(store['since']).not.toBe(OLD_SINCE);
      expect(store['lastForcedAt']).toBe(FORCED_AT);
      expect(existsSync(lockOf(project))).toBe(false);
    },
  );

  it.each(['resume', 'fork', 'something-else'])(
    '336-01/AC-17: armed + source %s leaves the store bytes unchanged, creates no lock and prints nothing (built bin)',
    (source) => {
      const project = newProject();
      seedStore(project, { state: 'armed', since: OLD_SINCE, instructed: true, blocks: 2 });
      const before = storeBytes(project);
      const r = runBin([], sessionStartPayload(project, source));
      expect(r.status).toBe(0);
      expect(r.stdout.length).toBe(0);
      expect(r.stderr).toBe('');
      expect(storeBytes(project)).toEqual(before);
      expect(existsSync(lockOf(project))).toBe(false);
    },
  );

  it.each([
    ['written', ['armed', 'idle']],
    ['reset', ['resumed', 'idle']],
    ['resumed', ['idle']],
    ['settled', ['reset', 'resumed', 'idle']],
  ] as const)(
    '336-01/AC-17: the leftover %s reaches idle on clear with existing edges and keeps lastForcedAt',
    async (state, walk) => {
      const project = newProject();
      seedStore(project, {
        state,
        since: OLD_SINCE,
        ...(state === 'written' ? { blocks: 1 } : {}),
        lastForcedAt: FORCED_AT,
      });
      const calls: CheckpointState[] = [];
      const r = await runInProcess([], sessionStartPayload(project, 'clear'), { store: recordingStore(calls) });
      expect(r).toEqual({ code: 0, stderr: '' });
      expect(calls).toEqual([...walk]);
      const store = storeJson(project);
      expect(Object.keys(store)).toEqual(['state', 'since', 'lastForcedAt']);
      expect(store['state']).toBe('idle');
      expect(store['lastForcedAt']).toBe(FORCED_AT);
      expect(existsSync(lockOf(project))).toBe(false);
    },
  );

  it('336-01/AC-17: all five sources on a stale armed store (built bin) - startup, clear and compact reach idle with instructed/blocks cleared and lastForcedAt kept; resume and fork leave the store bytes unchanged', () => {
    for (const source of ['startup', 'clear', 'compact']) {
      const project = newProject();
      seedStore(project, { state: 'armed', since: OLD_SINCE, instructed: true, blocks: 2, lastForcedAt: FORCED_AT });
      const r = runBin([], sessionStartPayload(project, source));
      expect(r.status).toBe(0);
      expect(r.stdout.length).toBe(0);
      expect(r.stderr).toBe('');
      const store = storeJson(project);
      expect(Object.keys(store)).toEqual(['state', 'since', 'lastForcedAt']);
      expect(store['state']).toBe('idle');
      expect(store['since']).not.toBe(OLD_SINCE);
      expect(store['lastForcedAt']).toBe(FORCED_AT);
      expect(existsSync(lockOf(project))).toBe(false);
    }
    for (const source of ['resume', 'fork']) {
      const project = newProject();
      seedStore(project, { state: 'armed', since: OLD_SINCE, instructed: true, blocks: 2, lastForcedAt: FORCED_AT });
      const before = storeBytes(project);
      const r = runBin([], sessionStartPayload(project, source));
      expect(r.status).toBe(0);
      expect(r.stdout.length).toBe(0);
      expect(r.stderr).toBe('');
      expect(storeBytes(project)).toEqual(before);
      expect(existsSync(lockOf(project))).toBe(false);
    }
  });

  it('336-01/AC-17: the three crash leftovers written, reset and resumed each reach idle on clear with existing edges and keep lastForcedAt', async () => {
    const walks: readonly (readonly [CheckpointState, readonly CheckpointState[]])[] = [
      ['written', ['armed', 'idle']],
      ['reset', ['resumed', 'idle']],
      ['resumed', ['idle']],
    ];
    for (const [state, walk] of walks) {
      const project = newProject();
      seedStore(project, {
        state,
        since: OLD_SINCE,
        ...(state === 'written' ? { blocks: 1 } : {}),
        lastForcedAt: FORCED_AT,
      });
      const calls: CheckpointState[] = [];
      const r = await runInProcess([], sessionStartPayload(project, 'clear'), { store: recordingStore(calls) });
      expect(r).toEqual({ code: 0, stderr: '' });
      expect(calls).toEqual([...walk]);
      const store = storeJson(project);
      expect(Object.keys(store)).toEqual(['state', 'since', 'lastForcedAt']);
      expect(store['state']).toBe('idle');
      expect(store['lastForcedAt']).toBe(FORCED_AT);
      expect(existsSync(lockOf(project))).toBe(false);
    }
  });

  it('336-01/AC-17: the idle fast path (an idle store, or no store at all) writes nothing and creates neither the lock nor the checkpoint directory', async () => {
    const idle = newProject();
    seedStore(idle, { state: 'idle', since: OLD_SINCE, lastForcedAt: FORCED_AT });
    const before = storeBytes(idle);
    let opened = 0;
    const r = await runInProcess([], sessionStartPayload(idle, 'clear'), {
      openLock: async (path) => {
        opened++;
        return open(path, 'wx');
      },
    });
    expect(r).toEqual({ code: 0, stderr: '' });
    expect(opened).toBe(0);
    expect(storeBytes(idle)).toEqual(before);
    expect(existsSync(lockOf(idle))).toBe(false);

    const empty = newProject();
    const bin = runBin([], sessionStartPayload(empty, 'startup'));
    expect(bin.status).toBe(0);
    expect(bin.stdout.length).toBe(0);
    expect(bin.stderr).toBe('');
    expect(existsSync(join(empty, '.cadence', 'checkpoint'))).toBe(false);
  });

  it('336-01/AC-17: a refused edge mid-walk stops the walk, leaves its one stderr line, exits 0 and removes the lock', async () => {
    const project = newProject();
    seedStore(project, settledRecord());
    const calls: CheckpointState[] = [];
    const store: SessionStartStore = {
      transition: async (projectDir, to, opts) => {
        calls.push(to);
        if (to === 'resumed') {
          opts.stderr.write('checkpoint transition refused: injected\n');
          return { ok: false, reason: 'checkpoint transition refused: injected' };
        }
        return transitionStore(projectDir, to, opts);
      },
    };
    const r = await runInProcess([], sessionStartPayload(project, 'clear'), { store });
    expect(r.code).toBe(0);
    expect(stderrLines(r.stderr)).toEqual(['checkpoint transition refused: injected']);
    expect(calls).toEqual(['reset', 'resumed']);
    expect(storeJson(project)['state']).toBe('reset');
    expect(existsSync(lockOf(project))).toBe(false);
  });

  it('336-01/AC-17: a store write that throws is exactly one `checkpoint session-start:` line, exit 0, and the lock is removed', async () => {
    const project = newProject();
    seedStore(project, settledRecord());
    const before = storeBytes(project);
    const store: SessionStartStore = {
      transition: () => {
        const err = new Error('EACCES: permission denied, rename state.json') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        return Promise.reject(err);
      },
    };
    const r = await runInProcess([], sessionStartPayload(project, 'clear'), { store });
    expect(r.code).toBe(0);
    expect(stderrLines(r.stderr)).toEqual(['checkpoint session-start: EACCES: permission denied, rename state.json']);
    expect(storeBytes(project)).toEqual(before);
    expect(existsSync(lockOf(project))).toBe(false);
  });

  it('336-01/AC-17: a corrupt store is its one refusal line and exit 0, with no lock and no write', () => {
    const project = newProject();
    mkdirSync(join(project, '.cadence', 'checkpoint'), { recursive: true });
    writeFileSync(checkpointStatePath(project), '{ not json');
    const r = runBin([], sessionStartPayload(project, 'clear'));
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBe(0);
    const lines = stderrLines(r.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^checkpoint state refused: .* is not valid JSON/);
    expect(readFileSync(checkpointStatePath(project), 'utf8')).toBe('{ not json');
    expect(existsSync(lockOf(project))).toBe(false);
  });

  it('336-01/AC-17: a malformed payload is one stderr line and exit 0 with no write (built bin)', () => {
    const project = newProject();
    seedStore(project, settledRecord());
    const before = storeBytes(project);
    for (const input of ['', 'not json', '[]', JSON.stringify({ source: 'clear' }), JSON.stringify({ cwd: project })]) {
      const r = runBin([], input);
      expect(r.status).toBe(0);
      expect(r.stdout.length).toBe(0);
      const lines = stderrLines(r.stderr);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^checkpoint session-start: /);
      expect(storeBytes(project)).toEqual(before);
    }
  });

  it('336-01/AC-17: any argument is one stderr line and exit 0, never the usage exit (built bin)', () => {
    const project = newProject();
    seedStore(project, settledRecord());
    const before = storeBytes(project);
    for (const args of [['--force'], ['extra'], ['--source=clear']]) {
      const r = runBin(args, sessionStartPayload(project, 'clear'));
      expect(r.status).toBe(0);
      expect(r.stdout.length).toBe(0);
      const lines = stderrLines(r.stderr);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^checkpoint session-start: /);
      expect(lines[0]).not.toContain('Usage:');
      expect(storeBytes(project)).toEqual(before);
      expect(existsSync(lockOf(project))).toBe(false);
    }
  });

  it('336-01/AC-17: a session outside any cadence project is a silent exit 0', () => {
    const bare = newBareDir();
    const r = runBin([], sessionStartPayload(bare, 'clear'));
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('336-01/AC-17: parseSessionStartPayload needs a string cwd and a string source', () => {
    expect(parseSessionStartPayload(JSON.stringify({ cwd: '/p', source: 'clear' }))).toEqual({
      ok: true,
      cwd: '/p',
      source: 'clear',
    });
    expect(parseSessionStartPayload('').ok).toBe(false);
    expect(parseSessionStartPayload('{').ok).toBe(false);
    expect(parseSessionStartPayload('null').ok).toBe(false);
    expect(parseSessionStartPayload(JSON.stringify({ cwd: '', source: 'clear' })).ok).toBe(false);
    expect(parseSessionStartPayload(JSON.stringify({ cwd: '/p', source: 7 })).ok).toBe(false);
    expect(sessionStartLockPath('/p')).toBe(join('/p', '.cadence', 'checkpoint', 'session-start.lock'));
  });
});

// ---------------------------------------------------------------------------
// AC-19: a stale lock is reported, never broken.
// ---------------------------------------------------------------------------

describe('checkpoint session-start: AC-19 stale lock', () => {
  it('336-01/AC-19: a pre-existing lock + settled + clear exits 0, leaves store and lock bytes unchanged, and prints exactly one line naming the lock path and how to remove it (built bin)', () => {
    const project = newProject();
    seedStore(project, settledRecord());
    const lock = lockOf(project);
    writeFileSync(lock, 'pid 4242 at 2026-10-21T09:31:00.000Z\n');
    const storeBefore = storeBytes(project);
    const lockBefore = readFileSync(lock);

    const r = runBin([], sessionStartPayload(project, 'clear'));
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBe(0);
    expect(r.stderr).toBe(`${lockHeldNotice(lock)}\n`);
    const lines = stderrLines(r.stderr);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^checkpoint session-start: /);
    expect(lines[0]).toContain(lock);
    expect(lines[0]).toMatch(/delete/i);
    expect(storeBytes(project)).toEqual(storeBefore);
    expect(existsSync(lock)).toBe(true);
    expect(readFileSync(lock)).toEqual(lockBefore);
  });

  function errnoError(code: string, path: string): NodeJS.ErrnoException {
    const err = new Error(`${code}: injected, unlink '${path}'`) as NodeJS.ErrnoException;
    err.code = code;
    return err;
  }

  it('336-01/AC-19: removing its own lock retries a transient EPERM/EACCES/EBUSY and then succeeds silently', async () => {
    const project = newProject();
    seedStore(project, settledRecord());
    const lock = lockOf(project);
    const attempts: string[] = [];
    const transient = ['EPERM', 'EACCES', 'EBUSY'];
    const r = await runInProcess([], sessionStartPayload(project, 'clear'), {
      unlinkLock: async (path) => {
        attempts.push(path);
        const code = transient[attempts.length - 1];
        if (code !== undefined) throw errnoError(code, path);
        await unlink(path);
      },
    });
    expect(r).toEqual({ code: 0, stderr: '' });
    expect(attempts).toEqual([lock, lock, lock, lock]);
    expect(existsSync(lock)).toBe(false);
    expect(storeJson(project)['state']).toBe('idle');
  });

  it('336-01/AC-19: a lock removal that keeps failing gives up after 10 tries with exactly one notice naming the lock, which no allowed race line matches; a non-transient code is not retried', async () => {
    const project = newProject();
    seedStore(project, settledRecord());
    const lock = lockOf(project);
    let attempts = 0;
    const r = await runInProcess([], sessionStartPayload(project, 'clear'), {
      unlinkLock: (path) => {
        attempts++;
        return Promise.reject(errnoError('EPERM', path));
      },
    });
    expect(r.code).toBe(0);
    expect(attempts).toBe(10);
    const lines = stderrLines(r.stderr);
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? '';
    expect(line).toMatch(/^checkpoint session-start: could not remove its own lock /);
    expect(line).toContain(lock);
    expect(line).toMatch(/delete/);
    // The winner's own notice can never pass as an allowed loser line in the spawned race.
    expect(raceAllowList(project).some((re) => re.test(line))).toBe(false);
    // The claim-failure shape (the loser's) does match index 2.
    const claim = `checkpoint session-start: EPERM: operation not permitted, open '${lock}'`;
    expect(raceAllowList(project).findIndex((re) => re.test(claim))).toBe(2);
    expect(storeJson(project)['state']).toBe('idle');

    const other = newProject();
    seedStore(other, settledRecord());
    let otherAttempts = 0;
    const r2 = await runInProcess([], sessionStartPayload(other, 'clear'), {
      unlinkLock: (path) => {
        otherAttempts++;
        return Promise.reject(errnoError('EISDIR', path));
      },
    });
    expect(r2.code).toBe(0);
    expect(otherAttempts).toBe(1);
    expect(stderrLines(r2.stderr)).toHaveLength(1);
  });
});
