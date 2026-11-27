import { describe, it, expect, afterEach } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';

// Phase 355 (355-01, T2): `cadence build task` names an upstream-failed
// merge-base on stderr instead of calling git unavailable, and keeps the
// git-unavailable line where there is no git repository (rec-20261125-003).

const CADENCE_CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');

function run(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    ...(input !== undefined ? { input } : {}),
    stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'ignore'],
  });
}

/** One commit on the current branch, and an orphan refs/remotes/origin/main. */
function makeOrphanUpstream(root: string): void {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@cadence.local']);
  git(root, ['config', 'user.name', 'Cadence Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init', '--allow-empty']);
  const emptyTree = git(root, ['hash-object', '-t', 'tree', '-w', '--stdin'], '').trim();
  const orphan = git(root, ['commit-tree', emptyTree, '-m', 'orphan'], '').trim();
  git(root, ['update-ref', 'refs/remotes/origin/main', orphan]);
}

const SKIPPED_LINE =
  'build task: boundary/redundancy check skipped: the merge-base of origin/main and HEAD could not be computed; ' +
  'no working-tree changes are visible — falling back to the self-reported touchedFiles';
const GIT_UNAVAILABLE_LINE =
  'build task: boundary/redundancy check skipped: git unavailable (no base ref resolved and no working-tree ' +
  'changes visible) — falling back to the self-reported touchedFiles';

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

describe('build task base notice (phase 355)', () => {
  it('355-01/AC-3: an orphan origin/main is named as a merge-base failure, not git unavailable', async () => {
    active = await tempRepo({ initialized: true });
    makeOrphanUpstream(active.root);
    await run(['draft', 'new', '01-foundation', '01', '--title=Demo'], active.root);
    await run(['draft', 'approve', '01-foundation', '01'], active.root);
    const outside = git(active.root, ['status', '--porcelain', '--untracked-files=all'])
      .split('\n')
      .filter((l) => l && !l.slice(3).startsWith('.cadence/'));
    expect(outside).toStrictEqual([]);

    const r = await run(['build', 'task', 'T1', '--status=DONE'], active.root);

    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Recorded T1: DONE/);
    expect(r.stderr).toContain(SKIPPED_LINE);
    expect(r.stderr).not.toContain('git unavailable');
  });

  it('355-01/AC-4: without a git repository the git-unavailable line is kept', async () => {
    active = await tempRepo({ initialized: true });
    expect(existsSync(join(active.root, '.git'))).toBe(false);
    await run(['draft', 'new', '01-foundation', '01', '--title=Demo'], active.root);
    await run(['draft', 'approve', '01-foundation', '01'], active.root);

    const r = await run(['build', 'task', 'T1', '--status=DONE'], active.root);

    expect(r.code).toBe(0);
    expect(r.stderr).toContain(GIT_UNAVAILABLE_LINE);
  });
});
