import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { collectGitDiff, collectPhaseDiff, resolveMergeBaseSync } from '../../src/git/diff.js';

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

function git(root: string, args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

describe('collectGitDiff', () => {
  it('AC-2: passes file paths as argv, not shell-interpolated text', async () => {
    active = await tempRepo({ initialized: true, projectName: 'diff_argv' });
    const root = active.root;
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'test@cadence.local']);
    git(root, ['config', 'user.name', 'Cadence Test']);
    git(root, ['config', 'commit.gpgsign', 'false']);

    await mkdir(join(root, 'src'), { recursive: true });
    const rel = 'src/a & b.test.ts';
    await writeFile(join(root, rel), 'export const value = 1;\n');
    git(root, ['add', rel]);
    git(root, ['commit', '-q', '-m', 'init']);

    await writeFile(join(root, rel), 'export const value = 2; // AC-2\n');

    const diff = collectGitDiff(root, [rel]);
    expect(diff).toContain('a & b.test.ts');
    expect(diff).toContain('AC-2');
  });
});

async function initRepoOnMain(root: string): Promise<void> {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@cadence.local']);
  git(root, ['config', 'user.name', 'Cadence Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['checkout', '-q', '-b', 'main']);
  await mkdir(join(root, 'src'), { recursive: true });
  for (const f of ['a', 'b', 'c']) {
    await writeFile(join(root, 'src', `${f}.ts`), `export const ${f} = 0;\n`);
  }
  git(root, ['add', 'src']);
  git(root, ['commit', '-q', '-m', 'base']);
}

// Issue #501 / phase 307: settle's review diff must include the phase's
// committed work, not only uncommitted working-tree changes.
describe('collectPhaseDiff (phase 307)', () => {
  it('307-01/AC-1: includes committed-since-divergence and uncommitted changes to declared files only', async () => {
    active = await tempRepo({ initialized: true, projectName: 'phase_diff' });
    const root = active.root;
    await initRepoOnMain(root);
    git(root, ['checkout', '-q', '-b', 'feature']);
    await writeFile(join(root, 'src/a.ts'), 'export const a = 1; // committed-A\n');
    await writeFile(join(root, 'src/c.ts'), 'export const c = 1; // committed-C-undeclared\n');
    git(root, ['add', 'src']);
    git(root, ['commit', '-q', '-m', 'task work']);
    await writeFile(join(root, 'src/b.ts'), 'export const b = 1; // uncommitted-B\n');

    expect(resolveMergeBaseSync(root, 'main')).toMatch(/^[0-9a-f]{40}$/);
    const res = collectPhaseDiff(root, ['src/a.ts', 'src/b.ts'], 'main');
    expect(res.basis).toBe('merge-base');
    expect(res.diff).toContain('committed-A');
    expect(res.diff).toContain('uncommitted-B');
    expect(res.diff).not.toContain('committed-C-undeclared');
    // The pre-fix basis misses the committed change entirely.
    expect(collectGitDiff(root, ['src/a.ts', 'src/b.ts'])).not.toContain('committed-A');
  });

  it('307-01/AC-2: falls back to the HEAD diff when no integration ref resolves, and reports it', async () => {
    active = await tempRepo({ initialized: true, projectName: 'phase_diff_nobase' });
    const root = active.root;
    await initRepoOnMain(root);
    await writeFile(join(root, 'src/b.ts'), 'export const b = 2; // uncommitted\n');

    expect(resolveMergeBaseSync(root, 'trunk-does-not-exist')).toBeNull();
    const res = collectPhaseDiff(root, ['src/b.ts'], 'trunk-does-not-exist');
    expect(res.basis).toBe('head-fallback');
    expect(res.diff).toBe(collectGitDiff(root, ['src/b.ts']));
    expect(res.diff).toContain('uncommitted');
  });

  it('307-01/AC-2: a directory that is not a git work tree yields an empty diff with basis not-a-repo', async () => {
    active = await tempRepo({ initialized: true, projectName: 'phase_diff_nogit' });
    const res = collectPhaseDiff(active.root, ['src/a.ts'], 'main');
    expect(res).toEqual({ diff: '', basis: 'not-a-repo' });
  });
});
