import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import {
  CADENCE_OWNED_GITIGNORE_ENTRIES,
  planGitignoreEntries,
  ensureGitignoreEntries,
} from '../../src/init/gitignore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CADENCE_CLI = join(__dirname, '../../dist/cli/index.js');

function run(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], {
      cwd,
      env: { ...process.env, ...env },
    });
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

describe('CADENCE_OWNED_GITIGNORE_ENTRIES', () => {
  it('is exactly the five cadence-owned ephemeral paths, in order (341-01/AC-5)', () => {
    // Phase 341 appends `.cadence/local/` after the existing four; nothing
    // ignores the committed `.cadence/snapshots/` directory.
    expect(CADENCE_OWNED_GITIGNORE_ENTRIES).toEqual([
      '.cadence/state.json',
      '.cadence/STATE.md',
      '.cadence/mcp-trust.json',
      '.cadence/intelligence/context/',
      '.cadence/local/',
    ]);
    expect(CADENCE_OWNED_GITIGNORE_ENTRIES.some((e) => e.includes('snapshots'))).toBe(false);
  });
});

describe('planGitignoreEntries (pure)', () => {
  it('returns all five entries when given empty content', () => {
    expect(planGitignoreEntries('')).toEqual([...CADENCE_OWNED_GITIGNORE_ENTRIES]);
  });

  it('returns only the missing entries when some are already present', () => {
    const existing = 'node_modules/\n.cadence/state.json\n.cadence/STATE.md\n';
    expect(planGitignoreEntries(existing)).toEqual([
      '.cadence/mcp-trust.json',
      '.cadence/intelligence/context/',
      '.cadence/local/',
    ]);
  });

  it('returns [] (idempotent) when all five entries are already present', () => {
    const existing = [
      'node_modules/',
      '.cadence/state.json',
      '.cadence/STATE.md',
      '.cadence/mcp-trust.json',
      '.cadence/intelligence/context/',
      '.cadence/local/',
      '',
    ].join('\n');
    expect(planGitignoreEntries(existing)).toEqual([]);
  });

  it('returns only `.cadence/local/` for a repo initialized before phase 341 (341-01/AC-5)', () => {
    const existing = [
      '# cadence-owned ephemeral state (see docs/concepts.md)',
      '.cadence/state.json',
      '.cadence/STATE.md',
      '.cadence/mcp-trust.json',
      '.cadence/intelligence/context/',
      '',
    ].join('\n');
    expect(planGitignoreEntries(existing)).toEqual(['.cadence/local/']);
  });
});

describe('ensureGitignoreEntries (I/O)', () => {
  it('creates .gitignore with the header + all five entries when none exists', async () => {
    active = await tempRepo();
    expect(existsSync(join(active.root, '.gitignore'))).toBe(false);

    await ensureGitignoreEntries(active.root);

    const content = await readFile(join(active.root, '.gitignore'), 'utf8');
    expect(content).toContain('# cadence-owned ephemeral state (see docs/concepts.md)');
    for (const entry of CADENCE_OWNED_GITIGNORE_ENTRIES) {
      expect(content).toContain(entry);
    }
  });

  it('appends missing entries onto an existing non-empty .gitignore without a trailing-newline glitch', async () => {
    active = await tempRepo();
    const path = join(active.root, '.gitignore');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, 'node_modules/'); // no trailing newline

    await ensureGitignoreEntries(active.root);

    const content = await readFile(path, 'utf8');
    expect(content).toContain('node_modules/\n');
    for (const entry of CADENCE_OWNED_GITIGNORE_ENTRIES) {
      expect(content).toContain(entry);
    }
  });

  it('second call is a no-op / does not duplicate lines (idempotent at the I/O layer)', async () => {
    active = await tempRepo();
    await ensureGitignoreEntries(active.root);
    const first = await readFile(join(active.root, '.gitignore'), 'utf8');

    await ensureGitignoreEntries(active.root);
    const second = await readFile(join(active.root, '.gitignore'), 'utf8');

    expect(second).toBe(first);
    // Exact-line count, not a substring count: a pair fix for the intended
    // phase 341 change, not a loosening. `split(entry)` counts substrings, so
    // it would also count an entry occurring inside another line (e.g.
    // `.cadence/state.json` inside a `.cadence/state.json.bak`-style entry).
    const lines = second.split('\n');
    for (const entry of CADENCE_OWNED_GITIGNORE_ENTRIES) {
      expect(lines.filter((l) => l === entry).length).toBe(1);
    }
  });

  it('on an already-initialized repo, appends a second header line above the one new entry (341-01/AC-5)', async () => {
    // Accepted existing behaviour: the writer appends only what is missing,
    // always behind its header, so a pre-phase-341 .gitignore gains a second
    // header followed by `.cadence/local/`. Nothing already there is rewritten.
    active = await tempRepo();
    const path = join(active.root, '.gitignore');
    const { writeFile } = await import('node:fs/promises');
    const header = '# cadence-owned ephemeral state (see docs/concepts.md)';
    const pre341 = [
      header,
      '.cadence/state.json',
      '.cadence/STATE.md',
      '.cadence/mcp-trust.json',
      '.cadence/intelligence/context/',
      '',
    ].join('\n');
    await writeFile(path, pre341);

    await ensureGitignoreEntries(active.root);

    const content = await readFile(path, 'utf8');
    expect(content).toBe(`${pre341}${header}\n.cadence/local/\n`);
    const lines = content.split('\n');
    expect(lines.filter((l) => l === header)).toHaveLength(2);
    expect(lines.filter((l) => l === '.cadence/local/')).toHaveLength(1);
  });
});

describe('cadence init — wires ensureGitignoreEntries into the scaffold (AC-1)', () => {
  it('a fresh `cadence init` writes all five entries into the repo root .gitignore', async () => {
    active = await tempRepo();
    const r = await run(['init', '--name=demo'], active.root);
    expect(r.code).toBe(0);
    const gitignorePath = join(active.root, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    const content = readFileSync(gitignorePath, 'utf8');
    for (const entry of CADENCE_OWNED_GITIGNORE_ENTRIES) {
      expect(content).toContain(entry);
    }
  });

  it('re-running init-time gitignore writing is idempotent (no duplicate lines)', async () => {
    active = await tempRepo();
    await run(['init', '--name=demo'], active.root);
    const gitignorePath = join(active.root, '.gitignore');
    const before = readFileSync(gitignorePath, 'utf8');

    // simulate a second scaffold pass over the same repo root directly
    // (init itself refuses on an already-initialized repo, so we exercise
    // the idempotent writer function directly against the same root).
    await ensureGitignoreEntries(active.root);
    const after = readFileSync(gitignorePath, 'utf8');

    expect(after).toBe(before);
    // Exact-line count (pair fix for phase 341, not a loosening): a substring
    // count would also match an entry occurring inside another line.
    const lines = after.split('\n');
    for (const entry of CADENCE_OWNED_GITIGNORE_ENTRIES) {
      expect(lines.filter((l) => l === entry).length).toBe(1);
    }
  });
});
