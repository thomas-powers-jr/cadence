import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mergeManagedHookEntries } from '@thomas-powers-jr/cadence-host-toolkit/install-merge';
import type { ManagedHookEntry } from '@thomas-powers-jr/cadence-host-toolkit/install-merge';
import { CODEX_EXPECTED_HOOKS } from '@thomas-powers-jr/cadence-host-toolkit';
import { resolveLocalPaths } from './locate-self.js';

export interface InstallOptions {
  /**
   * Shim command Codex invokes for every hook event. The shim reads stdin,
   * translates the payload, and spawns the core CLI.
   * Default: `npx @thomas-powers-jr/cadence-host-codex hook`.
   */
  command?: string;
  /**
   * Base command the shim itself uses to invoke `@thomas-powers-jr/cadence-core`.
   * If set, appended as `--cadence "<cmd>"`. Default: the shim's own default.
   */
  cadenceCommand?: string;
  /** Hook config path relative to root. Default `.codex/hooks.json`. */
  hooksPath?: string;
  /**
   * Use absolute paths to the local workspace builds instead of the `npx`
   * defaults. Monorepo dogfood only — writes machine-absolute paths.
   */
  local?: boolean;
}

type HookEntry = ManagedHookEntry;

interface HooksFile {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

/**
 * Write cadence-managed Codex hook entries into project-level
 * `{root}/.codex/hooks.json` (FINDINGS §3). Idempotent: cadence-managed entries
 * are replaced on re-install; user-authored entries on the same event are
 * preserved. Hooks are project-scoped — unlike the global slash-command prompts.
 */
export async function installHooks(root: string, opts: InstallOptions = {}): Promise<void> {
  const local = opts.local ? resolveLocalPaths() : null;
  const base = opts.command ?? (local ? `node ${local.shimCli} hook` : 'npx @thomas-powers-jr/cadence-host-codex hook');
  const cadenceCommand = opts.cadenceCommand ?? (local ? `node ${local.coreCli}` : undefined);
  const command = cadenceCommand ? `${base} --cadence "${cadenceCommand}"` : base;
  const hooksPath = join(root, opts.hooksPath ?? '.codex/hooks.json');

  let current: HooksFile = {};
  try {
    current = JSON.parse(await readFile(hooksPath, 'utf8')) as HooksFile;
  } catch {
    // absent or malformed → start fresh
  }
  if (typeof current !== 'object' || current === null || Array.isArray(current)) current = {};

  const plain = (): HookEntry => ({ hooks: [{ type: 'command', command }], _managedBy: 'cadence' });
  const matched = (matcher: string): HookEntry => ({
    matcher,
    hooks: [{ type: 'command', command }],
    _managedBy: 'cadence',
  });

  // Phase 308: built from CODEX_EXPECTED_HOOKS, the single source of truth
  // also pinned against core's independent copy by a drift test
  // (packages/host-codex/tests/expected-hooks-drift.test.ts) — this
  // installer and cadence doctor's completeness check must not disagree
  // about what "fully installed" means.
  const desired: Record<string, HookEntry[]> = {};
  for (const { event, matcher } of CODEX_EXPECTED_HOOKS) {
    (desired[event] ??= []).push(matcher === null ? plain() : matched(matcher));
  }

  current.hooks = mergeManagedHookEntries(current.hooks ?? {}, desired);

  await mkdir(dirname(hooksPath), { recursive: true });
  await writeFile(hooksPath, JSON.stringify(current, null, 2) + '\n', 'utf8');
}
