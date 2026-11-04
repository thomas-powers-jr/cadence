import { describe, it, expect } from 'vitest';
import { AbstractEventZ, HookContextZ, type AbstractEvent } from '../src/events.js';

describe('AbstractEventZ', () => {
  it('accepts all nine valid abstract events', () => {
    const events: AbstractEvent[] = [
      'session-start',
      'user-prompt',
      'pre-tool-edit',
      'post-tool-edit',
      'session-stop',
      'subagent-result',
      'subagent-start',
      'skill-invoke',
      'pre-compact',
    ];
    expect([...AbstractEventZ.options].sort()).toEqual([...events].sort());
    for (const e of events) {
      expect(() => AbstractEventZ.parse(e)).not.toThrow();
    }
  });

  it('skill-invoke is parseable (AC-1, Phase 23.4)', () => {
    expect(AbstractEventZ.parse('skill-invoke')).toBe('skill-invoke');
  });

  it('rejects unknown event names', () => {
    expect(() => AbstractEventZ.parse('something-else')).toThrow();
  });
});

describe('HookContext agentId/agentType (subagent task-redundancy monitoring)', () => {
  it('are optional — omitting them parses fine', () => {
    expect(() =>
      HookContextZ.parse({ event: 'pre-tool-edit', cwd: '/repo' }),
    ).not.toThrow();
  });

  it('accepts agentId and agentType when present', () => {
    const parsed = HookContextZ.parse({
      event: 'pre-tool-edit',
      cwd: '/repo',
      agentId: 'agent-123',
      agentType: 'general-purpose',
    });
    expect(parsed.agentId).toBe('agent-123');
    expect(parsed.agentType).toBe('general-purpose');
  });
});

describe('AbstractEventZ subagent-start', () => {
  it('accepts "subagent-start"', () => {
    expect(() => AbstractEventZ.parse('subagent-start')).not.toThrow();
  });
});

describe('pre-compact event and compactTrigger (phase 345)', () => {
  it('345-01/AC-1: AbstractEventZ accepts "pre-compact"', () => {
    expect(AbstractEventZ.parse('pre-compact')).toBe('pre-compact');
  });

  it('345-01/AC-1: HookContextZ accepts an optional compactTrigger string', () => {
    const parsed = HookContextZ.parse({
      event: 'pre-compact',
      cwd: '/repo',
      compactTrigger: 'auto',
    });
    expect(parsed.compactTrigger).toBe('auto');
    expect(HookContextZ.parse({ event: 'pre-compact', cwd: '/repo' }).compactTrigger).toBeUndefined();
  });

  it('345-01/AC-1: HookContextZ rejects a non-string compactTrigger', () => {
    expect(() =>
      HookContextZ.parse({ event: 'session-start', cwd: '/repo', compactTrigger: 42 }),
    ).toThrow();
  });
});
