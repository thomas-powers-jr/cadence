// packages/core/src/hooks/hook-liveness.ts
//
// Phase 349 (349-01, AC-1): pure host-hook liveness check. The hook
// dispatcher stamps `state.session.lastHookEventAt` on every event it handles
// (see `StateBackend.stampHookEvent`); this decides whether that stamp is
// recent enough to say the host hooks are firing in this session. Distinct
// from `../phases/liveness.ts`, which is PROGRESS.json freshness.
//
// Phase 349 (349-01, AC-2) adds the best-effort `installedHostHookConfigs`
// observer beside it (impure, read-only, never throws).

import { join } from 'node:path';
import { hasManagedCadenceEntryAt } from '../doctor/host-hooks-state.js';

/** How recent the last hook event must be to count as live: 30 minutes. A constant, not config. */
export const HOOK_LIVENESS_WINDOW_MS = 30 * 60 * 1000;

/**
 * True only when `lastHookEventAt` is present, parses as a date, and
 * `0 <= now - stamp <= HOOK_LIVENESS_WINDOW_MS`. A stamp later than `now`
 * (clock skew, a copied state.json) is not live.
 */
export function isHookLive(lastHookEventAt: string | null | undefined, now: Date): boolean {
  if (typeof lastHookEventAt !== 'string' || lastHookEventAt.length === 0) return false;
  const stamp = Date.parse(lastHookEventAt);
  if (Number.isNaN(stamp)) return false;
  const age = now.getTime() - stamp;
  return age >= 0 && age <= HOOK_LIVENESS_WINDOW_MS;
}

/** The host hook config files CADENCE installs, repo-relative, in report order. */
export const HOST_HOOK_CONFIG_PATHS = ['.claude/settings.json', '.codex/hooks.json'] as const;

/**
 * Phase 349 (349-01, AC-2): the repo-relative paths among
 * {@link HOST_HOOK_CONFIG_PATHS} that hold a CADENCE-managed hook entry, in
 * that fixed order. Read-only and best-effort: any failure contributes
 * nothing, so the worst case is `[]` ("no host hooks installed"). Never throws.
 */
export async function installedHostHookConfigs(root: string): Promise<string[]> {
  const installed: string[] = [];
  for (const rel of HOST_HOOK_CONFIG_PATHS) {
    try {
      if (await hasManagedCadenceEntryAt(join(root, ...rel.split('/')))) installed.push(rel);
    } catch {
      // best-effort observer: contribute nothing
    }
  }
  return installed;
}

/**
 * Joins installed host config paths for a human-facing message: one path
 * as-is, two as `a and b`, more as `a, b and c`.
 */
export function joinHostConfigPaths(paths: readonly string[]): string {
  if (paths.length <= 1) return paths.join('');
  return `${paths.slice(0, -1).join(', ')} and ${paths[paths.length - 1] ?? ''}`;
}
