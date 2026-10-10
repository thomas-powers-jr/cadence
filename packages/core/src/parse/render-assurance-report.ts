import type { AssuranceCategory, AssuranceReport } from '../services/assurance-report.js';

// Phase 327 (T3): the text view of `cadence assurance report`. Built only
// from the report object — every number printed here is a field of the
// `--json` output (AC-5), so no count, percentage or boundary is computed or
// hardcoded in this file. No locale formatting: the output is byte-identical
// across machines (AC-7).

function span(c: AssuranceCategory): string {
  if (c.firstPhase === null || c.lastPhase === null) return 'no records';
  return c.firstPhase === c.lastPhase ? `phase ${c.firstPhase}` : `phases ${c.firstPhase}–${c.lastPhase}`;
}

/** Zod error messages are multi-line; keep each list entry on one line. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function renderAssuranceReport(report: AssuranceReport): string {
  const { categories, grades, totals } = report;
  const lines: string[] = [];

  lines.push('# Assurance report', '');
  lines.push(
    report.window.since === null
      ? 'Window: every phase'
      : `Window: phases at or after ${report.window.since}`,
  );
  lines.push(
    `Files: ${totals.files} (settled ${totals.settled}, refused ${totals.refused}, unreadable ${totals.unreadable})`,
    '',
  );

  lines.push('## Settled records by category', '');
  lines.push(`- Un-gradable: ${categories.unGradable.count} (${span(categories.unGradable)}) — ${categories.unGradable.reason}`);
  lines.push(
    `- Gradable but never graded: ${categories.neverGraded.count} (${span(categories.neverGraded)}) — ${categories.neverGraded.reason}`,
  );
  if (categories.neverGraded.afterFirstGraded.length > 0) {
    lines.push(
      `  - at or after the first graded phase: ${categories.neverGraded.afterFirstGraded.map((r) => r.id).join(', ')}`,
    );
  }
  lines.push(`- Graded: ${categories.graded.count} (${span(categories.graded)}) — ${categories.graded.reason}`, '');

  lines.push('## Grades of graded records', '');
  lines.push('| Grade | Stored | Re-derived |', '|---|---|---|');
  for (const grade of Object.keys(grades.stored) as (keyof typeof grades.stored)[]) {
    lines.push(`| ${grade} | ${grades.stored[grade]} | ${grades.rederived[grade]} |`);
  }
  lines.push('');
  lines.push(
    "Re-derived applies today's assurance rule to each graded record's stored inputs; the files themselves are never rewritten.",
  );
  if (grades.delta.length === 0) {
    lines.push('No graded record changes grade under the current rule.', '');
  } else {
    lines.push('Records whose grade changes under the current rule:');
    for (const d of grades.delta) lines.push(`- ${d.id}: ${d.stored} → ${d.rederived} (${d.path})`);
    lines.push('');
  }

  lines.push(`## Gates (over ${report.provenanceRecords} settled records with gate provenance)`, '');
  lines.push('| Gate | Ran | Skipped | Not recorded |', '|---|---|---|---|');
  for (const row of report.gates) {
    lines.push(`| ${row.gate} | ${row.ran} | ${row.skipped} | ${row.notRecorded} |`);
  }
  lines.push('');
  lines.push(
    "Not recorded means the SUMMARY's gates[] has no entry for that gate. Some gates are never written there (they fire before settle, such as approve and plan-review, or are excluded from settle provenance), so a fully not-recorded row says nothing about whether the gate ran.",
    '',
  );

  lines.push('## Provider selection (gate entries)', '');
  for (const [k, v] of Object.entries(report.providerSelection)) lines.push(`- ${k}: ${v}`);
  lines.push('');

  lines.push('## Bypasses', '');
  lines.push(`- settled records with gate bypasses: ${report.recordsWithBypasses}`, '');

  lines.push('## Evidence tally (stored, over graded records)', '');
  for (const [k, v] of Object.entries(report.evidenceTally)) lines.push(`- ${k}: ${v}`);
  lines.push('');

  lines.push(`## Refused settles (${totals.refused})`, '');
  if (report.refused.length === 0) lines.push('- none');
  for (const r of report.refused) lines.push(`- ${r.id} (${r.path})`);
  lines.push('');

  lines.push(`## Unreadable files (${totals.unreadable})`, '');
  if (report.unreadable.length === 0) lines.push('- none');
  for (const u of report.unreadable) lines.push(`- ${u.path} — ${oneLine(u.reason)}`);

  return lines.join('\n') + '\n';
}
