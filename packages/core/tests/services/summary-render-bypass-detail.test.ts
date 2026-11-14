import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { SummaryZ, type Summary } from '@thomas-powers-jr/cadence-types';
import { renderSummaryForReview } from '../../src/services/summary-render.js';
import { verifySummaryContentHash } from '../../src/services/summary-verify.js';

/**
 * Phase 346 (346-01, T4): `renderSummaryForReview` prints a gateBypasses
 * entry's optional `detail` (the build-test-must-pass output tail) as an
 * indented block under that entry's bullet, and renders a SUMMARY carrying
 * no `detail` on any entry byte-identically to before.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
// A real committed record carrying a (detail-less) gateBypasses entry.
const FIXTURE_PATH = join(
  REPO_ROOT,
  '.cadence',
  'phases',
  '206-cadence-next',
  '206-01-SUMMARY.json',
);

function loadFixture(): Summary {
  const parsed = SummaryZ.safeParse(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')));
  if (!parsed.success) throw new Error(`fixture failed SummaryZ: ${parsed.error.message}`);
  return parsed.data;
}

const TAIL = 'FAIL tests/a.test.ts > adds\n  expected 3 to be 4\nTests  1 failed | 9 passed';

function withBuildTestEntry(s: Summary, detail?: string): Summary {
  return {
    ...s,
    gateBypasses: [
      ...(s.gateBypasses ?? []),
      {
        gate: 'build-test-must-pass',
        flag: '--allow-failing-build',
        reason: 'pnpm test exited 1',
        severity: 'error',
        ...(detail !== undefined ? { detail } : {}),
      },
    ],
  };
}

describe('summary-render gateBypasses detail (phase 346, T4)', () => {
  it('346-01/AC-3: an entry with detail prints its bullet, a blank line, then every detail line indented by six spaces (a CommonMark indented code block, not a lazy paragraph continuation)', () => {
    const md = renderSummaryForReview(withBuildTestEntry(loadFixture(), TAIL));
    const expected = [
      '- ERROR build-test-must-pass via --allow-failing-build: pnpm test exited 1',
      '',
      '      FAIL tests/a.test.ts > adds',
      '        expected 3 to be 4',
      '      Tests  1 failed | 9 passed',
    ].join('\n');
    expect(md).toContain(`${expected}\n`);
  });

  it('346-01/AC-3: a trailing newline in detail adds no empty indented line', () => {
    const fixture = loadFixture();
    const md = renderSummaryForReview(withBuildTestEntry(fixture, `${TAIL}\n`));
    expect(md).toBe(renderSummaryForReview(withBuildTestEntry(fixture, TAIL)));
    expect(md).not.toMatch(/\n {4}\n/);
  });

  it('346-01/AC-3: the detail block is purely additive — stripping its lines yields the render of the same entry without detail', () => {
    const fixture = loadFixture();
    const withDetail = renderSummaryForReview(withBuildTestEntry(fixture, TAIL));
    const without = renderSummaryForReview(withBuildTestEntry(fixture));
    const block = ['', ...TAIL.split('\n').map((l) => `      ${l}`)].join('\n');
    expect(withDetail).toContain(`exited 1\n${block}\n`);
    expect(withDetail.replace(`\n${block}`, '')).toBe(without);
    expect(withDetail).not.toBe(without);
  });

  it('346-01/AC-3: a committed SUMMARY with no detail on any entry renders its Gate bypasses section exactly as the bullet lines alone, and its contentHash still matches', () => {
    const fixture = loadFixture();
    const bypasses = fixture.gateBypasses ?? [];
    expect(bypasses.length).toBeGreaterThan(0);
    expect(bypasses.every((b) => b.detail === undefined)).toBe(true);
    const md = renderSummaryForReview(fixture);
    const start = md.indexOf('## Gate bypasses');
    expect(start).toBeGreaterThanOrEqual(0);
    const next = md.indexOf('\n## ', start + 1);
    const section = md.slice(start, next === -1 ? md.length : next + 1);
    expect(section).toBe(
      [
        '## Gate bypasses',
        '',
        ...bypasses.map(
          (b) => `- ${b.severity.toUpperCase()} ${b.gate} via ${b.flag}: ${b.reason}`,
        ),
        '',
      ].join('\n'),
    );
    expect(md).not.toMatch(/^ {4}/m);
    // An explicit no-detail copy renders byte-identically to the parsed record.
    const copy: Summary = { ...fixture, gateBypasses: bypasses.map((b) => ({ ...b })) };
    expect(renderSummaryForReview(copy)).toBe(md);
    if (fixture.contentHash) expect(verifySummaryContentHash(fixture)).toBe('MATCH');
  });
});
