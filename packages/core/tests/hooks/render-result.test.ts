import { describe, it, expect } from 'vitest';
import { renderHookResult } from '../../src/hooks/render-result.js';

// Message shapes copied from the real `ok: false` sites in
// packages/core/src/hooks/handlers.ts (boundary, redundant-work, build-gate,
// session-stop, subagent-result).
const BOUNDARY_MSG =
  "boundaryEnforcement=block: file(s) not declared in any task's files: src/a.ts, src/b.ts";
const REDUNDANT_MSG =
  'redundantWorkEnforcement=block: src/a.ts belongs to T1, already DONE — mark it back to NEEDS_CONTEXT first (cadence build task T1 --status=NEEDS_CONTEXT), or confirm with the orchestrator.';
const BUILD_GATE_MSG =
  "preToolUseBuildGate is enabled and loopPosition=DRAFT. Run 'cadence draft approve' to enter BUILD phase before editing.";
const SESSION_STOP_MSG =
  "loopEnforcement=strict and 1 unclosed draft(s). Run 'cadence settle' before ending session.";
const FALLBACK_REASON = 'blocked by a CADENCE hook';

function denyDoc(reason: string): string {
  return (
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }) + '\n'
  );
}

describe('renderHookResult', () => {
  describe('ok:true (byte-identical to the legacy console.log transport)', () => {
    it('317-01/AC-5: ok:true with contextPayload writes payload + newline, exit 0', () => {
      const out = renderHookResult('session-start', { ok: true, contextPayload: 'hello\nworld' });
      expect(out).toEqual({ stdout: 'hello\nworld\n', stderr: '', exitCode: 0 });
    });

    it('317-01/AC-5: ok:true without contextPayload writes nothing, exit 0', () => {
      expect(renderHookResult('pre-tool-edit', { ok: true })).toEqual({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
    });

    it('317-01/AC-5: ok:true with an empty-string contextPayload writes nothing (legacy truthiness)', () => {
      expect(renderHookResult('user-prompt', { ok: true, contextPayload: '' })).toEqual({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });
    });
  });

  describe('pre-tool-edit ok:false -> PreToolUse deny document', () => {
    it('317-01/AC-1: boundary block (handlers.ts:177) renders the exact deny shape, exit 0', () => {
      const out = renderHookResult('pre-tool-edit', { ok: false, blockMessage: BOUNDARY_MSG });
      expect(out.stdout).toBe(denyDoc(BOUNDARY_MSG));
      expect(out.exitCode).toBe(0);
      expect(out.stderr).toBe(BOUNDARY_MSG + '\n');
      const parsed = JSON.parse(out.stdout) as {
        hookSpecificOutput: Record<string, unknown>;
      };
      expect(Object.keys(parsed)).toEqual(['hookSpecificOutput']);
      expect(Object.keys(parsed.hookSpecificOutput)).toEqual([
        'hookEventName',
        'permissionDecision',
        'permissionDecisionReason',
      ]);
      expect(parsed.hookSpecificOutput).toEqual({
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: BOUNDARY_MSG,
      });
    });

    it('317-01/AC-1: redundant-work block (handlers.ts:230) keeps its em dash in stdout and after JSON.parse', () => {
      const out = renderHookResult('pre-tool-edit', { ok: false, blockMessage: REDUNDANT_MSG });
      expect(out.stdout).toBe(denyDoc(REDUNDANT_MSG));
      expect(out.stdout).toContain('—');
      expect(out.stdout).not.toContain('\\u2014');
      expect(out.exitCode).toBe(0);
      expect(out.stderr).toBe(REDUNDANT_MSG + '\n');
      const parsed = JSON.parse(out.stdout) as {
        hookSpecificOutput: { permissionDecisionReason: string };
      };
      expect(Object.keys(parsed.hookSpecificOutput)).toEqual([
        'hookEventName',
        'permissionDecision',
        'permissionDecisionReason',
      ]);
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe(REDUNDANT_MSG);
      expect(parsed.hookSpecificOutput.permissionDecisionReason).toContain('—');
    });

    it('317-01/AC-1: build-gate block (handlers.ts:256) renders the exact deny shape, exit 0', () => {
      const out = renderHookResult('pre-tool-edit', { ok: false, blockMessage: BUILD_GATE_MSG });
      expect(out.stdout).toBe(denyDoc(BUILD_GATE_MSG));
      expect(out.exitCode).toBe(0);
      expect(out.stderr).toBe(BUILD_GATE_MSG + '\n');
      const parsed = JSON.parse(out.stdout) as {
        hookSpecificOutput: Record<string, unknown>;
      };
      expect(Object.keys(parsed.hookSpecificOutput)).toEqual([
        'hookEventName',
        'permissionDecision',
        'permissionDecisionReason',
      ]);
      expect(parsed.hookSpecificOutput['permissionDecisionReason']).toBe(BUILD_GATE_MSG);
    });

    it('317-01/AC-1: missing blockMessage falls back to the fixed reason, stderr empty', () => {
      const out = renderHookResult('pre-tool-edit', { ok: false });
      expect(out.stdout).toBe(denyDoc(FALLBACK_REASON));
      expect(out.stderr).toBe('');
      expect(out.exitCode).toBe(0);
    });

    it('317-01/AC-1: empty-string blockMessage falls back to the fixed reason', () => {
      const out = renderHookResult('pre-tool-edit', { ok: false, blockMessage: '' });
      expect(out.stdout).toBe(denyDoc(FALLBACK_REASON));
      expect(out.stderr).toBe('');
      expect(out.exitCode).toBe(0);
    });
  });

  describe('session-stop / subagent-result ok:false -> top-level block document', () => {
    it('317-01/AC-2: session-stop block (handlers.ts:297) renders {decision,reason}, exit 0', () => {
      const out = renderHookResult('session-stop', { ok: false, blockMessage: SESSION_STOP_MSG });
      expect(out.stdout).toBe(
        JSON.stringify({ decision: 'block', reason: SESSION_STOP_MSG }) + '\n',
      );
      expect(out.exitCode).toBe(0);
      expect(out.stderr).toBe(SESSION_STOP_MSG + '\n');
      const parsed = JSON.parse(out.stdout) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(['decision', 'reason']);
      expect(parsed).toEqual({ decision: 'block', reason: SESSION_STOP_MSG });
    });

    it('317-01/AC-2: subagent-result block (handlers.ts:368 message, constructed directly) renders {decision,reason} with em dash, exit 0', () => {
      const out = renderHookResult('subagent-result', { ok: false, blockMessage: REDUNDANT_MSG });
      expect(out.stdout).toBe(JSON.stringify({ decision: 'block', reason: REDUNDANT_MSG }) + '\n');
      expect(out.stdout).toContain('—');
      expect(out.exitCode).toBe(0);
      expect(out.stderr).toBe(REDUNDANT_MSG + '\n');
      const parsed = JSON.parse(out.stdout) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(['decision', 'reason']);
      expect(parsed['reason']).toBe(REDUNDANT_MSG);
    });

    it('317-01/AC-2: missing blockMessage falls back to the fixed reason', () => {
      const out = renderHookResult('session-stop', { ok: false });
      expect(out.stdout).toBe(JSON.stringify({ decision: 'block', reason: FALLBACK_REASON }) + '\n');
      expect(out.stderr).toBe('');
      expect(out.exitCode).toBe(0);
    });
  });

  describe('combined ok:false + contextPayload', () => {
    it('317-01/AC-6: pre-tool-edit adds additionalContext after permissionDecisionReason', () => {
      const out = renderHookResult('pre-tool-edit', {
        ok: false,
        blockMessage: BUILD_GATE_MSG,
        contextPayload: 'extra context',
      });
      expect(out.stdout).toBe(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: BUILD_GATE_MSG,
            additionalContext: 'extra context',
          },
        }) + '\n',
      );
      expect(out.exitCode).toBe(0);
      expect(out.stderr).toBe(BUILD_GATE_MSG + '\n');
      const parsed = JSON.parse(out.stdout) as {
        hookSpecificOutput: Record<string, unknown>;
      };
      expect(Object.keys(parsed)).toEqual(['hookSpecificOutput']);
      expect(Object.keys(parsed.hookSpecificOutput)).toEqual([
        'hookEventName',
        'permissionDecision',
        'permissionDecisionReason',
        'additionalContext',
      ]);
      expect(parsed.hookSpecificOutput['additionalContext']).toBe('extra context');
    });

    it('317-01/AC-6: session-stop emits only the bare block document and a loud stderr notice that contextPayload was dropped', () => {
      const out = renderHookResult('session-stop', {
        ok: false,
        blockMessage: SESSION_STOP_MSG,
        contextPayload: 'dropped payload',
      });
      expect(out.stdout).toBe(
        JSON.stringify({ decision: 'block', reason: SESSION_STOP_MSG }) + '\n',
      );
      expect(out.stdout).not.toContain('dropped payload');
      expect(out.exitCode).toBe(0);
      const parsed = JSON.parse(out.stdout) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(['decision', 'reason']);
      expect(out.stderr.startsWith(SESSION_STOP_MSG + '\n')).toBe(true);
      const notice = out.stderr.slice(SESSION_STOP_MSG.length + 1);
      expect(notice).toMatch(/contextPayload/);
      expect(notice).toMatch(/dropped/);
      expect(notice).toMatch(/session-stop/);
      expect(notice.endsWith('\n')).toBe(true);
    });

    it('317-01/AC-6: subagent-result with contextPayload also drops it with a stderr notice', () => {
      const out = renderHookResult('subagent-result', {
        ok: false,
        blockMessage: REDUNDANT_MSG,
        contextPayload: 'dropped payload',
      });
      expect(out.stdout).toBe(JSON.stringify({ decision: 'block', reason: REDUNDANT_MSG }) + '\n');
      expect(out.exitCode).toBe(0);
      expect(out.stderr).toMatch(/contextPayload/);
      expect(out.stderr).toMatch(/dropped/);
      expect(out.stderr).toMatch(/subagent-result/);
    });
  });

  describe('ok:false on an event with no JSON block shape -> legacy exit 2', () => {
    it('317-01 legacy path: user-prompt ok:false keeps exit 2, empty stdout, blockMessage + loud notice on stderr', () => {
      const out = renderHookResult('user-prompt', { ok: false, blockMessage: 'nope' });
      expect(out.stdout).toBe('');
      expect(out.exitCode).toBe(2);
      expect(out.stderr.startsWith('nope\n')).toBe(true);
      const notice = out.stderr.slice('nope\n'.length);
      expect(notice).toMatch(/user-prompt/);
      expect(notice).toMatch(/no JSON block shape/);
      expect(notice).toMatch(/PowerShell/);
      expect(notice.endsWith('\n')).toBe(true);
    });

    it('317-01 legacy path: legacy path without blockMessage still emits only the notice, exit 2', () => {
      const out = renderHookResult('post-tool-edit', { ok: false });
      expect(out.stdout).toBe('');
      expect(out.exitCode).toBe(2);
      expect(out.stderr).toMatch(/post-tool-edit/);
      expect(out.stderr).toMatch(/no JSON block shape/);
    });

    it('317-01 legacy path: a contextPayload on the legacy path is dropped loudly, not silently', () => {
      const out = renderHookResult('user-prompt', {
        ok: false,
        blockMessage: 'nope',
        contextPayload: 'extra context',
      });
      expect(out.stdout).toBe('');
      expect(out.exitCode).toBe(2);
      expect(out.stderr).not.toContain('extra context');
      expect(out.stderr).toMatch(/contextPayload was dropped/);
    });
  });
});
