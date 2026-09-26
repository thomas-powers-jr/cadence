import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  hasManagedCadence,
  hasStaleScopeManagedHook,
  findMissingManagedHooks,
  type ExpectedManagedHook,
} from './host-hooks.js';

/**
 * The install state of CADENCE's Claude Code lifecycle hooks in
 * `.claude/settings.json` — the classification `checkHostHooks` reports on,
 * shared (phase 317, AC-7) with `checkHookTransport` so the two doctor checks
 * can never disagree about which state the install is in. Each check calls
 * {@link readHostHooksInstallState} independently; neither reads the other's
 * `DoctorCheck` output.
 */
export type HostHooksInstallState =
  | { kind: 'missing-file' }
  | { kind: 'invalid-json'; message: string }
  | { kind: 'incomplete'; missing: ExpectedManagedHook[] }
  | { kind: 'stale-scope' }
  | { kind: 'no-managed-entries' }
  /** `firstManagedEntry`: the first `_managedBy: "cadence"` entry in document
   *  order (`hooks` object key order, then array order), or `null` if none
   *  could be located (defensive; a complete install always has one). */
  | { kind: 'complete'; firstManagedEntry: Record<string, unknown> | null };

/** The first `_managedBy: "cadence"` hook entry in a parsed settings document,
 *  walked in document order: `hooks` object key order, then each event's array order. */
export function firstManagedCadenceEntry(parsed: unknown): Record<string, unknown> | null {
  if (parsed === null || typeof parsed !== 'object') return null;
  const hooks = (parsed as { hooks?: unknown }).hooks;
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) return null;
  for (const entries of Object.values(hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (e !== null && typeof e === 'object' && !Array.isArray(e)) {
        const entry = e as Record<string, unknown>;
        if (entry['_managedBy'] === 'cadence') return entry;
      }
    }
  }
  return null;
}

/**
 * Pure classification of an already-parsed `.claude/settings.json` document,
 * in exactly `checkHostHooks`'s original branch order: completeness first
 * (phase 295), then current-and-managed, then stale scope (phase 250), then
 * no managed entries at all.
 *
 * Note: `no-managed-entries` is not reachable from real input today — an
 * empty `missing` list means every expected event carries a `_managedBy:
 * "cadence"` entry, so `hasManagedCadence` can only be false via staleness,
 * which the preceding branch catches. It is kept to preserve the original
 * branch structure exactly.
 */
export function classifyHostHooksSettings(
  parsed: unknown,
): Exclude<HostHooksInstallState, { kind: 'missing-file' } | { kind: 'invalid-json' }> {
  const missing = findMissingManagedHooks(parsed);
  if (missing.length > 0) return { kind: 'incomplete', missing };
  if (hasManagedCadence(parsed)) {
    return { kind: 'complete', firstManagedEntry: firstManagedCadenceEntry(parsed) };
  }
  if (hasStaleScopeManagedHook(parsed)) return { kind: 'stale-scope' };
  return { kind: 'no-managed-entries' };
}

/**
 * Thin impure wrapper: reads `<root>/.claude/settings.json` and classifies it.
 * Never throws — a read failure lands in `invalid-json` with the error's
 * message, exactly as `checkHostHooks`'s single try/catch around
 * read-and-parse always did.
 */
export async function readHostHooksInstallState(root: string): Promise<HostHooksInstallState> {
  const settings = join(root, '.claude', 'settings.json');
  if (!existsSync(settings)) return { kind: 'missing-file' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(settings, 'utf8'));
  } catch (err) {
    return { kind: 'invalid-json', message: err instanceof Error ? err.message : String(err) };
  }
  return classifyHostHooksSettings(parsed);
}
