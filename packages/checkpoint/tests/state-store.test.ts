import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpointStatePath, readMachineState, transitionStore } from '../src/state.js';
import type { CheckpointState } from '../src/state.js';
import { updateStoreExtras } from '../src/state.js';
import type { MachineStateExtrasPatch, TransitionContext } from '../src/state.js';

interface CapturedStderr {
  chunks: string[];
  write(chunk: string): boolean;
}

function captureStderr(): CapturedStderr {
  const chunks: string[] = [];
  return {
    chunks,
    write(chunk: string): boolean {
      chunks.push(chunk);
      return true;
    },
  };
}

const FIXED_NOW = new Date('2026-10-15T12:34:56.789Z');
const now = (): Date => FIXED_NOW;

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'checkpoint-state-store-'));
  // The project marker the sensor walks up to; the store itself only needs
  // the project dir, but a realistic project has .cadence/ already.
  mkdirSync(join(projectDir, '.cadence'));
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function checkpointDir(): string {
  return join(projectDir, '.cadence', 'checkpoint');
}

function tmpSiblings(): string[] {
  const dir = checkpointDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.tmp'));
}

function seedState(bytes: string): Buffer {
  mkdirSync(checkpointDir(), { recursive: true });
  writeFileSync(checkpointStatePath(projectDir), bytes);
  return readFileSync(checkpointStatePath(projectDir));
}

describe('checkpoint machine-state store', () => {
  it('stores state at <project>/.cadence/checkpoint/state.json', () => {
    expect(checkpointStatePath(projectDir)).toBe(join(projectDir, '.cadence', 'checkpoint', 'state.json'));
  });

  it('331-01/AC-4: with no state file the machine reads as idle', () => {
    expect(readMachineState(projectDir)).toEqual({ ok: true, state: 'idle', since: null });
    expect(existsSync(checkpointDir())).toBe(false);
  });

  it('331-01/AC-4: a legal transition writes { state, since } atomically and writes nothing to stderr', async () => {
    const stderr = captureStderr();
    const result = await transitionStore(projectDir, 'armed', {
      stderr,
      ctx: { reading: { used_percentage: 42 } },
      now,
    });
    expect(result).toEqual({ ok: true, state: 'armed' });
    const written = JSON.parse(readFileSync(checkpointStatePath(projectDir), 'utf8')) as unknown;
    expect(written).toEqual({ state: 'armed', since: '2026-10-15T12:34:56.789Z' });
    expect(stderr.chunks).toEqual([]);
    expect(tmpSiblings()).toEqual([]);
    expect(readMachineState(projectDir)).toEqual({ ok: true, state: 'armed', since: '2026-10-15T12:34:56.789Z' });
  });

  it('331-01/AC-4: the store reads its current state from disk across transitions', async () => {
    const stderr = captureStderr();
    await transitionStore(projectDir, 'armed', { stderr, ctx: { reading: { used_percentage: 7 } }, now });
    const later = new Date('2026-10-15T13:00:00.000Z');
    const second = await transitionStore(projectDir, 'written', { stderr, now: () => later });
    expect(second).toEqual({ ok: true, state: 'written' });
    expect(JSON.parse(readFileSync(checkpointStatePath(projectDir), 'utf8'))).toEqual({
      state: 'written',
      since: '2026-10-15T13:00:00.000Z',
    });
    // written -> idle is not an edge; the on-disk 'written' is what is checked.
    const third = await transitionStore(projectDir, 'idle', { stderr, now });
    expect(third.ok).toBe(false);
    expect(stderr.chunks).toHaveLength(1);
    expect(stderr.chunks[0]).toContain('written -> idle');
  });

  it('331-01/AC-4: since defaults to the current time as an ISO-8601 timestamp', async () => {
    const before = Date.now();
    const result = await transitionStore(projectDir, 'armed', {
      stderr: captureStderr(),
      ctx: { reading: { used_percentage: 50 } },
    });
    expect(result.ok).toBe(true);
    const { since } = JSON.parse(readFileSync(checkpointStatePath(projectDir), 'utf8')) as { since: string };
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(since)).toBeGreaterThanOrEqual(before - 1);
  });

  it('331-01/AC-4: a rejected transition leaves state.json byte-unchanged and writes the reason to stderr as one line', async () => {
    // Odd bytes on purpose: indentation, CRLF, no trailing newline — any
    // rewrite (even of the same logical state) would change them.
    const before = seedState('{   "state":"armed",\r\n  "since":"2026-01-01T00:00:00.000Z"}');
    const stderr = captureStderr();
    const result = await transitionStore(projectDir, 'idle', { stderr, now });
    expect(result.ok).toBe(false);
    const after = readFileSync(checkpointStatePath(projectDir));
    expect(after.equals(before)).toBe(true);
    expect(stderr.chunks).toHaveLength(1);
    const line = stderr.chunks[0] as string;
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(line).toContain('armed');
    expect(line).toContain('idle');
    if (!result.ok) expect(line).toBe(`${result.reason}\n`);
    expect(tmpSiblings()).toEqual([]);
  });

  it('331-01/AC-4: a rejected transition from a missing file creates no checkpoint directory', async () => {
    const stderr = captureStderr();
    const result = await transitionStore(projectDir, 'settled', { stderr, now });
    expect(result.ok).toBe(false);
    expect(existsSync(checkpointDir())).toBe(false);
    expect(stderr.chunks).toHaveLength(1);
    expect(stderr.chunks[0]).toContain('idle -> settled');
  });

  it('331-01/AC-3: the store refuses idle -> armed on an unknown reading and writes nothing', async () => {
    for (const ctx of [{ reading: { used_percentage: 0 } }, { reading: { used_percentage: null } }, { reading: {} }, {}]) {
      const stderr = captureStderr();
      const result = await transitionStore(projectDir, 'armed', { stderr, ctx, now });
      expect(result.ok).toBe(false);
      expect(stderr.chunks).toHaveLength(1);
      expect(stderr.chunks[0]).toMatch(/unknown reading/);
      expect(existsSync(checkpointDir())).toBe(false);
    }
    const noCtx = captureStderr();
    expect((await transitionStore(projectDir, 'armed', { stderr: noCtx, now })).ok).toBe(false);
    expect(noCtx.chunks[0]).toMatch(/unknown reading/);
    expect(existsSync(checkpointDir())).toBe(false);
  });

  const corruptContents: ReadonlyArray<readonly [string, string]> = [
    ['unparseable JSON', '{"state": "idle",'],
    ['empty file', ''],
    ['JSON null', 'null'],
    ['JSON array', '[]'],
    ['bare string', '"idle"'],
    ['object without state', '{"since":"2026-01-01T00:00:00.000Z"}'],
    ['unknown state', '{"state":"bogus","since":"2026-01-01T00:00:00.000Z"}'],
    ['non-string state', '{"state":1,"since":"2026-01-01T00:00:00.000Z"}'],
    ['missing since', '{"state":"idle"}'],
    ['non-string since', '{"state":"idle","since":5}'],
  ];

  it('331-01/AC-4: an unreadable or invalid state file is refused loudly, never read as idle', async () => {
    for (const [label, contents] of corruptContents) {
      const before = seedState(contents);
      const read = readMachineState(projectDir);
      expect(read.ok, label).toBe(false);
      if (!read.ok) {
        expect(read.reason, label).toContain('state.json');
        expect(read.reason, label).not.toContain('\n');
      }

      // idle -> armed with a known reading would succeed if the corrupt file
      // were silently treated as idle; it must be refused instead.
      const stderr = captureStderr();
      const result = await transitionStore(projectDir, 'armed', {
        stderr,
        ctx: { reading: { used_percentage: 42 } },
        now,
      });
      expect(result.ok, label).toBe(false);
      expect(readFileSync(checkpointStatePath(projectDir)).equals(before), label).toBe(true);
      expect(stderr.chunks, label).toHaveLength(1);
      expect(stderr.chunks[0], label).toContain('state.json');
      expect(tmpSiblings(), label).toEqual([]);
    }
  });

  it('331-01/AC-4: a state.json that is a directory is refused, not read as idle', async () => {
    mkdirSync(checkpointStatePath(projectDir), { recursive: true });
    const read = readMachineState(projectDir);
    expect(read.ok).toBe(false);
    const stderr = captureStderr();
    const result = await transitionStore(projectDir, 'armed', {
      stderr,
      ctx: { reading: { used_percentage: 42 } },
      now,
    });
    expect(result.ok).toBe(false);
    expect(stderr.chunks).toHaveLength(1);
  });

  it('331-01/AC-4: a regular file at .cadence/checkpoint is refused as a corrupt store, not read as idle', async () => {
    // On win32, readFileSync('.cadence/checkpoint/state.json') reports ENOENT
    // (not POSIX's ENOTDIR) when .cadence/checkpoint is a file — so ENOENT
    // alone must not be taken to mean "no state yet".
    const blocker = join(projectDir, '.cadence', 'checkpoint');
    writeFileSync(blocker, 'not a directory\r\n');
    const before = readFileSync(blocker);

    const read = readMachineState(projectDir);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toContain(blocker);
      expect(read.reason).toMatch(/not a directory/);
      expect(read.reason).not.toContain('\n');
    }

    for (const to of ['armed', 'settled'] as const) {
      const stderr = captureStderr();
      const result = await transitionStore(projectDir, to, {
        stderr,
        ctx: { reading: { used_percentage: 42 } },
        now,
      });
      expect(result.ok, to).toBe(false);
      expect(stderr.chunks, to).toHaveLength(1);
      if (!result.ok) expect(stderr.chunks[0], to).toBe(`${result.reason}\n`);
      // The refusal is about the store, not a misleading `idle -> X` edge.
      expect(stderr.chunks[0], to).not.toContain('idle ->');
      expect(readFileSync(blocker).equals(before), to).toBe(true);
    }
  });

  it('331-01/AC-4: a regular file at .cadence is refused as a corrupt store, not read as idle', async () => {
    const cadence = join(projectDir, '.cadence');
    rmSync(cadence, { recursive: true, force: true });
    writeFileSync(cadence, 'x');
    const before = readFileSync(cadence);

    const read = readMachineState(projectDir);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain(cadence);

    const stderr = captureStderr();
    const result = await transitionStore(projectDir, 'armed', {
      stderr,
      ctx: { reading: { used_percentage: 42 } },
      now,
    });
    expect(result.ok).toBe(false);
    expect(stderr.chunks).toHaveLength(1);
    expect(readFileSync(cadence).equals(before)).toBe(true);
  });

  /**
   * The 29 non-edges of CMD-C's machine, written out by hand (independent of
   * LEGAL_EDGES): every self-pair, every reverse except the legal
   * armed<->written pair, and every cross-state jump.
   */
  const REJECTED_PAIRS: ReadonlyArray<readonly [CheckpointState, CheckpointState]> = [
    ['idle', 'idle'],
    ['idle', 'written'],
    ['idle', 'settled'],
    ['idle', 'reset'],
    ['idle', 'resumed'],
    ['armed', 'idle'],
    ['armed', 'armed'],
    ['armed', 'settled'],
    ['armed', 'reset'],
    ['armed', 'resumed'],
    ['written', 'idle'],
    ['written', 'written'],
    ['written', 'reset'],
    ['written', 'resumed'],
    ['settled', 'idle'],
    ['settled', 'armed'],
    ['settled', 'written'],
    ['settled', 'settled'],
    ['settled', 'resumed'],
    ['reset', 'idle'],
    ['reset', 'armed'],
    ['reset', 'written'],
    ['reset', 'settled'],
    ['reset', 'reset'],
    ['resumed', 'armed'],
    ['resumed', 'written'],
    ['resumed', 'settled'],
    ['resumed', 'reset'],
    ['resumed', 'resumed'],
  ];

  it('331-01/AC-4: every one of the 29 rejected pairs leaves state.json byte-unchanged and logs its reason once to stderr', async () => {
    expect(REJECTED_PAIRS).toHaveLength(29);
    expect(new Set(REJECTED_PAIRS.map(([from, to]) => `${from}->${to}`)).size).toBe(29);
    for (const [from, to] of REJECTED_PAIRS) {
      // Odd spacing and CRLF so any rewrite would be visible in the bytes.
      const before = seedState(`{ "state" :  "${from}",\r\n   "since":"2026-01-01T00:00:00.000Z"   }`);
      const stderr = captureStderr();
      const result = await transitionStore(projectDir, to, {
        stderr,
        ctx: { reading: { used_percentage: 42 } },
        now,
      });
      const pair = `${from} -> ${to}`;
      expect(result.ok, pair).toBe(false);
      expect(readFileSync(checkpointStatePath(projectDir)).equals(before), pair).toBe(true);
      expect(stderr.chunks, pair).toHaveLength(1);
      if (!result.ok) expect(stderr.chunks[0], pair).toBe(`${result.reason}\n`);
      expect(stderr.chunks[0], pair).toContain(pair);
      expect(tmpSiblings(), pair).toEqual([]);
    }
  });
});

describe('checkpoint machine-state extras (phase 336)', () => {
  const T0 = '2026-10-15T10:00:00.000Z';
  const T1 = new Date('2026-10-15T11:00:00.000Z');
  const T2 = new Date('2026-10-15T12:00:00.000Z');
  const T3 = new Date('2026-10-15T13:00:00.000Z');
  const EARLIER_FORCE = '2026-10-14T09:00:00.000Z';

  function seedRecord(record: Record<string, unknown>): Buffer {
    return seedState(`${JSON.stringify(record, null, 2)}\n`);
  }

  function onDisk(): Record<string, unknown> {
    return JSON.parse(readFileSync(checkpointStatePath(projectDir), 'utf8')) as Record<string, unknown>;
  }

  it('336-01/AC-8: armed -> settled with ctx.forced writes forced, forcedAt and lastForcedAt, all equal to since, and drops the armed epoch', async () => {
    seedRecord({ state: 'armed', since: T0, instructed: true, blocks: 2 });
    const stderr = captureStderr();
    const result = await transitionStore(projectDir, 'settled', { stderr, ctx: { forced: true }, now: () => T1 });
    expect(result).toEqual({ ok: true, state: 'settled' });
    const iso = T1.toISOString();
    const written = onDisk();
    expect(written).toEqual({ state: 'settled', since: iso, forced: true, forcedAt: iso, lastForcedAt: iso });
    expect(Object.keys(written)).toEqual(['state', 'since', 'forced', 'forcedAt', 'lastForcedAt']);
    expect(readMachineState(projectDir)).toEqual({
      ok: true,
      state: 'settled',
      since: iso,
      forced: true,
      forcedAt: iso,
      lastForcedAt: iso,
    });
    expect(stderr.chunks).toEqual([]);
    expect(tmpSiblings()).toEqual([]);
  });

  it('336-01/AC-8: armed -> settled without ctx.forced is refused and leaves the extras-bearing store byte-unchanged', async () => {
    const before = seedRecord({ state: 'armed', since: T0, instructed: true, blocks: 2 });
    for (const ctx of [undefined, {}, { forced: false }, { sessionReset: true }]) {
      const stderr = captureStderr();
      const result = await transitionStore(projectDir, 'settled', ctx === undefined ? { stderr } : { stderr, ctx });
      expect(result.ok, JSON.stringify(ctx)).toBe(false);
      expect(stderr.chunks, JSON.stringify(ctx)).toHaveLength(1);
      expect(stderr.chunks[0]).toContain('armed -> settled');
      expect(readFileSync(checkpointStatePath(projectDir)).equals(before)).toBe(true);
    }
  });

  it('336-01/AC-8: lastForcedAt is carried across settled -> reset -> resumed -> idle -> armed and later edges; forced and forcedAt are not', async () => {
    seedRecord({ state: 'armed', since: T0, blocks: 2 });
    const stderr = captureStderr();
    await transitionStore(projectDir, 'settled', { stderr, ctx: { forced: true }, now: () => T1 });
    const forcedAt = T1.toISOString();

    const walk: ReadonlyArray<readonly [CheckpointState, TransitionContext | undefined]> = [
      ['reset', undefined],
      ['resumed', undefined],
      ['idle', undefined],
      ['armed', { reading: { used_percentage: 80 } }],
      ['written', undefined],
      ['armed', undefined],
      ['written', undefined],
      ['settled', undefined],
    ];
    let tick = T2.getTime();
    for (const [to, ctx] of walk) {
      tick += 1000;
      const at = new Date(tick);
      const result = await transitionStore(
        projectDir,
        to,
        ctx === undefined ? { stderr, now: () => at } : { stderr, ctx, now: () => at },
      );
      expect(result, to).toEqual({ ok: true, state: to });
      expect(onDisk(), `after -> ${to}`).toEqual({ state: to, since: at.toISOString(), lastForcedAt: forcedAt });
    }
    expect(stderr.chunks).toEqual([]);

    // A same-state extras update carries it too.
    await transitionStore(projectDir, 'reset', { stderr, now: () => T3 });
    await transitionStore(projectDir, 'resumed', { stderr, now: () => T3 });
    await transitionStore(projectDir, 'idle', { stderr, now: () => T3 });
    await transitionStore(projectDir, 'armed', { stderr, ctx: { reading: { used_percentage: 90 } }, now: () => T3 });
    await updateStoreExtras(projectDir, { instructed: true }, { stderr, expectedState: 'armed' });
    expect(onDisk()).toEqual({ state: 'armed', since: T3.toISOString(), instructed: true, lastForcedAt: forcedAt });

    // A second force moves lastForcedAt forward to the new forcedAt.
    const T4 = new Date('2026-10-15T14:00:00.000Z');
    await transitionStore(projectDir, 'settled', { stderr, ctx: { forced: true }, now: () => T4 });
    const iso4 = T4.toISOString();
    expect(onDisk()).toEqual({ state: 'settled', since: iso4, forced: true, forcedAt: iso4, lastForcedAt: iso4 });
    expect(stderr.chunks).toEqual([]);
  });

  it('336-01/AC-8: no patch can clear or overwrite lastForcedAt, forced or forcedAt', async () => {
    seedRecord({ state: 'armed', since: T0, lastForcedAt: EARLIER_FORCE });
    const stderr = captureStderr();
    const smuggled = { lastForcedAt: null, forced: true, forcedAt: T0 } as unknown as MachineStateExtrasPatch;
    expect((await updateStoreExtras(projectDir, smuggled, { stderr, expectedState: 'armed' })).ok).toBe(true);
    expect(onDisk()).toEqual({ state: 'armed', since: T0, lastForcedAt: EARLIER_FORCE });
    expect((await transitionStore(projectDir, 'written', { stderr, extras: smuggled, now: () => T1 })).ok).toBe(true);
    expect(onDisk()).toEqual({ state: 'written', since: T1.toISOString(), lastForcedAt: EARLIER_FORCE });
    expect(stderr.chunks).toEqual([]);
  });

  it('336-01/AC-17: armed -> idle with ctx.sessionReset clears instructed and blocks and keeps lastForcedAt', async () => {
    seedRecord({ state: 'armed', since: T0, instructed: true, blocks: 2, lastForcedAt: EARLIER_FORCE });
    const stderr = captureStderr();
    const result = await transitionStore(projectDir, 'idle', { stderr, ctx: { sessionReset: true }, now: () => T1 });
    expect(result).toEqual({ ok: true, state: 'idle' });
    expect(onDisk()).toEqual({ state: 'idle', since: T1.toISOString(), lastForcedAt: EARLIER_FORCE });
    expect(readMachineState(projectDir)).toEqual({
      ok: true,
      state: 'idle',
      since: T1.toISOString(),
      lastForcedAt: EARLIER_FORCE,
    });
    expect(stderr.chunks).toEqual([]);
    expect(tmpSiblings()).toEqual([]);
  });

  it('336-01/AC-17: armed -> idle with ctx.sessionReset and no prior force writes exactly { state, since }', async () => {
    seedRecord({ state: 'armed', since: T0, instructed: true, blocks: 1 });
    const stderr = captureStderr();
    expect((await transitionStore(projectDir, 'idle', { stderr, ctx: { sessionReset: true }, now: () => T1 })).ok).toBe(true);
    expect(onDisk()).toEqual({ state: 'idle', since: T1.toISOString() });
  });

  it('336-01/AC-17: armed -> idle without ctx.sessionReset is refused and leaves the store byte-unchanged', async () => {
    const before = seedRecord({ state: 'armed', since: T0, instructed: true, blocks: 2 });
    for (const ctx of [undefined, {}, { sessionReset: false }, { forced: true }]) {
      const stderr = captureStderr();
      const result = await transitionStore(projectDir, 'idle', ctx === undefined ? { stderr } : { stderr, ctx });
      expect(result.ok, JSON.stringify(ctx)).toBe(false);
      expect(stderr.chunks).toHaveLength(1);
      expect(stderr.chunks[0]).toContain('armed -> idle');
      expect(readFileSync(checkpointStatePath(projectDir)).equals(before)).toBe(true);
    }
  });

  it('336-01/AC-8: the patch sets instructed and blocks on a transition; a plain transition still writes none', async () => {
    const stderr = captureStderr();
    await transitionStore(projectDir, 'armed', {
      stderr,
      ctx: { reading: { used_percentage: 80 } },
      extras: { instructed: true, blocks: 1 },
      now: () => T1,
    });
    const written = onDisk();
    expect(written).toEqual({ state: 'armed', since: T1.toISOString(), instructed: true, blocks: 1 });
    expect(Object.keys(written)).toEqual(['state', 'since', 'instructed', 'blocks']);
    expect(readMachineState(projectDir)).toEqual({
      ok: true,
      state: 'armed',
      since: T1.toISOString(),
      instructed: true,
      blocks: 1,
    });
    expect(stderr.chunks).toEqual([]);
  });

  it('336-01/AC-8: idle -> armed starts a fresh epoch; blocks carries across armed -> written -> armed, instructed resets on every entry into armed; null in the patch clears', async () => {
    // Ill-placed epoch fields on an idle record do not leak into the new epoch.
    seedRecord({ state: 'idle', since: T0, instructed: true, blocks: 2 });
    const stderr = captureStderr();
    await transitionStore(projectDir, 'armed', { stderr, ctx: { reading: { used_percentage: 80 } }, now: () => T1 });
    expect(onDisk()).toEqual({ state: 'armed', since: T1.toISOString() });

    await updateStoreExtras(projectDir, { instructed: true, blocks: 1 }, { stderr, expectedState: 'armed' });
    await transitionStore(projectDir, 'written', { stderr, now: () => T2 });
    // The chain survives the validator round trip; the instruction flag does not.
    expect(onDisk()).toEqual({ state: 'written', since: T2.toISOString(), blocks: 1 });

    // written -> armed (validator fail) is a new entry into armed: instructed
    // starts unset; the chain grows through the patch.
    await transitionStore(projectDir, 'armed', { stderr, extras: { blocks: 2 }, now: () => T3 });
    expect(onDisk()).toEqual({ state: 'armed', since: T3.toISOString(), blocks: 2 });

    // Without a patch, written -> armed carries the chain unchanged.
    await transitionStore(projectDir, 'written', { stderr, now: () => T3 });
    await transitionStore(projectDir, 'armed', { stderr, now: () => T3 });
    expect(onDisk()).toEqual({ state: 'armed', since: T3.toISOString(), blocks: 2 });

    // A stop_hook_active: false Stop resets the chain; null clears the field.
    await updateStoreExtras(projectDir, { instructed: true, blocks: null }, { stderr, expectedState: 'armed' });
    expect(onDisk()).toEqual({ state: 'armed', since: T3.toISOString(), instructed: true });
    await updateStoreExtras(projectDir, { instructed: null, blocks: 0 }, { stderr, expectedState: 'armed' });
    expect(onDisk()).toEqual({ state: 'armed', since: T3.toISOString(), blocks: 0 });
    expect(stderr.chunks).toEqual([]);
  });

  it('336-01/AC-8: written -> settled drops the armed epoch and any stale forced flag but keeps lastForcedAt', async () => {
    seedRecord({
      state: 'written',
      since: T0,
      instructed: true,
      blocks: 2,
      forced: true,
      forcedAt: EARLIER_FORCE,
      lastForcedAt: EARLIER_FORCE,
    });
    const stderr = captureStderr();
    expect((await transitionStore(projectDir, 'settled', { stderr, now: () => T1 })).ok).toBe(true);
    expect(onDisk()).toEqual({ state: 'settled', since: T1.toISOString(), lastForcedAt: EARLIER_FORCE });
  });

  it('336-01/AC-8: readMachineState returns every well-typed extra', () => {
    seedRecord({
      state: 'settled',
      since: T0,
      instructed: false,
      blocks: 0,
      forced: true,
      forcedAt: EARLIER_FORCE,
      lastForcedAt: EARLIER_FORCE,
      unrelated: 'ignored',
    });
    expect(readMachineState(projectDir)).toEqual({
      ok: true,
      state: 'settled',
      since: T0,
      instructed: false,
      blocks: 0,
      forced: true,
      forcedAt: EARLIER_FORCE,
      lastForcedAt: EARLIER_FORCE,
    });
  });

  const illTypedExtras: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['instructed as a string', { instructed: 'yes' }],
    ['instructed null', { instructed: null }],
    ['blocks negative', { blocks: -1 }],
    ['blocks fractional', { blocks: 1.5 }],
    ['blocks as a string', { blocks: '2' }],
    ['forced false', { forced: false }],
    ['forced as a string', { forced: 'true' }],
    ['forcedAt a number', { forcedAt: 5 }],
    ['forcedAt not a date', { forcedAt: 'not a date' }],
    ['forcedAt date only', { forcedAt: '2026-10-15' }],
    ['forcedAt without a zone', { forcedAt: '2026-10-15T10:00:00' }],
    ['forcedAt RFC 1123', { forcedAt: 'Thu, 15 Oct 2026 10:00:00 GMT' }],
    ['forcedAt ISO-shaped but impossible', { forcedAt: '2026-13-45T99:99:99Z' }],
  ];

  it('336-01/AC-8: an ill-typed extra other than lastForcedAt is dropped, never a refusal, while state and since stay strict', async () => {
    for (const [label, extra] of illTypedExtras) {
      seedRecord({ state: 'armed', since: T0, ...extra });
      expect(readMachineState(projectDir), label).toEqual({ ok: true, state: 'armed', since: T0 });
      // And the dropped extra is not written back by the next edge.
      const stderr = captureStderr();
      expect((await transitionStore(projectDir, 'written', { stderr, now: () => T1 })).ok, label).toBe(true);
      expect(onDisk(), label).toEqual({ state: 'written', since: T1.toISOString() });
    }
    // A well-typed extra does not rescue a bad state or since.
    seedRecord({ state: 'bogus', since: T0, lastForcedAt: EARLIER_FORCE });
    expect(readMachineState(projectDir).ok).toBe(false);
    seedRecord({ state: 'armed', since: 5, lastForcedAt: EARLIER_FORCE });
    expect(readMachineState(projectDir).ok).toBe(false);
  });

  it('336-01/AC-8: updateStoreExtras records instructed and blocks without changing state or since', async () => {
    seedRecord({ state: 'armed', since: T0, lastForcedAt: EARLIER_FORCE });
    const stderr = captureStderr();
    const result = await updateStoreExtras(projectDir, { instructed: true }, { stderr, expectedState: 'armed' });
    expect(result).toEqual({ ok: true, state: 'armed' });
    expect(onDisk()).toEqual({ state: 'armed', since: T0, instructed: true, lastForcedAt: EARLIER_FORCE });
    await updateStoreExtras(projectDir, { blocks: 2 }, { stderr, expectedState: 'armed' });
    const written = onDisk();
    expect(written).toEqual({ state: 'armed', since: T0, instructed: true, blocks: 2, lastForcedAt: EARLIER_FORCE });
    expect(Object.keys(written)).toEqual(['state', 'since', 'instructed', 'blocks', 'lastForcedAt']);
    expect(stderr.chunks).toEqual([]);
    expect(tmpSiblings()).toEqual([]);
  });

  it('336-01/AC-8: updateStoreExtras refuses a state mismatch, a missing store and a corrupt store, writing nothing', async () => {
    // Missing store: no directory is created.
    const missing = captureStderr();
    const none = await updateStoreExtras(projectDir, { instructed: true }, { stderr: missing, expectedState: 'idle' });
    expect(none.ok).toBe(false);
    expect(missing.chunks).toHaveLength(1);
    if (!none.ok) expect(missing.chunks[0]).toBe(`${none.reason}\n`);
    expect(existsSync(checkpointDir())).toBe(false);

    // State mismatch: the reason names both states; bytes unchanged.
    const before = seedState('{ "state":"written",\r\n "since":"2026-01-01T00:00:00.000Z" }');
    const mismatch = captureStderr();
    const wrong = await updateStoreExtras(projectDir, { blocks: 1 }, { stderr: mismatch, expectedState: 'armed' });
    expect(wrong.ok).toBe(false);
    expect(mismatch.chunks).toHaveLength(1);
    expect(mismatch.chunks[0]).toContain('written');
    expect(mismatch.chunks[0]).toContain('armed');
    expect((mismatch.chunks[0] as string).slice(0, -1)).not.toContain('\n');
    expect(readFileSync(checkpointStatePath(projectDir)).equals(before)).toBe(true);

    // Corrupt store.
    const corrupt = seedState('{"state":');
    const bad = captureStderr();
    expect((await updateStoreExtras(projectDir, { blocks: 1 }, { stderr: bad, expectedState: 'armed' })).ok).toBe(false);
    expect(bad.chunks).toHaveLength(1);
    expect(bad.chunks[0]).toContain('state.json');
    expect(readFileSync(checkpointStatePath(projectDir)).equals(corrupt)).toBe(true);
    expect(tmpSiblings()).toEqual([]);
  });

  it('336-01/AC-8: an ill-typed patch value is refused by both writers and leaves the store byte-unchanged', async () => {
    const before = seedRecord({ state: 'armed', since: T0, blocks: 1 });
    const badPatches = [
      { blocks: -1 },
      { blocks: 1.5 },
      { blocks: Number.NaN },
      { instructed: 'yes' },
    ] as unknown as MachineStateExtrasPatch[];
    for (const patch of badPatches) {
      const label = JSON.stringify(patch);
      const a = captureStderr();
      expect((await updateStoreExtras(projectDir, patch, { stderr: a, expectedState: 'armed' })).ok, label).toBe(false);
      expect(a.chunks, label).toHaveLength(1);
      const b = captureStderr();
      expect((await transitionStore(projectDir, 'written', { stderr: b, extras: patch, now: () => T1 })).ok, label).toBe(
        false,
      );
      expect(b.chunks, label).toHaveLength(1);
      expect(readFileSync(checkpointStatePath(projectDir)).equals(before), label).toBe(true);
    }
  });

  /** Every plain legal edge, each with the ctx it needs, seeded from its from-state. */
  const PLAIN_EDGES: ReadonlyArray<readonly [CheckpointState, CheckpointState, TransitionContext]> = [
    ['idle', 'armed', { reading: { used_percentage: 80 } }],
    ['armed', 'written', {}],
    ['written', 'settled', {}],
    ['written', 'armed', {}],
    ['settled', 'reset', {}],
    ['reset', 'resumed', {}],
    ['resumed', 'idle', {}],
  ];

  it('336-01/AC-8: the store refuses ctx.forced on any edge other than armed -> settled, naming the flag and its edge, and writes nothing', async () => {
    const cases: ReadonlyArray<readonly [CheckpointState, CheckpointState, TransitionContext]> = [
      ...PLAIN_EDGES,
      ['armed', 'idle', { sessionReset: true }],
    ];
    for (const [from, to, ctx] of cases) {
      const label = `${from} -> ${to}`;
      const before = seedRecord({ state: from, since: T0, lastForcedAt: EARLIER_FORCE });
      const stderr = captureStderr();
      const result = await transitionStore(projectDir, to, { stderr, ctx: { ...ctx, forced: true }, now: () => T1 });
      expect(result.ok, label).toBe(false);
      expect(stderr.chunks, label).toHaveLength(1);
      const line = stderr.chunks[0] as string;
      if (!result.ok) expect(line, label).toBe(`${result.reason}\n`);
      expect(line, label).toContain('ctx.forced');
      expect(line, label).toContain('armed -> settled');
      expect(line, label).toContain(label);
      expect(line.slice(0, -1), label).not.toContain('\n');
      expect(readFileSync(checkpointStatePath(projectDir)).equals(before), label).toBe(true);
      expect(tmpSiblings(), label).toEqual([]);
    }
    // From a missing store: refused, and no checkpoint directory is created.
    rmSync(checkpointDir(), { recursive: true, force: true });
    const stderr = captureStderr();
    const missing = await transitionStore(projectDir, 'armed', {
      stderr,
      ctx: { reading: { used_percentage: 80 }, forced: true },
      now,
    });
    expect(missing.ok).toBe(false);
    expect(stderr.chunks[0]).toContain('ctx.forced');
    expect(existsSync(checkpointDir())).toBe(false);
  });

  it('336-01/AC-17: the store refuses ctx.sessionReset on any edge other than armed -> idle, naming the flag and its edge, and writes nothing', async () => {
    const cases: ReadonlyArray<readonly [CheckpointState, CheckpointState, TransitionContext]> = [
      ...PLAIN_EDGES,
      ['armed', 'settled', { forced: true }],
    ];
    for (const [from, to, ctx] of cases) {
      const label = `${from} -> ${to}`;
      const before = seedRecord({ state: from, since: T0 });
      const stderr = captureStderr();
      const result = await transitionStore(projectDir, to, {
        stderr,
        ctx: { ...ctx, sessionReset: true },
        now: () => T1,
      });
      expect(result.ok, label).toBe(false);
      expect(stderr.chunks, label).toHaveLength(1);
      const line = stderr.chunks[0] as string;
      expect(line, label).toContain('ctx.sessionReset');
      expect(line, label).toContain('armed -> idle');
      expect(line, label).toContain(label);
      expect(readFileSync(checkpointStatePath(projectDir)).equals(before), label).toBe(true);
    }
    // A false flag is no flag: plain edges still accept it.
    seedRecord({ state: 'written', since: T0 });
    const stderr = captureStderr();
    expect(
      (await transitionStore(projectDir, 'settled', { stderr, ctx: { forced: false, sessionReset: false }, now: () => T1 }))
        .ok,
    ).toBe(true);
    expect(stderr.chunks).toEqual([]);
  });

  const BAD_LAST_FORCED_AT: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['a number', 5],
    ['an object', {}],
    ['not a date', 'yesterday-ish'],
    ['date only', '2026-10-15'],
    ['no zone', '2026-10-15T10:00:00'],
    ['RFC 1123', 'Thu, 15 Oct 2026 10:00:00 GMT'],
    ['ISO-shaped but impossible', '2026-13-45T99:99:99Z'],
  ];

  it('336-01/AC-8: an ill-typed lastForcedAt on disk is dropped on read but both writers refuse to erase it, naming the file and the key', async () => {
    const path = checkpointStatePath(projectDir);
    for (const [label, value] of BAD_LAST_FORCED_AT) {
      const before = seedRecord({ state: 'armed', since: T0, lastForcedAt: value });
      expect(readMachineState(projectDir), label).toEqual({ ok: true, state: 'armed', since: T0 });

      const a = captureStderr();
      const viaTransition = await transitionStore(projectDir, 'written', { stderr: a, now: () => T1 });
      expect(viaTransition.ok, label).toBe(false);
      expect(a.chunks, label).toHaveLength(1);
      if (!viaTransition.ok) expect(a.chunks[0], label).toBe(`${viaTransition.reason}\n`);
      expect(a.chunks[0], label).toContain(path);
      expect(a.chunks[0], label).toContain('lastForcedAt');
      expect((a.chunks[0] as string).slice(0, -1), label).not.toContain('\n');

      const b = captureStderr();
      const viaUpdate = await updateStoreExtras(projectDir, { instructed: true }, { stderr: b, expectedState: 'armed' });
      expect(viaUpdate.ok, label).toBe(false);
      expect(b.chunks, label).toHaveLength(1);
      expect(b.chunks[0], label).toContain(path);
      expect(b.chunks[0], label).toContain('lastForcedAt');

      expect(readFileSync(path).equals(before), label).toBe(true);
      expect(tmpSiblings(), label).toEqual([]);
    }
  });

  it('336-01/AC-8: forcedAt and lastForcedAt accept the strict ISO shape, with or without milliseconds and with an offset', async () => {
    const withOffset = '2026-10-14T09:00:00+02:00';
    const noMillis = '2026-10-14T09:00:00Z';
    seedRecord({ state: 'settled', since: T0, forced: true, forcedAt: noMillis, lastForcedAt: withOffset });
    expect(readMachineState(projectDir)).toEqual({
      ok: true,
      state: 'settled',
      since: T0,
      forced: true,
      forcedAt: noMillis,
      lastForcedAt: withOffset,
    });
    const stderr = captureStderr();
    expect((await transitionStore(projectDir, 'reset', { stderr, now: () => T1 })).ok).toBe(true);
    expect(onDisk()).toEqual({ state: 'reset', since: T1.toISOString(), lastForcedAt: withOffset });
    expect(stderr.chunks).toEqual([]);
  });

  it('336-01/AC-8: a non-empty extras patch whose target is neither armed nor written is refused by both writers', async () => {
    const transitions: ReadonlyArray<readonly [CheckpointState, CheckpointState, TransitionContext, MachineStateExtrasPatch]> = [
      ['armed', 'settled', { forced: true }, { blocks: 3 }],
      ['armed', 'idle', { sessionReset: true }, { instructed: null }],
      ['written', 'settled', {}, { blocks: 0 }],
      ['settled', 'reset', {}, { instructed: true }],
      ['reset', 'resumed', {}, { blocks: null }],
      ['resumed', 'idle', {}, { instructed: false }],
    ];
    for (const [from, to, ctx, extras] of transitions) {
      const label = `${from} -> ${to} ${JSON.stringify(extras)}`;
      const before = seedRecord({ state: from, since: T0 });
      const stderr = captureStderr();
      const result = await transitionStore(projectDir, to, { stderr, ctx, extras, now: () => T1 });
      expect(result.ok, label).toBe(false);
      expect(stderr.chunks, label).toHaveLength(1);
      expect(stderr.chunks[0], label).toContain(to);
      expect(stderr.chunks[0], label).toMatch(/armed or written/);
      expect(readFileSync(checkpointStatePath(projectDir)).equals(before), label).toBe(true);
    }
    for (const state of ['idle', 'settled', 'reset', 'resumed'] as const) {
      const before = seedRecord({ state, since: T0 });
      const stderr = captureStderr();
      const result = await updateStoreExtras(projectDir, { instructed: true }, { stderr, expectedState: state });
      expect(result.ok, state).toBe(false);
      expect(stderr.chunks, state).toHaveLength(1);
      expect(stderr.chunks[0], state).toMatch(/armed or written/);
      expect(readFileSync(checkpointStatePath(projectDir)).equals(before), state).toBe(true);
    }
    // An empty patch is no patch: the edge proceeds.
    seedRecord({ state: 'written', since: T0 });
    const ok = captureStderr();
    expect((await transitionStore(projectDir, 'settled', { stderr: ok, extras: {}, now: () => T1 })).ok).toBe(true);
    expect(onDisk()).toEqual({ state: 'settled', since: T1.toISOString() });
    // The epoch states accept a patch on both writers.
    seedRecord({ state: 'written', since: T0 });
    expect((await updateStoreExtras(projectDir, { blocks: 1 }, { stderr: ok, expectedState: 'written' })).ok).toBe(true);
    expect(onDisk()).toEqual({ state: 'written', since: T0, blocks: 1 });
    expect(ok.chunks).toEqual([]);
  });

  it('336-01/AC-8: updateStoreExtras with expectedSince refuses unless the on-disk since matches, writing nothing', async () => {
    const before = seedRecord({ state: 'armed', since: T0, blocks: 1 });
    const stale = captureStderr();
    const refused = await updateStoreExtras(
      projectDir,
      { blocks: 2 },
      { stderr: stale, expectedState: 'armed', expectedSince: '2026-10-15T09:59:59.999Z' },
    );
    expect(refused.ok).toBe(false);
    expect(stale.chunks).toHaveLength(1);
    expect(stale.chunks[0]).toContain(T0);
    expect(stale.chunks[0]).toContain('2026-10-15T09:59:59.999Z');
    expect((stale.chunks[0] as string).slice(0, -1)).not.toContain('\n');
    expect(readFileSync(checkpointStatePath(projectDir)).equals(before)).toBe(true);

    const fresh = captureStderr();
    const accepted = await updateStoreExtras(
      projectDir,
      { blocks: 2 },
      { stderr: fresh, expectedState: 'armed', expectedSince: T0 },
    );
    expect(accepted).toEqual({ ok: true, state: 'armed' });
    expect(onDisk()).toEqual({ state: 'armed', since: T0, blocks: 2 });
    expect(fresh.chunks).toEqual([]);
  });
});
