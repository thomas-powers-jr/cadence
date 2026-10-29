import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit, tempRepo } from '@thomas-powers-jr/cadence-testkit';
// A PACKAGE import, not a relative source path: phase 331 (D-BR,
// dec-20261013-002) makes core a runtime dependency of checkpoint for this one
// I/O primitive, so the sensor resolves it the way an installed consumer would.
import { atomicWriteText, findUnfilledSections } from '@thomas-powers-jr/cadence-core';

const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

// packages/checkpoint/tests → repo root is three levels up.
const REPO_ROOT = join(__dirname, '..', '..', '..');
const CHANGESET_BIN = join(REPO_ROOT, 'node_modules', '@changesets', 'cli', 'bin.js');
const PHASE_CHANGESET = 'checkpoint-sensor-core-atomic-write-export';
const FIXED_GROUP = [
  '@thomas-powers-jr/cadence-core',
  '@thomas-powers-jr/cadence-types',
  '@thomas-powers-jr/cadence-host-claude-code',
  '@thomas-powers-jr/cadence-host-codex',
  '@thomas-powers-jr/cadence-host-toolkit',
];

interface ReleasePlan {
  changesets: { id: string; releases: { name: string; type: string }[] }[];
  releases: { name: string; type: string; oldVersion: string; newVersion: string }[];
}

describe('core atomicWriteText as a checkpoint runtime dependency', () => {
  it('331-01/AC-10: atomicWriteText imported by package name writes and round-trips a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'checkpoint-core-export-'));
    try {
      const target = join(dir, 'reading.json');
      await atomicWriteText(target, '{"used_percentage":42}\n');
      expect(readFileSync(target, 'utf8')).toBe('{"used_percentage":42}\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('331-01/AC-10: core is a runtime dependency and checkpoint stays private at 0.0.0', () => {
    expect(pkg.dependencies?.['@thomas-powers-jr/cadence-core']).toBe('workspace:*');
    expect(pkg.devDependencies?.['@thomas-powers-jr/cadence-core']).toBeUndefined();
    expect(pkg.private).toBe(true);
    expect(pkg.version).toBe('0.0.0');
  });

  // The release plan, computed by the real `changeset status --verbose
  // --output <file>`. It runs against a temp git repo holding this repo's
  // workspace manifests and its real `.changeset/` directory, committed on
  // `main`: status's "changed packages since baseBranch" check then sees a
  // clean tree, so the plan does not depend on CI's shallow checkout or on
  // how far this branch is from main. The packages and config are exactly the
  // repo's; the changesets are the repo's plus one synthetic core minor, so
  // the plan always bumps core's group. Without it, a release that consumes
  // every changeset leaves an empty plan and nothing below would be checked.
  it('331-01/AC-10: changeset status --verbose --output bumps core\'s fixed group and leaves checkpoint unbumped and unpublished', async () => {
    const fixture = await tempRepo();
    try {
      const root = fixture.root;
      for (const file of ['package.json', 'pnpm-workspace.yaml']) copyFileSync(join(REPO_ROOT, file), join(root, file));
      for (const dir of readdirSync(join(REPO_ROOT, 'packages'))) {
        const manifest = join(REPO_ROOT, 'packages', dir, 'package.json');
        if (!existsSync(manifest)) continue;
        mkdirSync(join(root, 'packages', dir), { recursive: true });
        copyFileSync(manifest, join(root, 'packages', dir, 'package.json'));
      }
      mkdirSync(join(root, '.changeset'));
      for (const file of readdirSync(join(REPO_ROOT, '.changeset'))) {
        copyFileSync(join(REPO_ROOT, '.changeset', file), join(root, '.changeset', file));
      }
      writeFileSync(
        join(root, '.changeset', 'release-plan-fixture-core-minor.md'),
        '---\n"@thomas-powers-jr/cadence-core": minor\n---\n\nSynthetic fixture changeset: keeps core in the plan.\n',
      );
      runGit(root, ['init', '-q', '-b', 'main']);
      runGit(root, ['add', '-A']);
      runGit(root, [
        '-c', 'user.name=release-plan', '-c', 'user.email=release-plan@example.invalid', '-c', 'commit.gpgsign=false',
        'commit', '-q', '-m', 'fixture',
      ]);

      execFileSync(process.execPath, [CHANGESET_BIN, 'status', '--verbose', '--output', 'release-plan.json'], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const plan = JSON.parse(readFileSync(join(root, 'release-plan.json'), 'utf8')) as ReleasePlan;
      const release = (name: string) => plan.releases.find((r) => r.name === name);

      // checkpoint: never bumped, never published, whatever changesets exist.
      const checkpoint = release('@thomas-powers-jr/cadence-checkpoint');
      if (checkpoint !== undefined) {
        expect(checkpoint.type).toBe('none');
        expect(checkpoint.newVersion).toBe('0.0.0');
      }
      for (const changeset of plan.changesets) {
        expect(changeset.releases.map((r) => r.name)).not.toContain('@thomas-powers-jr/cadence-checkpoint');
      }

      // Core's fixed group moves together: one type, one new version.
      const group = FIXED_GROUP.map((name) => release(name));
      const core = group[0];
      expect(core, 'core missing from the release plan').toBeDefined();
      for (const member of group) {
        expect(member?.type).toBe(core?.type);
        expect(member?.newVersion).toBe(core?.newVersion);
      }

      // While this phase's changeset is unreleased, it bumps that group (at
      // least minor: a new public export). A release consumes the file, after
      // which only the invariants above apply.
      if (existsSync(join(REPO_ROOT, '.changeset', `${PHASE_CHANGESET}.md`))) {
        expect(plan.changesets.map((c) => c.id)).toContain(PHASE_CHANGESET);
        expect(['minor', 'major']).toContain(core?.type);
        expect(core?.newVersion).not.toBe(core?.oldVersion);
      }
    } finally {
      await fixture.cleanup();
    }
  });
});

// Phase 336 (T1): the Stop gate reports unfilled SESSION-doc sections with
// core's own detector rather than a second copy inside checkpoint.
describe('core findUnfilledSections as a checkpoint runtime import', () => {
  it('336-01/AC-6: findUnfilledSections imported by package name names each section still holding a FILL IN marker', () => {
    const doc = [
      '---',
      'cadence_handoff: 2',
      '---',
      '## TL;DR for the next session',
      'Filled narrative.',
      '## Carry-forward gotchas   ·  pre-filled',
      '<!-- FILL IN: gotchas -->',
      '## Next action',
      '<!-- FILL IN: next action -->',
      '<!-- FILL IN: a second marker in the same section -->',
      '',
    ].join('\n');
    expect(findUnfilledSections(doc)).toEqual(['Carry-forward gotchas', 'Next action']);
  });
});
