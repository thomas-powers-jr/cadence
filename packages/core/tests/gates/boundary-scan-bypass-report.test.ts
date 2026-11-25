import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBoundaryScanGate } from '../../src/gates/boundary-scan.js';
import type { SettleContext, ProgressJson } from '../../src/gates/types.js';
import type { Task } from '@thomas-powers-jr/cadence-types';

// Phase 352 (352-01, T1): when the boundary-scan gate is bypassed it reports
// what it bypassed in `flags.boundaryScanBypass` and names the flag by the
// rule (`--allow-boundary-scan-failure` when set, else `--force`). Real git
// repos in temp dirs, built as boundary-scan-diff-base.test.ts builds them.

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

/** AC-1(b): `refs/remotes/origin/main` points at a commit with no common history with HEAD. */
async function makeOrphanUpstreamRepo(): Promise<string> {
  const root = await makeFeatureRepo();
  const emptyTree = git(root, ['hash-object', '-t', 'tree', '-w', '--stdin'], '').trim();
  const orphan = git(root, ['commit-tree', emptyTree, '-m', 'orphan'], '').trim();
  git(root, ['update-ref', 'refs/remotes/origin/main', orphan]);
  return root;
}

/** AC-1(a)/(c): no origin remote; `stray.ts` committed on `feature` after it diverges from `main`. */
async function makeStrayCommitRepo(): Promise<string> {
  const root = await makeFeatureRepo();
  await writeFile(join(root, 'stray.ts'), 'stray\n');
  git(root, ['add', 'stray.ts']);
  git(root, ['commit', '-m', 'stray work']);
  return root;
}

describe('runBoundaryScanGate — bypass report (phase 352)', () => {
  it('352-01/AC-1: (a) --allow-boundary-scan-failure past a committed offender reports causes [offenders]', async () => {
    const root = await makeStrayCommitRepo();
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
    expect(res.flags).toStrictEqual({
      boundaryScanBypassed: true,
      boundaryScanBypass: { flag: '--allow-boundary-scan-failure', causes: ['offenders'], offenders: ['stray.ts'] },
    });
  });

  it('352-01/AC-1: (b) --force past an upstream-failed base on a clean tree reports causes [merge-base]', async () => {
    const root = await makeOrphanUpstreamRepo();
    const errs: string[] = [];

    const res = await runBoundaryScanGate(
      ctx({ cwd: root, boundaryEnforcement: 'block', declaredFiles: ['declared.ts'], force: true, errs }),
    );

    expect(res.outcome).toBe('pass');
    expect(res.flags).toStrictEqual({
      boundaryScanBypassed: true,
      boundaryScanBypass: { flag: '--force', causes: ['merge-base'], offenders: [] },
    });
  });

  it('352-01/AC-1: (c) with both --force and --allow-boundary-scan-failure the report and stderr name --allow-boundary-scan-failure', async () => {
    const root = await makeStrayCommitRepo();
    const errs: string[] = [];

    const res = await runBoundaryScanGate(
      ctx({
        cwd: root,
        boundaryEnforcement: 'block',
        declaredFiles: ['declared.ts'],
        force: true,
        allowBoundaryScanFailure: true,
        errs,
      }),
    );

    expect(res.outcome).toBe('pass');
    expect(res.flags).toStrictEqual({
      boundaryScanBypassed: true,
      boundaryScanBypass: { flag: '--allow-boundary-scan-failure', causes: ['offenders'], offenders: ['stray.ts'] },
    });
    expect(errs).toContain('boundary-scan: --allow-boundary-scan-failure set; proceeding past 1 offending file(s).\n');
    expect(errs.some((e) => e.includes('--force set'))).toBe(false);
  });
});
