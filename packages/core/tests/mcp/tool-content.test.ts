import { describe, it, expect } from 'vitest';
import { toolResultContent } from '../../src/mcp/tool-content.js';

// Phase 356 (356-01, T1): MCP tool results keep stderr notices. The first
// content item is exactly the pre-356 text; a second item carries stderr when
// the tool also wrote to stdout (rec-20260822-002).
describe('toolResultContent (phase 356)', () => {
  it('356-01/AC-1: (a) stdout and stderr both with text give two items', () => {
    expect(toolResultContent('Settled 01-01\n', 'settle: notice\n', 0)).toStrictEqual([
      { type: 'text', text: 'Settled 01-01' },
      { type: 'text', text: 'settle: notice' },
    ]);
  });

  it('356-01/AC-1: (b) whitespace-only stdout still takes the first item, as today, and stderr follows', () => {
    expect(toolResultContent('\n', 'warn\n', 0)).toStrictEqual([
      { type: 'text', text: 'ok' },
      { type: 'text', text: 'warn' },
    ]);
  });

  it('356-01/AC-2: (c) stderr only gives one item', () => {
    expect(toolResultContent('', 'refused: reason\n', 2)).toStrictEqual([{ type: 'text', text: 'refused: reason' }]);
  });

  it('356-01/AC-2: (d) stdout only gives one item', () => {
    expect(toolResultContent('{"a":1}\n', '', 0)).toStrictEqual([{ type: 'text', text: '{"a":1}' }]);
  });

  it('356-01/AC-2: (e) no output on success gives ok', () => {
    expect(toolResultContent('', '', 0)).toStrictEqual([{ type: 'text', text: 'ok' }]);
  });

  it('356-01/AC-2: (f) no output on failure gives failed', () => {
    expect(toolResultContent('', '', 1)).toStrictEqual([{ type: 'text', text: 'failed' }]);
  });
});
