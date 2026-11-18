import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { Command } from 'commander';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import type * as SettleServiceModule from '../../src/services/settle.js';

/**
 * Phase 347 (347-01, T3): the `settle run --dry-run` flag. Two layers:
 *  - in-process: the registered `settle run` command with `settleService`
 *    spied, proving the --interactive / --ship-ref usage errors fire in the
 *    CLI before the service is ever called, and that the flag is passed
 *    through as `SettleArgs.dryRun`;
 *  - spawned: the built CLI (`dist/cli/index.js`, like the neighbouring
 *    settle CLI tests) end to end — help text, exit codes 0/1/2, stdout vs
 *    stderr, and a marker test command that must never run on a usage error.
 */

const settleSpy = vi.hoisted(() => ({
  calls: [] as unknown[],
  passThrough: true,
}));
vi.mock('../../src/services/settle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SettleServiceModule>();
  return {
    ...actual,
    settleService: async (...args: Parameters<typeof SettleServiceModule.settleService>) => {
      settleSpy.calls.push(args[1]);
      if (!settleSpy.passThrough) return { exitCode: 0 };
      return actual.settleService(...args);
    },
  };
});

const { registerSettleCommand, dryRunCliUsageError } = await import('../../src/cli/commands/settle.js');

const CADENCE_CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');

function run(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ANTHROPIC_API_KEY: '' };
    delete env.CADENCE_PROMPTER_SCRIPT;
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

async function patchConfig(root: string, patch: (c: Record<string, unknown>) => void): Promise<void> {
  const configPath = join(root, '.cadence', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  patch(config);
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

/** A test command that leaves a MARKER file behind if it ever runs. */
async function armMarkerTestCommand(root: string): Promise<void> {
  await patchConfig(root, (c) => {
    c.verification = {
      ...((c.verification as Record<string, unknown> | undefined) ?? {}),
      testCommand: `node -e "require('fs').writeFileSync('MARKER','ran')"`,
    };
  });
}

/** See settle.test.ts: these fixtures have no real test coverage, so lower
 *  the evidence floor to keep the passing fixture passing. */
async function relaxEvidenceFloor(root: string): Promise<void> {
  await patchConfig(root, (c) => {
    c.gates = { ...((c.gates as Record<string, unknown> | undefined) ?? {}), evidenceFloor: 'unverified' };
  });
}

async function draftApproveAndComplete(root: string): Promise<void> {
  await run(['draft', 'new', '01-foundation', '01', '--title=Demo'], root);
  await run(['draft', 'approve', '01-foundation', '01'], root);
  await run(['build', 'task', 'T1', '--status=DONE'], root);
}

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
  settleSpy.calls = [];
  settleSpy.passThrough = true;
});

/** Run the registered `settle run` in-process; capture stderr/stdout and the
 *  exit code the action leaves on `process.exitCode`. */
async function runInProcess(args: string[]): Promise<{ code: number; stderr: string; stdout: string }> {
  const program = new Command();
  program.exitOverride();
  registerSettleCommand(program);
  let stderr = '';
  let stdout = '';
  const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  });
  const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  });
  const prev = process.exitCode;
  process.exitCode = undefined;
  try {
    await program.parseAsync(['node', 'cadence', 'settle', 'run', ...args]);
    return { code: typeof process.exitCode === 'number' ? process.exitCode : 0, stderr, stdout };
  } finally {
    process.exitCode = prev;
    errSpy.mockRestore();
    outSpy.mockRestore();
  }
}

describe('settle run --dry-run: CLI usage rules, in-process (Phase 347)', () => {
  it('347-01/AC-4: --dry-run --interactive is a usage error before settleService runs', async () => {
    settleSpy.passThrough = false;
    const r = await runInProcess(['--dry-run', '--interactive']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--interactive');
    expect(r.stderr).toContain('--dry-run');
    expect(r.stdout).toBe('');
    expect(settleSpy.calls).toHaveLength(0);
  });

  it('347-01/AC-4: --dry-run --ship-ref is a usage error before settleService runs', async () => {
    settleSpy.passThrough = false;
    const r = await runInProcess(['--dry-run', '--ship-ref', 'PR #1']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--ship-ref');
    expect(r.stderr).toContain('finalize');
    expect(r.stdout).toBe('');
    expect(settleSpy.calls).toHaveLength(0);
  });

  it('347-01/AC-4: both refused flags are named together', async () => {
    settleSpy.passThrough = false;
    const r = await runInProcess(['--dry-run', '--interactive', '--ship-ref', 'x']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--interactive');
    expect(r.stderr).toContain('--ship-ref');
    expect(settleSpy.calls).toHaveLength(0);
  });

  it('347-01/AC-4: --dry-run --no-interactive is accepted and passed through as dryRun', async () => {
    settleSpy.passThrough = false;
    const r = await runInProcess(['--dry-run', '--no-interactive', '--auto']);
    expect(r.code).toBe(0);
    expect(settleSpy.calls).toHaveLength(1);
    expect(settleSpy.calls[0]).toMatchObject({ dryRun: true, interactive: false, auto: true });
  });

  it('347-01/AC-4: without --dry-run, --interactive and --ship-ref reach settleService unchanged', async () => {
    settleSpy.passThrough = false;
    const r = await runInProcess(['--interactive', '--ship-ref', 'PR #2']);
    expect(r.code).toBe(0);
    expect(settleSpy.calls).toHaveLength(1);
    const args = settleSpy.calls[0] as Record<string, unknown>;
    expect(args).toMatchObject({ interactive: true, shipRef: 'PR #2' });
    expect(args.dryRun).toBeUndefined();
  });
});

describe('settle run --dry-run: CLI and service usage messages agree (Phase 347)', () => {
  const cases: { name: string; extra: Partial<SettleServiceModule.SettleArgs> }[] = [
    { name: '--interactive', extra: { interactive: true } },
    { name: '--ship-ref', extra: { shipRef: 'x' } },
    { name: '--interactive and --ship-ref', extra: { interactive: true, shipRef: 'x' } },
  ];
  for (const c of cases) {
    it(`347-01/AC-4: ${c.name} — settleService's stderr equals dryRunCliUsageError exactly, exit 2 from both`, async () => {
      active = await tempRepo({ initialized: true });
      const actual = await vi.importActual<typeof SettleServiceModule>('../../src/services/settle.js');
      const opts: SettleServiceModule.SettleArgs = { dryRun: true, ...c.extra };
      const err: string[] = [];
      const out: string[] = [];
      const result = await actual.settleService(active.root, opts, {
        out: (s) => out.push(s),
        err: (s) => err.push(s),
      });
      const cliMessage = dryRunCliUsageError(opts);
      expect(cliMessage).not.toBeNull();
      expect(result.exitCode).toBe(2);
      expect(err.join('')).toBe(cliMessage);
      expect(out).toEqual([]);
    });
  }
});

describe('settle run --dry-run: built CLI end to end (Phase 347)', () => {
  it('347-01/AC-4: settle run --help lists --dry-run with its exit codes and refused flags', async () => {
    active = await tempRepo({ initialized: true });
    const r = await run(['settle', 'run', '--help'], active.root);
    expect(r.code).toBe(0);
    const help = r.stdout.replace(/\s+/g, ' ');
    expect(help).toContain('--dry-run');
    expect(help).toContain('never prompts; stops before finalize');
    expect(help).toContain('cadence writes and notifies nothing (the test command and verifiers still run)');
    expect(help).toContain('spends no convergence attempt');
    expect(help).toContain(
      'exit 0 if settle would pass, 1 if it would refuse, 2 when combined with --interactive or --ship-ref',
    );
    // Not every usage error exits 2 (Commander parse errors exit 1), so the
    // help must not claim it.
    expect(help).not.toContain('2 for a usage error');
  });

  it('347-01/AC-4: --dry-run --interactive exits 2 naming --interactive; the test command never runs', async () => {
    active = await tempRepo({ initialized: true });
    await draftApproveAndComplete(active.root);
    await armMarkerTestCommand(active.root);
    const r = await run(['settle', 'run', '--ac', 'AC-1=pass', '--dry-run', '--interactive'], active.root);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--interactive cannot be combined with --dry-run');
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toContain('settle would');
    expect(existsSync(join(active.root, 'MARKER'))).toBe(false);
  });

  it('347-01/AC-4: --dry-run --ship-ref exits 2 naming --ship-ref; the test command never runs', async () => {
    active = await tempRepo({ initialized: true });
    await draftApproveAndComplete(active.root);
    await armMarkerTestCommand(active.root);
    const r = await run(['settle', 'run', '--ac', 'AC-1=pass', '--dry-run', '--ship-ref', 'PR #9'], active.root);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--ship-ref cannot be combined with --dry-run');
    expect(r.stdout).toBe('');
    expect(existsSync(join(active.root, 'MARKER'))).toBe(false);
  });

  it('347-01/AC-4: control — --dry-run --no-interactive runs the marker test command, so the "never ran" checks are not vacuous', async () => {
    active = await tempRepo({ initialized: true });
    await relaxEvidenceFloor(active.root);
    await draftApproveAndComplete(active.root);
    await armMarkerTestCommand(active.root);
    const r = await run(['settle', 'run', '--ac', 'AC-1=pass', '--dry-run', '--no-interactive'], active.root);
    expect(r.stdout).toContain('settle would');
    expect(existsSync(join(active.root, 'MARKER'))).toBe(true);
  });

  it('347-01/AC-4: a Commander parse error under --dry-run (--ship-ref "") exits 1 with Commander\'s message and no report', async () => {
    active = await tempRepo({ initialized: true });
    await draftApproveAndComplete(active.root);
    await armMarkerTestCommand(active.root);
    const r = await run(['settle', 'run', '--ac', 'AC-1=pass', '--dry-run', '--ship-ref', ''], active.root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--ship-ref requires a non-empty value');
    expect(r.stdout).not.toContain('settle would');
    expect(existsSync(join(active.root, 'MARKER'))).toBe(false);
  });

  it('347-01/AC-4: --dry-run on a passing fixture exits 0, prints "settle would pass" on stdout, writes no SUMMARY', async () => {
    active = await tempRepo({ initialized: true });
    await relaxEvidenceFloor(active.root);
    await draftApproveAndComplete(active.root);
    const r = await run(['settle', 'run', '--ac', 'AC-1=pass', '--dry-run', '--no-interactive'], active.root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('settle would pass');
    expect(r.stderr).not.toContain('settle would pass');
    expect(existsSync(join(active.root, '.cadence/phases/01-foundation/01-01-SUMMARY.json'))).toBe(false);
    const state = JSON.parse(await readFile(join(active.root, '.cadence/state.json'), 'utf8'));
    expect(state.loopPosition).toBe('BUILD');
  });

  it('347-01/AC-4: --dry-run on a refusing fixture (no active BUILD) exits 1 with "settle would refuse at" on stdout', async () => {
    active = await tempRepo({ initialized: true });
    const r = await run(['settle', 'run', '--auto', '--dry-run'], active.root);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('settle would refuse at');
    expect(r.stderr).not.toContain('settle would refuse at');
  });
});
