import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/core/tests/docs → repo root is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const COMMANDS_MD = join(REPO_ROOT, 'docs/reference/commands.md');

// Phase 316: `renderSession()` now emits a required `## Open decisions`
// narrative stub (between `Carry-forward gotchas` and `Next action`). The
// `cadence handoff` reference entry describes the narrative zone as a
// parenthetical list of its stubs; this test pins that the list names the
// new stub alongside the other four, so the doc cannot drift from the
// generator's output.
//
// Plain `.toContain()` on string literals only (see
// phase253-handoff-narrative.test.ts for why regex literals carrying quote
// characters corrupt the coverage scanner's boundary tracking).
describe('commands.md cadence handoff narrative-zone description', () => {
  it('316-01/AC-8: the narrative-zone parenthetical names open decisions alongside TL;DR, what landed, gotchas, and next action', () => {
    const doc = readFileSync(COMMANDS_MD, 'utf8').replace(/\s+/g, ' ');

    const anchor = 'empty **narrative** zone (';
    const start = doc.indexOf(anchor);
    expect(start).toBeGreaterThan(-1);
    const end = doc.indexOf(')', start + anchor.length);
    expect(end).toBeGreaterThan(start);
    const list = doc.slice(start + anchor.length, end).toLowerCase();

    expect(list).toContain('tl;dr');
    expect(list).toContain('what landed');
    expect(list).toContain('gotchas');
    expect(list).toContain('next action');
    expect(list).toContain('open decisions');
  });
});
