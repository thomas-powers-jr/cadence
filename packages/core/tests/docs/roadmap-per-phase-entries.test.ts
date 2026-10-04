import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phaseNumber } from '../../src/phases/collision.js';
import { ROADMAP_PHASE_HEADING, MILESTONES_PHASE_BULLET } from '../../src/roadmap/phase-entry.js';

// packages/core/tests/docs → repo root is four levels up.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Phase 320 (rec-20261004-001): ROADMAP.md / MILESTONES.md kept falling
 * behind settled phases. From phase 314 on, every settled phase directory
 * (one holding a `-SUMMARY.json`) must carry both a `### Phase N` ROADMAP heading and a `- **Phase N**`
 * MILESTONES bullet, so CI catches the next miss in this repo. Phases below
 * 314 are tracked separately (rec-20260811-005, rec-20260815-004).
 */
const FIRST_REQUIRED_PHASE = 314;

function readRecord(name: string): string {
  return readFileSync(join(REPO_ROOT, '.cadence', name), 'utf8');
}

function documentedNumbers(text: string, pattern: RegExp): Set<number> {
  const found = new Set<number>();
  for (const m of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
    found.add(Number.parseInt(m[1] ?? '', 10));
  }
  return found;
}

/**
 * Settled phases only — a directory holding at least one `*-SUMMARY.json`.
 * A phase directory exists from `draft new` onward, so requiring entries for
 * every directory would turn the suite red at the first mid-build
 * re-verification. settle writes SUMMARY.json after its own
 * `build-test-must-pass` run, so this bites on the PR's CI — after settle's
 * stderr notice has already named any missing entry.
 */
function requiredPhaseNumbers(): number[] {
  const numbers = new Set<number>();
  const phasesDir = join(REPO_ROOT, '.cadence/phases');
  for (const entry of readdirSync(phasesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const n = phaseNumber(entry.name);
    if (n === null || n < FIRST_REQUIRED_PHASE) continue;
    const settled = readdirSync(join(phasesDir, entry.name)).some((f) => f.endsWith('-SUMMARY.json'));
    if (settled) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b);
}

function headingLine(text: string, phase: number): string | undefined {
  return text.split(/\r?\n/).find((line) => new RegExp(`^### Phase ${phase}(?!\\d)`).test(line));
}

describe('ROADMAP/MILESTONES per-phase entries (phase 320)', () => {
  it('320-01/AC-5: every settled phase directory numbered 314+ has a `### Phase N` ROADMAP heading', () => {
    const required = requiredPhaseNumbers();
    expect(required.length).toBeGreaterThan(0);
    const documented = documentedNumbers(readRecord('ROADMAP.md'), ROADMAP_PHASE_HEADING);
    const missing = required.filter((n) => !documented.has(n));
    expect(
      missing,
      `.cadence/ROADMAP.md has no "### Phase N" heading for phase(s): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('320-01/AC-5: every settled phase directory numbered 314+ has a `- **Phase N**` MILESTONES bullet', () => {
    const required = requiredPhaseNumbers();
    expect(required.length).toBeGreaterThan(0);
    const documented = documentedNumbers(readRecord('MILESTONES.md'), MILESTONES_PHASE_BULLET);
    const missing = required.filter((n) => !documented.has(n));
    expect(
      missing,
      `.cadence/MILESTONES.md has no "- **Phase N**" bullet for phase(s): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('320-01/AC-5: the phase 292 and 303 ROADMAP headings carry their PR numbers, not "(in progress)"', () => {
    const roadmap = readRecord('ROADMAP.md');
    const expected: Array<[number, string]> = [
      [292, '(#469)'],
      [303, '(#496)'],
    ];
    const stale: string[] = [];
    for (const [phase, pr] of expected) {
      const line = headingLine(roadmap, phase);
      if (line === undefined) {
        stale.push(`${phase}: no heading`);
      } else if (line.includes('(in progress)') || !line.includes(pr)) {
        stale.push(`${phase}: ${line}`);
      }
    }
    expect(stale, `stale ROADMAP heading(s):\n${stale.join('\n')}`).toEqual([]);
  });

  it('320-01/AC-5: the phase 292 and 303 ROADMAP entries carry an As built line, and the MILESTONES 292 bullet is no longer "(in progress)"', () => {
    const roadmap = readRecord('ROADMAP.md');
    for (const phase of [292, 303]) {
      const start = roadmap.search(new RegExp(`^### Phase ${phase}\\b`, 'm'));
      expect(start, `no ### Phase ${phase} heading`).toBeGreaterThanOrEqual(0);
      // Skip past the heading line itself before looking for the next heading.
      const rest = roadmap.slice(roadmap.indexOf('\n', start) + 1);
      const nextHeading = rest.search(/^#{2,3} /m);
      const entry = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
      expect(entry, `phase ${phase} entry lacks an As built line`).toMatch(/^\*\*As built \(\d{4}-\d{2}-\d{2}\)\.\*\*/m);
    }
    const milestones = readRecord('MILESTONES.md');
    const bullet292 = milestones.split(/\r?\n/).find((l) => /^\s*-\s+\*\*Phase 292\*\*/.test(l));
    expect(bullet292).toBeDefined();
    expect(bullet292).not.toContain('(in progress)');
  });
});
