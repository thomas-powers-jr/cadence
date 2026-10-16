// AC-7 tool sweep (phase 331, task T5): with checkpoint's state files present
// under `.cadence/checkpoint/` (D-BS), `cadence doctor`, `cadence summary
// verify-all`, and the settle-time boundary scan's touched-file filtering
// must not report them as an anomaly. Each tool runs once without and once
// with the seeded files, in a testkit ephemeral CADENCE-initialized git repo,
// and the two runs are compared.
//
// Test-only imports of core SOURCE by relative path (as drift-sections.test.ts
// does, see its header): `collectUnscopedTouchedFiles` and
// `filterCadenceSelfWrites` are what the `boundary-scan` gate calls, and
// neither is part of core's public entry. The doctor and verify-all runs go
// through the built core CLI (`packages/core/bin/cadence.cjs`), which turbo
// builds before this package's tests (core is a dependency).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGit, tempRepo } from '@thomas-powers-jr/cadence-testkit';
import type { Fixture } from '@thomas-powers-jr/cadence-testkit';
import { collectUnscopedTouchedFiles, filterCadenceSelfWrites } from '../../core/src/git/boundary-diff.js';

const CADENCE_BIN = join(__dirname, '..', '..', 'core', 'bin', 'cadence.cjs');

const SEEDED = [
  '.cadence/checkpoint/reading.json',
  '.cadence/checkpoint/state.json',
  '.cadence/checkpoint/reading.json.123.abcdef.tmp',
] as const;

let repo: Fixture;
let cadenceHome: string;

beforeEach(async () => {
  repo = await tempRepo({ initialized: true, projectName: 'tool-sweep' });
  // A private CADENCE_HOME: the CLI reads the user-level onboarding store at
  // startup, and this test must never touch the real one.
  cadenceHome = mkdtempSync(join(tmpdir(), 'tool-sweep-home-'));
  runGit(repo.root, ['init', '-q', '-b', 'main']);
  runGit(repo.root, ['add', '-A']);
  runGit(repo.root, [
    '-c',
    'user.name=tool-sweep',
    '-c',
    'user.email=tool-sweep@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    'init',
  ]);
});

afterEach(async () => {
  await repo.cleanup();
  rmSync(cadenceHome, { recursive: true, force: true });
});

function seedCheckpointFiles(root: string): void {
  mkdirSync(join(root, '.cadence', 'checkpoint'), { recursive: true });
  const reading = {
    used_percentage: 42,
    unknown: false,
    absolute: {
      total_input_tokens: 15500,
      total_output_tokens: 1200,
      context_window_size: 200000,
      current_usage: null,
    },
    exceeds_200k_tokens: false,
    current_dir: root,
    project_dir: root,
    ts: '2026-10-15T12:00:00.000Z',
  };
  writeFileSync(join(root, SEEDED[0]), `${JSON.stringify(reading, null, 2)}\n`);
  writeFileSync(join(root, SEEDED[1]), `${JSON.stringify({ state: 'idle', since: '2026-10-15T12:00:00.000Z' })}\n`);
  // A leftover temp sibling, as an interrupted atomic write would leave.
  writeFileSync(join(root, SEEDED[2]), '{"used_percentage": 4');
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function cadence(args: string[], cwd: string): CliResult {
  const r = spawnSync(process.execPath, [CADENCE_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, CADENCE_HOME: cadenceHome },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

interface DoctorCheck {
  name: string;
  severity: string;
  detail: string;
  remediation: string | null;
}

function doctorJson(cwd: string): { status: number | null; ok: unknown; checks: DoctorCheck[]; stderr: string } {
  const r = cadence(['doctor', '--json'], cwd);
  const report = JSON.parse(r.stdout) as { ok: unknown; checks: DoctorCheck[] };
  return { status: r.status, ok: report.ok, checks: report.checks, stderr: r.stderr };
}

describe('state files vs the cadence tool sweep', () => {
  it('331-01/AC-7: cadence doctor reports the same checks, severities, and exit status with the checkpoint files present', () => {
    const without = doctorJson(repo.root);
    seedCheckpointFiles(repo.root);
    const withFiles = doctorJson(repo.root);

    expect(withFiles.checks.length).toBeGreaterThan(0);
    expect(withFiles.checks.map((c) => [c.name, c.severity])).toEqual(without.checks.map((c) => [c.name, c.severity]));
    expect(withFiles.ok).toBe(without.ok);
    expect(withFiles.status).toBe(without.status);
    for (const check of withFiles.checks) {
      expect(`${check.detail} ${check.remediation ?? ''}`, check.name).not.toMatch(/checkpoint/i);
    }
    expect(withFiles.stderr).not.toMatch(/checkpoint/i);
  });

  it('331-01/AC-7: cadence summary verify-all output and exit status are unchanged with the checkpoint files present', () => {
    // One real record so the walk has something to check (NO_HASH is
    // informational, not a failure).
    const phaseDir = join(repo.root, '.cadence', 'phases', '10-alpha');
    mkdirSync(phaseDir, { recursive: true });
    writeFileSync(
      join(phaseDir, '10-01-SUMMARY.json'),
      JSON.stringify({
        schemaVersion: 1,
        draftId: '10-01',
        completedAt: '2026-07-15T10:00:00.000Z',
        acResults: [{ id: 'AC-1', pass: true, evidence: 'executed', note: 'ok' }],
        taskResults: [{ id: 'T1', status: 'DONE', notes: '' }],
        decisions: [],
        deferred: [],
        skillAudit: { required: [], invoked: [] },
        gates: [],
      }),
    );
    const without = cadence(['summary', 'verify-all'], repo.root);
    expect(without.stdout).toMatch(/1 checked: 0 MATCH, 1 NO_HASH, 0 failed/);

    seedCheckpointFiles(repo.root);
    const withFiles = cadence(['summary', 'verify-all'], repo.root);
    expect(withFiles.status).toBe(without.status);
    expect(withFiles.stdout).toBe(without.stdout);
    expect(withFiles.stderr).toBe(without.stderr);
    expect(`${withFiles.stdout}${withFiles.stderr}`).not.toMatch(/checkpoint/i);
  });

  it("331-01/AC-7: the boundary scan's touched-file filtering drops every checkpoint file the unscoped git scan sees", async () => {
    const without = await collectUnscopedTouchedFiles(repo.root, 'main');
    seedCheckpointFiles(repo.root);
    const withFiles = await collectUnscopedTouchedFiles(repo.root, 'main');

    // Premise: the checkpoint files really are in the scan's input (no
    // consumer .gitignore entry covers .cadence/checkpoint/ yet).
    for (const path of SEEDED) expect(withFiles.files).toContain(path);
    const filtered = filterCadenceSelfWrites(withFiles.files);
    expect(filtered.filter((f) => /checkpoint/i.test(f))).toEqual([]);
    expect([...filtered].sort()).toEqual([...filterCadenceSelfWrites(without.files)].sort());
    // The literal list form the brief names, too.
    expect(filterCadenceSelfWrites([...SEEDED, 'src/app.ts'])).toEqual(['src/app.ts']);
  });
});
