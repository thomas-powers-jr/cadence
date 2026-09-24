import { describe, expect, it } from 'vitest';
import type { ContextPacket, GitFacts } from '@thomas-powers-jr/cadence-types';
import { findUnfilledSections } from '../../src/handoff/placeholders.js';
import { renderSession } from '../../src/handoff/render-session.js';

const DOC = [
  '## TL;DR for the next session',
  '<!-- 4–6 bullets: where things stand, the single next action, blockers. FILL IN. -->',
  '',
  "## State on handoff   ·  pre-filled — verify, don't retype",
  '- Branch `main` (clean), 0 ahead / 0 behind origin',
  '',
  '## What landed this session',
  '- shipped the thing',
  '',
  '## Next action',
  '<!-- FILL IN -->',
].join('\n');

describe('findUnfilledSections', () => {
  it('AC-4: names each section that still holds a FILL IN marker, once', () => {
    expect(findUnfilledSections(DOC)).toEqual(['TL;DR for the next session', 'Next action']);
  });
  it('AC-4: returns [] for a completed doc', () => {
    expect(findUnfilledSections('## Next action\n**Action:** run x\n')).toEqual([]);
  });
});

// Phase 316-01: the generator emits a v2 SESSION doc with an `Open decisions`
// section; findUnfilledSections picks it up generically off its marker.
const PACKET: ContextPacket = {
  schemaVersion: 1,
  scope: 'handoff',
  generatedAt: '2026-06-03T14:02:00.000Z',
  loop: { present: true, loopPosition: 'BUILD', activePhase: '46-handoff', activeDraft: null, tier: 'standard' },
  recommendations: [],
  assumptions: [],
  decisions: [],
  files: [],
  totals: { recommendations: 0, assumptions: 0, decisions: 0, files: 0, recommendationsOmitted: 0 },
};

const GIT: GitFacts = {
  available: true, branch: 'main', dirty: false, ahead: 0, behind: 0,
  head: 'abc1234', recentCommits: 'abc1234 feat: x', diffStat: '', fetched: true,
};

function render(): string {
  return renderSession({
    generatedAt: '2026-06-03T14:02:00.000Z',
    label: null,
    packet: PACKET,
    git: GIT,
    contextPacketPath: '.cadence/intelligence/context/handoff.json',
  });
}

describe('renderSession v2 shape + findUnfilledSections (316-01)', () => {
  it('316-01/AC-3: frontmatter carries cadence_handoff: 2', () => {
    const md = render();
    const frontmatter = md.slice(0, md.indexOf('\n---', 4));
    expect(frontmatter).toMatch(/^cadence_handoff: 2$/m);
    expect(md).not.toMatch(/^cadence_handoff: 1$/m);
  });

  it('316-01/AC-3: Open decisions sits between Carry-forward gotchas and Next action with a one-line FILL IN marker', () => {
    const md = render();
    const carry = md.indexOf('\n## Carry-forward gotchas\n');
    const open = md.indexOf('\n## Open decisions\n');
    const next = md.indexOf('\n## Next action\n');
    expect(carry).toBeGreaterThan(-1);
    expect(open).toBeGreaterThan(carry);
    expect(next).toBeGreaterThan(open);
    const body = md.slice(open + '\n## Open decisions\n'.length, next);
    const markerLine = body.split('\n').find((l) => l.includes('<!--'));
    expect(markerLine).toBeDefined();
    expect(markerLine).toMatch(/<!--.*FILL IN.*-->/);
    expect(markerLine).toMatch(/decision/i);
    expect(markerLine).toMatch(/"None"/);
  });

  it('316-01/AC-3: reports Open decisions, in document order, while its marker is unreplaced', () => {
    expect(findUnfilledSections(render())).toEqual([
      'TL;DR for the next session',
      'What landed this session',
      'Carry-forward gotchas',
      'Open decisions',
      'Next action',
    ]);
  });

  it('316-01/AC-3: stops reporting Open decisions once its marker is replaced', () => {
    const filled = render().replace(/(## Open decisions\n)<!--[^\n]*-->/, '$1- None');
    expect(filled).not.toBe(render());
    const unfilled = findUnfilledSections(filled);
    expect(unfilled).not.toContain('Open decisions');
    expect(unfilled).toContain('Next action');
  });
});
