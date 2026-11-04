// packages/core/src/handoff/run-resume.ts
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { defaultConfig, type HandoffCandidate, type ResumeResult } from '@thomas-powers-jr/cadence-types';
import { SimpleStateBackend } from '../state/simple.js';
import { runContext } from '../intelligence/context.js';
import { loadConfig } from '../config/loader.js';
import { type CommandIO, processIO } from '../services/io.js';
import { resolveInteractivity } from '../gates/interactivity.js';
import { createDefaultPrompter } from '../verify/prompter.js';
import { locateFreshestHandoff, readKey } from './locate.js';
import { extractBriefSections } from './brief.js';
import { gatherHandoffCandidates } from './candidates.js';
import { resolvePick, promptForPick } from './pick.js';
import { checkRemoteFreshness } from './remote-freshness.js';
import { findUnfilledSections } from './placeholders.js';
import { findNewestPrecompactRecord, type PrecompactRecordPointer } from './precompact.js';

/** The instant a SESSION doc counts as written for AC-7 (phase 345): its
 *  `generated_at` when parseable, else the END of its file-name date
 *  (23:59:59.999Z), else null (no comparable instant). */
function sessionDocInstant(session: { generatedAt: string | null; path: string }): number | null {
  if (session.generatedAt !== null) {
    const ms = Date.parse(session.generatedAt);
    if (!Number.isNaN(ms)) return ms;
  }
  const day = basename(session.path).match(/SESSION-(\d{4}-\d{2}-\d{2})/)?.[1];
  if (day === undefined) return null;
  const ms = Date.parse(`${day}T23:59:59.999Z`);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Pure (phase 345, AC-7): is a pre-compaction record written at
 * `recordGeneratedAt` strictly newer than the freshest SESSION doc? Any
 * record counts as newer when there is no SESSION doc (`session === null`).
 * An unparseable record time, or a SESSION doc with no comparable instant,
 * yields false (the output then stays exactly as it was).
 */
export function isPrecompactRecordNewer(
  recordGeneratedAt: string,
  session: { generatedAt: string | null; path: string } | null,
): boolean {
  const recordMs = Date.parse(recordGeneratedAt);
  if (Number.isNaN(recordMs)) return false;
  if (session === null) return true;
  const sessionMs = sessionDocInstant(session);
  return sessionMs !== null && recordMs > sessionMs;
}

/** Pure (phase 345, AC-7): the one-line pointer the SessionStart banner and
 *  `cadence resume` print. Whitespace runs are collapsed so it stays one line. */
export function renderPrecompactPointerLine(record: PrecompactRecordPointer): string {
  const flat = (v: string): string => v.replace(/\s+/g, ' ').trim();
  return `Pre-compaction record: ${flat(record.path)} (trigger: ${flat(record.trigger)}, ${flat(record.generatedAt)}) — newer than any SESSION handoff`;
}

/**
 * Best-effort (phase 345, AC-7): the newest pre-compaction record when it is
 * newer than the freshest SESSION doc, else null. "Freshest" uses AC-7's own
 * rule over every `.cadence/handoff/SESSION-*.md` doc: its `generated_at`, or
 * the end of its file-name date when it has none. Non-SESSION files (including
 * a custom-labelled `lastHandoff`) are never SESSION docs and are ignored. A
 * SESSION doc with no comparable instant makes the answer "not newer", so the
 * output stays exactly as it was. Never throws: any failure yields null.
 * `_lastHandoff` is accepted for call-site symmetry and deliberately unused.
 */
export async function findNewerPrecompactRecord(
  root: string,
  _lastHandoff: string | null,
): Promise<PrecompactRecordPointer | null> {
  try {
    const record = await findNewestPrecompactRecord(root);
    if (record === null) return null;
    const recordMs = Date.parse(record.generatedAt);
    if (Number.isNaN(recordMs)) return null;
    const dir = join(root, '.cadence', 'handoff');
    // A missing handoff directory means no SESSION doc exists (the record is
    // newer); any other read failure is a lookup failure and contributes nothing.
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => /^SESSION-.*\.md$/.test(n));
    } catch (err) {
      if ((err as { code?: unknown }).code !== 'ENOENT') return null;
      names = [];
    }
    for (const name of names) {
      // generated_at counts only from the doc's front matter, never its body.
      const content = (await readFile(join(dir, name), 'utf8')).replace(/\r\n/g, '\n');
      const frontMatter = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] ?? '';
      const generatedAt = readKey(frontMatter, 'generated_at');
      const instant = sessionDocInstant({ generatedAt, path: name });
      if (instant === null || instant >= recordMs) return null;
    }
    return record;
  } catch {
    return null;
  }
}

/** runResume's lookup: reads `lastHandoff` best-effort, like `localResolve`. */
async function resumePrecompactRecord(root: string): Promise<PrecompactRecordPointer | null> {
  let lastHandoff: string | null = null;
  try {
    lastHandoff = (await new SimpleStateBackend(root).readState()).session.lastHandoff;
  } catch {
    lastHandoff = null;
  }
  return findNewerPrecompactRecord(root, lastHandoff);
}

export interface ResumeOptions {
  /** Force output mode. Omitted → drift decides: drift → 'full', else 'brief'. */
  mode?: 'brief' | 'full';
  /** Render every discovered candidate without resuming anything (AC-3). */
  list?: boolean;
  /** 1-based index into the freshest-first candidate list (AC-4). */
  pick?: number;
  /** Exact handoff doc path to resolve directly, across any worktree (AC-4). */
  path?: string;
  /** Force the pre-phase-143 local-only behavior, ignoring config (AC-1). */
  local?: boolean;
  /** Skip the origin-freshness probe entirely (no network). */
  offline?: boolean;
}

/**
 * The pre-phase-143 local-resolution path, byte-identical to the original
 * `runResume` body. This is the fast path for the single-candidate case
 * (AC-1) and is reused, unmodified, whenever a pick/prompt resolves to the
 * *local* candidate.
 */
async function localResolve(
  root: string,
  opts: ResumeOptions,
  now: Date,
): Promise<ResumeResult> {
  let lastHandoff: string | null = null;
  let liveLoopPosition: string | null = null;
  try {
    const state = await new SimpleStateBackend(root).readState();
    lastHandoff = state.session.lastHandoff;
    liveLoopPosition = state.loopPosition;
  } catch {
    // No/corrupt state: fall back to globbing for the doc. With no live loop
    // position we cannot compute drift, so `mode` resolves to 'brief' below —
    // a corrupt state.json yields brief output with no drift warning. Pass
    // --full to force the whole doc + live context in that case.
  }

  const located = await locateFreshestHandoff(root, lastHandoff);
  if (!located) return { found: false };

  const drift =
    located.loopPosition && liveLoopPosition && located.loopPosition !== liveLoopPosition
      ? { docLoopPosition: located.loopPosition, liveLoopPosition }
      : null;

  const mode = opts.mode ?? (drift ? 'full' : 'brief');

  if (mode === 'full') {
    const context = await runContext(root, 'handoff', now);
    return {
      found: true,
      handoffPath: located.path,
      generatedAt: located.generatedAt,
      doc: located.content,
      context,
      drift,
      mode,
      ...(located.danglingPointer !== undefined
        ? { danglingHandoffPointer: located.danglingPointer }
        : {}),
      ...(located.supersededPointer !== undefined
        ? { supersededHandoffPointer: located.supersededPointer }
        : {}),
    };
  }

  // brief: skip the live-context recompute entirely — the doc is authoritative
  return {
    found: true,
    handoffPath: located.path,
    generatedAt: located.generatedAt,
    doc: extractBriefSections(located.content),
    context: null,
    drift,
    mode,
    ...(located.danglingPointer !== undefined
      ? { danglingHandoffPointer: located.danglingPointer }
      : {}),
    ...(located.supersededPointer !== undefined
      ? { supersededHandoffPointer: located.supersededPointer }
      : {}),
  };
}

/**
 * Resolve a *sibling* candidate read-only, straight off its own doc + its own
 * already-captured live loop position (`candidate.liveLoopPosition`, from
 * `gatherHandoffCandidates`). Deliberately never touches `SimpleStateBackend`
 * or `locateFreshestHandoff` against the foreign root, and — critically for
 * AC-6 — never calls `runContext`, since that would write into the sibling's
 * `.cadence/intelligence/context/` directory. `context` is always `null` for
 * a sibling; the CLI/human-facing layer (a later task) renders the "cd there
 * and re-run --full" hint.
 */
async function resolveSiblingCandidate(
  candidate: HandoffCandidate,
  opts: ResumeOptions,
): Promise<ResumeResult> {
  const content = await readFile(candidate.path, 'utf8');
  const docLoopPosition = readKey(content, 'loop_position');
  const generatedAt = readKey(content, 'generated_at');
  const liveLoopPosition = candidate.liveLoopPosition;

  const drift =
    docLoopPosition && liveLoopPosition && docLoopPosition !== liveLoopPosition
      ? { docLoopPosition, liveLoopPosition }
      : null;

  const mode = opts.mode ?? (drift ? 'full' : 'brief');

  return {
    found: true,
    handoffPath: candidate.path,
    generatedAt,
    doc: mode === 'full' ? content : extractBriefSections(content),
    context: null,
    drift,
    mode,
    pickedSource: 'sibling',
    pickedWorktree: candidate.worktreePath,
  };
}

/** Dispatch a resolved candidate (from a pick/path/prompt) to the right resolver. */
async function resolveByCandidate(
  root: string,
  candidate: HandoffCandidate,
  opts: ResumeOptions,
  now: Date,
): Promise<ResumeResult> {
  return candidate.source === 'local'
    ? localResolve(root, opts, now)
    : resolveSiblingCandidate(candidate, opts);
}

function withCandidates(result: ResumeResult, candidates: HandoffCandidate[]): ResumeResult {
  return { ...result, candidates };
}

async function resolveResume(
  root: string,
  opts: ResumeOptions,
  now: Date,
  io: CommandIO,
): Promise<ResumeResult> {
  // Best-effort: an unrelated corrupt/invalid config.json must never break a
  // read-only `cadence resume` (matches the guarded `loadConfig(...).catch(()
  // => null)` idiom in status.ts / loop-violation.ts). Fall back to
  // `defaultConfig`'s `resume` block ({ crossWorktree: true, autoList: false }).
  const { resume: resumeConfig } = (await loadConfig(root).catch(() => null)) ?? defaultConfig;

  // AC-1 fast path: explicit --local, or config opt-out. No candidate
  // gathering at all — not even for logging/counting.
  if (opts.local === true || resumeConfig.crossWorktree === false) {
    return localResolve(root, opts, now);
  }

  const candidates = await gatherHandoffCandidates(root);
  const hasExplicitSelector = opts.pick !== undefined || opts.path !== undefined || opts.list === true;

  // AC-1 also covers "no siblings with candidates" — still byte-identical.
  if (candidates.length <= 1 && !hasExplicitSelector) {
    return localResolve(root, opts, now);
  }

  // AC-4: explicit selection, pick beats path beats list.
  let resolved: HandoffCandidate | undefined;
  if (opts.pick !== undefined) {
    resolved = resolvePick(candidates, opts.pick);
  } else if (opts.path !== undefined) {
    resolved = candidates.find((c) => c.path === opts.path);
  }

  if (resolved) {
    return withCandidates(await resolveByCandidate(root, resolved, opts, now), candidates);
  }
  // Neither --pick nor --path resolved to anything (out of range / no match):
  // treat as if neither was given and fall through to --list / the default
  // automatic behavior below. No AC requires a hard error here.

  // AC-3: --list renders every candidate, resumes nothing.
  if (opts.list) {
    return { found: false, candidates };
  }

  // AC-2 / AC-7: 2+ candidates, no explicit selection.
  if (candidates.length >= 2) {
    if (!resumeConfig.autoList) {
      const result = await localResolve(root, opts, now);
      const hasLocal = candidates.some((c) => c.source === 'local');
      const count = hasLocal ? candidates.length - 1 : candidates.length;
      const noun = hasLocal ? 'other worktree(s)' : 'worktree(s)';
      io.err(`note: ${count} ${noun} have resumable handoffs — cadence resume --list\n`);
      return withCandidates(result, candidates);
    }

    const interactivity = resolveInteractivity(process.env, Boolean(process.stdin.isTTY));
    const picked = await promptForPick(candidates, interactivity, io, { createPrompter: createDefaultPrompter });
    if (!picked) return { found: false, candidates };
    return withCandidates(await resolveByCandidate(root, picked, opts, now), candidates);
  }

  // Edge case the brief leaves open: a --pick/--path was given but resolved to
  // nothing, and fewer than 2 candidates exist (so there is no menu to fall
  // back to either). Fall back to the local-resolution result, still
  // attaching whatever candidates were gathered for visibility.
  return withCandidates(await localResolve(root, opts, now), candidates);
}

export async function runResume(
  root: string,
  opts: ResumeOptions = {},
  now: Date = new Date(),
  io: CommandIO = processIO(),
): Promise<ResumeResult> {
  const result = await resolveResume(root, opts, now, io);

  // Phase 345 (AC-7): default mode only — --list and --pick are unchanged.
  const precompactRecord =
    opts.list === true || opts.pick !== undefined ? null : await resumePrecompactRecord(root);
  if (!result.found) return precompactRecord ? { ...result, precompactRecord } : result;

  const unfilled = findUnfilledSections(result.found ? result.doc : '');
  const withUnfilled = unfilled.length > 0 ? { ...result, unfilled } : result;
  const decorated = precompactRecord ? { ...withUnfilled, precompactRecord } : withUnfilled;

  // Two-PC guard: a handoff superseded by work pushed from another clone is
  // invisible to loop-position drift. Probe origin unless opted out. The probe
  // is soft and its fetch touches remote-tracking refs only (resume stays
  // working-tree read-only).
  const { resume: cfg } = (await loadConfig(root).catch(() => null)) ?? defaultConfig;
  if (opts.offline === true || cfg.remoteCheck === false) return decorated;
  const remote = await checkRemoteFreshness(root);
  return { ...decorated, remote };
}
