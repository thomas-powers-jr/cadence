// packages/core/src/handoff/retention.ts
//
// Handoff retention (Phase 88, v1.20). `selectPrunable` is the pure, I/O-free
// core: given SESSION-*.md filenames, a keep-count, the current (lastHandoff)
// filename and the git-tracked names, it decides which docs to prune.
// `pruneHandoffDir` is its impure companion that reads the dir, asks git which
// docs are tracked (best-effort), and unlinks the selection; both prune entry
// points (run-handoff and the doctor --fix handoff-retention repair) call it.
// Phase 335: a git-tracked SESSION doc is never pruned.
import { execFile } from 'node:child_process';
import { readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

/**
 * Return the filenames to prune: everything except the newest `keep` docs by
 * lexicographic-descending order. The `current` (lastHandoff) filename is
 * ALWAYS retained — a belt-and-suspenders invariant so the active handoff can
 * never be deleted, even if it would otherwise fall outside the newest `keep`.
 * A name in `tracked` (a git-tracked doc, phase 335) is never returned either;
 * it is filtered out after the keep window is applied, so it does not shift
 * which docs the window keeps. With `tracked` empty (the default) the result
 * is exactly the pre-phase-335 selection.
 *
 * Lexicographic-descending order is deterministic and offline: SESSION names
 * carry an ISO date prefix (`SESSION-YYYY-MM-DD[-label].md`), so descending
 * string order is chronological at day granularity, with intra-day label ties
 * broken alphabetically. The returned list preserves that descending order.
 *
 * Pure: no filesystem access, no side effects.
 */
export function selectPrunable(
  filenames: readonly string[],
  keep: number,
  current: string,
  tracked: ReadonlySet<string> = new Set(),
): string[] {
  const descending = [...filenames].sort().reverse();
  const retained = new Set(descending.slice(0, Math.max(0, keep)));
  retained.add(current);
  return descending.filter((name) => !retained.has(name) && !tracked.has(name));
}

const SESSION_RE = /^SESSION-.*\.md$/;

const pexecFile = promisify(execFile);

/**
 * Names of the files git tracks directly in the handoff `dir`, via
 * `git ls-files -z -- .` run in `dir` — a read-only shell-out with a fixed arg
 * array (never a shell string), mirroring `listTrackedCadenceOwnedPaths`.
 * Paths come back relative to `dir` with `/` separators on every platform;
 * anything in a subdirectory is dropped so it cannot shadow a top-level doc of
 * the same name. Staged-but-uncommitted docs count as tracked (`ls-files`
 * reports the index). Returns `null` — never throws — when the lookup fails
 * (not a git repository, git unavailable, timeout), so the caller degrades to
 * no protection.
 */
async function listTrackedHandoffDocs(dir: string): Promise<ReadonlySet<string> | null> {
  try {
    const { stdout } = await pexecFile('git', ['ls-files', '-z', '--', '.'], {
      cwd: dir,
      timeout: 5000,
      windowsHide: true,
    });
    return new Set(stdout.split('\0').filter((path) => path.length > 0 && !path.includes('/')));
  } catch {
    return null;
  }
}

/** Injectable seams for `pruneHandoffDir` (phase 335). */
export interface PruneDeps {
  /** Tracked basenames in `dir`, or `null` when unknown. Default: `listTrackedHandoffDocs`. */
  listTracked?: (dir: string) => Promise<ReadonlySet<string> | null>;
  /** Where the kept-tracked-docs notice goes. Default: `process.stderr`. */
  stderr?: (text: string) => void;
}

/**
 * Impure companion to `selectPrunable`: read the handoff `dir`, select the
 * `SESSION-*.md` docs to prune (keeping the newest `retain` plus `current`,
 * and every git-tracked doc), `unlink` them, and return the pruned filenames.
 * The tracked lookup is best-effort: a lister that throws or returns `null`
 * protects nothing, which is the pre-phase-335 behavior. When the budget would
 * have pruned at least one tracked doc, one stderr line names how many were
 * kept. The callers (run-handoff, the doctor --fix repair) invoke this
 * best-effort; run-handoff swallows any throw so it never fails a handoff
 * write. The first three parameters match run-handoff's injectable `prune` seam.
 */
export async function pruneHandoffDir(
  dir: string,
  retain: number,
  current: string,
  deps: PruneDeps = {},
): Promise<string[]> {
  const entries = await readdir(dir);
  const sessions = entries.filter((n) => SESSION_RE.test(n));
  // Nothing past the budget: skip the git lookup entirely.
  const overBudget = selectPrunable(sessions, retain, current);
  if (overBudget.length === 0) return [];
  let tracked: ReadonlySet<string> | null = null;
  try {
    tracked = await (deps.listTracked ?? listTrackedHandoffDocs)(dir);
  } catch {
    tracked = null;
  }
  const protectedNames = tracked ?? new Set<string>();
  const toPrune = selectPrunable(sessions, retain, current, protectedNames);
  const kept = overBudget.filter((name) => protectedNames.has(name)).length;
  for (const name of toPrune) {
    await unlink(join(dir, name));
  }
  if (kept > 0) {
    const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));
    stderr(
      `handoff: kept ${kept} git-tracked SESSION doc(s) past handoff.retain; committed SESSION docs are kept, sweep them in a housekeeping PR\n`,
    );
  }
  return toPrune;
}
