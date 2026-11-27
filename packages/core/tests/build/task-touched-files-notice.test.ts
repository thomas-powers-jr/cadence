import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveTaskTouchedFiles, touchedFilesNotice } from '../../src/build/task-touched-files.js';

// Phase 355 (355-01, T1): build task's record-time check names an
// upstream-failed merge-base instead of calling git unavailable
// (rec-20261125-003).

const BASE = 'the merge-base of origin/main and HEAD could not be computed';
const SHALLOW = ', and this is a shallow clone (run git fetch --unshallow origin, or --deepen=<n>)';
const skipped = (suffix: string): string =>
  `build task: boundary/redundancy check skipped: ${BASE}${suffix}; no working-tree changes are visible — ` +
  'falling back to the self-reported touchedFiles';
const partial = (suffix: string): string =>
  `build task: ${BASE}${suffix}; the boundary/redundancy check sees working-tree changes only`;
const GIT_UNAVAILABLE =
  'build task: boundary/redundancy check skipped: git unavailable (no base ref resolved and no working-tree ' +
  'changes visible) — falling back to the self-reported touchedFiles';

describe('touchedFilesNotice (phase 355)', () => {
  const at = (
    baseSource: 'upstream' | 'local' | 'upstream-failed' | 'none',
    shallow: boolean,
    deltaEmpty: boolean,
  ): string | null => touchedFilesNotice({ baseSource, shallow, deltaEmpty, integrationRef: 'main' });

  it('355-01/AC-1: (a) upstream-failed with no delta gives the skipped line', () => {
    expect(at('upstream-failed', false, true)).toBe(skipped(''));
  });
  it('355-01/AC-1: (b) upstream-failed in a shallow clone with no delta gives the skipped line with the suffix', () => {
    expect(at('upstream-failed', true, true)).toBe(skipped(SHALLOW));
  });
  it('355-01/AC-1: (c) upstream-failed with a delta gives the partial line', () => {
    expect(at('upstream-failed', false, false)).toBe(partial(''));
  });
  it('355-01/AC-1: (d) none with no delta keeps the git-unavailable line', () => {
    expect(at('none', false, true)).toBe(GIT_UNAVAILABLE);
  });
  it('355-01/AC-1: (e) none with a delta prints nothing', () => {
    expect(at('none', false, false)).toBeNull();
  });
  it('355-01/AC-1: (f) upstream with no delta prints nothing', () => {
    expect(at('upstream', false, true)).toBeNull();
  });
  it('355-01/AC-1: (g) upstream-failed in a shallow clone with a delta gives the partial line with the suffix', () => {
    expect(at('upstream-failed', true, false)).toBe(partial(SHALLOW));
  });
});

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    ...(input !== undefined ? { input } : {}),
    stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'ignore'],
  });
}

const roots: string[] = [];
afterEach(async () => {
  while (roots.length) {
    await rm(roots.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }
});

describe('deriveTaskTouchedFiles base source (phase 355)', () => {
  it('355-01/AC-2: an orphan origin/main yields baseSource upstream-failed and shallow false', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'cadence-orphan-upstream-')));
    roots.push(root);
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'Test']);
    git(root, ['config', 'commit.gpgsign', 'false']);
    await writeFile(join(root, 'README.md'), '# test\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'init']);
    const emptyTree = git(root, ['hash-object', '-t', 'tree', '-w', '--stdin'], '').trim();
    const orphan = git(root, ['commit-tree', emptyTree, '-m', 'orphan'], '').trim();
    git(root, ['update-ref', 'refs/remotes/origin/main', orphan]);

    expect(await deriveTaskTouchedFiles(root, 'main', new Set())).toStrictEqual({
      delta: [],
      baseRefResolved: false,
      baseSource: 'upstream-failed',
      shallow: false,
    });
  });
});
