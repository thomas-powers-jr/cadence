// packages/core/src/state/snapshot.ts
//
// Pure planners for `cadence state save | load | list` (phase 341, T2). No I/O,
// no clock, no `os`: time, host, versions, file lists, raw parsed JSON and
// existence facts all arrive as arguments. The impure service (T3) gathers
// those facts, calls these, and prints refusal reasons verbatim to stderr.
//
// A snapshot is a committed file that can arrive from anyone through a branch,
// so `planStateLoad` treats it as untrusted: every path-bearing field is
// checked before any existence fact is consulted, and `--force` never
// overrides that check.

import {
  CadenceStateZ,
  type CadenceState,
  type StateSnapshot,
} from '@thomas-powers-jr/cadence-types';
import { assertSafePhaseSlug } from '../phases/id.js';

/** Number of `state-*.json` snapshots `save` keeps. A constant, not config
 *  (YAGNI: recorded in DESIGN.md as dropped, not deferred). */
export const SNAPSHOT_KEEP = 3;

const HOST_MAX = 40;
const SNAPSHOT_NAME_RE = /^state-.*\.json$/;
const PLAIN_IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HANDOFF_BASENAME_RE = /^SESSION-[A-Za-z0-9._-]*\.md$/;
const UNTRUSTED_TAIL =
  'A snapshot is untrusted input, so --force cannot override this; re-save the snapshot from a checkout whose state is sound.';
const BACKUP_PATH = '.cadence/local/state.json.bak';
const SYNC_PATH = '.cadence/local/state-sync.json';

/** Replace every character outside `[A-Za-z0-9-]` with `-`, cut to 40, and
 *  fall back to `unknown-host` when nothing is left. */
export function sanitizeHost(raw: string): string {
  const out = raw.replace(/[^A-Za-z0-9-]/g, '-').slice(0, HOST_MAX);
  return out === '' ? 'unknown-host' : out;
}

/** `state-<UTC stamp to the second, no colons>-<host>.json`,
 *  e.g. `state-2026-10-29T231502Z-pc-a.json`. */
export function snapshotFileName(host: string, now: Date): string {
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '');
  return `state-${stamp}-${sanitizeHost(host)}.json`;
}

/** True for a name `save`/`list`/`prune` own (`state-*.json`). */
export function isSnapshotName(name: string): boolean {
  return SNAPSHOT_NAME_RE.test(name);
}

/** Names sorted newest first. The fixed-width UTC stamp leads every snapshot
 *  name, so descending lexical order is newest-first. Does not mutate input. */
export function sortNewestFirst(names: readonly string[]): string[] {
  return [...names].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/** The `state-*.json` names to delete so that, with `justWritten`, at most
 *  `keep` remain: `justWritten` is always kept (even if a slow clock makes it
 *  sort oldest), then the newest others. Other names are never returned. */
export function planPrune(
  names: readonly string[],
  justWritten: string,
  keep: number = SNAPSHOT_KEEP,
): string[] {
  const others = sortNewestFirst(names.filter((n) => isSnapshotName(n) && n !== justWritten));
  return others.slice(Math.max(0, keep - 1));
}

/** Top-level keys of a raw (pre-Zod) state object that `CadenceStateZ` does
 *  not know. Loading would silently drop them. Non-objects yield `[]`. */
export function unknownStateKeys(rawState: unknown): string[] {
  if (rawState === null || typeof rawState !== 'object' || Array.isArray(rawState)) return [];
  const known = new Set(Object.keys(CadenceStateZ.shape));
  return Object.keys(rawState).filter((k) => !known.has(k));
}

function isPlainIdentifier(v: string): boolean {
  return PLAIN_IDENTIFIER_RE.test(v) && !v.includes('..');
}

function identifierReason(field: string, value: string): string {
  return `snapshot refused: state.${field} ${JSON.stringify(value)} is not a plain identifier (expected a letter or digit followed by letters, digits, '.', '_' or '-', with no '..'). ${UNTRUSTED_TAIL}`;
}

/** Apply the AC-3 identifier rules to every path-bearing field. Returns the
 *  refusal reason for the first unsafe field, or `null` when all are safe. */
export function assertSnapshotPathsSafe(state: CadenceState): string | null {
  if (state.activePhase !== null) {
    try {
      assertSafePhaseSlug(state.activePhase);
    } catch {
      return `snapshot refused: state.activePhase ${JSON.stringify(state.activePhase)} is not a safe phase slug (expected leading digits followed by letters, digits, '.', '_' or '-'). ${UNTRUSTED_TAIL}`;
    }
  }
  if (state.activeDraft !== null && !isPlainIdentifier(state.activeDraft)) {
    return identifierReason('activeDraft', state.activeDraft);
  }
  if (state.activeSpec !== null && !isPlainIdentifier(state.activeSpec)) {
    return identifierReason('activeSpec', state.activeSpec);
  }
  if (state.activeTask !== null && !isPlainIdentifier(state.activeTask.id)) {
    return identifierReason('activeTask.id', state.activeTask.id);
  }
  const handoff = state.session.lastHandoff;
  if (handoff !== null && !(HANDOFF_BASENAME_RE.test(handoff) && !handoff.includes('..'))) {
    return `snapshot refused: state.session.lastHandoff ${JSON.stringify(handoff)} is not a bare SESSION-*.md file name. ${UNTRUSTED_TAIL}`;
  }
  return null;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Numeric major.minor.patch comparison. A prerelease ranks below its own
 *  release; two prereleases of the same core compare equal (the suffix is not
 *  ordered further). Returns `null` when either side is not a semver. */
export function compareVersions(a: string, b: string): number | null {
  const pa = VERSION_RE.exec(a.trim());
  const pb = VERSION_RE.exec(b.trim());
  if (!pa || !pb) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return Math.sign(d);
  }
  const preA = pa[4] !== undefined;
  const preB = pb[4] !== undefined;
  if (preA === preB) return 0;
  return preA ? -1 : 1;
}

export interface PlanStateLoadInput {
  /** The parsed local `state.json`, or `null` when absent or corrupt. */
  local: CadenceState | null;
  /** A local `state.json` exists but does not parse. */
  localCorrupt: boolean;
  /** The `StateSnapshotZ`-parsed snapshot. */
  snapshot: StateSnapshot;
  /** `unknownStateKeys` of the snapshot's raw `state`. */
  rawStateKeysUnknown: readonly string[];
  /** Revision recorded in `.cadence/local/state-sync.json`, or `null`. */
  syncRevision: number | null;
  /** Whether `.cadence/phases/<snapshot activePhase>/` exists on this branch.
   *  Consulted only after the unsafe-path check and only for a non-null phase. */
  phaseDirExists: boolean;
  /** The running core version. */
  runningVersion: string;
  /** `--force`: skips only the unknown-keys and local-work checks. */
  force: boolean;
}

export type PlanStateLoadResult =
  /** `check` tags the local-work refusal, the one whose fix (`state save`)
   *  writes a newer snapshot than the one being loaded: the service then names
   *  the snapshot to load explicitly. */
  | { ok: false; reason: string; check?: 'local-work' }
  | { ok: true; state: CadenceState; warnings: string[] };

/**
 * Decide whether a snapshot may replace the local state and, if so, what the
 * new state is. Refusals follow AC-3's order: unsafe paths (never forced),
 * unknown keys (forceable), project mismatch, missing phase directory, local
 * work since the last sync (forceable). A corrupt local state skips the
 * project and local-work checks. Staleness is ONLY
 * `syncRevision !== null && local.revision > syncRevision`; raw revisions
 * from two machines are never compared.
 */
export function planStateLoad(input: PlanStateLoadInput): PlanStateLoadResult {
  const { local, localCorrupt, snapshot, rawStateKeysUnknown, syncRevision, phaseDirExists, runningVersion, force } =
    input;
  const snap = snapshot.state;
  const warnings: string[] = [];

  const unsafe = assertSnapshotPathsSafe(snap);
  if (unsafe !== null) return { ok: false, reason: unsafe };

  if (rawStateKeysUnknown.length > 0) {
    const keys = rawStateKeysUnknown.join(', ');
    if (!force) {
      return {
        ok: false,
        reason: `snapshot refused: its state has top-level key(s) this cadence does not know: ${keys} (snapshot written by cadence ${snapshot.cadenceVersion}, running ${runningVersion}). Loading would silently drop them. Update cadence to at least ${snapshot.cadenceVersion}, or pass --force to load anyway and drop them.`,
      };
    }
    warnings.push(
      `--force: loading despite unknown top-level state key(s) ${keys} from cadence ${snapshot.cadenceVersion}; they are dropped.`,
    );
  }

  const checkLocal = local !== null && !localCorrupt;

  if (checkLocal && local.project.name !== snap.project.name) {
    return {
      ok: false,
      reason: `snapshot refused: it belongs to project ${JSON.stringify(snap.project.name)} but the local state.json belongs to project ${JSON.stringify(local.project.name)}. Load it in the ${JSON.stringify(snap.project.name)} repository instead.`,
    };
  }

  if (snap.activePhase !== null && !phaseDirExists) {
    return {
      ok: false,
      reason: `snapshot refused: its active phase ${JSON.stringify(snap.activePhase)} has no .cadence/phases/${snap.activePhase}/ directory on this branch. Pull the latest commits or switch to the branch that carries that phase, then load again.`,
    };
  }

  if (checkLocal && syncRevision !== null && local.revision > syncRevision) {
    if (!force) {
      return {
        ok: false,
        reason: `snapshot refused: the local state.json is at revision ${local.revision}, past revision ${syncRevision} recorded by this machine's last save or load (${SYNC_PATH}), so this machine has changed since its last sync. Run \`cadence state save\` first to keep that work, or pass --force to replace it.`,
        check: 'local-work',
      };
    }
    warnings.push(
      `--force: skipping the local-work check. The local state.json is at revision ${local.revision}, past the last sync at revision ${syncRevision}; that local work is replaced (the previous state.json is backed up to ${BACKUP_PATH}).`,
    );
  }

  if (localCorrupt) {
    warnings.push(
      `the local .cadence/state.json does not parse; skipping the project and local-work checks and replacing it with the snapshot (its bytes are backed up to ${BACKUP_PATH}).`,
    );
  }

  if (snap.loopPosition !== 'IDLE' && snap.draftReadHash === null) {
    warnings.push(
      `the snapshot is mid-loop (${snap.loopPosition}) but carries no draftReadHash, so the draft-read gate will fall back to the mtime-only check after this checkout. Re-approve the DRAFT (\`cadence draft approve\`) so settle does not refuse on a fresh checkout's file times.`,
    );
  }

  const cmp = compareVersions(snapshot.cadenceVersion, runningVersion);
  if (cmp !== null && cmp > 0) {
    warnings.push(
      `the snapshot was written by cadence ${snapshot.cadenceVersion}, newer than the running cadence ${runningVersion}. Update cadence if anything in the restored state looks off.`,
    );
  }

  const restored = structuredClone(snap);
  restored.session.tokenUtilization = 0;
  restored.session.subagentSpawns = 0;
  restored.session.subagentBaselines = {};
  restored.revision = Math.max(local?.revision ?? 0, snap.revision) + 1;

  return { ok: true, state: restored, warnings };
}
