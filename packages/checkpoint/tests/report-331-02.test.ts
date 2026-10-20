import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Phase 331-02, T6: the phase report records 331-02's measurements, the
// corrected deadline rationale, and what is still open for Phase 3. The
// assertions read only the 331-02 section, so 331-01's record above it is
// neither required nor allowed to change (D-BZ).
const REPORT_MD = join(__dirname, '..', '..', '..', 'docs', 'checkpoint', 'REPORT-checkpoint-phase-2.md');
const HEADING = '## Slice 331-02 (as built, 2026-10-20)';

function slice02Section(): string {
  const text = readFileSync(REPORT_MD, 'utf8').replace(/\r\n/g, '\n');
  const start = text.indexOf(`\n${HEADING}\n`);
  if (start === -1) throw new Error(`report: "${HEADING}" section not found`);
  const rest = text.slice(start + 1 + HEADING.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

/** The named `###` subsection of the 331-02 section, up to the next `###`. */
function subsection(body: string, title: string): string {
  const start = body.indexOf(`\n### ${title}\n`);
  if (start === -1) throw new Error(`331-02 section: "### ${title}" not found`);
  const rest = body.slice(start + 1);
  const next = rest.indexOf('\n### ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('phase report: slice 331-02 section', () => {
  it('331-02/AC-5: cites the three probe runs and PR #571 run 39461022835, with a per-leg table', () => {
    const measurements = subsection(slice02Section(), 'Measurements');
    for (const run of ['39448948337', '39450266774', '39452805430', '39461022835']) {
      expect(measurements).toContain(run);
    }
    for (const leg of ['ubuntu-latest', 'macos-latest', 'windows-latest']) {
      expect(measurements).toMatch(new RegExp(`^\\| ${leg} \\|`, 'm'));
    }
  });

  it('331-02/AC-5: says 1500 ms is an operator-chosen hold ceiling, not a measured tail', () => {
    const decisions = subsection(slice02Section(), 'Decisions (operator, 2026-10-20)');
    expect(decisions).toContain('`RECORD_DEADLINE_MS` is 1500');
    expect(decisions).toContain('**not a measured tail**');
    expect(decisions).toContain('CHECKPOINT_RECORD_DEADLINE_MS');
  });

  it('331-02/AC-5: cites the statusline docs for render-on-exit and cancel-on-retrigger', () => {
    const docs = subsection(slice02Section(), 'What Claude Code does with a statusline');
    expect(docs).toContain('https://code.claude.com/docs/en/statusline');
    expect(docs).toContain('**Render on exit.**');
    expect(docs).toContain('**Cancel on retrigger.**');
    expect(docs).toContain('**300 ms is a debounce, not a budget.**');
  });

  it('331-02/AC-5: marks the stream-the-inner-stdout precondition done, without claiming backpressure', () => {
    const body = slice02Section();
    expect(subsection(body, "Corrections to 331-01's record")).toMatch(/Stream the inner's stdout": \*\*done in 331-02\*\*/);
    expect(subsection(body, 'What changed')).toContain('**Backpressure is not applied**');
  });

  it('331-02/AC-5: keeps the unbounded process lifetime and an inner left running on cancellation as Phase 3 notes', () => {
    const notes = subsection(slice02Section(), 'Phase 3 notes');
    expect(notes).toContain('**Process lifetime is still unbounded on a truly hung filesystem.**');
    expect(notes).toContain('**An inner can be left running when Claude Code cancels a run.**');
  });
});
