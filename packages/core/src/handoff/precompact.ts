// packages/core/src/handoff/precompact.ts
//
// Phase 345: the record `cadence hook pre-compact` writes just before the host
// compacts a session. Machine facts only, written to the already-gitignored
// `.cadence/local/precompact/`, never a SESSION doc, never a state write.
//
// Pure core: `precompactFileStem`, `planPrecompactRecord`, `payloadFieldNames`,
// `selectPrunablePrecompact`. Impure shell: `writePrecompactRecord`,
// `findNewestPrecompactRecord`. Both shells are best-effort and never throw.
import { existsSync } from 'node:fs';
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  readdir as fsReaddir,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CadenceStateZ } from '@thomas-powers-jr/cadence-types';
import type { GitFacts, PrecompactRecordPointer } from '@thomas-powers-jr/cadence-types';
import { readGitFacts } from './git-facts.js';

/** Consecutive lost races on a free name before the writer gives up (never a suffix limit). */
export const PRECOMPACT_RACE_RETRIES = 20;

/** How many records the writer keeps (the newest, by file name). */
export const PRECOMPACT_KEEP = 5;

/** Keys the host adapter adds to the translated stdin; not host payload fields. */
export const PRECOMPACT_ADAPTER_KEYS: readonly string[] = Object.freeze([
  'compactTrigger',
  'files',
  'skill',
  'agentId',
  'agentType',
]);

const RECORD_RE = /^PRECOMPACT-(\d{8}T\d{6}\.\d{3}Z)(?:-(\d+))?\.md$/;

/**
 * Order record names oldest → newest: by timestamp stem, then by numeric
 * collision suffix (the base name counts as 1). Plain string order is wrong
 * here because `-` sorts before `.`, and `-10` before `-2`.
 */
function compareRecordNames(a: string, b: string): number {
  const ma = RECORD_RE.exec(a);
  const mb = RECORD_RE.exec(b);
  const sa = ma?.[1] ?? '';
  const sb = mb?.[1] ?? '';
  if (sa !== sb) return sa < sb ? -1 : 1;
  return Number(ma?.[2] ?? '1') - Number(mb?.[2] ?? '1');
}
const UNAVAILABLE = 'unavailable';

export interface PrecompactLoopFacts {
  loopPosition: string;
  activePhase: string | null;
  activeDraft: string | null;
  activeSpec: string | null;
}

/** Git facts plus, when known, whether the branch has an upstream (no upstream → ahead/behind unavailable). */
export type PrecompactGitFacts = GitFacts | (Extract<GitFacts, { available: true }> & { upstream?: boolean });

export interface PrecompactFacts {
  now: Date;
  /** The host's trigger, passed through unchanged; absent → "unknown". */
  trigger?: string;
  payloadKeys: readonly string[];
  /** null when state.json could not be read. */
  loop: PrecompactLoopFacts | null;
  /** null or `{ available: false }` when git facts could not be gathered. */
  git: PrecompactGitFacts | null;
}

/** `<repoRoot>/.cadence/local/precompact` */
export function precompactDir(repoRoot: string): string {
  return join(repoRoot, '.cadence', 'local', 'precompact');
}

/** Repo-relative, forward-slash path of a record (never machine-absolute). */
function relativeRecordPath(fileName: string): string {
  return `.cadence/local/precompact/${fileName}`;
}

/** `PRECOMPACT-YYYYMMDDTHHMMSS.mmmZ` — sorts by name, no `:` (Windows-safe). */
export function precompactFileStem(now: Date): string {
  const iso = now.toISOString(); // 2026-11-02T18:19:23.456Z
  return `PRECOMPACT-${iso.replace(/[-:]/g, '')}`;
}

/** Collapse a free-text value to one line so it can never break the front matter. */
function oneLine(value: string | null | undefined, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > 0 ? flat : fallback;
}

/** JSON-quote a string, also escaping U+2028/U+2029 so it stays on one line for every reader. */
function quote(value: string): string {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Pure: render a record from injected facts. */
export function planPrecompactRecord(facts: PrecompactFacts): { fileName: string; content: string } {
  const generatedAt = facts.now.toISOString();
  const trigger = facts.trigger ?? 'unknown';
  const fm: string[] = [
    '---',
    'cadence_precompact: 1',
    `generated_at: ${generatedAt}`,
    `trigger: ${quote(trigger)}`,
  ];
  if (facts.loop === null) {
    fm.push(
      `loop_position: ${UNAVAILABLE}`,
      `active_phase: ${UNAVAILABLE}`,
      `active_draft: ${UNAVAILABLE}`,
      `active_spec: ${UNAVAILABLE}`,
    );
  } else {
    fm.push(
      `loop_position: ${oneLine(facts.loop.loopPosition, UNAVAILABLE)}`,
      `active_phase: ${oneLine(facts.loop.activePhase, 'none')}`,
      `active_draft: ${oneLine(facts.loop.activeDraft, 'none')}`,
      `active_spec: ${oneLine(facts.loop.activeSpec, 'none')}`,
    );
  }
  const git = facts.git;
  if (git !== null && git.available) {
    fm.push(
      `git_branch: ${oneLine(git.branch, UNAVAILABLE)}`,
      `git_head: ${oneLine(git.head, UNAVAILABLE)}`,
      `git_dirty: ${git.dirty ? 'true' : 'false'}`,
      `git_ahead: ${'upstream' in git && git.upstream === false ? UNAVAILABLE : git.ahead}`,
      `git_behind: ${'upstream' in git && git.upstream === false ? UNAVAILABLE : git.behind}`,
    );
  } else {
    fm.push(`git: ${UNAVAILABLE}`);
  }
  fm.push('---');

  const fields =
    facts.payloadKeys.length > 0
      ? facts.payloadKeys.map((k) => `- ${oneLine(k, '?')}`).join('\n')
      : '- (none)';
  const body = [
    '',
    `# Pre-compaction record — ${generatedAt}`,
    '',
    'Written by `cadence hook pre-compact` just before the host compacted the session. ' +
      'Machine facts only: nothing here was written by the agent, and no state or ' +
      'handoff file was changed. The trigger is in the front matter; the body never ' +
      'carries a payload value.',
    '',
    '## Host payload fields (names only, never values)',
    '',
    fields,
    '',
    '## Next step',
    '',
    'Run `cadence resume` to replay the freshest SESSION handoff, then `cadence progress`.',
    '',
  ];
  return {
    fileName: `${precompactFileStem(facts.now)}.md`,
    content: `${fm.join('\n')}\n${body.join('\n')}`,
  };
}

/** Pure: the host payload's top-level field names, sorted, minus adapter-added keys. */
export function payloadFieldNames(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.keys(raw as Record<string, unknown>)
    .filter((k) => !PRECOMPACT_ADAPTER_KEYS.includes(k))
    .sort();
}

/** Pure: record file names beyond the newest `keep`, by file name. Other names are ignored. */
export function selectPrunablePrecompact(names: readonly string[], keep = PRECOMPACT_KEEP): string[] {
  const records = names.filter((n) => RECORD_RE.test(n)).sort(compareRecordNames).reverse();
  return records.slice(Math.max(0, keep));
}

export interface PrecompactFsDeps {
  mkdir?: (path: string, opts: { recursive: true }) => Promise<unknown>;
  writeFileExclusive?: (path: string, content: string) => Promise<void>;
  readdir?: (path: string) => Promise<string[]>;
  unlink?: (path: string) => Promise<void>;
}

export interface WritePrecompactDeps {
  now?: () => Date;
  readGit?: (root: string) => Promise<PrecompactGitFacts | null>;
  readLoop?: (repoRoot: string) => Promise<PrecompactLoopFacts | null>;
  fs?: PrecompactFsDeps;
}

export interface WritePrecompactInput {
  trigger?: string;
  /** The raw stdin payload, read for its field names only. */
  raw?: unknown;
}

export type WritePrecompactResult = { ok: true; path: string } | { ok: false; reason: string };

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Read the loop facts from state.json, read-only. null on any failure,
 * including a state.json that does not satisfy the state schema (the same
 * file `cadence` itself would refuse to read).
 */
async function defaultReadLoop(repoRoot: string): Promise<PrecompactLoopFacts | null> {
  try {
    const parsed = CadenceStateZ.safeParse(
      JSON.parse(await fsReadFile(join(repoRoot, '.cadence', 'state.json'), 'utf8')),
    );
    if (!parsed.success) return null;
    const st = parsed.data;
    return {
      loopPosition: st.loopPosition,
      activePhase: st.activePhase,
      activeDraft: st.activeDraft,
      activeSpec: st.activeSpec,
    };
  } catch {
    return null;
  }
}

const pexecFile = promisify(execFile);

/**
 * Git facts for the record: `readGitFacts` (never fetches) plus two local
 * reads it does not do: the full branch name (`readGitFacts` cuts a name at
 * its first `.`) and whether the branch has an upstream (without one,
 * ahead/behind are not known and the record says so). Never throws.
 */
async function defaultReadGit(root: string): Promise<PrecompactGitFacts | null> {
  const facts = await readGitFacts(root);
  if (!facts.available) return facts;
  const git = async (args: string[]): Promise<string | null> => {
    try {
      const { stdout } = await pexecFile('git', args, { cwd: root, timeout: 5000, windowsHide: true });
      const out = stdout.trim();
      return out.length > 0 ? out : null;
    } catch {
      return null;
    }
  };
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  return { ...facts, ...(branch !== null ? { branch } : {}), upstream: upstream !== null };
}

/**
 * Write one record. Never throws and never writes to stdout or stderr: the
 * caller reports the result in one line. Refuses (ok:false) without creating
 * anything when `<repoRoot>/.cadence/` does not exist.
 */
export async function writePrecompactRecord(
  repoRoot: string,
  input: WritePrecompactInput,
  deps: WritePrecompactDeps = {},
): Promise<WritePrecompactResult> {
  try {
    if (!existsSync(join(repoRoot, '.cadence'))) {
      return { ok: false, reason: `no .cadence/ directory at ${repoRoot}; nothing was written` };
    }
    const fs = deps.fs ?? {};
    const mkdir = fs.mkdir ?? ((p: string, o: { recursive: true }) => fsMkdir(p, o));
    const writeExclusive =
      fs.writeFileExclusive ??
      ((p: string, c: string) => fsWriteFile(p, c, { encoding: 'utf8', flag: 'wx' }));
    const readdir = fs.readdir ?? ((p: string) => fsReaddir(p));
    const unlink = fs.unlink ?? ((p: string) => fsUnlink(p));

    const now = (deps.now ?? (() => new Date()))();
    let loop: PrecompactLoopFacts | null = null;
    try {
      loop = await (deps.readLoop ?? defaultReadLoop)(repoRoot);
    } catch {
      loop = null;
    }
    let git: PrecompactGitFacts | null = null;
    try {
      git = await (deps.readGit ?? defaultReadGit)(repoRoot);
    } catch {
      git = null;
    }

    const plan = planPrecompactRecord({
      now,
      ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
      payloadKeys: payloadFieldNames(input.raw),
      loop,
      git,
    });

    const dir = precompactDir(repoRoot);
    try {
      await mkdir(dir, { recursive: true });
    } catch (err) {
      return { ok: false, reason: `cannot create ${relativeRecordPath('')}: ${errMessage(err)}` };
    }

    // A same-millisecond collision takes the next free numeric suffix after
    // the highest one already on disk (the base name counts as 1), so there is
    // no fixed limit on suffixes. Only a write that loses a race to a
    // concurrent writer on that exact name retries, and only a bounded number
    // of times in a row.
    const stem = plan.fileName.slice(0, -'.md'.length);
    const nextFreeName = async (): Promise<string> => {
      let max = 1;
      for (const n of await readdir(dir)) {
        const m = RECORD_RE.exec(n);
        if (m === null || `PRECOMPACT-${m[1] ?? ''}` !== stem) continue;
        max = Math.max(max, Number(m[2] ?? '1'));
      }
      return `${stem}-${max + 1}.md`;
    };
    let name = plan.fileName;
    let written: string | null = null;
    for (let attempt = 0; attempt < PRECOMPACT_RACE_RETRIES && written === null; attempt++) {
      try {
        await writeExclusive(join(dir, name), plan.content);
        written = name;
      } catch (err) {
        if ((err as { code?: unknown }).code !== 'EEXIST') {
          return { ok: false, reason: `cannot write ${relativeRecordPath(name)}: ${errMessage(err)}` };
        }
        try {
          name = await nextFreeName();
        } catch (listErr) {
          return { ok: false, reason: `cannot list ${relativeRecordPath('')}: ${errMessage(listErr)}` };
        }
      }
    }
    if (written === null) {
      return {
        ok: false,
        reason: `concurrent writers took ${PRECOMPACT_RACE_RETRIES} names in a row; nothing was written`,
      };
    }

    // Silent, best-effort retention: a prune failure never fails the write.
    try {
      for (const name of selectPrunablePrecompact(await readdir(dir))) {
        if (name === written) continue;
        try {
          await unlink(join(dir, name));
        } catch {
          /* best-effort */
        }
      }
    } catch {
      /* best-effort */
    }
    return { ok: true, path: relativeRecordPath(written) };
  } catch (err) {
    return { ok: false, reason: errMessage(err) };
  }
}

/** The record pointer; its schema lives in cadence-types (`PrecompactRecordPointerZ`). */
export type { PrecompactRecordPointer } from '@thomas-powers-jr/cadence-types';

/** The newest record's pointer, or null on none or any failure. Never throws. */
export async function findNewestPrecompactRecord(
  repoRoot: string,
): Promise<PrecompactRecordPointer | null> {
  try {
    const dir = precompactDir(repoRoot);
    const names = (await fsReaddir(dir)).filter((n) => RECORD_RE.test(n)).sort(compareRecordNames);
    const newest = names[names.length - 1];
    if (newest === undefined) return null;
    const content = await fsReadFile(join(dir, newest), 'utf8');
    const fm = content.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n/)?.[1];
    if (fm === undefined) return null;
    const generatedAt = fm.match(/^generated_at: (.+)$/m)?.[1]?.trim();
    const triggerRaw = fm.match(/^trigger: (.+)$/m)?.[1]?.trim();
    if (generatedAt === undefined || triggerRaw === undefined) return null;
    let trigger: string;
    try {
      const parsed: unknown = JSON.parse(triggerRaw);
      trigger = typeof parsed === 'string' ? parsed : triggerRaw;
    } catch {
      trigger = triggerRaw;
    }
    return { path: relativeRecordPath(newest), trigger, generatedAt };
  } catch {
    return null;
  }
}
