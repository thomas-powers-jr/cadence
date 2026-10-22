import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneHandoffDir, selectPrunable } from '../../src/handoff/retention.js';

describe('selectPrunable (AC-2)', () => {
  const docs = [
    'SESSION-2026-06-05.md',
    'SESSION-2026-06-06.md',
    'SESSION-2026-06-07.md',
    'SESSION-2026-06-08.md',
  ];

  it('AC-2: keeps the newest N by lexicographic-descending order, prunes the rest', () => {
    const prune = selectPrunable(docs, 2, 'SESSION-2026-06-08.md');
    expect(prune.sort()).toEqual(['SESSION-2026-06-05.md', 'SESSION-2026-06-06.md']);
  });

  it('AC-2: returns [] when candidates are within the keep-count', () => {
    expect(selectPrunable(docs, 4, 'SESSION-2026-06-08.md')).toEqual([]);
    expect(selectPrunable(docs, 10, 'SESSION-2026-06-08.md')).toEqual([]);
  });

  it('AC-2: never prunes the current (lastHandoff) doc even when it is the oldest', () => {
    // current is the oldest; keep=1 would otherwise drop everything but the newest.
    const prune = selectPrunable(docs, 1, 'SESSION-2026-06-05.md');
    expect(prune).not.toContain('SESSION-2026-06-05.md');
    // newest is kept by recency, current is kept by force → both survive.
    expect(prune.sort()).toEqual(['SESSION-2026-06-06.md', 'SESSION-2026-06-07.md']);
  });

  it('AC-2: keep-count counts the current doc — current + (N-1) newest survive', () => {
    // current is newest already; keep=2 → current + next-newest survive, oldest two prune.
    const prune = selectPrunable(docs, 2, 'SESSION-2026-06-08.md');
    expect(prune).toHaveLength(2);
  });

  it('AC-2: deterministic — intra-day label ties break alphabetically', () => {
    const sameDay = [
      'SESSION-2026-06-08-alpha.md',
      'SESSION-2026-06-08-bravo.md',
      'SESSION-2026-06-08-charlie.md',
    ];
    const prune = selectPrunable(sameDay, 1, 'SESSION-2026-06-08-charlie.md');
    // newest lexicographically is 'charlie' (also current) → alpha + bravo prune.
    expect(prune).toEqual(['SESSION-2026-06-08-bravo.md', 'SESSION-2026-06-08-alpha.md']);
  });

  it('AC-2: empty input returns []', () => {
    expect(selectPrunable([], 3, 'SESSION-2026-06-08.md')).toEqual([]);
  });
});

// Phase 335: git-tracked SESSION docs are never pruned.
describe('selectPrunable with a tracked set (335-01)', () => {
  const docs = [
    'SESSION-2026-06-05.md',
    'SESSION-2026-06-06.md',
    'SESSION-2026-06-07.md',
    'SESSION-2026-06-08.md',
  ];
  const sameDay = [
    'SESSION-2026-06-08-alpha.md',
    'SESSION-2026-06-08-bravo.md',
    'SESSION-2026-06-08-charlie.md',
  ];
  // The pre-phase fixtures above, in the exact order selectPrunable returns.
  const pinned: [readonly string[], number, string, string[]][] = [
    [docs, 2, 'SESSION-2026-06-08.md', ['SESSION-2026-06-06.md', 'SESSION-2026-06-05.md']],
    [docs, 4, 'SESSION-2026-06-08.md', []],
    [docs, 10, 'SESSION-2026-06-08.md', []],
    [docs, 1, 'SESSION-2026-06-05.md', ['SESSION-2026-06-07.md', 'SESSION-2026-06-06.md']],
    [sameDay, 1, 'SESSION-2026-06-08-charlie.md', ['SESSION-2026-06-08-bravo.md', 'SESSION-2026-06-08-alpha.md']],
    [[], 3, 'SESSION-2026-06-08.md', []],
  ];

  it('335-01/AC-4: without a tracked set, or with an empty one, output equals the pre-phase selection', () => {
    for (const [names, keep, current, expected] of pinned) {
      expect(selectPrunable(names, keep, current)).toEqual(expected);
      expect(selectPrunable(names, keep, current, new Set())).toEqual(expected);
    }
  });

  it('335-01/AC-4: a tracked name is never returned, while the current invariant and descending order hold', () => {
    const six = [
      'SESSION-2026-06-01.md',
      'SESSION-2026-06-02.md',
      'SESSION-2026-06-03.md',
      'SESSION-2026-06-04.md',
      'SESSION-2026-06-05.md',
      'SESSION-2026-06-06.md',
    ];
    const tracked = new Set(['SESSION-2026-06-05.md', 'SESSION-2026-06-02.md']);
    // keep=1 retains 06; current 03 is force-retained; 05 and 02 are tracked.
    expect(selectPrunable(six, 1, 'SESSION-2026-06-03.md', tracked)).toEqual([
      'SESSION-2026-06-04.md',
      'SESSION-2026-06-01.md',
    ]);
    // Tracked names inside the keep window (08) or absent from the input are
    // filtered after the window, so the window does not shift: still [06, 05].
    expect(selectPrunable(docs, 2, 'SESSION-2026-06-08.md', new Set(['SESSION-2026-06-08.md', 'other.md']))).toEqual([
      'SESSION-2026-06-06.md',
      'SESSION-2026-06-05.md',
    ]);
  });
});

describe('pruneHandoffDir with tracked docs (335-01)', () => {
  // Newest (05) is untracked and is the current doc; 02 and 03 are tracked.
  const FIVE = [
    'SESSION-2026-06-01.md',
    'SESSION-2026-06-02.md',
    'SESSION-2026-06-03.md',
    'SESSION-2026-06-04.md',
    'SESSION-2026-06-05.md',
  ];
  const NEWEST = 'SESSION-2026-06-05.md';
  const TRACKED = ['SESSION-2026-06-02.md', 'SESSION-2026-06-03.md'];
  const NOTICE_2 =
    'handoff: kept 2 git-tracked SESSION doc(s) past handoff.retain; committed SESSION docs are kept, sweep them in a housekeeping PR\n';

  function seedDir(names: readonly string[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'cadence-retention-'));
    for (const n of names) writeFileSync(join(dir, n), '');
    return dir;
  }

  it('335-01/AC-1: tracked docs stay on disk and only untracked docs beyond the budget are pruned', async () => {
    const dir = seedDir(FIVE);
    try {
      const listedDirs: string[] = [];
      const pruned = await pruneHandoffDir(dir, 1, NEWEST, {
        listTracked: async (d) => {
          listedDirs.push(d);
          return new Set(TRACKED);
        },
        stderr: () => {},
      });
      expect(listedDirs).toEqual([dir]);
      expect(pruned).toEqual(['SESSION-2026-06-04.md', 'SESSION-2026-06-01.md']);
      expect(readdirSync(dir).sort()).toEqual([...TRACKED, NEWEST].sort());
      for (const n of TRACKED) expect(existsSync(join(dir, n))).toBe(true);
      expect(existsSync(join(dir, NEWEST))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('335-01/AC-2: nothing over budget skips the tracked lookup and prunes nothing', async () => {
    const dir = seedDir(FIVE);
    try {
      let listed = 0;
      const err: string[] = [];
      const pruned = await pruneHandoffDir(dir, 5, NEWEST, {
        listTracked: async () => {
          listed += 1;
          return new Set(TRACKED);
        },
        stderr: (t) => err.push(t),
      });
      expect(pruned).toEqual([]);
      expect(listed).toBe(0);
      expect(err).toEqual([]);
      expect(readdirSync(dir).sort()).toEqual([...FIVE].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('335-01/AC-2: a lister that throws or resolves null leaves the pre-phase prune and prints nothing', async () => {
    const listers = [
      async (): Promise<ReadonlySet<string> | null> => {
        throw new Error('not a git repository');
      },
      async (): Promise<ReadonlySet<string> | null> => null,
    ];
    for (const listTracked of listers) {
      const dir = seedDir(FIVE);
      try {
        const err: string[] = [];
        const pruned = await pruneHandoffDir(dir, 1, NEWEST, { listTracked, stderr: (t) => err.push(t) });
        expect(pruned).toEqual([
          'SESSION-2026-06-04.md',
          'SESSION-2026-06-03.md',
          'SESSION-2026-06-02.md',
          'SESSION-2026-06-01.md',
        ]);
        expect(readdirSync(dir)).toEqual([NEWEST]);
        expect(err).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('335-01/AC-3: exactly one notice when tracked docs fall outside the budget', async () => {
    const dir = seedDir(FIVE);
    try {
      const err: string[] = [];
      await pruneHandoffDir(dir, 1, NEWEST, {
        listTracked: async () => new Set(TRACKED),
        stderr: (t) => err.push(t),
      });
      expect(err).toEqual([NOTICE_2]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('335-01/AC-3: no notice when the only tracked doc is inside the budget, or none is tracked', async () => {
    const cases: [number, ReadonlySet<string>, string[]][] = [
      // keep=2 retains 05 and 04, so the tracked 04 was never a prune candidate.
      [2, new Set(['SESSION-2026-06-04.md']), ['SESSION-2026-06-03.md', 'SESSION-2026-06-02.md', 'SESSION-2026-06-01.md']],
      [1, new Set(), ['SESSION-2026-06-04.md', 'SESSION-2026-06-03.md', 'SESSION-2026-06-02.md', 'SESSION-2026-06-01.md']],
    ];
    for (const [retain, tracked, expected] of cases) {
      const dir = seedDir(FIVE);
      try {
        const err: string[] = [];
        const pruned = await pruneHandoffDir(dir, retain, NEWEST, {
          listTracked: async () => tracked,
          stderr: (t) => err.push(t),
        });
        expect(pruned).toEqual(expected);
        expect(err).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
