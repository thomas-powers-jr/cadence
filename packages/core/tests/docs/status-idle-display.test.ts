import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/core/tests/docs → repo root is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/**
 * Slice `text` from the first occurrence of `start` up to (not including) the
 * first occurrence of `end` after it. Fails loudly when either anchor is
 * missing so a renamed heading cannot silently turn the assertions vacuous.
 */
function section(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from, `start anchor not found: ${start}`).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to, `end anchor not found after ${start}: ${end}`).toBeGreaterThan(from);
  return text.slice(from, to);
}

/**
 * The `status` section's prose, after its fenced `Usage:` block. The start
 * anchor carries a leading newline so it cannot match `#### status anomalies`
 * (which contains `### status` as a substring); the end anchor is that
 * subcommand heading, so the slice is the default action's own section.
 */
function statusProse(): string {
  const status = section(read('docs/reference/commands.md'), '\n### status', '#### status anomalies');
  const open = status.indexOf('```');
  expect(open, 'status section has no fenced Usage block').toBeGreaterThanOrEqual(0);
  const close = status.indexOf('```', open + 3);
  expect(close, 'status section Usage block is not closed').toBeGreaterThan(open);
  return status.slice(close + 3);
}

describe('phase 322 — commands.md documents the IDLE status display', () => {
  it('322-01/AC-5: on an IDLE checkout the text shows `last settled:` instead of the checkout-local activePhase', () => {
    const prose = statusProse();
    expect(prose).toContain('IDLE');
    expect(prose).toContain('`last settled: <phase>`');
    // The old `phase:` line is named as what IDLE no longer prints.
    expect(prose).toContain('`phase: <activePhase>`');
    expect(prose).toMatch(/checkout-local/);
  });

  it('322-01/AC-5: `last settled` is derived from working-tree SUMMARY files carrying stateAtSettle', () => {
    const prose = statusProse();
    expect(prose).toContain('SUMMARY');
    expect(prose).toContain('stateAtSettle');
    // The finder reads the working tree, not git history (whole-branch review minor).
    expect(prose).toContain('in the working tree');
    // A refused settle's SUMMARY (no stateAtSettle) does not count.
    expect(prose).toMatch(/refused/);
  });

  it('322-01/AC-5: documents the `last phase in this checkout:` fallback for histories without stateAtSettle', () => {
    const prose = statusProse();
    expect(prose).toContain('`last phase in this checkout: <activePhase>`');
    expect(prose).toMatch(/predate/);
  });

  it('322-01/AC-5: `--json` keeps activePhase unchanged and adds lastSettledPhase', () => {
    const prose = statusProse();
    expect(prose).toContain('`--json`');
    expect(prose).toContain('`activePhase`');
    expect(prose).toContain('`lastSettledPhase`');
    expect(prose).toMatch(/`lastSettledPhase`[^\n]*(string|null)/);
  });

  it('322-01/AC-5: the STATE.md and SessionStart banner IDLE labels are documented alongside', () => {
    const prose = statusProse();
    expect(prose).toContain('STATE.md');
    expect(prose).toContain('(none — loop is IDLE)');
    expect(prose).toContain('Latest settled phase:');
    expect(prose).toContain('Last phase in this checkout:');
  });
});
