import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Wrap the real `readFile` in a spy so the finder's stop-early behaviour is
// observable (which SUMMARY files it actually opened). Every call still
// delegates to the real implementation.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return { ...actual, readFile: vi.fn(actual.readFile), readdir: vi.fn(actual.readdir) };
});

import {
  selectLatestSettledPhase,
  isSettledSummary,
  findLatestSettledPhase,
} from '../../src/phases/latest-settled.js';

const SETTLED = {
  stateAtSettle: { loopPositionBeforeSettle: 'BUILD', revision: 1, sessionSubagentSpawns: 0 },
  acResults: [],
};
const REFUSED = { acResults: [], gates: [] };

describe('selectLatestSettledPhase (pure)', () => {
  it('322-01/AC-1: returns the settled entry with the highest phase number', () => {
    expect(
      selectLatestSettledPhase([
        { name: '3-a', settled: true },
        { name: '12-b', settled: true },
        { name: '9-c', settled: true },
      ]),
    ).toBe('12-b');
  });

  it('322-01/AC-1: ignores unsettled entries even when their number is higher', () => {
    expect(
      selectLatestSettledPhase([
        { name: '3-a', settled: true },
        { name: '5-b', settled: false },
      ]),
    ).toBe('3-a');
  });

  it('322-01/AC-1: breaks a phase-number tie by the lexicographically greatest name', () => {
    expect(
      selectLatestSettledPhase([
        { name: '7-alpha', settled: true },
        { name: '7-zeta', settled: true },
        { name: '7-mid', settled: true },
      ]),
    ).toBe('7-zeta');
  });

  it('322-01/AC-1: ignores names with no phase number', () => {
    expect(
      selectLatestSettledPhase([
        { name: 'notes', settled: true },
        { name: '2-a', settled: true },
        { name: 'zzz', settled: true },
      ]),
    ).toBe('2-a');
    expect(selectLatestSettledPhase([{ name: 'notes', settled: true }])).toBeNull();
  });

  it('322-01/AC-1: returns null when no entry is settled', () => {
    expect(
      selectLatestSettledPhase([
        { name: '3-a', settled: false },
        { name: '4-b', settled: false },
      ]),
    ).toBeNull();
  });

  it('322-01/AC-1: returns null for an empty list', () => {
    expect(selectLatestSettledPhase([])).toBeNull();
  });
});

describe('isSettledSummary (pure)', () => {
  it('322-01/AC-1: is true for a SUMMARY carrying a stateAtSettle object', () => {
    expect(
      isSettledSummary({
        stateAtSettle: { loopPositionBeforeSettle: 'BUILD', revision: 1, sessionSubagentSpawns: 0 },
      }),
    ).toBe(true);
  });

  it('322-01/AC-1: is false for a refused SUMMARY shape (no stateAtSettle)', () => {
    expect(isSettledSummary({ acResults: [], gates: [] })).toBe(false);
  });

  it('322-01/AC-1: is false for null, arrays, primitives, and a null/array stateAtSettle', () => {
    expect(isSettledSummary(null)).toBe(false);
    expect(isSettledSummary(undefined)).toBe(false);
    expect(isSettledSummary([])).toBe(false);
    expect(isSettledSummary([{ stateAtSettle: {} }])).toBe(false);
    expect(isSettledSummary('stateAtSettle')).toBe(false);
    expect(isSettledSummary(42)).toBe(false);
    expect(isSettledSummary(true)).toBe(false);
    expect(isSettledSummary({ stateAtSettle: null })).toBe(false);
    expect(isSettledSummary({ stateAtSettle: [] })).toBe(false);
    expect(isSettledSummary({ stateAtSettle: 'BUILD' })).toBe(false);
  });
});

describe('findLatestSettledPhase (impure, best-effort)', () => {
  let root: string;

  async function phase(name: string, files: Record<string, string>): Promise<void> {
    const dir = join(root, '.cadence', 'phases', name);
    await mkdir(dir, { recursive: true });
    for (const [file, body] of Object.entries(files)) {
      await writeFile(join(dir, file), body);
    }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cadence-latest-settled-'));
    vi.mocked(readFile).mockClear();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('322-01/AC-1: skips refused, malformed, snapshot-only, non-numeric dirs and stray files', async () => {
    await phase('3-a', { '3-01-SUMMARY.json': JSON.stringify(SETTLED) });
    await phase('5-b', { '5-01-SUMMARY.json': JSON.stringify(REFUSED) });
    await phase('4-c', { '4-01-SUMMARY.json': '{ not json' });
    await phase('6-d', { '6-01-SUMMARY-snapshot-x.json': JSON.stringify(SETTLED) });
    await phase('notes', { 'notes-SUMMARY.json': JSON.stringify(SETTLED) });
    await writeFile(join(root, '.cadence', 'phases', 'README.md'), '# phases\n');

    expect(await findLatestSettledPhase(root)).toBe('3-a');
  });

  it('322-01/AC-1: returns null when .cadence/phases is missing', async () => {
    expect(await findLatestSettledPhase(root)).toBeNull();
    expect(await findLatestSettledPhase(join(root, 'does-not-exist'))).toBeNull();
  });

  it('322-01/AC-1: returns null when no directory holds a settled SUMMARY', async () => {
    await phase('5-b', { '5-01-SUMMARY.json': JSON.stringify(REFUSED) });
    await phase('6-c', { 'README.md': 'nothing here' });
    expect(await findLatestSettledPhase(root)).toBeNull();
  });

  it('322-01/AC-1: settles on any settled SUMMARY in a dir with several slices', async () => {
    await phase('8-multi', {
      '8-01-SUMMARY.json': JSON.stringify(REFUSED),
      '8-02-SUMMARY.json': JSON.stringify(SETTLED),
    });
    await phase('2-a', { '2-01-SUMMARY.json': JSON.stringify(SETTLED) });
    expect(await findLatestSettledPhase(root)).toBe('8-multi');
  });

  it('322-01/AC-1: the finder breaks a phase-number tie between settled dirs by the greatest name', async () => {
    await phase('7-alpha', { '7-01-SUMMARY.json': JSON.stringify(SETTLED) });
    await phase('7-zeta', { '7-01-SUMMARY.json': JSON.stringify(SETTLED) });
    await phase('6-a', { '6-01-SUMMARY.json': JSON.stringify(SETTLED) });
    expect(await findLatestSettledPhase(root)).toBe('7-zeta');
  });

  it('322-01/AC-1: returns the highest settled dir and stops without reading lower dirs', async () => {
    await phase('3-a', { '3-01-SUMMARY.json': JSON.stringify(SETTLED) });
    await phase('9-z', { '9-01-SUMMARY.json': JSON.stringify(SETTLED) });
    await phase('10-refused', { '10-01-SUMMARY.json': JSON.stringify(REFUSED) });

    expect(await findLatestSettledPhase(root)).toBe('9-z');

    const readPaths = vi.mocked(readFile).mock.calls.map((c) => String(c[0]));
    expect(readPaths.some((p) => p.includes('10-01-SUMMARY.json'))).toBe(true);
    expect(readPaths.some((p) => p.includes('9-01-SUMMARY.json'))).toBe(true);
    expect(readPaths.some((p) => p.includes('3-01-SUMMARY.json'))).toBe(false);
  });

  it('322-01/AC-1: an unreadable phase directory is skipped, not fatal — the scan continues to lower dirs', async () => {
    await phase('3-a', { '3-01-SUMMARY.json': JSON.stringify(SETTLED) });
    await phase('9-locked', { '9-01-SUMMARY.json': JSON.stringify(SETTLED) });
    const original = vi.mocked(readdir).getMockImplementation();
    expect(original).toBeDefined();
    // Portable stand-in for an unreadable directory (chmod does not work on Windows).
    vi.mocked(readdir).mockImplementation(((path: unknown, ...rest: unknown[]) =>
      String(path).endsWith('9-locked')
        ? Promise.reject(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }))
        : (original as (...a: unknown[]) => unknown)(path, ...rest)) as typeof readdir);
    try {
      expect(await findLatestSettledPhase(root)).toBe('3-a');
    } finally {
      vi.mocked(readdir).mockImplementation(original as typeof readdir);
    }
  });
});
