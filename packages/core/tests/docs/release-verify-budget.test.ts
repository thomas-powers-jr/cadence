import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/core/tests/docs → repo root is four levels up.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const script = await import('../../../../scripts/release-integrity.mjs');

/**
 * Phase 323 (rec-20260802-005): the Release workflow's post-publish npm
 * verification now polls long enough to outlast the registry edge's
 * five-minute packument cache. The operator-facing docs must describe that
 * budget (computed from the script's own exports, so the prose cannot drift
 * from the code) and stop calling a red verify step a propagation race.
 *
 * Both files are hard-wrapped prose, so whitespace is collapsed before every
 * assertion: a phrase split across a line break still matches, and a
 * reworded leftover cannot hide from the negative check behind a wrap.
 */
function readCollapsed(...segments: string[]): string {
  return readFileSync(join(ROOT, ...segments), 'utf8').replace(/\s+/g, ' ');
}

const releaseDoc = readCollapsed('docs', 'release.md');
const skill = readCollapsed('.claude', 'skills', 'release-cut', 'SKILL.md');
const manual = readCollapsed('CLAUDE.md');

// Minutes of waiting between attempts, from the script's own exports.
const minutes = Math.round(
  ((script.POST_PUBLISH_VERIFY_ATTEMPTS - 1) * script.POST_PUBLISH_VERIFY_INTERVAL_MS) / 60000,
);

describe('post-publish verify budget docs (phase 323)', () => {
  it('323-01/AC-4: docs/release.md states the budget in minutes computed from the script exports', () => {
    expect(minutes).toBeGreaterThanOrEqual(5);
    expect(releaseDoc).toContain(`${minutes} minutes`);
    expect(releaseDoc).toContain(`${script.POST_PUBLISH_VERIFY_INTERVAL_MS / 1000} s`);
    expect(releaseDoc).toContain(`${script.POST_PUBLISH_VERIFY_ATTEMPTS} attempts`);
  });

  it('323-01/AC-4: docs/release.md names the edge cache lifetime, the progress lines and what a red verify step means', () => {
    expect(releaseDoc).toContain('max-age=300');
    expect(releaseDoc).toContain('one progress line per miss');
    expect(releaseDoc).toContain(
      'a red verify step after that budget is a real mismatch to investigate, not a propagation race',
    );
  });

  it('323-01/AC-4: docs/release.md keeps the done bar the release-integrity wiring test pins', () => {
    expect(releaseDoc).toContain('npm shows the new version');
    expect(releaseDoc).toContain('matching `v<version>` git tag');
    expect(releaseDoc).toContain('non-draft Release');
    expect(releaseDoc).toContain('latest release');
  });

  it('323-01/AC-4: the release-cut skill names all five published packages, host-toolkit included', () => {
    expect(skill).toContain('all five published packages');
    // Step 2's list, not just step 6's npm view line.
    expect(skill).toContain('`host-codex`, `host-toolkit`');
    expect(skill).toContain('npm view @thomas-powers-jr/cadence-host-toolkit version');
    expect(skill).toContain('All five on npm');
    expect(skill).not.toContain('all four published packages');
    expect(skill).not.toContain('All four on npm');
  });

  it('323-01/AC-4: the release-cut skill no longer excuses a red verify step as a propagation race', () => {
    expect(skill).not.toContain('often just an npm-CDN propagation race');
    expect(skill).toContain(`about ${minutes} minutes`);
    // Step 6 tells operators to look for the final attempt's line in the log.
    expect(skill).toContain(
      `attempt ${script.POST_PUBLISH_VERIFY_ATTEMPTS}/${script.POST_PUBLISH_VERIFY_ATTEMPTS}`,
    );
    expect(skill).toContain('Never `gh run rerun --failed` on the Release workflow');
  });

  it('323-01/AC-4: CLAUDE.md\'s "The Release Re-Run" entry agrees with the skill (five packages, no propagation-race excuse)', () => {
    const start = manual.indexOf('**The Release Re-Run.**');
    expect(start).toBeGreaterThan(-1);
    const entry = manual.slice(start, manual.indexOf('**The Auto-Renumber.**', start));
    expect(entry).not.toContain('npm-CDN propagation race');
    expect(entry).not.toContain('all four packages');
    expect(entry).toContain('all five packages');
    expect(entry).toContain(`about ${minutes} minutes`);
  });
});
