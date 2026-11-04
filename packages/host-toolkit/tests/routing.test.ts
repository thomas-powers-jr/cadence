import { describe, it, expect } from 'vitest';
import { COMMAND_GUIDANCE, DISPATCH_DIALOGUE, SCOUT_DIALOGUE } from '@thomas-powers-jr/cadence-types';
import {
  mapEvent,
  extractPayload,
  routeHookEvent,
  EDIT_TOOL_MATCHER,
  COMMANDS,
  CLAUDE_CODE_EXPECTED_HOOKS,
  CODEX_EXPECTED_HOOKS,
  resolveHookShimExit,
  planCoreSpawn,
} from '../src/routing.js';

// AC-1: routeHookEvent's dispatch algorithm and the slash-command catalog
// live in one shared module (packages/host-toolkit/src/routing.ts) that both
// host-claude-code and host-codex import instead of hand-rolling their own
// copy.

describe('mapEvent (AC-1)', () => {
  it('maps SessionStart → session-start', () => {
    expect(mapEvent('SessionStart')).toBe('session-start');
  });

  it('maps UserPromptSubmit → user-prompt', () => {
    expect(mapEvent('UserPromptSubmit')).toBe('user-prompt');
  });

  it('maps Stop → session-stop', () => {
    expect(mapEvent('Stop')).toBe('session-stop');
  });

  it('maps SubagentStop → subagent-result', () => {
    expect(mapEvent('SubagentStop')).toBe('subagent-result');
  });

  it('maps SubagentStart → subagent-start', () => {
    expect(mapEvent('SubagentStart')).toBe('subagent-start');
  });

  it('maps PreToolUse → pre-tool-edit', () => {
    expect(mapEvent('PreToolUse')).toBe('pre-tool-edit');
  });

  it('maps PostToolUse → post-tool-edit', () => {
    expect(mapEvent('PostToolUse')).toBe('post-tool-edit');
  });

  it('maps PostToolUse + tool_name=Skill → skill-invoke', () => {
    expect(mapEvent('PostToolUse', 'Skill')).toBe('skill-invoke');
  });

  it('maps PostToolUse + tool_name=Edit → post-tool-edit (regression)', () => {
    expect(mapEvent('PostToolUse', 'Edit')).toBe('post-tool-edit');
  });

  it('returns null for non-relevant events', () => {
    expect(mapEvent('Notification')).toBeNull();
    expect(mapEvent('PostCompact')).toBeNull();
    expect(mapEvent('NopeNope')).toBeNull();
  });

  it('345-01/AC-1: maps PreCompact → pre-compact', () => {
    expect(mapEvent('PreCompact')).toBe('pre-compact');
  });
});

describe('EDIT_TOOL_MATCHER (AC-1)', () => {
  it('regex covers Edit, Write, MultiEdit, NotebookEdit', () => {
    const re = new RegExp(`^(?:${EDIT_TOOL_MATCHER})$`);
    expect(re.test('Edit')).toBe(true);
    expect(re.test('Write')).toBe(true);
    expect(re.test('MultiEdit')).toBe(true);
    expect(re.test('NotebookEdit')).toBe(true);
    expect(re.test('Bash')).toBe(false);
    expect(re.test('Read')).toBe(false);
  });
});

describe('extractPayload (AC-1)', () => {
  it('PostToolUse Edit → {files:[file_path]}', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/abs/path/foo.ts', old_string: 'a', new_string: 'b' },
    };
    expect(extractPayload(raw)).toEqual({ files: ['/abs/path/foo.ts'] });
  });

  it('PostToolUse Write → {files:[file_path]}', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/x.md', content: 'hi' },
    };
    expect(extractPayload(raw)).toEqual({ files: ['/x.md'] });
  });

  it('PostToolUse MultiEdit → {files:[file_path]}', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      tool_name: 'MultiEdit',
      tool_input: { file_path: '/m.ts', edits: [] },
    };
    expect(extractPayload(raw)).toEqual({ files: ['/m.ts'] });
  });

  it('PreToolUse Edit → {files:[file_path]}', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/p.ts', old_string: 'a', new_string: 'b' },
    };
    expect(extractPayload(raw)).toEqual({ files: ['/p.ts'] });
  });

  it('returns undefined when no file path', () => {
    expect(extractPayload({ hook_event_name: 'SessionStart' })).toBeUndefined();
    expect(extractPayload({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })).toBeUndefined();
    expect(extractPayload(null)).toBeUndefined();
    expect(extractPayload('not-json')).toBeUndefined();
  });

  it('PostToolUse Skill → {skill:<name>}', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Skill',
      tool_input: { skill: 'using-superpowers' },
    };
    expect(extractPayload(raw)).toEqual({ skill: 'using-superpowers' });
  });

  it('PostToolUse Skill with missing skill field → undefined', () => {
    expect(
      extractPayload({ hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: {} }),
    ).toBeUndefined();
  });

  it('extracts agent_id/agent_type from a PreToolUse subagent edit', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/p.ts', old_string: 'a', new_string: 'b' },
      agent_id: 'agent-123',
      agent_type: 'general-purpose',
    };
    expect(extractPayload(raw)).toEqual({
      files: ['/p.ts'],
      agentId: 'agent-123',
      agentType: 'general-purpose',
    });
  });

  it('extracts agent_id/agent_type from a SubagentStart event (no files/skill)', () => {
    const raw = { hook_event_name: 'SubagentStart', agent_id: 'agent-9', agent_type: 'claude' };
    expect(extractPayload(raw)).toEqual({ agentId: 'agent-9', agentType: 'claude' });
  });

  it('extracts agent_id/agent_type from a SubagentStop event', () => {
    const raw = { hook_event_name: 'SubagentStop', agent_id: 'agent-9', agent_type: 'claude' };
    expect(extractPayload(raw)).toEqual({ agentId: 'agent-9', agentType: 'claude' });
  });

  it('a main-thread PreToolUse edit (no agent_id) omits agentId/agentType', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/p.ts' },
    };
    expect(extractPayload(raw)).toEqual({ files: ['/p.ts'] });
  });

  it('a SessionStart event with no extractable fields still returns undefined', () => {
    expect(extractPayload({ hook_event_name: 'SessionStart' })).toBeUndefined();
  });
});

describe('routeHookEvent (AC-1)', () => {
  it('SessionStart with no extra payload → session-start, stdin unchanged', () => {
    const raw = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'abc' });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('session-start');
    expect(JSON.parse(r.translatedStdin)).toEqual({
      hook_event_name: 'SessionStart',
      session_id: 'abc',
    });
  });

  it('PostToolUse Edit → post-tool-edit + translated stdin has files[]', () => {
    const raw = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/abs/foo.ts', old_string: 'a', new_string: 'b' },
    });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('post-tool-edit');
    const parsed = JSON.parse(r.translatedStdin);
    expect(parsed.files).toEqual(['/abs/foo.ts']);
    expect(parsed.tool_name).toBe('Edit');
  });

  it('PostToolUse Skill → skill-invoke + translated stdin has skill', () => {
    const raw = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Skill',
      tool_input: { skill: 'using-superpowers' },
    });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('skill-invoke');
    expect(JSON.parse(r.translatedStdin).skill).toBe('using-superpowers');
  });

  it('PostToolUse Bash → null (skip, non-edit tool)', () => {
    const raw = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBeNull();
  });

  it('PreToolUse Write → pre-tool-edit + files[]', () => {
    const raw = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/x.md', content: 'hi' },
    });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('pre-tool-edit');
    expect(JSON.parse(r.translatedStdin).files).toEqual(['/x.md']);
  });

  it('Notification → null (no abstract mapping)', () => {
    const raw = JSON.stringify({ hook_event_name: 'Notification', message: 'hi' });
    expect(routeHookEvent(raw).abstractEvent).toBeNull();
  });

  it('SubagentStop → subagent-result, stdin unchanged', () => {
    const raw = JSON.stringify({ hook_event_name: 'SubagentStop' });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('subagent-result');
  });

  it('empty stdin → null', () => {
    expect(routeHookEvent('').abstractEvent).toBeNull();
  });

  it('non-JSON stdin → null', () => {
    expect(routeHookEvent('not json {').abstractEvent).toBeNull();
  });

  it('missing hook_event_name → null', () => {
    expect(routeHookEvent('{"foo":1}').abstractEvent).toBeNull();
  });

  it('array stdin → null (rejects non-object payloads)', () => {
    expect(routeHookEvent('[1,2,3]').abstractEvent).toBeNull();
  });

  it('PreToolUse for a spoofed non-edit tool_name is defensively dropped', () => {
    // The host-side hook matcher already restricts this, but routeHookEvent
    // re-filters defensively (step 7 of the dispatch algorithm).
    const raw = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'NotARealEditTool',
    });
    expect(routeHookEvent(raw).abstractEvent).toBeNull();
  });
});

describe('routeHookEvent agent identity translation (318-01/AC-1)', () => {
  it('318-01/AC-1: SubagentStart translated stdin carries camelCase agentId/agentType', () => {
    const raw = JSON.stringify({
      hook_event_name: 'SubagentStart',
      agent_id: 'agent-abc123',
      agent_type: 'general-purpose',
    });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('subagent-start');
    const parsed = JSON.parse(r.translatedStdin);
    expect(parsed.agentId).toBe('agent-abc123');
    expect(parsed.agentType).toBe('general-purpose');
  });

  it('318-01/AC-1: SubagentStop translated stdin carries camelCase agentId/agentType', () => {
    const raw = JSON.stringify({
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-def456',
      agent_type: 'Explore',
    });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('subagent-result');
    const parsed = JSON.parse(r.translatedStdin);
    expect(parsed.agentId).toBe('agent-def456');
    expect(parsed.agentType).toBe('Explore');
  });

  it('318-01/AC-1: PostToolUse Edit inside a subagent carries agentId/agentType alongside files[]', () => {
    const raw = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/abs/sub.ts', old_string: 'a', new_string: 'b' },
      agent_id: 'agent-ghi789',
      agent_type: 'general-purpose',
    });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('post-tool-edit');
    const parsed = JSON.parse(r.translatedStdin);
    expect(parsed.files).toEqual(['/abs/sub.ts']);
    expect(parsed.agentId).toBe('agent-ghi789');
    expect(parsed.agentType).toBe('general-purpose');
  });

  it('318-01/AC-1: main-thread PostToolUse Edit (no agent_id/agent_type) adds no agentId/agentType keys', () => {
    const raw = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/abs/main.ts', old_string: 'a', new_string: 'b' },
    });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('post-tool-edit');
    const parsed = JSON.parse(r.translatedStdin);
    expect(parsed.files).toEqual(['/abs/main.ts']);
    expect(parsed).not.toHaveProperty('agentId');
    expect(parsed).not.toHaveProperty('agentType');
  });
});

describe('COMMANDS slash-command catalog (AC-1)', () => {
  it('is the single shared source of truth both adapters render from', () => {
    expect(COMMANDS.length).toBeGreaterThan(0);
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length); // no duplicate names
    expect(names).toContain('cadence-scout');
    expect(names).toContain('cadence-dispatch');
  });

  it('cadence-scout carries the shared SCOUT_DIALOGUE body', () => {
    const scout = COMMANDS.find((c) => c.name === 'cadence-scout');
    expect(scout?.body).toBe(SCOUT_DIALOGUE);
  });

  // Regression guard for the drift AC-1 calls out: Codex's own copy of this
  // catalog had silently dropped the dispatch dialogue body. The shared
  // catalog is the fix — any adapter importing COMMANDS gets it back.
  it('cadence-dispatch carries the shared DISPATCH_DIALOGUE body', () => {
    const dispatch = COMMANDS.find((c) => c.name === 'cadence-dispatch');
    expect(dispatch?.body).toBe(DISPATCH_DIALOGUE);
  });

  it('every command has a non-empty name, description, and cli suffix', () => {
    for (const spec of COMMANDS) {
      expect(spec.name.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.cli.length).toBeGreaterThan(0);
    }
  });

  // 293-01/AC-3: COMMAND_GUIDANCE's keys are the authority `cadence doctor`'s
  // pack-commands check uses for "does this slash command actually exist."
  // Both host-claude-code/src/install-commands.ts and
  // host-codex/src/install-commands.ts iterate `COMMANDS` unconditionally
  // (`for (const spec of COMMANDS)`, no filter beyond skipping an
  // already-user-customized file on disk) — so COMMAND_GUIDANCE's keys must
  // stay exactly equal to COMMANDS' names, or the doctor check would either
  // falsely warn on a real command or silently pass a pack declaring one that
  // was never installed.
  it('293-01/AC-3: COMMAND_GUIDANCE keys exactly match the COMMANDS catalog names', () => {
    const commandNames = COMMANDS.map((c) => c.name).sort();
    const guidanceKeys = Object.keys(COMMAND_GUIDANCE).sort();
    expect(commandNames).toEqual(guidanceKeys);
  });
});

describe('PreCompact trigger forwarding (345-01/AC-1)', () => {
  it('345-01/AC-1: extractPayload returns compactTrigger for a string PreCompact trigger', () => {
    expect(extractPayload({ hook_event_name: 'PreCompact', trigger: 'auto' })).toEqual({
      compactTrigger: 'auto',
    });
    expect(extractPayload({ hook_event_name: 'PreCompact', trigger: 'manual' })).toEqual({
      compactTrigger: 'manual',
    });
  });

  it('345-01/AC-1: extractPayload yields no compactTrigger for a missing or non-string trigger', () => {
    expect(extractPayload({ hook_event_name: 'PreCompact' })).toBeUndefined();
    expect(extractPayload({ hook_event_name: 'PreCompact', trigger: 7 })).toBeUndefined();
    expect(extractPayload({ hook_event_name: 'PreCompact', trigger: null })).toBeUndefined();
  });

  it('345-01/AC-1: extractPayload ignores a trigger field on any other event', () => {
    expect(extractPayload({ hook_event_name: 'SessionStart', trigger: 'auto' })).toBeUndefined();
  });

  it('345-01/AC-1: routeHookEvent translates PreCompact to pre-compact with compactTrigger in stdin', () => {
    const raw = JSON.stringify({
      hook_event_name: 'PreCompact',
      trigger: 'auto',
      session_id: 's1',
      custom_instructions: '',
    });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('pre-compact');
    const parsed = JSON.parse(r.translatedStdin);
    expect(parsed.compactTrigger).toBe('auto');
    expect(parsed.trigger).toBe('auto');
    expect(parsed.session_id).toBe('s1');
  });

  it('345-01/AC-1: an unrecognised string trigger passes through unchanged', () => {
    const raw = JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'some-future-kind' });
    const parsed = JSON.parse(routeHookEvent(raw).translatedStdin);
    expect(parsed.compactTrigger).toBe('some-future-kind');
  });

  it('345-01/AC-1: a missing or non-string trigger yields no compactTrigger key', () => {
    const noTrigger = JSON.parse(
      routeHookEvent(JSON.stringify({ hook_event_name: 'PreCompact' })).translatedStdin,
    );
    expect(routeHookEvent(JSON.stringify({ hook_event_name: 'PreCompact' })).abstractEvent).toBe(
      'pre-compact',
    );
    expect('compactTrigger' in noTrigger).toBe(false);
    const numeric = JSON.parse(
      routeHookEvent(JSON.stringify({ hook_event_name: 'PreCompact', trigger: 3 })).translatedStdin,
    );
    expect('compactTrigger' in numeric).toBe(false);
  });

  it('345-01/AC-2: CLAUDE_CODE_EXPECTED_HOOKS lists an unmatched PreCompact entry; Codex list does not', () => {
    expect(CLAUDE_CODE_EXPECTED_HOOKS).toContainEqual({ event: 'PreCompact', matcher: null });
    expect(CODEX_EXPECTED_HOOKS.some((h) => h.event === 'PreCompact')).toBe(false);
  });
});

describe('resolveHookShimExit (345-01/AC-6)', () => {
  it('345-01/AC-6: a core killed by a signal (null code) on pre-compact exits 0 and reports it in one line', () => {
    const r = resolveHookShimExit('pre-compact', { kind: 'exit', code: null });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/signal/);
    expect(r.stderr.split('\n').filter((l) => l.length > 0)).toHaveLength(1);
    expect(resolveHookShimExit('session-stop', { kind: 'exit', code: null })).toEqual({ exitCode: 0, stderr: '' });
  });

  const NEVER_BLOCKED = 'exiting 0 so compaction is never blocked';

  it('345-01/AC-6: pre-compact with a non-zero core exit resolves to exit 0 and one stderr line naming the code', () => {
    const r = resolveHookShimExit('pre-compact', { kind: 'exit', code: 2 });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toBe(`cadence pre-compact: core exited with code 2; ${NEVER_BLOCKED}\n`);
    expect(r.stderr.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('345-01/AC-6: pre-compact with a zero core exit resolves to exit 0 and no stderr', () => {
    expect(resolveHookShimExit('pre-compact', { kind: 'exit', code: 0 })).toEqual({
      exitCode: 0,
      stderr: '',
    });
  });

  it('345-01/AC-6: a pre-compact spawn or shim error resolves to exit 0 and one stderr line naming the cause', () => {
    const r = resolveHookShimExit('pre-compact', {
      kind: 'error',
      message: 'shim spawn failed: spawn x ENOENT',
    });
    expect(r).toEqual({
      exitCode: 0,
      stderr: `cadence pre-compact: shim spawn failed: spawn x ENOENT; ${NEVER_BLOCKED}\n`,
    });
  });

  it('345-01/AC-6: every other event keeps the core exit code and exits 1 on an error, unchanged', () => {
    expect(resolveHookShimExit('session-stop', { kind: 'exit', code: 2 })).toEqual({
      exitCode: 2,
      stderr: '',
    });
    expect(resolveHookShimExit('pre-tool-edit', { kind: 'exit', code: null })).toEqual({
      exitCode: 0,
      stderr: '',
    });
    expect(
      resolveHookShimExit('session-start', { kind: 'error', message: '--cadence command is empty' }),
    ).toEqual({ exitCode: 1, stderr: '--cadence command is empty\n' });
    expect(resolveHookShimExit(null, { kind: 'error', message: 'hook shim failed: boom' })).toEqual({
      exitCode: 1,
      stderr: 'hook shim failed: boom\n',
    });
  });
});

describe('planCoreSpawn (345-01/AC-6)', () => {
  it('345-01/AC-6: on win32 joins the command into one string with no args, so Node 24+ prints no DEP0190 warning', () => {
    expect(planCoreSpawn('npx', ['@thomas-powers-jr/cadence-core', 'hook', 'pre-compact'], 'win32')).toEqual({
      command: 'npx @thomas-powers-jr/cadence-core hook pre-compact',
      args: [],
      shell: true,
    });
  });

  it('345-01/AC-6: elsewhere spawns without a shell and passes args as an array, unchanged', () => {
    const args = ['/opt/cadence.cjs', 'hook', 'session-stop'];
    const plan = planCoreSpawn('node', args, 'linux');
    expect(plan).toEqual({ command: 'node', args, shell: false });
    expect(plan.args).not.toBe(args);
    expect(planCoreSpawn('node', args, 'darwin').shell).toBe(false);
  });
});
