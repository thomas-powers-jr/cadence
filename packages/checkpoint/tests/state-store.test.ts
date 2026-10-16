import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpointStatePath, readMachineState, transitionStore } from '../src/state.js';
import type { CheckpointState } from '../src/state.js';

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
