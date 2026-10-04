import type { CadenceState } from '@thomas-powers-jr/cadence-types';

/**
 * Phase 322 (T2, AC-3): `state.activePhase` survives `settle` and is
 * per-checkout, so on IDLE it is only the last phase that loop-tripped in
 * this checkout — not an active one. Relabel it for what it is; every
 * non-IDLE state renders the line exactly as before.
 */
function activePhaseLines(state: CadenceState): string[] {
  if (state.loopPosition !== 'IDLE') {
    return [`**Active phase:** ${state.activePhase ?? '(none)'}`];
  }
  return [
    '**Active phase:** (none — loop is IDLE)',
    `**Last phase in this checkout:** ${state.activePhase ?? '(none)'}`,
  ];
}

export function renderStateMd(state: CadenceState): string {
  const lines = [
    '# CADENCE State',
    '',
    '> Derived view. Do not edit by hand — regenerated on every state.json write.',
    '',
    `**Project:** ${state.project.name}`,
    `**Loop position:** ${state.loopPosition}`,
    ...activePhaseLines(state),
    `**Active draft:** ${state.activeDraft ?? '(none)'}`,
    `**Tier:** ${state.tier ?? '(n/a)'}`,
    '',
    '## Telemetry',
    `- Token utilization: ${(state.session.tokenUtilization * 100).toFixed(0)}%`,
    `- Subagent spawns this session: ${state.session.subagentSpawns}`,
    `- Last handoff: ${state.session.lastHandoff ?? '(none)'}`,
    '',
    '## Counts',
    `- Open drafts: ${state.openDrafts.length}`,
    `- Decisions: ${state.decisions.length}`,
    `- Deferred items: ${state.deferred.length}`,
    '',
    '## Skill audit',
    `- Required: ${state.skillAudit.required.join(', ') || '(none)'}`,
    `- Invoked: ${state.skillAudit.invoked.join(', ') || '(none)'}`,
    '',
  ];
  if (state.activeTask) {
    lines.push('## Active task', `- ID: ${state.activeTask.id}`, `- Status: ${state.activeTask.status}`, '');
  }
  return lines.join('\n');
}
