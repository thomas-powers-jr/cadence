import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, realpath, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';

// Phase 345 T4: drives the real `cadence hook pre-compact` entry point (the
// built CLI through bin/cadence.cjs) in testkit ephemeral repos with the
// default config, so the logger stays silent. Requires
// `pnpm --filter @thomas-powers-jr/cadence-core build` first.

const __dirname = dirname(fileURLToPath(import.meta.url));
const CADENCE_BIN = join(__dirname, '../../bin/cadence.cjs');

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runHook(cwd: string, stdin: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_BIN, 'hook', 'pre-compact'], { cwd });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    p.stdin.write(stdin);
    p.stdin.end();
    p.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

/** Every file under `.cadence/` except new precompact records, path → bytes. */
async function snapshotCadence(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const base = join(root, '.cadence');
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(base, full).split(sep).join('/');
      if (rel === 'local' || rel.startsWith('local/')) continue;
      if (entry.isDirectory()) await walk(full);
      else out.set(rel, (await readFile(full)).toString('base64'));
    }
  }
  await walk(base);
  return out;
}

async function precompactRecords(root: string): Promise<string[]> {
  const dir = join(root, '.cadence', 'local', 'precompact');
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((n) => n.startsWith('PRECOMPACT-'));
}

const SESSION_DOC = `---\ngenerated_at: 2026-11-01T10:00:00.000Z\n---\n\n# Session\n\nTL;DR: seeded.\n`;
const CC_PAYLOAD = JSON.stringify({
  session_id: 's-1',
  transcript_path: '/secret/transcript.jsonl',
  hook_event_name: 'PreCompact',
  trigger: 'auto',
  custom_instructions: 'keep the secret',
  compactTrigger: 'auto',
});

/** One non-empty line terminated by a newline, nothing else. */
const ONE_LINE = /^[^\n]+\n$/;

const fixtures: Fixture[] = [];
const extraDirs: string[] = [];
afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.cleanup();
  while (extraDirs.length > 0) {
    const d = extraDirs.pop();
    if (d !== undefined) await rm(d, { recursive: true, force: true });
  }
});

async function initRepo(): Promise<Fixture> {
  const f = await tempRepo({ initialized: true });
  fixtures.push(f);
  await writeFile(join(f.root, '.cadence', 'handoff', 'SESSION-2026-11-01-a.md'), SESSION_DOC);
  return f;
}

describe('cadence hook pre-compact (spawned)', () => {
  it('345-01/AC-1 345-01/AC-3 345-01/AC-4: success writes one record carrying the trigger, exit 0, empty stdout, one stderr line naming it, nothing else touched', async () => {
    const f = await initRepo();
    const before = await snapshotCadence(f.root);

    const r = await runHook(f.root, CC_PAYLOAD);

    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(ONE_LINE);

    const records = await precompactRecords(f.root);
    expect(records).toHaveLength(1);
    const name = records[0] ?? '';
    expect(name).toMatch(/^PRECOMPACT-\d{8}T\d{6}\.\d{3}Z\.md$/);
    expect(r.stderr).toContain(`.cadence/local/precompact/${name}`);

    const content = await readFile(join(f.root, '.cadence', 'local', 'precompact', name), 'utf8');
    // AC-1: the compactTrigger from stdin reached the context and the record.
    expect(content).toMatch(/^trigger: "auto"$/m);
    expect(content).toMatch(/^loop_position: IDLE$/m);
    expect(content).toContain('- custom_instructions');
    expect(content).toContain('- transcript_path');
    expect(content).not.toContain('keep the secret');
    expect(content).not.toContain('/secret/transcript.jsonl');
    expect(content).not.toMatch(/^- compactTrigger$/m);

    // AC-3: state.json, STATE.md, SESSION docs and everything else under .cadence/ untouched.
    const after = await snapshotCadence(f.root);
    expect(after).toEqual(before);
    expect(after.has('state.json')).toBe(true);
    expect(after.has('STATE.md')).toBe(true);
    expect(after.has('handoff/SESSION-2026-11-01-a.md')).toBe(true);
  });

  it('345-01/AC-1: a non-auto string trigger is recorded verbatim; no trigger records "unknown"', async () => {
    const f = await initRepo();
    const r1 = await runHook(f.root, JSON.stringify({ hook_event_name: 'PreCompact', compactTrigger: 'manual' }));
    expect(r1.code).toBe(0);
    const r2 = await runHook(f.root, JSON.stringify({ hook_event_name: 'PreCompact', compactTrigger: 42 }));
    expect(r2.code).toBe(0);
    const contents = await Promise.all(
      (await precompactRecords(f.root)).map((n) =>
        readFile(join(f.root, '.cadence', 'local', 'precompact', n), 'utf8'),
      ),
    );
    expect(contents).toHaveLength(2);
    expect(contents.some((c) => /^trigger: "manual"$/m.test(c))).toBe(true);
    expect(contents.some((c) => /^trigger: "unknown"$/m.test(c))).toBe(true);
  });

  it('345-01/AC-4 345-01/AC-3: state.json missing still writes the record with loop fields unavailable, exit 0, one stderr line', async () => {
    const f = await initRepo();
    await unlink(join(f.root, '.cadence', 'state.json'));
    const before = await snapshotCadence(f.root);

    const r = await runHook(f.root, CC_PAYLOAD);

    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(ONE_LINE);
    const records = await precompactRecords(f.root);
    expect(records).toHaveLength(1);
    expect(r.stderr).toContain(`.cadence/local/precompact/${records[0] ?? ''}`);
    const content = await readFile(
      join(f.root, '.cadence', 'local', 'precompact', records[0] ?? ''),
      'utf8',
    );
    expect(content).toMatch(/^loop_position: unavailable$/m);
    expect(existsSync(join(f.root, '.cadence', 'state.json'))).toBe(false);
    expect(await snapshotCadence(f.root)).toEqual(before);
  });

  it('345-01/AC-4 345-01/AC-3: state.json corrupt still writes the record, exit 0, one stderr line, state.json byte-identical', async () => {
    const f = await initRepo();
    await writeFile(join(f.root, '.cadence', 'state.json'), '{ not json');
    const before = await snapshotCadence(f.root);

    const r = await runHook(f.root, CC_PAYLOAD);

    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(ONE_LINE);
    const records = await precompactRecords(f.root);
    expect(records).toHaveLength(1);
    expect(r.stderr).toContain(`.cadence/local/precompact/${records[0] ?? ''}`);
    expect(await snapshotCadence(f.root)).toEqual(before);
  });

  it('345-01/AC-4: config.json invalid still writes the record, exit 0, empty stdout, one stderr line', async () => {
    const f = await initRepo();
    await writeFile(join(f.root, '.cadence', 'config.json'), '{ "profile": 12, broken');
    const before = await snapshotCadence(f.root);

    const r = await runHook(f.root, CC_PAYLOAD);

    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(ONE_LINE);
    const records = await precompactRecords(f.root);
    expect(records).toHaveLength(1);
    expect(r.stderr).toContain(`.cadence/local/precompact/${records[0] ?? ''}`);
    expect(await snapshotCadence(f.root)).toEqual(before);
  });

  it('345-01/AC-4: no .cadence/ directory creates nothing, exit 0, empty stdout, one stderr line saying so', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'cadence-precompact-bare-')));
    extraDirs.push(dir);

    const r = await runHook(dir, CC_PAYLOAD);

    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(ONE_LINE);
    expect(r.stderr).toContain('.cadence/');
    expect(await readdir(dir)).toEqual([]);
  });

  it('345-01/AC-4: stdin that is not JSON still writes the record, exit 0, empty stdout, one stderr line', async () => {
    const f = await initRepo();

    const r = await runHook(f.root, 'this is { not json');

    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(ONE_LINE);
    const records = await precompactRecords(f.root);
    expect(records).toHaveLength(1);
    expect(r.stderr).toContain(`.cadence/local/precompact/${records[0] ?? ''}`);
    const content = await readFile(
      join(f.root, '.cadence', 'local', 'precompact', records[0] ?? ''),
      'utf8',
    );
    expect(content).toMatch(/^trigger: "unknown"$/m);
  });
});
