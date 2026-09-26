import type { AbstractEvent } from '@thomas-powers-jr/cadence-types';
import type { HookResult } from './handlers.js';

/** What `cadence hook` should write and how it should exit for one result. */
export interface RenderedHookResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Reason used in a JSON block document when the handler gave no blockMessage. */
export const FALLBACK_BLOCK_REASON = 'blocked by a CADENCE hook';

/**
 * Pure transport for a {@link HookResult} (dec-20260925-001, phase 317).
 *
 * A blocking result is signalled with a JSON decision document on stdout and
 * exit 0 instead of exit 2, because an exit 2 can collapse to 1 when the hook
 * runs under PowerShell and then fails to block at all.
 *
 * - `ok: true` → `contextPayload + '\n'` on stdout when it is a non-empty
 *   string (byte-identical to the old `console.log`), exit 0.
 * - `ok: false` on `pre-tool-edit` → a `PreToolUse` `deny` document, with
 *   `additionalContext` appended when a `contextPayload` is present, exit 0.
 * - `ok: false` on `session-stop` / `subagent-result` → a top-level
 *   `{"decision":"block","reason":...}` document, exit 0. Any
 *   `contextPayload` is dropped with a loud stderr notice: Stop/SubagentStop
 *   have no documented combined shape.
 * - `ok: false` on any other event → legacy exit 2 plus a loud stderr notice
 *   that no JSON block shape is defined for it.
 *
 * `blockMessage` is always mirrored to stderr as a diagnostic. No I/O here —
 * `hook.ts` writes the returned strings.
 */
export function renderHookResult(event: AbstractEvent, result: HookResult): RenderedHookResult {
  if (result.ok) {
    return {
      stdout: result.contextPayload ? result.contextPayload + '\n' : '',
      stderr: '',
      exitCode: 0,
    };
  }

  const blockMessage = result.blockMessage ? result.blockMessage : undefined;
  const diagnostic = blockMessage !== undefined ? blockMessage + '\n' : '';
  const reason = blockMessage ?? FALLBACK_BLOCK_REASON;

  if (event === 'pre-tool-edit') {
    const hookSpecificOutput = {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
      ...(result.contextPayload ? { additionalContext: result.contextPayload } : {}),
    };
    return {
      stdout: JSON.stringify({ hookSpecificOutput }) + '\n',
      stderr: diagnostic,
      exitCode: 0,
    };
  }

  if (event === 'session-stop' || event === 'subagent-result') {
    const notice = result.contextPayload
      ? `cadence hook: WARNING: ${event} returned both a block and a contextPayload; ` +
        'the contextPayload was dropped because Stop/SubagentStop have no documented ' +
        'combined block + additionalContext shape.\n'
      : '';
    return {
      stdout: JSON.stringify({ decision: 'block', reason }) + '\n',
      stderr: diagnostic + notice,
      exitCode: 0,
    };
  }

  return {
    stdout: '',
    stderr:
      diagnostic +
      `cadence hook: WARNING: ${event} returned a block, but no JSON block shape is ` +
      'defined for it; falling back to exit 2, which may not block when the hook runs ' +
      'under PowerShell.\n' +
      (result.contextPayload
        ? `cadence hook: WARNING: ${event} also returned a contextPayload; the ` +
          'contextPayload was dropped because a blocked legacy-path result has no stdout channel.\n'
        : ''),
    exitCode: 2,
  };
}
