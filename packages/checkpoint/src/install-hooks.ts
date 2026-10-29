import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { atomicWriteText } from '@thomas-powers-jr/cadence-core';
import { mergeManagedHookEntries } from '@thomas-powers-jr/cadence-host-toolkit/install-merge';
import type { ManagedHookEntry } from '@thomas-powers-jr/cadence-host-toolkit/install-merge';
import { checkpointBinPath, wrapperPrefixFor } from './install.js';
import { parseStopGateArgs } from './stop-gate.js';

/**
 * `checkpoint hooks-install --settings <path> [--threshold <pct>] [--ceiling <n>]`
 * (phase 336, AC-12, AC-20): installs checkpoint's own Claude Code `Stop`
 * (`stop-gate`) and `SessionStart` (`session-start`) hook entries, each tagged
 * `_managedBy: "cadence-checkpoint"`, into a settings file.
 *
 * - Merge: host-toolkit's `mergeManagedHookEntries` with a stale rule that
 *   matches ONLY `cadence-checkpoint` entries, so cadence's own
 *   `_managedBy: "cadence"` entries and every user-authored entry keep their
 *   place and order; a prior checkpoint entry is replaced, never duplicated.
 *   Cadence's installer, with its default stale rule, likewise leaves these
 *   entries alone.
 * - Unlike `statusline-install`, the file IS re-serialized
 *   (`JSON.stringify(next, null, 2) + "\n"`, the host installer's precedent),
 *   so a first run on a differently formatted file reformats it. Semantic
 *   preservation, as `JSON.parse` sees the file, is enforced instead: the
 *   planned text is re-parsed and refused unless it deep-equals the original
 *   everywhere except the checkpoint-managed entries of `hooks.Stop` /
 *   `hooks.SessionStart` (`verifyOnlyManagedHooksChanged`). What parsing
 *   itself discards is not preserved and cannot be seen by the guard,
 *   including: whitespace, CRLF line endings, duplicate keys (last wins, as
 *   for Claude Code), number spellings (integers beyond 2^53, `1.0`, `1e3`,
 *   `-0`), string-escape spellings, and integer-like key order.
 * - Idempotent: when the planned object deep-equals the current one nothing
 *   is written ("already installed"), so the bytes and mtime stay as they are.
 * - Strict UTF-8 decode (refused otherwise); a leading BOM is tolerated for
 *   parsing and PRESERVED on write, since dropping it would change a byte
 *   outside the managed entries.
 * - A missing settings file is refused, exactly like `statusline-install`
 *   (it never creates one).
 * - The rewrite keeps the file's permission bits and goes through
 *   `atomicWriteText`.
 * - The hook command's flags are re-validated with stop-gate's own parser
 *   before install, so a value stop-gate would refuse at hook time (and so
 *   silently not gate) is refused here instead.
 */

export const CHECKPOINT_MANAGED_BY = 'cadence-checkpoint';

/** The two events this installer owns entries in. */
const MANAGED_EVENTS = ['Stop', 'SessionStart'] as const;

const BOM = String.fromCharCode(0xfeff);

export interface HooksInstallFlags {
  threshold: number;
  ceiling: number;
}

export type HooksInstallPlan = { ok: true; text: string; changed: boolean } | { ok: false; reason: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** True for a hook entry carrying checkpoint's marker; null-safe for non-object entries. */
export function isCheckpointManagedEntry(entry: unknown): boolean {
  return asRecord(entry)?.['_managedBy'] === CHECKPOINT_MANAGED_BY;
}

function stopGateFlags(flags: HooksInstallFlags): string[] {
  return ['--threshold', String(flags.threshold), '--ceiling', String(flags.ceiling)];
}

/** Pure: the desired checkpoint entries (no matcher; both stop-gate flags always explicit). */
export function desiredCheckpointHooks(prefix: string, flags: HooksInstallFlags): Record<string, ManagedHookEntry[]> {
  return {
    Stop: [
      {
        hooks: [{ type: 'command', command: `${prefix} stop-gate ${stopGateFlags(flags).join(' ')}` }],
        _managedBy: CHECKPOINT_MANAGED_BY,
      },
    ],
    SessionStart: [
      { hooks: [{ type: 'command', command: `${prefix} session-start` }], _managedBy: CHECKPOINT_MANAGED_BY },
    ],
  };
}

/**
 * Pure: true only when `afterText` parses to `beforeText`'s object with
 * nothing changed except the checkpoint-managed entries of `hooks.Stop` and
 * `hooks.SessionStart` (which must now be exactly `desired`'s), allowing
 * `hooks` and those two keys to be created when absent. Non-managed entries
 * must be unchanged and in their original order.
 */
export function verifyOnlyManagedHooksChanged(
  beforeText: string,
  afterText: string,
  desired: Record<string, ManagedHookEntry[]>,
): boolean {
  let before: Record<string, unknown> | null;
  let after: Record<string, unknown> | null;
  try {
    before = asRecord(JSON.parse(stripBom(beforeText)));
    after = asRecord(JSON.parse(stripBom(afterText)));
  } catch {
    return false;
  }
  if (before === null || after === null) return false;

  const { hooks: beforeHooksRaw, ...restBefore } = before;
  const { hooks: afterHooksRaw, ...restAfter } = after;
  if (!isDeepStrictEqual(restAfter, restBefore)) return false;

  const hadHooks = Object.prototype.hasOwnProperty.call(before, 'hooks');
  const beforeHooks = hadHooks ? asRecord(beforeHooksRaw) : {};
  const afterHooks = asRecord(afterHooksRaw);
  if (beforeHooks === null || afterHooks === null) return false;

  const pick = (hooks: Record<string, unknown>) => {
    const rest: Record<string, unknown> = { ...hooks };
    for (const event of MANAGED_EVENTS) delete rest[event];
    return rest;
  };
  if (!isDeepStrictEqual(pick(afterHooks), pick(beforeHooks))) return false;

  for (const event of MANAGED_EVENTS) {
    const had = Object.prototype.hasOwnProperty.call(beforeHooks, event);
    const beforeList = had ? beforeHooks[event] : [];
    const afterList = afterHooks[event];
    if (!Array.isArray(beforeList) || !Array.isArray(afterList)) return false;
    const unmanaged = (list: unknown[]) => list.filter((e) => !isCheckpointManagedEntry(e));
    if (!isDeepStrictEqual(unmanaged(afterList), unmanaged(beforeList))) return false;
    if (!isDeepStrictEqual(afterList.filter(isCheckpointManagedEntry), desired[event] ?? [])) return false;
  }
  return true;
}

/**
 * Pure: plans the install into the raw settings text (a leading BOM is
 * tolerated and kept). Returns the full new text with `changed: true`, the
 * input text unchanged with `changed: false` when already installed, or a
 * one-line refusal.
 */
export function planHooksInstall(settingsText: string, prefix: string, flags: HooksInstallFlags): HooksInstallPlan {
  // stop-gate must accept, at hook time, exactly what is written here.
  const reparsed = parseStopGateArgs(stopGateFlags(flags));
  if (!reparsed.ok) return { ok: false, reason: reparsed.reason };
  if (reparsed.options.threshold !== flags.threshold || reparsed.options.ceiling !== flags.ceiling) {
    return { ok: false, reason: "the stop-gate flags do not round-trip through stop-gate's own parser" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(settingsText));
  } catch (err) {
    return { ok: false, reason: `settings file is not valid JSON (${oneLine((err as Error).message)})` };
  }
  const root = asRecord(parsed);
  if (root === null) return { ok: false, reason: 'settings file is not a JSON object' };

  let existing: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(root, 'hooks')) {
    const hooks = asRecord(root['hooks']);
    if (hooks === null) return { ok: false, reason: 'hooks is not an object' };
    existing = hooks;
  }
  for (const event of MANAGED_EVENTS) {
    if (Object.prototype.hasOwnProperty.call(existing, event) && !Array.isArray(existing[event])) {
      return { ok: false, reason: `hooks.${event} is not an array` };
    }
  }

  const desired = desiredCheckpointHooks(prefix, flags);
  // Already installed: each managed event already holds exactly the desired
  // checkpoint entries, wherever they sit among the others (cadence's own
  // installer re-appends its entries after ours, which must not make the next
  // run here rewrite the file just to reorder).
  const installed = MANAGED_EVENTS.every((event) => {
    const list = existing[event];
    return Array.isArray(list) && isDeepStrictEqual(list.filter(isCheckpointManagedEntry), desired[event] ?? []);
  });
  if (installed) return { ok: true, text: settingsText, changed: false };

  // Only the two managed events are touched by the merge; other events pass
  // through as-is, whatever their shape.
  const merged = mergeManagedHookEntries(
    existing as Record<string, ManagedHookEntry[]>,
    desired,
    isCheckpointManagedEntry,
  );
  const next: Record<string, unknown> = { ...root, hooks: merged };

  const bom = settingsText.startsWith(BOM) ? BOM : '';
  const text = `${bom}${JSON.stringify(next, null, 2)}\n`;
  if (!verifyOnlyManagedHooksChanged(settingsText, text, desired)) {
    return { ok: false, reason: 'refusing: the planned edit would change more than the checkpoint-managed hook entries' };
  }
  return { ok: true, text, changed: true };
}

export type ParseHooksInstallArgsResult =
  | { ok: true; settingsPath: string; options: HooksInstallFlags }
  | { ok: false; reason: string };

/**
 * Pure: `--settings <path>` (required, once, non-empty) plus stop-gate's
 * `--threshold` / `--ceiling`, each as `--flag v` or `--flag=v`, validated by
 * stop-gate's own parser. `--max-reading-age-s` is not part of this surface
 * and is refused.
 */
export function parseHooksInstallArgs(argv: readonly string[]): ParseHooksInstallArgsResult {
  const refuse = (reason: string): ParseHooksInstallArgsResult => ({ ok: false, reason: oneLine(reason) });
  let settingsPath: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    let value: string | undefined;
    if (arg === '--settings') {
      value = argv[i + 1];
      i++;
    } else if (arg.startsWith('--settings=')) {
      value = arg.slice('--settings='.length);
    } else {
      const name = arg.startsWith('--') && arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
      if (name === '--max-reading-age-s') return refuse(`unknown argument "${arg}"`);
      rest.push(arg);
      continue;
    }
    if (value === undefined || value.length === 0 || value.startsWith('--')) return refuse('--settings needs a path');
    if (settingsPath !== undefined) return refuse('--settings is given more than once');
    settingsPath = value;
  }
  if (settingsPath === undefined) return refuse('--settings <path> is required');
  const parsed = parseStopGateArgs(rest);
  if (!parsed.ok) return refuse(parsed.reason);
  return {
    ok: true,
    settingsPath,
    options: { threshold: parsed.options.threshold, ceiling: parsed.options.ceiling },
  };
}

// ---------------------------------------------------------------------------
// Impure shell
// ---------------------------------------------------------------------------

export interface HooksInstallOptions {
  settingsPath: string;
  flags: HooksInstallFlags;
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  binPath?: string;
}

const NOTICE_PREFIX = 'checkpoint hooks-install: ';

/** Reads, plans, and (only when changed) atomically rewrites the settings file. Resolves 0, or 2 on refusal. */
export async function installHooks(opts: HooksInstallOptions): Promise<number> {
  const refuse = (reason: string): number => {
    opts.stderr.write(`${NOTICE_PREFIX}${reason}; ${opts.settingsPath} left unchanged\n`);
    return 2;
  };
  const prefix = wrapperPrefixFor(opts.binPath ?? checkpointBinPath());
  if (!prefix.ok) return refuse(prefix.reason);

  let raw: Buffer;
  // Carried onto the replacement so the rename never widens a private file.
  let mode: number;
  try {
    raw = await readFile(opts.settingsPath);
    mode = statSync(opts.settingsPath).mode & 0o7777;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return refuse(`cannot read ${opts.settingsPath} (${e.code ?? e.message})`);
  }
  // Strict decode, BOM kept as text (planHooksInstall strips it for parsing
  // and puts it back on write).
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    return refuse('settings file is not valid UTF-8');
  }
  if (!Buffer.from(text, 'utf8').equals(raw)) return refuse('settings file does not round-trip as UTF-8');

  const plan = planHooksInstall(text, prefix.prefix, opts.flags);
  if (!plan.ok) return refuse(plan.reason);

  const desired = desiredCheckpointHooks(prefix.prefix, opts.flags);
  const stopCommand = desired['Stop']?.[0]?.hooks[0]?.command ?? '';
  const sessionCommand = desired['SessionStart']?.[0]?.hooks[0]?.command ?? '';
  if (!plan.changed) {
    opts.stdout.write(`checkpoint hooks already installed in ${opts.settingsPath}; nothing written\n`);
    return 0;
  }

  try {
    await atomicWriteText(opts.settingsPath, plan.text, { mode });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return refuse(`cannot write ${opts.settingsPath} (${e.code ?? e.message})`);
  }
  opts.stdout.write(`Stop hook set to: ${stopCommand}\nSessionStart hook set to: ${sessionCommand}\n`);
  return 0;
}
