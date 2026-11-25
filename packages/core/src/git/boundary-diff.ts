// packages/core/src/git/boundary-diff.ts
//
// Unscoped git-diff enumeration for the settle-time `boundary-scan` gate
// (phase 156). Unlike `ctx.touchedFiles`/`ctx.diff()`, which are pre-scoped to
// the active draft's declared `files:` set, this enumerates every file
// touched by the whole phase — committed-since-divergence plus working-tree
// changes — so the gate can catch an out-of-boundary edit that never passed
// through the declared-files scope (e.g. a subagent-driven edit).

import { gitBestEffort } from './worktrees.js';

export interface UnscopedTouchedFiles {
  files: string[];
  /** `true` exactly when `baseSource` is `upstream` or `local`. */
  baseRefResolved: boolean;
  /** Which ref the committed-since-divergence diff was taken against. */
  baseSource: MergeBaseSource;
  /** The merge-base sha the diff used, or `null` when none was used. */
  baseSha: string | null;
  /** On `upstream-failed`, whether the repo is a shallow clone; else `false`. */
  shallow: boolean;
}

/**
 * Where a merge-base came from:
 * - `upstream`: `origin/<integrationRef>` (after at most one retry).
 * - `local`: the local `<integrationRef>`, used only when the remote-tracking
 *   ref `refs/remotes/origin/<integrationRef>` does not resolve.
 * - `upstream-failed`: the remote-tracking ref resolves but its merge-base
 *   with `HEAD` could not be computed (twice); the local ref is NOT consulted.
 * - `none`: neither the upstream nor the local ref yielded a merge-base.
 */
export type MergeBaseSource = 'upstream' | 'local' | 'upstream-failed' | 'none';

export type MergeBaseResolution =
  | { base: string; source: 'upstream' | 'local' }
  | { base: null; source: 'none' }
  | { base: null; source: 'upstream-failed'; shallow: boolean };

/** A git runner: stdout untrimmed, `''` on non-zero exit, timeout or spawn failure. */
export type GitRunner = (root: string, args: string[]) => Promise<string>;

export const CADENCE_DIR_PREFIX = '.cadence/';

/**
 * Drop `.cadence/**` self-writes from a touched-files list — the settle-time
 * `boundary-scan` gate's own state writes (`state.json`, `STATE.md`, phase
 * artifacts, etc.) are never a boundary violation.
 */
export function filterCadenceSelfWrites(files: string[]): string[] {
  return files.filter((f) => f !== '.cadence' && !f.startsWith(CADENCE_DIR_PREFIX));
}

/**
 * Parse one `git status --porcelain` line into its path. Strips the 2-char
 * status code + 1-space prefix; for a rename/copy line (`R  old -> new`),
 * takes only the destination path — matching `git diff --name-only`'s own
 * default (renames-on) behavior of reporting the destination.
 */
function parsePorcelainPath(line: string): string | null {
  if (line.length < 4) return null;
  const rest = line.slice(3);
  const arrow = rest.indexOf(' -> ');
  return arrow === -1 ? rest : rest.slice(arrow + 4);
}

/**
 * Resolve a merge-base for the boundary scan. Asks for the merge-base of
 * `origin/<integrationRef>` and `HEAD`, retrying once on an empty answer.
 * If both attempts are empty, checks whether the remote-tracking ref exists:
 * when it does, the failure is reported as `upstream-failed` (with whether
 * this is a shallow clone) rather than silently diffing against a possibly
 * stale local ref; when it does not, falls back to the local
 * `<integrationRef>`. Every answer is trimmed. Never throws as long as `git`
 * does not (the default `gitBestEffort` never does).
 */
export async function resolveMergeBase(
  root: string,
  integrationRef: string,
  git: GitRunner = gitBestEffort,
): Promise<MergeBaseResolution> {
  const upstreamArgs = ['merge-base', `origin/${integrationRef}`, 'HEAD'];
  let upstream = (await git(root, upstreamArgs)).trim();
  if (!upstream) upstream = (await git(root, upstreamArgs)).trim();
  if (upstream) return { base: upstream, source: 'upstream' };

  const upstreamRef = (
    await git(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${integrationRef}`])
  ).trim();
  if (upstreamRef) {
    const shallow = (await git(root, ['rev-parse', '--is-shallow-repository'])).trim() === 'true';
    return { base: null, source: 'upstream-failed', shallow };
  }

  const local = (await git(root, ['merge-base', integrationRef, 'HEAD'])).trim();
  return local ? { base: local, source: 'local' } : { base: null, source: 'none' };
}

/**
 * Enumerate every file touched by the current phase: the union of (a)
 * committed-since-divergence files (`git diff --name-only <merge-base>
 * HEAD`, only when a base ref resolves) and (b) working-tree
 * modified/added/untracked files (`git status --porcelain
 * --untracked-files=all`, always attempted). Never throws — every git call
 * goes through the best-effort `gitBestEffort` helper.
 */
export async function collectUnscopedTouchedFiles(
  root: string,
  integrationRef: string,
): Promise<UnscopedTouchedFiles> {
  const resolution = await resolveMergeBase(root, integrationRef);
  const mergeBase = resolution.base;
  const files = new Set<string>();

  if (mergeBase) {
    const diff = await gitBestEffort(root, ['diff', '--name-only', mergeBase, 'HEAD']);
    for (const line of diff.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }
  }

  const status = await gitBestEffort(root, ['status', '--porcelain', '--untracked-files=all']);
  for (const line of status.split('\n')) {
    if (!line) continue;
    const path = parsePorcelainPath(line);
    if (path) files.add(path);
  }

  return {
    files: [...files],
    baseRefResolved: resolution.source === 'upstream' || resolution.source === 'local',
    baseSource: resolution.source,
    baseSha: mergeBase,
    shallow: resolution.source === 'upstream-failed' ? resolution.shallow : false,
  };
}
