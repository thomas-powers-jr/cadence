import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/core/tests/docs → repo root is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const REPORT_MD = join(REPO_ROOT, 'docs/checkpoint/REPORT-checkpoint-phase-2.md');

// Phase 331 builds checkpoint Phase 2 (the statusline sensor and the state
// store). Its report must carry a named `##` heading for every report-back
// item of docs/handoffs/HANDOFF-checkpoint-phase-2.md §6, plus the rationale
// and Phase 3 preconditions the phase recorded, so Phase 3 can find each one
// without re-deriving it. Headings are matched by prefix.
const REQUIRED_HEADINGS = [
  '## Doctor before and after',
  '## Baseline measurements',
  '## Dedup preflight',
  '## Decisions',
  '## Reading schema',
  '## Byte transparency per shell',
  '## Transition matrix',
  '## Tool sweep',
  '## Tier and review provenance',
  '## Package and hook status',
  '## Gate bypasses',
  '## Why absolutes are kept',
  '## Project resolution',
  '## Inner command limitations',
  '## Phase 3 preconditions',
];

// The exact key shape the sensor writes to reading.json (D-BJ: both units).
// `true` marks a leaf; a nested object is a nested record. The checkpoint
// package's sensor.test.ts separately deep-equals the report's block against
// parseReading's real output, so this shape and the code cannot drift apart
// without one of the two tests failing.
const SCHEMA_SHAPE = {
  used_percentage: true,
  unknown: true,
  absolute: {
    total_input_tokens: true,
    total_output_tokens: true,
    context_window_size: true,
    current_usage: {
      input_tokens: true,
      output_tokens: true,
      cache_creation_input_tokens: true,
      cache_read_input_tokens: true,
    },
  },
  exceeds_200k_tokens: true,
  current_dir: true,
  project_dir: true,
  ts: true,
};

/** The key shape of a parsed JSON value: leaves become `true`. */
function shapeOf(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return true;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, shapeOf(v)]));
}

/** The first fenced ```json block in a section, parsed. */
function jsonBlock(body: string): unknown {
  const match = /```json\r?\n([\s\S]*?)\r?\n```/.exec(body);
  expect(match, 'missing ```json block').not.toBeNull();
  return JSON.parse(match?.[1] ?? '');
}

const STATES = ['idle', 'armed', 'written', 'settled', 'reset', 'resumed'];

function readLines(): string[] {
  return readFileSync(REPORT_MD, 'utf8').split(/\r?\n/);
}

function section(lines: string[], prefix: string): string {
  const start = lines.findIndex((line) => line.startsWith(prefix));
  expect(start, `missing heading: ${prefix}`).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((line) => line.startsWith('## '));
  return (next === -1 ? rest : rest.slice(0, next)).join('\n');
}

describe('checkpoint Phase 2 report', () => {
  it('331-01/AC-6: the report exists and carries a named ## heading for each report-back item', () => {
    expect(existsSync(REPORT_MD)).toBe(true);
    const lines = readLines();
    for (const prefix of REQUIRED_HEADINGS) {
      expect(lines.findIndex((line) => line.startsWith(prefix)), `missing heading: ${prefix}`).toBeGreaterThan(-1);
    }
  });

  it('331-01/AC-6: the reading schema section carries the shipped schema verbatim, exactly these keys, both units', () => {
    const body = section(readLines(), '## Reading schema');
    // Exact recursive key-set equality: a key added, renamed or dropped on
    // either side fails, which a substring check would not catch.
    expect(shapeOf(jsonBlock(body))).toEqual(SCHEMA_SHAPE);
  });

  it('331-01/AC-6: the absolutes rationale cites the coarse percentage resolution and the input-only formula', () => {
    const body = section(readLines(), '## Why absolutes are kept');
    expect(body).toContain('10k');
    expect(body).toContain('input_tokens + cache_creation_input_tokens + cache_read_input_tokens');
  });

  it('331-01/AC-6: the transition matrix section enumerates every state and the 7 legal / 29 rejected split', () => {
    const body = section(readLines(), '## Transition matrix');
    for (const state of STATES) expect(body).toContain(state);
    // Count the 6x6 table's cells rather than matching a bare digit anywhere.
    const rows = body.split(/\r?\n/).filter((line) => STATES.some((s) => line.startsWith(`| ${s} |`)));
    expect(rows).toHaveLength(6);
    const cells = rows.flatMap((row) => row.split('|').slice(2, -1).map((cell) => cell.trim()));
    expect(cells).toHaveLength(36);
    expect(cells.filter((cell) => cell === '**accept**')).toHaveLength(7);
    expect(cells.filter((cell) => cell === 'reject')).toHaveLength(29);
  });

  it('331-01/AC-6: the Phase 3 preconditions name single-winner reset, threshold evaluation, and the consumer gitignore', () => {
    const body = section(readLines(), '## Phase 3 preconditions');
    expect(body).toContain('single-winner');
    expect(body).toContain('threshold');
    expect(body).toContain('.gitignore');
  });

  it('331-01/AC-6: the decisions section cites the three filed decision ids', () => {
    const body = section(readLines(), '## Decisions');
    expect(body).toContain('dec-20261013-001');
    expect(body).toContain('dec-20261013-002');
    expect(body).toContain('dec-20261013-003');
  });
});
