import { describe, it, expect } from 'vitest';
import { CODEX_EXPECTED_HOOKS as TOOLKIT_EXPECTED_HOOKS } from '@thomas-powers-jr/cadence-host-toolkit';
import { CODEX_EXPECTED_HOOKS as CORE_EXPECTED_HOOKS } from '@thomas-powers-jr/cadence-core';

/**
 * Phase 308: `install.ts` (this package) builds its `desired` hook map from
 * `@thomas-powers-jr/cadence-host-toolkit`'s `CODEX_EXPECTED_HOOKS`;
 * `cadence doctor`'s `checkCodexHooks` (core) holds its own independent copy,
 * since core cannot import host-toolkit or any host-adapter package. This
 * package already depends on both, so it is where the two get pinned
 * against each other — mirrors
 * `packages/host-claude-code/tests/expected-hooks-drift.test.ts`'s phase-295
 * precedent for the Claude Code pair. If either list gains, loses, or
 * changes an entry without the other following, this test fails instead of
 * the installer and the doctor check silently disagreeing about what "fully
 * installed" means.
 */
function sortedKey(list: readonly { event: string; matcher: string | null }[]): string[] {
  return list.map((e) => `${e.event}::${e.matcher ?? ''}`).sort();
}

describe('host-toolkit and core agree on the expected Codex hook set', () => {
  it('308-01/AC-3: the two independently-held lists describe the same (event, matcher) pairs', () => {
    expect(sortedKey(CORE_EXPECTED_HOOKS)).toEqual(sortedKey(TOOLKIT_EXPECTED_HOOKS));
  });

  it('308-01/AC-3: the set matches what this repo actually needs (sanity, not just self-consistency)', () => {
    expect(sortedKey(TOOLKIT_EXPECTED_HOOKS)).toEqual(
      [
        'PostToolUse::^apply_patch$',
        'PreToolUse::^apply_patch$',
        'SessionStart::',
        'Stop::',
        'SubagentStop::',
        'UserPromptSubmit::',
      ].sort(),
    );
  });
});
