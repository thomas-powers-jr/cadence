import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { createSettleDiffProvider } from '../../src/services/settle-diff.js';

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

async function repoWithCommittedTaskWork(): Promise<string> {
  active = await tempRepo({ initialized: true, projectName: 'settle_diff' });
  const root = active.root;
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@cadence.local']);
  git(root, ['config', 'user.name', 'Cadence Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['checkout', '-q', '-b', 'main']);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src/impl.ts'), 'export const v = 0;\n');
  git(root, ['add', 'src']);
  git(root, ['commit', '-q', '-m', 'base']);
  git(root, ['checkout', '-q', '-b', 'phase-branch']);
  await writeFile(join(root, 'src/impl.ts'), 'export const v = 1; // committed task work\n');
  git(root, ['add', 'src']);
  git(root, ['commit', '-q', '-m', 'T1']);
  return root;
}

// Issue #501 / phase 307: settle's review gates read ctx.diff(); a phase whose
// tasks were committed as they landed must still be visible to them.
describe('createSettleDiffProvider (phase 307)', () => {
  it('307-01/AC-3: a clean tree with committed task work yields that work, with no notice', async () => {
    const root = await repoWithCommittedTaskWork();
    const errs: string[] = [];
    const diff = createSettleDiffProvider(root, ['src/impl.ts'], 'main', (s) => errs.push(s));
    expect(diff()).toContain('committed task work');
    expect(errs).toEqual([]);
  });

  it('307-01/AC-2: an unresolvable integration ref writes one notice naming the ref and the HEAD fallback', async () => {
    const root = await repoWithCommittedTaskWork();
    const errs: string[] = [];
    const diff = createSettleDiffProvider(root, ['src/impl.ts'], 'no-such-trunk', (s) => errs.push(s));
    expect(diff()).toBe('');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('no-such-trunk');
    expect(errs[0]).toMatch(/HEAD/);
  });

  it('307-01/AC-3: a resolved merge-base with an empty diff writes one notice, memoized across reads', async () => {
    const root = await repoWithCommittedTaskWork();
    // A branch whose declared file is unchanged against a merge-base that is
    // not HEAD: only an undeclared file was committed.
    git(root, ['checkout', '-q', '-b', 'other-phase', 'main']);
    await writeFile(join(root, 'src/unrelated.ts'), 'export const u = 1;\n');
    git(root, ['add', 'src']);
    git(root, ['commit', '-q', '-m', 'unrelated']);
    const errs: string[] = [];
    const diff = createSettleDiffProvider(root, ['src/impl.ts'], 'main', (s) => errs.push(s));
    expect(diff()).toBe('');
    expect(diff()).toBe('');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/empty/);
    expect(errs[0]).toContain('main');
  });

  it('307-01/AC-3: a merge-base equal to HEAD with leftover uncommitted edits still writes a notice', async () => {
    const root = await repoWithCommittedTaskWork();
    // Working directly on the integration ref: the committed task work is
    // already on `main`, so merge-base(main, HEAD) is HEAD itself.
    git(root, ['branch', '-f', 'main', 'HEAD']);
    git(root, ['checkout', '-q', 'main']);
    await writeFile(join(root, 'src/impl.ts'), 'export const v = 2; // leftover edit\n');
    const errs: string[] = [];
    const diff = createSettleDiffProvider(root, ['src/impl.ts'], 'main', (s) => errs.push(s));
    expect(diff()).toContain('+export const v = 2; // leftover edit');
    // The committed change is not presented as added work — only as the old
    // side of the uncommitted edit.
    expect(diff()).not.toContain('+export const v = 1; // committed task work');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/HEAD/);
    expect(errs[0]).toContain('main');
  });

  it('307-01/AC-3: a git failure while diffing writes one notice', async () => {
    const root = await repoWithCommittedTaskWork();
    const errs: string[] = [];
    // An invalid pathspec magic makes `git diff` itself exit non-zero.
    const diff = createSettleDiffProvider(root, [':(no-such-magic)src/impl.ts'], 'main', (s) => errs.push(s));
    expect(diff()).toBe('');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/failed/);
  });

  it('307-01/AC-3: a provider no gate reads writes nothing, and a non-git directory is silent', async () => {
    const root = await repoWithCommittedTaskWork();
    const unreadErrs: string[] = [];
    createSettleDiffProvider(root, ['src/impl.ts'], 'no-such-trunk', (s) => unreadErrs.push(s));
    expect(unreadErrs).toEqual([]);

    const nonGit = await tempRepo({ initialized: true, projectName: 'settle_diff_nogit' });
    try {
      const errs: string[] = [];
      const diff = createSettleDiffProvider(nonGit.root, ['src/impl.ts'], 'main', (s) => errs.push(s));
      expect(diff()).toBe('');
      expect(errs).toEqual([]);
    } finally {
      await nonGit.cleanup();
    }
  });
});
