// packages/core/src/build/task-touched-files.ts
//
// Phase 280 (T7): first-sighting semantics on top of
// `collectUnscopedTouchedFiles`. `collectUnscopedTouchedFiles` returns the
// PHASE's cumulative touched-file set (a merge-base diff + all working-tree
// changes) -- this set never shrinks as a phase progresses. If a later
// task's boundary check re-ran that raw set, every file a DONE task ever
// touched would get re-flagged as a boundary violation on every subsequent
// recording, forever -- a growing false-positive flood. The fix: subtract
// everything already attributed to a previously-recorded task, so a stray
// file is only ever flagged once, at the recording that first observes it.

import {
  collectUnscopedTouchedFiles,
  filterCadenceSelfWrites,
  type MergeBaseSource,
} from '../git/boundary-diff.js';

export interface DeriveTaskTouchedFilesResult {
  delta: string[];
  baseRefResolved: boolean;
  /** Phase 355: where the merge-base came from (phase 351's `resolveMergeBase`). */
  baseSource: MergeBaseSource;
  /** Phase 355: on `upstream-failed`, whether the repo is a shallow clone; else `false`. */
  shallow: boolean;
}

/**
 * Derive the set of files newly touched since the last recorded task: the
 * phase's unscoped touched-file set (`.cadence/**` self-writes excluded),
 * minus every file already attributed to a previously-recorded task.
 */
export async function deriveTaskTouchedFiles(
  cwd: string,
  integrationRef: string,
  previouslyRecorded: Set<string>,
): Promise<DeriveTaskTouchedFilesResult> {
  const { files, baseRefResolved, baseSource, shallow } = await collectUnscopedTouchedFiles(cwd, integrationRef);
  const filtered = filterCadenceSelfWrites(files);
  const delta = filtered.filter((f) => !previouslyRecorded.has(f));
  return { delta, baseRefResolved, baseSource, shallow };
}

export interface TouchedFilesNoticeInput {
  baseSource: MergeBaseSource;
  shallow: boolean;
  /** No newly attributable change: the delta after previously-recorded files are subtracted. */
  deltaEmpty: boolean;
  integrationRef: string;
}

const GIT_UNAVAILABLE_NOTICE =
  'build task: boundary/redundancy check skipped: git unavailable ' +
  '(no base ref resolved and no working-tree changes visible) — ' +
  'falling back to the self-reported touchedFiles';

/**
 * Phase 355 (rec-20261125-003): the stderr line `build task`'s record-time
 * boundary/redundancy check prints about its diff base, or `null` for none.
 * Pure. An `upstream-failed` merge-base (origin/<ref> resolves but shares no
 * computable merge-base with HEAD, e.g. a shallow clone) is named as such,
 * with the same fix the settle-time boundary-scan refusal names; the
 * git-unavailable line is kept for the `none` source. No trailing newline.
 */
export function touchedFilesNotice(input: TouchedFilesNoticeInput): string | null {
  if (input.baseSource === 'upstream-failed') {
    const base =
      `the merge-base of origin/${input.integrationRef} and HEAD could not be computed` +
      (input.shallow ? ', and this is a shallow clone (run git fetch --unshallow origin, or --deepen=<n>)' : '');
    return input.deltaEmpty
      ? `build task: boundary/redundancy check skipped: ${base}; no working-tree changes are visible — ` +
          'falling back to the self-reported touchedFiles'
      : `build task: ${base}; the boundary/redundancy check sees working-tree changes only`;
  }
  if (input.baseSource === 'none' && input.deltaEmpty) return GIT_UNAVAILABLE_NOTICE;
  return null;
}
