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

describe('phase 320 — roadmap entries are on the build and release checklists', () => {
  it('320-01/AC-4: phase-build step 7 stages the ROADMAP heading and MILESTONES bullet in final form in the single settle commit', () => {
    const step7 = section(
      read('.claude/skills/phase-build/SKILL.md'),
      '7. **Settle, one commit.**',
      '8. **Land.**',
    );
    expect(step7).toContain('.cadence/ROADMAP.md');
    expect(step7).toContain('.cadence/MILESTONES.md');
    expect(step7).toContain('### Phase N');
    expect(step7).toContain('- **Phase N**');
    expect(step7).toMatch(/no `\(in progress\)` marker/);
    // This repo's per-phase record test enforces it for settled phases.
    expect(step7).toContain('roadmap-per-phase-entries.test.ts');
    // The entries are part of what the single settle commit stages.
    expect(step7).toMatch(/stage everything together[\s\S]*ROADMAP\/MILESTONES entries/);
    expect(step7.indexOf('.cadence/ROADMAP.md')).toBeLessThan(
      step7.indexOf('cadence settle run --auto'),
    );
  });

  it('320-01/AC-4: release-cut step 3 confirms every released phase has both entries and none is still (in progress)', () => {
    const step3 = section(
      read('.claude/skills/release-cut/SKILL.md'),
      '## 3 — Doc-sync verification',
      '## 4 — Release PR',
    );
    expect(step3).toContain('ROADMAP.md');
    expect(step3).toContain('MILESTONES.md');
    expect(step3).toContain('(in progress)');
    // The doctor check cannot see in-range gaps — the checklist must say so.
    expect(step3).toContain('roadmap-currency');
  });

  it('320-01/AC-4: commands.md settle run section documents the missing-roadmap-entry notice', () => {
    const settleRun = section(
      read('docs/reference/commands.md'),
      '#### settle run',
      '### progress',
    );
    // Prose lives outside the fenced Usage block.
    const afterUsage = settleRun.slice(settleRun.indexOf('```', settleRun.indexOf('```') + 3) + 3);
    expect(afterUsage).toContain('ROADMAP.md');
    expect(afterUsage).toContain('MILESTONES.md');
    expect(afterUsage).toContain('stderr');
    expect(afterUsage).toContain('never auto-generated');
  });

  it('320-01/AC-4: cli.md settle run section documents the missing-roadmap-entry notice', () => {
    const settleRun = section(
      read('docs/cli.md'),
      '## settle run — close the loop',
      '## status — inspect loop state',
    );
    expect(settleRun).toContain('ROADMAP.md');
    expect(settleRun).toContain('MILESTONES.md');
    expect(settleRun).toContain('stderr');
    expect(settleRun).toContain('never auto-generated');
  });
});
