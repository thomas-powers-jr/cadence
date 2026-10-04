// packages/core/src/phases/latest-settled.ts
//
// Latest-settled-phase lookup (phase 322, rec-20261004-002). `state.activePhase`
// is per-checkout and survives `settle`, so an IDLE primary checkout keeps
// naming whatever phase was last settled *in that checkout*. The phase
// directories on disk are the repo-wide fact: this module derives the latest
// SETTLED phase from them.
//
// The settled discriminator is `stateAtSettle`: only the successful settle path
// (`finalizeAndCloseSettle`) writes it into `<draftId>-SUMMARY.json`. A refused
// settle also writes the canonical `-SUMMARY.json` (`writeRefusedSettleSummary`),
// but without `stateAtSettle` — so a refused SUMMARY never counts as settled.
//
// Pure selector + pure discriminator, plus a best-effort impure finder that
// never throws (observation code degrades to "no information").

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { phaseNumber } from './collision.js';

/** One phase directory, as seen by the selector. */
export interface PhaseSettledEntry {
  /** The phase-directory name (e.g. `322-idle-status-names-the-latest-settled-phase`). */
  name: string;
  /** Whether the directory holds at least one settled SUMMARY (see `isSettledSummary`). */
  settled: boolean;
}

/** Order by phase number descending, then name descending. Null-number names must be filtered first. */
function compareDesc(a: { name: string; n: number }, b: { name: string; n: number }): number {
  if (a.n !== b.n) return b.n - a.n;
  return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
}

/** Number the given names, dropping any whose name has no leading phase number. */
function numbered(names: readonly string[]): { name: string; n: number }[] {
  const out: { name: string; n: number }[] = [];
  for (const name of names) {
    const n = phaseNumber(name);
    if (n !== null) out.push({ name, n });
  }
  return out;
}

/**
 * Pure (phase 322): the name of the settled entry with the highest integer phase
 * number (`phaseNumber()`), ties broken by the lexicographically greatest name.
 * Entries that are unsettled or whose name has no phase number are ignored.
 * Returns null when none qualify.
 */
export function selectLatestSettledPhase(entries: readonly PhaseSettledEntry[]): string | null {
  const candidates = numbered(entries.filter((e) => e.settled).map((e) => e.name));
  candidates.sort(compareDesc);
  return candidates[0]?.name ?? null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Pure (phase 322): true iff `raw` (a parsed `-SUMMARY.json`) is a non-null,
 * non-array object whose `stateAtSettle` is a non-null, non-array object.
 * `stateAtSettle` is written only by the successful settle path, so this is
 * what separates a settled SUMMARY from a refused one.
 */
export function isSettledSummary(raw: unknown): boolean {
  return isPlainObject(raw) && isPlainObject(raw['stateAtSettle']);
}

/** Best-effort: does this phase directory hold any settled `*-SUMMARY.json`? Never throws. */
async function dirHasSettledSummary(dir: string): Promise<boolean> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return false;
  }
  for (const file of files) {
    // Exactly `-SUMMARY.json` — refused-attempt `*-SUMMARY-snapshot*` siblings are ignored.
    if (!file.endsWith('-SUMMARY.json')) continue;
    try {
      const raw: unknown = JSON.parse(await readFile(join(dir, file), 'utf8'));
      if (isSettledSummary(raw)) return true;
    } catch {
      // Unreadable or malformed SUMMARY: contributes nothing.
    }
  }
  return false;
}

/**
 * Impure, best-effort (phase 322, rec-20261004-002): the latest settled phase
 * under `<root>/.cadence/phases/`. Directories are examined from the highest
 * phase number downward (then name descending) and the scan stops at the first
 * one holding a settled SUMMARY — it does not read every directory. Non-numeric
 * names and plain files are skipped. Any failure (missing directory, unreadable
 * entries) yields null; this function never throws.
 */
export async function findLatestSettledPhase(root: string): Promise<string | null> {
  try {
    const phasesDir = join(root, '.cadence', 'phases');
    const entries = await readdir(phasesDir, { withFileTypes: true });
    const dirs = numbered(entries.filter((e) => e.isDirectory()).map((e) => e.name));
    dirs.sort(compareDesc);
    for (const { name } of dirs) {
      if (await dirHasSettledSummary(join(phasesDir, name))) return name;
    }
    return null;
  } catch {
    return null;
  }
}
