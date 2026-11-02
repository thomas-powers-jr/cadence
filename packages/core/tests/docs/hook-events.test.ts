import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AbstractEventZ } from '@thomas-powers-jr/cadence-types';
import { CLAUDE_CODE_EXPECTED_HOOKS } from '../../src/doctor/host-hooks.js';

// 345-01 (phase 345) — the `cadence hook <event>` reference lists every
// abstract hook event, derived from `AbstractEventZ` rather than written from
// memory, and documents the `pre-compact` record and its limits. The list
// lives outside the generated `<!-- cadence:commands -->` marker block.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');
const commandsMd = read('docs', 'reference', 'commands.md');
const claudeCodeMd = read('docs', 'claude-code.md');
const hostAdaptersMd = read('docs', 'host-adapters.md');
const conceptsMd = read('docs', 'concepts.md');

const START = '<!-- cadence:hook-events:start -->';
const END = '<!-- cadence:hook-events:end -->';

/** Collapse line wrapping so a phrase split across lines still matches. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** The backticked event names of a `- \`name\` — …` bullet list. */
function bulletEvents(block: string): string[] {
  return [...block.matchAll(/^- `([a-z-]+)`/gm)].map((m) => m[1] ?? '');
}

function hookEventsBlock(): string {
  const from = commandsMd.indexOf(START);
  const to = commandsMd.indexOf(END);
  return from >= 0 && to > from ? commandsMd.slice(from + START.length, to) : '';
}

describe('hook events reference (phase 345)', () => {
  it('345-01/AC-8: commands.md lists exactly AbstractEventZ.options, in order, outside the cadence:commands marker block', () => {
    const block = hookEventsBlock();
    expect(block, 'commands.md has no cadence:hook-events marker block').not.toBe('');
    expect(bulletEvents(block)).toEqual([...AbstractEventZ.options]);

    const commandsStart = commandsMd.indexOf('<!-- cadence:commands:start -->');
    const commandsEnd = commandsMd.indexOf('<!-- cadence:commands:end -->');
    expect(commandsEnd).toBeGreaterThan(commandsStart);
    // The hook-events block sits in the `### hook` section, after the
    // generated block ends.
    expect(commandsMd.indexOf(START)).toBeGreaterThan(commandsEnd);
    expect(commandsMd.indexOf(START)).toBeGreaterThan(commandsMd.indexOf('\n### hook\n'));
    expect(commandsMd.indexOf(START)).toBeLessThan(commandsMd.indexOf('\n### build\n'));
  });

  it('345-01/AC-8: host-adapters.md lists every abstract event too', () => {
    const section = hostAdaptersMd.slice(
      hostAdaptersMd.indexOf('## 1. Speak the abstract event vocabulary'),
      hostAdaptersMd.indexOf('## 2. Declare capabilities'),
    );
    expect(bulletEvents(section)).toEqual([...AbstractEventZ.options]);
  });

  it('345-01/AC-8: commands.md documents the pre-compact record, its location, retention, never-blocks rule, shim clamp and limits', () => {
    const doc = flat(commandsMd);
    expect(doc).toContain('.cadence/local/precompact/PRECOMPACT-<YYYYMMDDTHHMMSS.mmmZ>.md');
    expect(doc).toContain('`generated_at`');
    expect(doc).toContain('`trigger`');
    expect(doc).toMatch(/field names only/);
    expect(doc).toMatch(/newest five/);
    expect(doc).toMatch(/gitignored/);
    expect(doc).toMatch(/always exits 0/);
    expect(doc).toMatch(/one stderr line/);
    expect(doc).toContain('`precompactRecord`');
    expect(doc).toContain('Pre-compaction record:');
    expect(doc).toContain('resolveHookShimExit');
    expect(doc).toMatch(/Codex adapter leaves `PreCompact` unmapped/);
  });

  it('345-01/AC-8: claude-code.md maps SubagentStart and PreCompact, and its count matches the table', () => {
    const tableRows = claudeCodeMd
      .split(/\r?\n/)
      .filter((l) => /^\| `[A-Za-z]+` \| .* \| `[a-z-]+` \|$/.test(l));
    expect(tableRows.some((r) => r.startsWith('| `SubagentStart` |') && r.endsWith('| `subagent-start` |'))).toBe(true);
    expect(tableRows.some((r) => r.startsWith('| `PreCompact` |') && r.endsWith('| `pre-compact` |'))).toBe(true);
    // Core's copy of the expected-hooks list is drift-pinned against
    // host-toolkit's (expected-hooks-drift.test.ts), so the counts derive from code.
    const expected = CLAUDE_CODE_EXPECTED_HOOKS.map((h) => `${h.event}|${h.matcher ?? ''}`);
    const documented = tableRows.map((r) => {
      const cells = r.split(/(?<!\\)\|/).map((c) => c.trim());
      const matcher = (cells[2] ?? '').replace(/`/g, '').replace(/\\\|/g, '|');
      return `${(cells[1] ?? '').replace(/`/g, '')}|${matcher.startsWith('(none') ? '' : matcher}`;
    });
    expect(documented.sort()).toEqual([...expected].sort());
    const groups = new Set(CLAUDE_CODE_EXPECTED_HOOKS.map((h) => h.event));
    const doc = flat(claudeCodeMd);
    expect(doc).toContain(`exactly **${groups.size} Claude Code hook groups**`);
    expect(doc).toContain(`${CLAUDE_CODE_EXPECTED_HOOKS.length} hook entries`);
    expect(doc).toContain('resolveHookShimExit');
  });

  it('345-01/AC-8: concepts.md lists precompact/ in the .cadence/local/ State files row only', () => {
    const row = conceptsMd.split(/\r?\n/).find((l) => l.startsWith('| `.cadence/local/` |')) ?? '';
    expect(row).toContain('`precompact/`');
  });
});
