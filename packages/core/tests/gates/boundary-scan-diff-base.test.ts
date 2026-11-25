import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runBoundaryScanGate } from '../../src/gates/boundary-scan.js';
import type { SettleContext, ProgressJson } from '../../src/gates/types.js';
import type { Task } from '@thomas-powers-jr/cadence-types';

// Phase 351 (351-01, T2): the settle-time boundary-scan gate names the ref it
// diffed against when it falls back to the local integration ref (AC-2), and
// refuses — instead of falling back — when `origin/<ref>` resolves but its
// merge-base with HEAD cannot be computed (AC-3). Real git repos in temp dirs.

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    ...(input !== undefined ? { input } : {}),
    stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'ignore'],
  });
}

async function initRepo(root: string): Promise<void> {
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(root, 'README.md'), '# test\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'init']);
  git(root, ['checkout', '-b', 'feature']);
}

const roots: string[] = [];
async function makeRepo(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cadence-boundary-scan-')));
  roots.push(root);
  await initRepo(root);
  return root;
}

async function makeDir(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cadence-boundary-scan-')));
  roots.push(root);
  return root;
}

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop()!;
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }
});

function task(files: string[]): Task {
  return { id: 'T1', name: 't', files, action: 'a', verify: 'v', done: 'AC-1' };
}

function ctx(over: {
  cwd: string;
  boundaryEnforcement?: 'warn' | 'block';
  declaredFiles?: string[];
  force?: boolean;
  allowBoundaryScanFailure?: boolean;
  sealed?: string[];
  errs?: string[];
  progressTasks?: ProgressJson['tasks'];
}): SettleContext {
  const errs = over.errs ?? [];
  return {
    cwd: over.cwd,
    state: { draftReadAt: null, activePhase: '156-x', activeDraft: '156-01' } as never,
    draft: {
      boundaryEnforcement: over.boundaryEnforcement,
      acceptanceCriteria: [],
      tasks: [task(over.declaredFiles ?? [])],
    } as never,
    progress: { draftId: '156-01', tasks: over.progressTasks ?? {} },
    config: over.sealed ? ({ gates: { sealed: over.sealed } } as never) : null,
    gateSet: { gates: ['boundary-scan'], softCap: false } as never,
    opts: {
      ...(over.force ? { force: true } : {}),
      ...(over.allowBoundaryScanFailure ? { allowBoundaryScanFailure: true } : {}),
    },
    explicitIds: new Set<string>(),
    touchedFiles: [],
    coverage: async () => new Map(),
    draftMtimeMs: async () => null,
    diff: () => '',
    verifiers: {
      deep: { verify: async () => ({ verdicts: {}, provider: 'mock' }) },
      codeReview: { verify: async () => ({ findings: {}, provider: 'mock' }) },
      securityAudit: { verify: async () => ({ findings: [], provider: 'mock' }) },
    },
    emit: { anomalies: async () => {}, codeReviewHigh: async () => {}, codeReviewUnconverged: async () => {} },
    runner: { test: async () => ({ ran: false, ok: true }) },
    prompter: { create: () => ({ ask: async () => '' }) },
    codeReviewSidecar: { read: async () => ({ attemptsSoFar: 0, history: [] }), write: async () => {} },
    io: { err: (s: string) => errs.push(s) },
  } as unknown as SettleContext;
}

/** `main` + `feature`, no origin remote, one committed declared file on `feature`. */
async function makeFeatureRepo(): Promise<string> {
  const root = await makeRepo();
  await writeFile(join(root, 'declared.ts'), 'declared\n');
  git(root, ['add', 'declared.ts']);
  git(root, ['commit', '-m', 'feature work']);
  return root;
}

/** AC-3(a): `refs/remotes/origin/main` points at a commit with no common history with HEAD. */
async function makeOrphanUpstreamRepo(): Promise<string> {
  const root = await makeFeatureRepo();
  const emptyTree = git(root, ['hash-object', '-t', 'tree', '-w', '--stdin'], '').trim();
  const orphan = git(root, ['commit-tree', emptyTree, '-m', 'orphan'], '').trim();
  git(root, ['update-ref', 'refs/remotes/origin/main', orphan]);
  return root;
}

/** AC-3(b): a depth-1 clone of `feature` plus a depth-1 fetch of a `main` that moved on. */
async function makeShallowClone(): Promise<string> {
  const source = await makeFeatureRepo();
  git(source, ['checkout', 'main']);
  await writeFile(join(source, 'later.txt'), 'main moved on\n');
  git(source, ['add', 'later.txt']);
  git(source, ['commit', '-m', 'main moves on']);
  git(source, ['checkout', 'feature']);

  const parent = await makeDir();
  const clone = join(parent, 'clone');
  git(parent, ['clone', '--depth', '1', '--branch', 'feature', pathToFileURL(source).href, clone]);
  git(clone, ['config', 'user.email', 'test@example.com']);
  git(clone, ['config', 'user.name', 'Test']);
  git(clone, ['config', 'commit.gpgsign', 'false']);
  git(clone, ['fetch', '--depth', '1', 'origin', 'main:refs/remotes/origin/main']);
  return clone;
}

const NON_SHALLOW_REASON =
  'settle run refused: boundary-scan could not compute the merge-base of origin/main and HEAD after a retry. ' +
  'Re-run settle, or pass --allow-boundary-scan-failure to scan only working-tree changes.';
const SHALLOW_REASON =
  'settle run refused: boundary-scan could not compute the merge-base of origin/main and HEAD after a retry, ' +
  'and this is a shallow clone. Run git fetch --unshallow origin (or --deepen=<n>) and re-run settle, ' +
  'or pass --allow-boundary-scan-failure to scan only working-tree changes.';

describe('runBoundaryScanGate — diff base (phase 351)', () => {
  it('351-01/AC-2: names the local fallback on stderr with the 7-char merge-base sha, and passes', async () => {
    const root = await makeFeatureRepo();
    const sha7 = git(root, ['merge-base', 'main', 'HEAD']).trim().slice(0, 7);
    const errs: string[] = [];

    const res = await runBoundaryScanGate(
      ctx({ cwd: root, boundaryEnforcement: 'block', declaredFiles: ['declared.ts'], errs }),
    );

    expect(res.outcome).toBe('pass');
    expect(errs).toContain(
      `boundary-scan: origin/main did not resolve; diffing against the merge-base with the local main ref (${sha7})\n`,
    );
    expect(errs.some((e) => e.includes('could not resolve a base ref'))).toBe(false);
  });

  it('351-01/AC-3: refuses with the non-shallow reason when origin/main resolves but shares no history with HEAD', async () => {
    const root = await makeOrphanUpstreamRepo();
    const errs: string[] = [];

    const res = await runBoundaryScanGate(
      ctx({ cwd: root, boundaryEnforcement: 'block', declaredFiles: ['declared.ts'], errs }),
    );

    expect(res).toEqual({ outcome: 'refuse', reason: NON_SHALLOW_REASON });
    expect(errs).toContain(`${NON_SHALLOW_REASON}\n`);
    expect(errs.some((e) => e.includes('could not resolve a base ref'))).toBe(false);
    expect(errs.some((e) => e.includes('did not resolve'))).toBe(false);
  });

  it('351-01/AC-3: refuses with the shallow-clone reason in a depth-1 clone whose origin/main moved on', async () => {
    const clone = await makeShallowClone();
    expect(git(clone, ['rev-parse', '--is-shallow-repository']).trim()).toBe('true');
    const errs: string[] = [];

    const res = await runBoundaryScanGate(
      ctx({ cwd: clone, boundaryEnforcement: 'block', declaredFiles: ['declared.ts'], errs }),
    );

    expect(res).toEqual({ outcome: 'refuse', reason: SHALLOW_REASON });
    expect(errs).toContain(`${SHALLOW_REASON}\n`);
  });

  it('351-01/AC-3: --allow-boundary-scan-failure passes, flags boundaryScanBypassed, prints the bypass line and no base-ref notice', async () => {
    const root = await makeOrphanUpstreamRepo();
    const errs: string[] = [];

    const res = await runBoundaryScanGate(
      ctx({
        cwd: root,
        boundaryEnforcement: 'block',
        declaredFiles: ['declared.ts'],
        allowBoundaryScanFailure: true,
        errs,
      }),
    );

    expect(res.outcome).toBe('pass');
    expect(res.flags).toEqual({ boundaryScanBypassed: true });
    expect(errs).toEqual([
      'boundary-scan: --allow-boundary-scan-failure set; scanning working-tree changes only.\n',
    ]);
    expect(errs.some((e) => e.includes('could not resolve a base ref'))).toBe(false);
  });

  it('351-01/AC-3: --force bypasses the upstream-failed refusal and the bypass line names --force', async () => {
    const root = await makeOrphanUpstreamRepo();
    const errs: string[] = [];

    const res = await runBoundaryScanGate(
      ctx({ cwd: root, boundaryEnforcement: 'block', declaredFiles: ['declared.ts'], force: true, errs }),
    );

    expect(res.outcome).toBe('pass');
    expect(res.flags?.boundaryScanBypassed).toBe(true);
    expect(errs).toEqual(['boundary-scan: --force set; scanning working-tree changes only.\n']);
  });

  it('351-01/AC-3: the upstream-failed bypass still scans the working tree and carries the flag when an offender is also bypassed', async () => {
    const root = await makeOrphanUpstreamRepo();
    await writeFile(join(root, 'undeclared.ts'), 'oops\n');
    const errs: string[] = [];

    const res = await runBoundaryScanGate(
      ctx({
        cwd: root,
        boundaryEnforcement: 'block',
        declaredFiles: ['declared.ts'],
        allowBoundaryScanFailure: true,
        errs,
      }),
    );

    expect(res.outcome).toBe('pass');
    expect(res.flags).toEqual({ boundaryScanBypassed: true });
    expect(res.summaryPatch?.boundaryScan?.offenders).toEqual(['undeclared.ts']);
    expect(errs).toEqual([
      'boundary-scan: --allow-boundary-scan-failure set; scanning working-tree changes only.\n',
      "boundary-scan: undeclared.ts touched but not declared in any task's files:\n",
      'boundary-scan: --allow-boundary-scan-failure set; proceeding past 1 offending file(s).\n',
    ]);
  });

  it('351-01/AC-3: a sealed gate refuses on upstream-failed even with --force and --allow-boundary-scan-failure', async () => {
    const root = await makeOrphanUpstreamRepo();
    const errs: string[] = [];

    const res = await runBoundaryScanGate(
      ctx({
        cwd: root,
        boundaryEnforcement: 'block',
        declaredFiles: ['declared.ts'],
        force: true,
        allowBoundaryScanFailure: true,
        sealed: ['boundary-scan'],
        errs,
      }),
    );

    expect(res.outcome).toBe('refuse');
    expect(res.reason).toContain('could not compute the merge-base of origin/main and HEAD after a retry');
    expect(res.reason).toContain('This gate is sealed (gates.sealed)');
    expect(res.flags).toBeUndefined();
    expect(errs).toEqual([`${res.reason}\n`]);
  });

  it('351-01/AC-3: an empty declared files: union still passes before the upstream-failed refusal is considered', async () => {
    const root = await makeOrphanUpstreamRepo();
    const errs: string[] = [];

    const res = await runBoundaryScanGate(ctx({ cwd: root, boundaryEnforcement: 'block', declaredFiles: [], errs }));

    expect(res).toEqual({ outcome: 'pass' });
    expect(errs).toEqual([]);
  });
});
