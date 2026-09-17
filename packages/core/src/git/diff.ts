import { execFileSync } from 'node:child_process';

const DIFF_MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Collect `git diff --no-color HEAD -- <files>` without invoking a shell.
 * Returns empty string outside git workdirs, on no diff, or on git failure.
 */
export function collectGitDiff(cwd: string, files: string[]): string {
  if (files.length === 0) return '';
  try {
    return execFileSync('git', ['diff', '--no-color', 'HEAD', '--', ...files], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: DIFF_MAX_BUFFER,
    });
  } catch {
    return '';
  }
}

/** Run a short git query; trimmed stdout, or `null` on any failure. */
function gitQuery(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Synchronous merge-base of `HEAD` against `origin/<integrationRef>`, falling
 * back to a local `<integrationRef>` (no remote, shallow clone). Same
 * resolution order as `boundary-diff.ts`'s async `resolveMergeBase`, kept sync
 * because `SettleContext.diff()` is synchronous. `null` if neither resolves.
 */
export function resolveMergeBaseSync(cwd: string, integrationRef: string): string | null {
  return (
    gitQuery(cwd, ['merge-base', `origin/${integrationRef}`, 'HEAD']) ??
    gitQuery(cwd, ['merge-base', integrationRef, 'HEAD'])
  );
}

/**
 * Which basis `collectPhaseDiff` used:
 * - `merge-base`: committed-since-divergence plus working-tree changes to
 *   tracked files (never-added untracked files are not included).
 * - `base-is-head`: the merge-base is `HEAD` itself (e.g. working directly on
 *   the integration ref), so any committed phase work is already on the ref
 *   and only working-tree changes are visible.
 * - `head-fallback`: no integration ref resolved; working-tree changes only.
 * - `git-error`: the diff command itself failed (e.g. `maxBuffer` overflow).
 * - `no-commits`: the repo has no commits yet, so there is nothing to diff
 *   against (the pre-307 `HEAD` diff was silently empty here too).
 * - `not-a-repo`: not inside a git work tree.
 * - `no-files`: nothing declared to diff.
 */
export type PhaseDiffBasis =
  | 'merge-base'
  | 'base-is-head'
  | 'head-fallback'
  | 'git-error'
  | 'no-commits'
  | 'not-a-repo'
  | 'no-files';

export interface PhaseDiff {
  diff: string;
  basis: PhaseDiffBasis;
}

/**
 * Phase 307 (issue #501): the settle-time review diff for a phase —
 * `git diff --no-color <merge-base> -- <files>`, which covers the phase's
 * committed work as well as uncommitted changes to tracked files. Falls back
 * to the `HEAD` diff when no merge-base resolves. Never throws; the `basis`
 * tells the caller which path was taken so a fallback is never silent.
 */
export function collectPhaseDiff(cwd: string, files: string[], integrationRef: string): PhaseDiff {
  if (files.length === 0) return { diff: '', basis: 'no-files' };
  if (gitQuery(cwd, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    return { diff: '', basis: 'not-a-repo' };
  }
  const head = gitQuery(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (!head) return { diff: '', basis: 'no-commits' };
  const mergeBase = resolveMergeBaseSync(cwd, integrationRef);
  const basis: PhaseDiffBasis = !mergeBase
    ? 'head-fallback'
    : mergeBase === head
      ? 'base-is-head'
      : 'merge-base';
  try {
    const diff = execFileSync('git', ['diff', '--no-color', mergeBase ?? 'HEAD', '--', ...files], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: DIFF_MAX_BUFFER,
    });
    return { diff, basis };
  } catch {
    return { diff: '', basis: 'git-error' };
  }
}
