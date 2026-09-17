import { collectPhaseDiff } from '../git/diff.js';

/**
 * Phase 307 (issue #501): the memoized `SettleContext.diff()` closure.
 *
 * Diffs the declared files against the merge-base with the integration ref,
 * so a phase whose tasks were committed as they landed is still visible to
 * `deep-verify`, `code-review`, and `security-audit`. The git work runs on the
 * first read only — a settle whose gate set never reads the diff pays nothing
 * and prints nothing. Every path that would hand a gate a misleading diff
 * writes one stderr notice instead of degrading silently:
 * - no merge-base resolved (fell back to the uncommitted-only `HEAD` diff);
 * - the diff command failed;
 * - the merge-base is HEAD itself (working directly on the integration ref),
 *   whether or not uncommitted edits make the diff non-empty;
 * - a merge-base resolved but the diff is empty.
 * Never-added untracked files are not part of any `git diff` basis.
 */
export function createSettleDiffProvider(
  cwd: string,
  touchedFiles: string[],
  integrationRef: string,
  err: (s: string) => void,
): () => string {
  let memo: string | undefined;
  return () => {
    if (memo !== undefined) return memo;
    const { diff, basis } = collectPhaseDiff(cwd, touchedFiles, integrationRef);
    memo = diff;
    if (basis === 'head-fallback') {
      err(
        `settle: could not resolve a merge-base against \`origin/${integrationRef}\` or \`${integrationRef}\` ` +
          '(phaseGuard.integrationRef) — review gates see only uncommitted changes (`git diff HEAD`), ' +
          'so committed phase work is invisible to them.\n',
      );
    } else if (basis === 'git-error') {
      err(
        `settle: \`git diff\` against \`${integrationRef}\`'s merge-base failed — review gates receive an empty diff.\n`,
      );
    } else if (basis === 'base-is-head') {
      err(
        `settle: HEAD has no commits beyond \`${integrationRef}\`, so review gates see only uncommitted ` +
          `changes — if any task work was already committed onto \`${integrationRef}\`, it is not in the review diff.\n`,
      );
    } else if (basis === 'merge-base' && diff.length === 0) {
      err(
        `settle: the diff of the declared files against the merge-base with \`${integrationRef}\` is empty — ` +
          `if this phase's commits are already on \`${integrationRef}\`, review gates cannot see its work.\n`,
      );
    }
    return memo;
  };
}
