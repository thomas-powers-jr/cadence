import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  AcEvidenceZ,
  AssuranceRecordZ,
  GateProvenanceZ,
  GateZ,
  SummaryZ,
  type AcEvidence,
  type AssuranceRecord,
  type Gate,
  type GateProvenance,
  type Summary,
} from '@thomas-powers-jr/cadence-types';
import { deriveAssuranceRecord } from '../gates/assurance-record.js';
import { walkFilesWithSuffix } from '../verify/historical-coverage-audit.js';

// ---------------------------------------------------------------------------
// Phase 327 (T1, rec-20261010-002): the corpus loader behind `cadence
// assurance report`. Read-only by construction — nothing in this file opens
// a file for writing.
// ---------------------------------------------------------------------------

/** One readable, schema-valid `SUMMARY.json` in the corpus. */
export interface AssuranceCorpusRecord {
  /** Phase directory name under `.cadence/phases/` (e.g. `'140-summary-gate-provenance'`). */
  phase: string;
  /** The phase directory's leading integer (e.g. `140`). */
  phaseNumber: number;
  /** The `<id>` prefix of `<id>-SUMMARY.json` (e.g. `'140-01'`). */
  id: string;
  /** Repo-root-relative, forward-slashed path to the `SUMMARY.json`. */
  path: string;
  summary: Summary;
}

/** A `SUMMARY.json` the report could not use, named by path with the reason. */
export interface AssuranceUnreadableRecord {
  phase: string;
  id: string;
  /** Repo-root-relative, forward-slashed path. */
  path: string;
  reason: string;
}

export type ParsedSummaryRecord =
  | { ok: true; record: AssuranceCorpusRecord }
  | { ok: false; unreadable: AssuranceUnreadableRecord };

export interface AssuranceCorpus {
  records: AssuranceCorpusRecord[];
  unreadable: AssuranceUnreadableRecord[];
}

const PHASES_PREFIX = '.cadence/phases/';
const SUMMARY_SUFFIX = '-SUMMARY.json';

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Parse one corpus file — `relPath` is repo-relative (either separator), and
 * `text` is its raw contents. Pure: the same `(relPath, text)` always gives
 * the same result. The order mirrors `auditHistoricalCoverage`'s
 * read/parse/validate sequence (JSON.parse in a try/catch, then
 * `SummaryZ.safeParse`), so a record that one corpus command can read the
 * other can too. A phase directory with no leading integer is unreadable
 * here rather than carrying a `NaN` phase number into the report's sorts
 * and `--since` window.
 */
export function parseSummaryRecord(relPath: string, text: string): ParsedSummaryRecord {
  const path = relPath.split('\\').join('/');
  const underPhases = path.startsWith(PHASES_PREFIX) ? path.slice(PHASES_PREFIX.length) : path;
  // A file directly under `.cadence/phases/` has no phase directory; leave
  // `phase` empty so its file name is never mistaken for one.
  const phase = underPhases.includes('/') ? (underPhases.split('/')[0] ?? '') : '';
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  const id = fileName.endsWith(SUMMARY_SUFFIX) ? fileName.slice(0, -SUMMARY_SUFFIX.length) : fileName;
  const unreadable = (reason: string): ParsedSummaryRecord => ({
    ok: false,
    unreadable: { phase, id, path, reason },
  });

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return unreadable(`SUMMARY.json is not valid JSON: ${errMessage(err)}`);
  }
  const parsed = SummaryZ.safeParse(json);
  if (!parsed.success) {
    return unreadable(`SUMMARY.json does not match the expected SUMMARY schema: ${parsed.error.message}`);
  }
  if (!underPhases.includes('/')) {
    return unreadable('SUMMARY.json is not inside a phase directory');
  }
  const leading = /^(\d+)/.exec(phase);
  if (!leading) {
    return unreadable(`phase directory "${phase}" has no leading phase number`);
  }
  return {
    ok: true,
    record: { phase, phaseNumber: Number(leading[1]), id, path, summary: parsed.data },
  };
}

/**
 * Load every `SUMMARY.json` under `<repoRoot>/.cadence/phases`, walked with
 * `walkFilesWithSuffix` (the phase 261 walker, exported for this — not a
 * fourth walker). Best-effort per "Best-effort introspection never throws":
 * a missing `.cadence/phases` is an empty corpus, and a file that can't be
 * read is an unreadable entry. `-SUMMARY-snapshot.json` refused-attempt
 * siblings don't end in `-SUMMARY.json`, so they are never corpus records.
 * `readText` is the file-read seam (defaults to a UTF-8 `readFileSync`).
 */
export function loadAssuranceCorpus(
  repoRoot: string,
  readText: (absPath: string) => string = (absPath) => readFileSync(absPath, 'utf8'),
): AssuranceCorpus {
  const records: AssuranceCorpusRecord[] = [];
  const unreadable: AssuranceUnreadableRecord[] = [];
  for (const absPath of walkFilesWithSuffix(join(repoRoot, '.cadence', 'phases'), SUMMARY_SUFFIX)) {
    const relPath = relative(repoRoot, absPath).split(sep).join('/');
    let text: string;
    try {
      text = readText(absPath);
    } catch (err) {
      // Node's fs errors embed the absolute path; swap it for the repo-relative
      // one so the report never carries a machine-specific path (AC-7).
      const reason = errMessage(err).split(absPath).join(relPath);
      const res = parseSummaryRecord(relPath, '');
      if (!res.ok) unreadable.push({ ...res.unreadable, reason: `could not read SUMMARY.json: ${reason}` });
      continue;
    }
    const res = parseSummaryRecord(relPath, text);
    if (res.ok) records.push(res.record);
    else unreadable.push(res.unreadable);
  }
  return { records, unreadable };
}

// ---------------------------------------------------------------------------
// Phase 327 (T2): the pure report computation. No clock, no I/O, no reliance
// on input order — every list is sorted here, by phase number then path, so
// the output is byte-identical across runs and platforms (AC-7).
// ---------------------------------------------------------------------------

export const ASSURANCE_REPORT_SCHEMA_VERSION = 1;

export type AssuranceGrade = AssuranceRecord['overall'];
export type ProviderSelection = NonNullable<GateProvenance['providerSelection']>;

/** Every grade level, provider-selection value, evidence class and gate comes
 *  from the Zod enums, so each row exists (at 0) whatever the window, and the
 *  report can't drift from the schema. */
const GRADES: readonly AssuranceGrade[] = AssuranceRecordZ.shape.overall.options;
const PROVIDER_SELECTIONS: readonly ProviderSelection[] =
  GateProvenanceZ.shape.providerSelection.unwrap().options;
const EVIDENCE_CLASSES: readonly AcEvidence[] = AcEvidenceZ.options;
const GATES: readonly Gate[] = GateZ.options;

export interface AssuranceCategory {
  count: number;
  /** Lowest phase number in the category, or `null` when it is empty. */
  firstPhase: number | null;
  /** Highest phase number in the category, or `null` when it is empty. */
  lastPhase: number | null;
  reason: string;
}

export interface AssuranceRecordRef {
  id: string;
  path: string;
}

export interface AssuranceGradeDelta extends AssuranceRecordRef {
  stored: AssuranceGrade;
  rederived: AssuranceGrade;
}

export interface AssuranceGateRow {
  gate: Gate;
  /** Records with at least one entry for this gate whose status is `ran`. */
  ran: number;
  /** Records with entries for this gate, none of them `ran`. */
  skipped: number;
  /** Records that carry gate provenance but no entry for this gate. */
  notRecorded: number;
}

export interface AssuranceReport {
  schemaVersion: typeof ASSURANCE_REPORT_SCHEMA_VERSION;
  window: { since: number | null };
  totals: { files: number; settled: number; refused: number; unreadable: number };
  categories: {
    unGradable: AssuranceCategory;
    neverGraded: AssuranceCategory & { afterFirstGraded: AssuranceRecordRef[] };
    graded: AssuranceCategory;
  };
  grades: {
    stored: Record<AssuranceGrade, number>;
    rederived: Record<AssuranceGrade, number>;
    delta: AssuranceGradeDelta[];
  };
  /** Settled records that carry gate provenance — the denominator of every gate row. */
  provenanceRecords: number;
  gates: AssuranceGateRow[];
  /** Counted over gate entries, not records. */
  providerSelection: Record<ProviderSelection, number>;
  recordsWithBypasses: number;
  /** Sum of each graded record's stored `assurance.evidenceTally`. */
  evidenceTally: Record<AcEvidence, number>;
  refused: AssuranceRecordRef[];
  unreadable: { path: string; reason: string }[];
}

export interface AssuranceReportOptions {
  /** Keep only records whose phase number is at least this (numeric compare). */
  since?: number;
}

const UN_GRADABLE_REASON =
  'no gate provenance: the record has no gates[] entries, so nothing says which gates ran';
const NEVER_GRADED_REASON =
  'gate provenance but no assurance block: the settle that wrote it did not derive an assurance record';
const GRADED_REASON = 'stored assurance block present';

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byPhaseThenPath(a: AssuranceCorpusRecord, b: AssuranceCorpusRecord): number {
  return a.phaseNumber !== b.phaseNumber ? a.phaseNumber - b.phaseNumber : comparePaths(a.path, b.path);
}

function category(records: readonly AssuranceCorpusRecord[], reason: string): AssuranceCategory {
  const first = records[0];
  const last = records[records.length - 1];
  return {
    count: records.length,
    firstPhase: first !== undefined ? first.phaseNumber : null,
    lastPhase: last !== undefined ? last.phaseNumber : null,
    reason,
  };
}

function ref(r: AssuranceCorpusRecord): AssuranceRecordRef {
  return { id: r.id, path: r.path };
}

/** The leading phase number of an unreadable entry's directory, if it has one. */
function unreadablePhaseNumber(u: AssuranceUnreadableRecord): number | null {
  const m = /^(\d+)/.exec(u.phase);
  return m ? Number(m[1]) : null;
}

/**
 * Compute the corpus-wide assurance report. Pure: the same records, in any
 * order, give the same report. Classification, in order:
 * 1. **refused** — any gate entry with `status: 'refused'` (only written when
 *    a gate halts the settle, `gates/registry.ts`); excluded from everything
 *    below.
 * 2. **graded** — a stored `assurance` block.
 * 3. **never graded** — gate provenance but no `assurance` block.
 * 4. **un-gradable** — no gate provenance at all.
 * Stored grades are reported as written; re-derived grades apply today's
 * `deriveAssuranceRecord` to graded records only (dec-20261010-002) — never
 * to never-graded records, whose inputs predate fields the rule reads.
 * Unreadable entries are windowed by their directory's leading number when
 * they have one, and always reported when they don't (they can't be placed).
 */
export function computeAssuranceReport(
  records: readonly AssuranceCorpusRecord[],
  unreadable: readonly AssuranceUnreadableRecord[],
  opts: AssuranceReportOptions,
): AssuranceReport {
  const since = opts.since ?? null;
  const inWindow = records
    .filter((r) => since === null || r.phaseNumber >= since)
    .sort(byPhaseThenPath);
  // Ordered like records — phase number, then path — with entries whose
  // directory has no leading number after every numbered one.
  const unreadableInWindow = unreadable
    .map((u) => ({ n: unreadablePhaseNumber(u), path: u.path, reason: u.reason }))
    .filter((u) => since === null || u.n === null || u.n >= since)
    .sort((a, b) => {
      if (a.n !== b.n) return a.n === null ? 1 : b.n === null ? -1 : a.n - b.n;
      return comparePaths(a.path, b.path);
    })
    .map((u) => ({ path: u.path, reason: u.reason }));

  const refused: AssuranceCorpusRecord[] = [];
  const settled: AssuranceCorpusRecord[] = [];
  const graded: AssuranceCorpusRecord[] = [];
  const neverGraded: AssuranceCorpusRecord[] = [];
  const unGradable: AssuranceCorpusRecord[] = [];
  for (const r of inWindow) {
    const gates = r.summary.gates ?? [];
    if (gates.some((g) => g.status === 'refused')) {
      refused.push(r);
      continue;
    }
    settled.push(r);
    if (r.summary.assurance !== undefined) graded.push(r);
    else if (gates.length > 0) neverGraded.push(r);
    else unGradable.push(r);
  }
  const withProvenance = settled.filter((r) => (r.summary.gates ?? []).length > 0);

  const stored = zeroed(GRADES);
  const rederived = zeroed(GRADES);
  const delta: AssuranceGradeDelta[] = [];
  const evidenceTally = zeroed(EVIDENCE_CLASSES);
  for (const r of graded) {
    const assurance = r.summary.assurance!;
    stored[assurance.overall] += 1;
    const again = deriveAssuranceRecord(r.summary.gates ?? [], r.summary.acResults, {
      gateBypasses: r.summary.gateBypasses ?? [],
      ...(r.summary.deepVerify !== undefined ? { deepVerify: r.summary.deepVerify } : {}),
    });
    rederived[again.overall] += 1;
    if (again.overall !== assurance.overall) {
      delta.push({ ...ref(r), stored: assurance.overall, rederived: again.overall });
    }
    for (const k of EVIDENCE_CLASSES) evidenceTally[k] += assurance.evidenceTally[k];
  }

  const gates: AssuranceGateRow[] = GATES.map((gate) => {
    const row: AssuranceGateRow = { gate, ran: 0, skipped: 0, notRecorded: 0 };
    // Per record: `ran` if any of its entries for this gate ran (a gate such
    // as per-task-verify may write one entry per task), else `skipped` if it
    // has one, else not recorded.
    for (const r of withProvenance) {
      const entries = (r.summary.gates ?? []).filter((g) => g.gate === gate);
      if (entries.length === 0) row.notRecorded += 1;
      else if (entries.some((g) => g.status === 'ran')) row.ran += 1;
      else row.skipped += 1;
    }
    return row;
  });

  const providerSelection = zeroed(PROVIDER_SELECTIONS);
  for (const r of settled) {
    for (const g of r.summary.gates ?? []) {
      if (g.providerSelection !== undefined) providerSelection[g.providerSelection] += 1;
    }
  }

  const firstGraded = graded[0]?.phaseNumber;
  return {
    schemaVersion: ASSURANCE_REPORT_SCHEMA_VERSION,
    window: { since },
    totals: {
      files: inWindow.length + unreadableInWindow.length,
      settled: settled.length,
      refused: refused.length,
      unreadable: unreadableInWindow.length,
    },
    categories: {
      unGradable: category(unGradable, UN_GRADABLE_REASON),
      neverGraded: {
        ...category(neverGraded, NEVER_GRADED_REASON),
        afterFirstGraded:
          firstGraded === undefined
            ? []
            : neverGraded.filter((r) => r.phaseNumber >= firstGraded).map(ref),
      },
      graded: category(graded, GRADED_REASON),
    },
    grades: { stored, rederived, delta },
    provenanceRecords: withProvenance.length,
    gates,
    providerSelection,
    recordsWithBypasses: settled.filter((r) => (r.summary.gateBypasses ?? []).length > 0).length,
    evidenceTally,
    refused: refused.map(ref),
    unreadable: unreadableInWindow,
  };
}
