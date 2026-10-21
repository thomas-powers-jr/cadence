import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shared from '../../../../vitest.shared';

// 333-01 (phase 333) — vitest.shared.ts's worker count is a core-aware upper
// bound, not a flat 12. The flat value took 3-4 vCPU CI runners *above*
// vitest's own default (cores - 1) and ran ~9.8 tests at once on every leg,
// which is what pushed the multi-spawn CLI tests past the 20s budget on the
// 3-vCPU macOS runner (rec-20261008-005, rec-20260918-004). The module is
// imported, not read as text, so the wiring assertion checks the value vitest
// actually receives.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

// Read through the namespace so a missing export fails the assertions below
// instead of failing module load (which would also take down AC-3).
const resolveMaxWorkers = (shared as { resolveMaxWorkers?: (cores: number) => number })
  .resolveMaxWorkers;
const config = shared.default as {
  test: {
    maxWorkers?: unknown;
    testTimeout?: unknown;
    hookTimeout?: unknown;
    pool?: unknown;
    coverage?: { enabled?: unknown };
  };
};

describe('core-aware vitest worker cap — real vitest.shared.ts (333-01)', () => {
  it('333-01/AC-1: resolveMaxWorkers returns the core count up to 12, caps at 12, and floors at 1', () => {
    expect(typeof resolveMaxWorkers).toBe('function');
    const cases: Array<[number, number]> = [
      [1, 1],
      [2, 2],
      [3, 3], // macos-26-arm64 runner
      [4, 4], // ubuntu-24.04 and windows runners
      [11, 11],
      [12, 12],
      [13, 12],
      [16, 12],
      [24, 12],
      [0, 1],
      [-2, 1],
    ];
    for (const [cores, expected] of cases) {
      expect(resolveMaxWorkers!(cores), `resolveMaxWorkers(${cores})`).toBe(expected);
    }
  });

  it("333-01/AC-2: the shared config's maxWorkers is resolveMaxWorkers(availableParallelism()), with no flat numeric maxWorkers line left", () => {
    expect(typeof resolveMaxWorkers).toBe('function');
    expect(config.test.maxWorkers).toBe(resolveMaxWorkers!(availableParallelism()));
    const source = readFileSync(join(ROOT, 'vitest.shared.ts'), 'utf8');
    // Line-anchored so the comment explaining the old `maxWorkers: 12` does
    // not trip the check — only a config-object line setting a bare number.
    expect(source).not.toMatch(/^\s*maxWorkers:\s*\d+\s*,/m);
    expect(source).toMatch(/^\s*maxWorkers:\s*resolveMaxWorkers\(availableParallelism\(\)\),/m);
  });

  it('333-01/AC-3: timeouts, pool and coverage around the worker cap are unchanged', () => {
    const expectedTimeout = process.platform === 'win32' ? 90000 : 20000;
    expect(config.test.testTimeout).toBe(expectedTimeout);
    expect(config.test.hookTimeout).toBe(expectedTimeout);
    expect(config.test.pool).toBe('forks');
    expect(config.test.coverage?.enabled).toBe(true);
  });
});
