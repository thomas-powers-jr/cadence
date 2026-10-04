import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';

/**
 * Phase 320 (T2, rec-20261004-001): a successful `settle run` prints one
 * best-effort stderr notice naming each roadmap file (`ROADMAP.md`,
 * `MILESTONES.md`) that uses its phase convention but has no entry for the
 * settled phase. Drives a REAL settle through the built CLI. The fixture
 * phase is `01-foundation`, so the settled phase number is 1.
 */

const CADENCE_CLI = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'dist',
  'cli',
  'index.js',
);

function run(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], {
      cwd,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

async function setEvidenceFloor(root: string, floor: 'unverified' | 'assertion'): Promise<void> {
  const configPath = join(root, '.cadence', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.gates = { ...(config.gates ?? {}), evidenceFloor: floor };
  await writeFile(configPath, JSON.stringify(config, null, 2));
}

/** Seed phase 01-foundation to a settle-ready BUILD (T1 DONE). */
async function seedBuild(root: string, floor: 'unverified' | 'assertion' = 'unverified'): Promise<void> {
  await setEvidenceFloor(root, floor);
  await run(['draft', 'new', '01-foundation', '01', '--title=Demo'], root);
  await run(['draft', 'approve', '01-foundation', '01'], root);
  await run(['build', 'task', 'T1', '--status=DONE'], root);
}

const ROADMAP_OTHER = '# Roadmap\n\n### Phase 2 — Other work\n\nSomething else.\n';
const ROADMAP_WITH_1 = '# Roadmap\n\n### Phase 1 — Foundation\n\n### Phase 2 — Other work\n';
const MILESTONES_OTHER = '# Milestones\n\n- **Phase 2** — other work\n';
const MILESTONES_WITH_1 = '# Milestones\n\n- **Phase 1** — foundation\n- **Phase 2** — other work\n';

async function writeRoadmapFiles(
  root: string,
  roadmap: string,
  milestones: string,
): Promise<void> {
  await writeFile(join(root, '.cadence', 'ROADMAP.md'), roadmap, 'utf8');
  await writeFile(join(root, '.cadence', 'MILESTONES.md'), milestones, 'utf8');
}

function noticeLines(stderr: string): string[] {
  return stderr.split(/\r?\n/).filter((l) => l.includes('has no roadmap entry'));
}

function settleOk(): string[] {
  return ['settle', 'run', '--ac', 'AC-1=pass'];
}

/** Recursively collect every object key in a parsed JSON value. */
function allKeys(value: unknown, acc: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, acc);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      acc.push(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

describe('settle run — missing roadmap entry notice (phase 320)', () => {
  it('320-01/AC-2: names both files on stderr when neither has the settled phase, keeps stdout and SUMMARY.json roadmap-free, and leaves both files byte-identical', async () => {
    active = await tempRepo({ initialized: true });
    const root = active.root;
    await seedBuild(root);
    await writeRoadmapFiles(root, ROADMAP_OTHER, MILESTONES_OTHER);
    const roadmapBefore = await readFile(join(root, '.cadence', 'ROADMAP.md'));
    const milestonesBefore = await readFile(join(root, '.cadence', 'MILESTONES.md'));

    const r = await run(settleOk(), root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Settled 01-01');

    const lines = noticeLines(r.stderr);
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? '';
    expect(line).toMatch(/^note: phase 1 has no roadmap entry in /);
    expect(line).toContain('ROADMAP.md');
    expect(line).toContain('MILESTONES.md');
    expect(line).toContain('"### Phase 1 — <title>"');
    expect(line).toContain('"- **Phase 1** — <summary>"');
    expect(line).toContain('roadmap prose is never auto-generated');

    // stdout is a contract: no roadmap line there.
    expect(r.stdout).not.toMatch(/roadmap/i);
    expect(r.stdout).not.toMatch(/milestones/i);

    // SUMMARY.json gains no roadmap-related field.
    const summary = JSON.parse(
      await readFile(join(root, '.cadence/phases/01-foundation/01-01-SUMMARY.json'), 'utf8'),
    ) as unknown;
    expect(allKeys(summary).filter((k) => /roadmap|milestone/i.test(k))).toEqual([]);

    // Detection only — the files are never written.
    expect(await readFile(join(root, '.cadence', 'ROADMAP.md'))).toEqual(roadmapBefore);
    expect(await readFile(join(root, '.cadence', 'MILESTONES.md'))).toEqual(milestonesBefore);
  });

  it('320-01/AC-2: names only ROADMAP.md (and only the heading form) when MILESTONES.md already has the bullet', async () => {
    active = await tempRepo({ initialized: true });
    const root = active.root;
    await seedBuild(root);
    await writeRoadmapFiles(root, ROADMAP_OTHER, MILESTONES_WITH_1);

    const r = await run(settleOk(), root);
    expect(r.code).toBe(0);
    const lines = noticeLines(r.stderr);
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? '';
    expect(line).toContain('ROADMAP.md');
    expect(line).toContain('"### Phase 1 — <title>"');
    expect(line).not.toContain('MILESTONES.md');
    expect(line).not.toContain('**Phase 1**');
  });

  it('320-01/AC-3: prints no notice when both files already carry the settled phase', async () => {
    active = await tempRepo({ initialized: true });
    const root = active.root;
    await seedBuild(root);
    await writeRoadmapFiles(root, ROADMAP_WITH_1, MILESTONES_WITH_1);

    const r = await run(settleOk(), root);
    expect(r.code).toBe(0);
    expect(noticeLines(r.stderr)).toEqual([]);
  });

  it('320-01/AC-3: prints no notice for the cadence init stubs (no phase convention in use)', async () => {
    active = await tempRepo({ initialized: true });
    const root = active.root;
    await seedBuild(root);
    await writeRoadmapFiles(root, '# Roadmap\n\n_(no phases yet)_\n', '# Milestones\n');

    const r = await run(settleOk(), root);
    expect(r.code).toBe(0);
    expect(noticeLines(r.stderr)).toEqual([]);
  });

  it('320-01/AC-3: an unreadable ROADMAP.md (a directory) still exits 0 and does not suppress a genuinely missing MILESTONES.md entry', async () => {
    active = await tempRepo({ initialized: true });
    const root = active.root;
    await seedBuild(root);
    const roadmapPath = join(root, '.cadence', 'ROADMAP.md');
    await rm(roadmapPath, { force: true });
    await mkdir(roadmapPath);
    await writeFile(join(root, '.cadence', 'MILESTONES.md'), MILESTONES_OTHER, 'utf8');

    const r = await run(settleOk(), root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Settled 01-01');
    const lines = noticeLines(r.stderr);
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? '';
    expect(line).toContain('MILESTONES.md');
    expect(line).toContain('"- **Phase 1** — <summary>"');
    expect(line).not.toContain('ROADMAP.md');
    expect(line).not.toContain('### Phase 1');
  });

  it('320-01/AC-3: a refused settle never prints the notice, even when both entries are missing', async () => {
    active = await tempRepo({ initialized: true });
    const root = active.root;
    // 'assertion' floor with no real coverage: the evidence-floor gate refuses.
    await seedBuild(root, 'assertion');
    await writeRoadmapFiles(root, ROADMAP_OTHER, MILESTONES_OTHER);

    const r = await run(settleOk(), root);
    expect(r.code).not.toBe(0);
    // Pin the refusal to the evidence-floor gate (the last refusal point
    // before finalize), so a broken fixture refusing earlier can't pass this.
    expect(r.stderr).toMatch(/evidence-floor|requires 'assertion'/);
    expect(r.stdout).not.toContain('Settled 01-01');
    expect(noticeLines(r.stderr)).toEqual([]);
  });
});
