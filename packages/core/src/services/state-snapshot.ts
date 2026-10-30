// packages/core/src/services/state-snapshot.ts
//
// `cadence state save | load | list` (phase 341, T3) — the impure shell
// around T2's pure planners in `state/snapshot.ts`. These services gather the
// facts (fs, hostname, clock, running core version, the state backend), call
// the planners, and print: results to `io.out`, every diagnostic to `io.err`.
// Under `--json` a refusal prints nothing to stdout.
//
// A snapshot is a committed file that can arrive from anyone, so `load` runs
// `assertSnapshotPathsSafe` on the parsed snapshot BEFORE it probes
// `.cadence/phases/<activePhase>/` or any other path derived from snapshot
// content, and `--force` never overrides that refusal.

import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { hostname as osHostname } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  CadenceStateZ,
  StateSnapshotZ,
  type CadenceState,
  type StateSnapshot,
} from '@thomas-powers-jr/cadence-types';
import type { ZodIssue } from 'zod';
import { NotInitializedError, StateConflictError, StateCorruptError } from '../errors.js';
import { atomicWriteText } from '../state/atomic-write.js';
import type { StateBackend } from '../state/backend.js';
import { SimpleStateBackend } from '../state/simple.js';
import {
  SNAPSHOT_KEEP,
  assertSnapshotPathsSafe,
  isSnapshotName,
  planPrune,
  planStateLoad,
  sanitizeHost,
  snapshotFileName,
  sortNewestFirst,
  unknownStateKeys,
} from '../state/snapshot.js';
import { readPackageVersion } from '../version.js';
import { formatCommandError } from './format-command-error.js';
import type { CommandIO, CommandResult } from './io.js';

const SNAPSHOTS_REL = '.cadence/snapshots';
const BACKUP_REL = '.cadence/local/state.json.bak';
const SYNC_REL = '.cadence/local/state-sync.json';

/** A loop position as `save`, `list` and `load` report it. */
export interface SnapshotPosition {
  loop: CadenceState['loopPosition'];
  phase: string | null;
  draft: string | null;
}

export interface StateSaveArgs {
  json?: boolean;
  /** Injectable clock (defaults to `new Date()`). */
  now?: Date;
  /** Injectable raw hostname (defaults to `os.hostname()`); sanitized here. */
  hostname?: string;
  /** Injectable running core version (defaults to core's package version). */
  runningVersion?: string;
}

export interface StateListArgs {
  json?: boolean;
}

export interface StateLoadArgs {
  /** A bare file name inside `.cadence/snapshots/`, or a path. Defaults to
   *  the newest `state-*.json`. */
  snapshot?: string;
  /** Skips only the unknown-keys and local-work checks. */
  force?: boolean;
  json?: boolean;
  /** Injectable running core version (defaults to core's package version). */
  runningVersion?: string;
  /** Injectable backend (defaults to `SimpleStateBackend(repoRoot)`). */
  backend?: StateBackend;
  /** Injectable directory probe for paths derived from snapshot content
   *  (defaults to a best-effort `stat().isDirectory()`). Never called before
   *  the snapshot's path-bearing fields pass `assertSnapshotPathsSafe`. */
  isDirectory?: (absPath: string) => Promise<boolean>;
}

export interface StateSaveData {
  path: string;
  position: SnapshotPosition;
  pruned: string[];
  warnings: string[];
}

export type StateListEntry =
  | { name: string; savedAt: string; host: string; position: SnapshotPosition }
  | { name: string; error: string };

export interface StateLoadData {
  from: string;
  before: SnapshotPosition | null;
  after: SnapshotPosition;
  backup: string | null;
  warnings: string[];
}

function positionOf(s: CadenceState): SnapshotPosition {
  return { loop: s.loopPosition, phase: s.activePhase, draft: s.activeDraft };
}

function renderPosition(p: SnapshotPosition): string {
  const parts: string[] = [];
  if (p.phase !== null) parts.push(`phase ${p.phase}`);
  if (p.draft !== null) parts.push(`draft ${p.draft}`);
  return parts.length > 0 ? `${p.loop} (${parts.join(', ')})` : p.loop;
}

/** Repo-relative POSIX path when inside the repo, absolute otherwise. */
function displayPath(repoRoot: string, abs: string): string {
  const rel = relative(repoRoot, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return abs;
  return rel.split(sep).join('/');
}

function issuesText(issues: readonly ZodIssue[]): string {
  const shown = issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  const more = issues.length > 3 ? `; and ${issues.length - 3} more` : '';
  return `${shown.join('; ')}${more}`;
}

async function writeJsonText(path: string, value: unknown): Promise<void> {
  await atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeSyncMarker(repoRoot: string, revision: number): Promise<void> {
  await mkdir(join(repoRoot, '.cadence', 'local'), { recursive: true });
  await writeJsonText(join(repoRoot, SYNC_REL), { revision });
}

/** `state-*.json` names under `.cadence/snapshots/`; `[]` when the directory
 *  is absent or unreadable (best-effort observation). */
async function snapshotNames(repoRoot: string): Promise<string[]> {
  try {
    return (await readdir(join(repoRoot, SNAPSHOTS_REL))).filter(isSnapshotName);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------

/**
 * `cadence state save` — write `.cadence/snapshots/state-<stamp>-<host>.json`
 * from the parsed local state, prune to the newest {@link SNAPSHOT_KEEP},
 * then record the local revision in `.cadence/local/state-sync.json`.
 */
export async function stateSaveService(
  repoRoot: string,
  args: StateSaveArgs,
  io: CommandIO,
): Promise<CommandResult> {
  try {
    const backend = new SimpleStateBackend(repoRoot);
    let state: CadenceState;
    try {
      state = await backend.readState();
    } catch (err) {
      if (err instanceof NotInitializedError) {
        io.err(
          `state save refused: there is no .cadence/state.json to save (${err.message}). Nothing was written.\n`,
        );
        return { exitCode: 1 };
      }
      if (err instanceof StateCorruptError) {
        io.err(
          `state save refused: .cadence/state.json does not parse (${err.message}). Nothing was written. Run 'cadence doctor --fix' to repair it, then save again.\n`,
        );
        return { exitCode: 1 };
      }
      throw err;
    }

    const now = args.now ?? new Date();
    const rawHost = args.hostname ?? osHostname();
    const name = snapshotFileName(rawHost, now);
    const dir = join(repoRoot, SNAPSHOTS_REL);
    const path = join(dir, name);
    const rel = `${SNAPSHOTS_REL}/${name}`;
    if (existsSync(path)) {
      io.err(
        `state save refused: ${rel} already exists, and a snapshot is never overwritten. Names are stamped to the second, so wait a second and save again.\n`,
      );
      return { exitCode: 1 };
    }

    const warnings: string[] = [];
    if (state.session.lastHandoff === null) {
      warnings.push(
        'no handoff is linked (state.session.lastHandoff is null), so the next machine gets the loop position without session notes. Write one with `cadence handoff`, then run `cadence state save` again so the snapshot links it and the sync marker is current.',
      );
    }

    const snapshot: StateSnapshot = {
      snapshotVersion: 1,
      savedAt: now.toISOString(),
      host: sanitizeHost(rawHost),
      cadenceVersion: args.runningVersion ?? readPackageVersion(),
      state,
    };
    await mkdir(dir, { recursive: true });
    await writeJsonText(path, snapshot);

    const pruned: string[] = [];
    for (const old of planPrune(await snapshotNames(repoRoot), name)) {
      try {
        await unlink(join(dir, old));
        pruned.push(old);
        io.err(`state save: pruned ${SNAPSHOTS_REL}/${old} (keeping the newest ${SNAPSHOT_KEEP}).\n`);
      } catch (err) {
        io.err(
          `state save: warning: could not prune ${SNAPSHOTS_REL}/${old}: ${(err as Error).message}\n`,
        );
      }
    }

    await writeSyncMarker(repoRoot, state.revision);

    for (const w of warnings) io.err(`state save: warning: ${w}\n`);
    const data: StateSaveData = { path: rel, position: positionOf(state), pruned, warnings };
    if (args.json) {
      io.out(`${JSON.stringify(data)}\n`);
    } else {
      io.out(`Saved ${rel} at ${renderPosition(data.position)}.\n`);
    }
    return { exitCode: 0, data };
  } catch (err) {
    io.err(`${formatCommandError('state save', err)}\n`);
    return { exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

/** Read and parse one snapshot file, or describe why it cannot be. */
async function readSnapshotEntry(dir: string, name: string): Promise<StateListEntry> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dir, name), 'utf8'));
  } catch (err) {
    return { name, error: `not valid JSON: ${(err as Error).message}` };
  }
  const parsed = StateSnapshotZ.safeParse(raw);
  if (!parsed.success) return { name, error: `not a valid snapshot: ${issuesText(parsed.error.issues)}` };
  return {
    name,
    savedAt: parsed.data.savedAt,
    host: parsed.data.host,
    position: positionOf(parsed.data.state),
  };
}

/**
 * `cadence state list` — every `state-*.json`, newest first. An unreadable
 * file is still listed (marked, with a stderr warning) and exit stays 0.
 */
export async function stateListService(
  repoRoot: string,
  args: StateListArgs,
  io: CommandIO,
): Promise<CommandResult> {
  try {
    const dir = join(repoRoot, SNAPSHOTS_REL);
    const names = sortNewestFirst(await snapshotNames(repoRoot));
    const entries: StateListEntry[] = [];
    for (const name of names) {
      const entry = await readSnapshotEntry(dir, name);
      if ('error' in entry) {
        io.err(
          `state list: warning: ${SNAPSHOTS_REL}/${name} is unreadable (${entry.error}); it is listed but cannot be loaded.\n`,
        );
      }
      entries.push(entry);
    }
    if (args.json) {
      io.out(`${JSON.stringify(entries)}\n`);
    } else if (entries.length === 0) {
      io.out(`No snapshots in ${SNAPSHOTS_REL}/. Run \`cadence state save\` to write one.\n`);
    } else {
      for (const e of entries) {
        io.out(
          'error' in e
            ? `${e.name}  UNREADABLE: ${e.error}\n`
            : `${e.name}  ${e.savedAt}  ${e.host}  ${renderPosition(e.position)}\n`,
        );
      }
    }
    return { exitCode: 0, data: entries };
  } catch (err) {
    io.err(`${formatCommandError('state list', err)}\n`);
    return { exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

/** Resolve the snapshot to load, or a refusal reason. */
async function resolveSnapshotPath(
  repoRoot: string,
  arg: string | undefined,
): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
  if (arg === undefined) {
    const newest = sortNewestFirst(await snapshotNames(repoRoot))[0];
    if (newest === undefined) {
      return {
        ok: false,
        reason: `state load refused: there are no snapshots in ${SNAPSHOTS_REL}/. Run \`cadence state save\` on the machine that has the state, commit and push the snapshot, then pull here and load again.`,
      };
    }
    return { ok: true, path: join(repoRoot, SNAPSHOTS_REL, newest) };
  }
  const bare = arg !== '.' && arg !== '..' && !arg.includes('/') && !arg.includes('\\');
  const path = bare ? join(repoRoot, SNAPSHOTS_REL, arg) : resolve(arg);
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: `state load refused: snapshot ${JSON.stringify(arg)} not found (looked for ${displayPath(repoRoot, path)}). Run \`cadence state list\` to see the available snapshots, or pass a path to a snapshot file.`,
    };
  }
  return { ok: true, path };
}

/** Parse a snapshot file's text into a snapshot plus its raw unknown state
 *  keys, mapping each failure to its AC-3 refusal. */
function parseSnapshotText(
  from: string,
  text: string,
): { ok: true; snapshot: StateSnapshot; unknownKeys: string[] } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      reason: `state load refused: ${from} is not valid JSON (${(err as Error).message}). Re-save it with \`cadence state save\` on the machine it came from, or pick another with \`cadence state list\`.`,
    };
  }
  const obj = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const version = obj === null ? undefined : obj.snapshotVersion;
  if (version !== 1) {
    const shown = version === undefined ? 'no snapshotVersion' : `snapshotVersion ${JSON.stringify(version)}`;
    return {
      ok: false,
      reason: `state load refused: ${from} has ${shown}, but this cadence reads only snapshotVersion 1. Update cadence if the snapshot is from a newer one, or re-save it with \`cadence state save\`.`,
    };
  }
  // Unknown keys come from the RAW state, before Zod strips them.
  const unknownKeys = unknownStateKeys(obj?.state);
  const parsed = StateSnapshotZ.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    if (issues.every((i) => i.path[0] === 'state')) {
      return {
        ok: false,
        reason: `state load refused: the state in ${from} fails the CadenceState schema (${issuesText(issues)}). Re-save it from a checkout whose state.json is valid (run \`cadence doctor\` there first), or pick another with \`cadence state list\`.`,
      };
    }
    return {
      ok: false,
      reason: `state load refused: ${from} is not a valid snapshot (${issuesText(issues)}). Re-save it with \`cadence state save\`, or pick another with \`cadence state list\`.`,
    };
  }
  return { ok: true, snapshot: parsed.data, unknownKeys };
}

/** The sync marker's revision, or `null` when absent. A present-but-invalid
 *  marker also yields `null`, loudly (it disables the local-work check). */
async function readSyncRevision(repoRoot: string, io: CommandIO): Promise<number | null> {
  const path = join(repoRoot, SYNC_REL);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
    const rev = raw !== null && typeof raw === 'object' ? (raw as { revision?: unknown }).revision : undefined;
    if (typeof rev === 'number' && Number.isInteger(rev) && rev >= 0) return rev;
  } catch {
    /* fall through to the warning */
  }
  io.err(
    `state load: warning: ${SYNC_REL} is unreadable, so it is treated as absent and the local-work check is skipped. The next save or load rewrites it.\n`,
  );
  return null;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Write the backup's exact bytes. Text that round-trips through UTF-8 goes
 *  through the atomic writer; anything else is written as raw bytes so the
 *  backup of a broken file is never altered. */
async function writeBackup(path: string, bytes: Buffer): Promise<void> {
  const text = bytes.toString('utf8');
  if (Buffer.from(text, 'utf8').equals(bytes)) {
    await atomicWriteText(path, text);
  } else {
    await writeFile(path, bytes);
  }
}

/**
 * `cadence state load [snapshot]` — validate an untrusted snapshot, plan the
 * restore with `planStateLoad`, back up the exact local bytes, replace the
 * state at the planned revision, and record the sync marker.
 */
export async function stateLoadService(
  repoRoot: string,
  args: StateLoadArgs,
  io: CommandIO,
): Promise<CommandResult> {
  try {
    const refuse = (reason: string): CommandResult => {
      io.err(`${reason}\n`);
      return { exitCode: 1 };
    };

    // 1. Which snapshot (the path comes from the operator, not the snapshot).
    const resolved = await resolveSnapshotPath(repoRoot, args.snapshot);
    if (!resolved.ok) return refuse(resolved.reason);
    const from = displayPath(repoRoot, resolved.path);

    // 2. Local state: exact bytes, parsed or marked corrupt.
    const statePath = join(repoRoot, '.cadence', 'state.json');
    let localBytes: Buffer | null = null;
    let local: CadenceState | null = null;
    let localCorrupt = false;
    if (existsSync(statePath)) {
      localBytes = await readFile(statePath);
      try {
        local = CadenceStateZ.parse(JSON.parse(localBytes.toString('utf8')));
      } catch {
        localCorrupt = true;
      }
    }

    // 3. Parse the snapshot (raw unknown keys before Zod strips them).
    let text: string;
    try {
      text = await readFile(resolved.path, 'utf8');
    } catch (err) {
      return refuse(
        `state load refused: cannot read ${from} (${(err as Error).message}). Pass a snapshot file, or run \`cadence state list\` to see the available snapshots.`,
      );
    }
    const parsed = parseSnapshotText(from, text);
    if (!parsed.ok) return refuse(parsed.reason);
    const { snapshot, unknownKeys } = parsed;

    // 4. SECURITY: every path-bearing field is checked BEFORE any probe of a
    //    path derived from snapshot content. --force never overrides this.
    //    (planStateLoad re-runs the same check first; this explicit call
    //    guarantees the ordering against the phase-directory probe below.)
    const unsafe = assertSnapshotPathsSafe(snapshot.state);
    if (unsafe !== null) return refuse(unsafe);

    // 5. Facts derived from (now-validated) snapshot content.
    const phaseDirExists =
      snapshot.state.activePhase !== null &&
      (await (args.isDirectory ?? isDirectory)(
        join(repoRoot, '.cadence', 'phases', snapshot.state.activePhase),
      ));
    const syncRevision = await readSyncRevision(repoRoot, io);

    const plan = planStateLoad({
      local,
      localCorrupt,
      snapshot,
      rawStateKeysUnknown: unknownKeys,
      syncRevision,
      phaseDirExists,
      runningVersion: args.runningVersion ?? readPackageVersion(),
      force: args.force === true,
    });
    if (!plan.ok) {
      // Following this refusal's fix (`state save`) writes a newer snapshot,
      // so a second bare `state load` would pick that one, not this one.
      if (plan.check === 'local-work' && args.snapshot === undefined) {
        return refuse(
          `${plan.reason} The snapshot refused here is ${basename(resolved.path)}; after saving, load it by name: \`cadence state load ${basename(resolved.path)}\`.`,
        );
      }
      return refuse(plan.reason);
    }

    for (const w of plan.warnings) io.err(`state load: warning: ${w}\n`);

    // 6. Backup the exact local bytes, immediately before the state write.
    const expected: { revision: number } | 'absent' | 'corrupt' =
      local !== null ? { revision: local.revision } : localCorrupt ? 'corrupt' : 'absent';
    let backup: string | null = null;
    if (localBytes !== null) {
      await mkdir(join(repoRoot, '.cadence', 'local'), { recursive: true });
      await writeBackup(join(repoRoot, BACKUP_REL), localBytes);
      backup = BACKUP_REL;
    }

    const backend = args.backend ?? new SimpleStateBackend(repoRoot);
    try {
      await backend.replaceState(plan.state, expected);
    } catch (err) {
      if (err instanceof StateConflictError) {
        return refuse(formatCommandError('state load', err));
      }
      throw err;
    }

    // 7. Sync marker at the new revision.
    await writeSyncMarker(repoRoot, plan.state.revision);

    const data: StateLoadData = {
      from,
      before: local !== null ? positionOf(local) : null,
      after: positionOf(plan.state),
      backup,
      warnings: plan.warnings,
    };
    if (args.json) {
      io.out(`${JSON.stringify(data)}\n`);
    } else {
      const before =
        data.before !== null
          ? renderPosition(data.before)
          : localCorrupt
            ? 'unparseable state.json'
            : 'no state.json';
      io.out(`Loaded ${from}\n`);
      io.out(`  before: ${before}\n`);
      io.out(`  after:  ${renderPosition(data.after)} (revision ${plan.state.revision})\n`);
      if (backup !== null) io.out(`  backup: ${backup}\n`);
    }
    return { exitCode: 0, data };
  } catch (err) {
    io.err(`${formatCommandError('state load', err)}\n`);
    return { exitCode: 1 };
  }
}
