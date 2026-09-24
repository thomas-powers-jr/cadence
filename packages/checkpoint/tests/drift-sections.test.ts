import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Test-only import by relative SOURCE path, not by package name.
// `@thomas-powers-jr/cadence-core`'s package.json `exports` map only exposes
// the package root, and `renderSession` is not part of core's public API, so
// `import { renderSession } from '@thomas-powers-jr/cadence-core'` is not an
// option (and adding a public export just for this test is out of scope).
// Reaching into core's source is acceptable here only because this is a test
// whose whole job is to catch drift between core's handoff renderer and this
// package's validator. `render-session.ts` imports from
// `@thomas-powers-jr/cadence-types` with `import type` only, so nothing from
// that package is loaded at runtime by this import. Checkpoint's tsconfig
// (`include: ["src"]`) does not typecheck test files; vitest transpiles them.
//
// The import itself resolves without any declared dependency, but the
// `@thomas-powers-jr/cadence-core` (and `-types`) devDependencies in
// checkpoint's package.json are still LOAD-BEARING: they are how turbo learns
// that checkpoint's test task depends on core's source, so a renderer-only
// edit busts checkpoint's cached test result. Do not remove them as "unused".
import { renderSession } from '../../core/src/handoff/render-session.js';
import type { SessionRenderInput } from '../../core/src/handoff/render-session.js';
import { extractHeaderLabels, LATEST_HANDOFF_VERSION, REQUIRED_SECTIONS_V2, validate } from '../src/validate.js';

// Same spawn pattern as tests/cli.test.ts (its `run` helper is not exported).
const CLI = join(__dirname, '..', 'bin', 'checkpoint.cjs');

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

// Fixed input, mirroring the minimal PACKET/GIT fixture in
// packages/core/tests/handoff/render-session.test.ts. Types come from
// SessionRenderInput rather than a package-name import of cadence-types.
const PACKET: SessionRenderInput['packet'] = {
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

const GIT: SessionRenderInput['git'] = {
  available: true,
  branch: 'main',
  dirty: true,
  ahead: 0,
  behind: 0,
  head: 'abc1234',
  recentCommits: 'abc1234 feat: x',
  diffStat: ' 1 file changed',
  fetched: true,
};

const INPUT: SessionRenderInput = {
  generatedAt: '2026-06-03T14:02:00.000Z',
  label: 'drift',
  packet: PACKET,
  git: GIT,
  contextPacketPath: '.cadence/intelligence/context/handoff.json',
};

describe('renderer ↔ validator section drift', () => {
  it("316-01/AC-4: renderSession()'s ## header labels equal the validator's v2 required-section list, in order", () => {
    const rendered = renderSession(INPUT);

    // Exact equality on purpose. Both sides are compared unfiltered: filtering
    // the rendered labels through the validator's own SECTIONS_V2 name set
    // would hide a section dropped from the validator (it would vanish from
    // both sides). Exact equality catches a header renamed, removed, added, or
    // reordered on either side.
    //
    // The optional "Acceptance criteria touched" section is intentionally
    // absent: the generator does not emit it. If the renderer ever starts
    // emitting it, update this test deliberately.
    expect(extractHeaderLabels(rendered)).toEqual([...REQUIRED_SECTIONS_V2]);
  });

  it('316-01/AC-4: renderSession() declares cadence_handoff equal to the validator\'s LATEST_HANDOFF_VERSION', () => {
    // The header comparison above is against the v2 list regardless of the
    // version the document declares. Without this guard, a renderer that
    // emitted `cadence_handoff: 1` while still rendering the v2 sections would
    // pass the header test yet be validated against the wrong schema.
    const rendered = renderSession(INPUT);
    const declared = /^cadence_handoff:(.*)$/m.exec(rendered)?.[1]?.trim();

    expect(declared).toBe(LATEST_HANDOFF_VERSION);
  });

  it('316-01/AC-1: a document freshly rendered by renderSession() from a fixed input validates clean', () => {
    const rendered = renderSession(INPUT);

    expect(validate(rendered)).toEqual({ ok: true, diagnostics: [] });
  });

  it('316-01/AC-1: `checkpoint validate <file>` exits 0 with no stderr diagnostics on the freshly rendered document', () => {
    const rendered = renderSession(INPUT);
    const dir = mkdtempSync(join(tmpdir(), 'checkpoint-drift-'));
    try {
      const file = join(dir, 'SESSION-fresh-render.md');
      writeFileSync(file, rendered, 'utf8');

      const result = run(['validate', file]);

      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
