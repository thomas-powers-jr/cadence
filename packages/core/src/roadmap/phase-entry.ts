/**
 * Pure per-phase roadmap entry check (phase 320, rec-20261004-001).
 *
 * Answers "does ROADMAP.md / MILESTONES.md carry an entry for phase N?"
 * using the same heading conventions `checkRoadmapCurrency` in
 * `doctor/run.ts` scans for. No I/O: the caller reads the files and passes
 * their text (or `null` when a file is absent).
 */

/** ROADMAP.md convention: a `### Phase <digits>` heading per phase. */
export const ROADMAP_PHASE_HEADING = /^### Phase (\d+)/gm;

/** MILESTONES.md convention: a `- **Phase <digits>**` bullet per phase. */
export const MILESTONES_PHASE_BULLET = /^\s*-\s+\*\*Phase (\d+)/gm;

export type RoadmapEntryFile = 'ROADMAP.md' | 'MILESTONES.md';

export interface MissingRoadmapEntriesInput {
  phaseNumber: number;
  roadmapText: string | null;
  milestonesText: string | null;
}

/**
 * True when `text` uses the convention (at least one match) but no match's
 * number equals `phaseNumber` exactly. A `null` text or a text with zero
 * convention matches is never "missing" — the project does not use the
 * convention there (e.g. the `cadence init` stub). A fresh `RegExp` is built
 * per call so the shared constant's `g`-flag `lastIndex` never leaks.
 */
function lacksEntry(text: string | null, pattern: RegExp, phaseNumber: number): boolean {
  if (text === null) return false;
  const numbers = [...text.matchAll(new RegExp(pattern.source, pattern.flags))].map((m) =>
    Number.parseInt(m[1] ?? '', 10),
  );
  return numbers.length > 0 && !numbers.includes(phaseNumber);
}

/**
 * Returns the roadmap files (in `ROADMAP.md`, `MILESTONES.md` order) that
 * use their phase convention but have no entry whose number equals
 * `phaseNumber` (integer equality: `### Phase 32` never satisfies 320).
 */
export function missingRoadmapEntries(input: MissingRoadmapEntriesInput): RoadmapEntryFile[] {
  const missing: RoadmapEntryFile[] = [];
  if (lacksEntry(input.roadmapText, ROADMAP_PHASE_HEADING, input.phaseNumber)) {
    missing.push('ROADMAP.md');
  }
  if (lacksEntry(input.milestonesText, MILESTONES_PHASE_BULLET, input.phaseNumber)) {
    missing.push('MILESTONES.md');
  }
  return missing;
}
