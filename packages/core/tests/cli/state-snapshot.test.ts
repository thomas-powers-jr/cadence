import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';

// Phase 341, T4: `cadence state save | list | load` wired into the CLI. These
// spawn the BUILT dist CLI against testkit fixtures, so they prove the
// registration, the `--json` stdout contract and the exit codes end to end.

const CADENCE_CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');

function run(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

describe('cadence state (CLI, phase 341)', () => {
  it('save → list --json → load --json round-trips with exit 0 and single-JSON stdout (341-01/AC-1, 341-01/AC-2, 341-01/AC-4)', async () => {
    active = await tempRepo({ initialized: true, projectName: 'state-cli-roundtrip' });
    const root = active.root;

    // 341-01/AC-1: save writes a named snapshot and reports it as one JSON object.
    const save = await run(['state', 'save', '--json'], root);
    expect(save.code).toBe(0);
    const saved = JSON.parse(save.stdout) as {
      path: string;
      position: { loop: string; phase: string | null; draft: string | null };
      pruned: string[];
      warnings: string[];
    };
    expect(saved.path).toMatch(/^\.cadence\/snapshots\/state-\d{4}-\d{2}-\d{2}T\d{6}Z-[A-Za-z0-9-]+\.json$/);
    expect(saved.position.loop).toBe('IDLE');
    expect(saved.pruned).toEqual([]);
    expect(existsSync(join(root, saved.path))).toBe(true);
    expect(existsSync(join(root, '.cadence', 'local', 'state-sync.json'))).toBe(true);
    const snapshotName = saved.path.split('/').pop() as string;

    // 341-01/AC-2: list --json is exactly one JSON array naming that snapshot.
    const list = await run(['state', 'list', '--json'], root);
    expect(list.code).toBe(0);
    const entries = JSON.parse(list.stdout) as Array<{ name: string; host?: string; savedAt?: string }>;
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe(snapshotName);
    expect(typeof entries[0]?.savedAt).toBe('string');

    // 341-01/AC-4: load --json restores, bumps revision past both sides, backs up.
    const beforeBytes = await readFile(join(root, '.cadence', 'state.json'), 'utf8');
    const beforeRevision = (JSON.parse(beforeBytes) as { revision: number }).revision;
    const load = await run(['state', 'load', '--json'], root);
    expect(load.code).toBe(0);
    const loaded = JSON.parse(load.stdout) as {
      from: string;
      before: unknown;
      after: { loop: string };
      backup: string | null;
      warnings: string[];
    };
    expect(loaded.from).toBe(saved.path);
    expect(loaded.after.loop).toBe('IDLE');
    expect(loaded.backup).toBe('.cadence/local/state.json.bak');
    expect(readFileSync(join(root, '.cadence', 'local', 'state.json.bak'), 'utf8')).toBe(beforeBytes);
    const after = JSON.parse(await readFile(join(root, '.cadence', 'state.json'), 'utf8')) as {
      revision: number;
      session: { tokenUtilization: number; subagentSpawns: number };
    };
    expect(after.revision).toBe(beforeRevision + 1);
    expect(after.session.tokenUtilization).toBe(0);
    expect(after.session.subagentSpawns).toBe(0);
  });

  it('a refused load exits 1 with empty stdout under --json and the reason on stderr (341-01/AC-3)', async () => {
    active = await tempRepo({ initialized: true, projectName: 'state-cli-refuse' });
    const root = active.root;
    const statePath = join(root, '.cadence', 'state.json');
    const before = await readFile(statePath, 'utf8');

    // 341-01/AC-3: no snapshot exists → refusal.
    const r = await run(['state', 'load', '--json'], root);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/state load refused/);
    expect(r.stderr).toMatch(/no snapshots/);
    expect(await readFile(statePath, 'utf8')).toBe(before);
    expect(existsSync(join(root, '.cadence', 'local'))).toBe(false);

    // 341-01/AC-3: a named snapshot that does not exist → refusal too.
    const named = await run(['state', 'load', 'state-missing.json', '--json', '--force'], root);
    expect(named.code).toBe(1);
    expect(named.stdout).toBe('');
    expect(named.stderr).toMatch(/not found/);
    expect(await readFile(statePath, 'utf8')).toBe(before);
  });

  it('`init` gitignores .cadence/local/ and nothing that ignores .cadence/snapshots/ (341-01/AC-5)', async () => {
    active = await tempRepo();
    const r = await run(['init', '--name=state-cli-init'], active.root);
    expect(r.code).toBe(0);
    const lines = readFileSync(join(active.root, '.gitignore'), 'utf8').split('\n');
    // 341-01/AC-5: the new entry is present as an exact line ...
    expect(lines.filter((l) => l === '.cadence/local/')).toHaveLength(1);
    // ... and no line ignores the committed snapshots directory.
    expect(lines.some((l) => l.includes('snapshots'))).toBe(false);
  });
});
