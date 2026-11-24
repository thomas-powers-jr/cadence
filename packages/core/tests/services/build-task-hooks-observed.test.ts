// Phase 349 (349-01, T2) — `buildTaskService` records whether host hooks were
// observed (`hooksObserved` on the PROGRESS.json row) from the state it reads
// before any verifier runs, and, when they were not and host hooks are
// installed in the repository, prints one stderr notice naming the installed
// host config path(s). Direct `recordTaskOutcome` callers (`cadence block`,
// `cadence needs-context`) write no key; pre-349 rows still read back.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyState } from '@thomas-powers-jr/cadence-types';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { buildTaskService } from '../../src/services/build-task.js';
import { recordTaskOutcome } from '../../src/build/record.js';
import { SimpleStateBackend } from '../../src/state/simple.js';
import {
  installedHostHookConfigs,
  joinHostConfigPaths,
} from '../../src/hooks/hook-liveness.js';
import type { CommandIO } from '../../src/services/io.js';

const PHASE = '01-foundation';
const DRAFT_ID = '01-01';
const NOW = new Date('2026-11-23T12:00:00.000Z');
const MIN = 60 * 1000;

const NOTICE_PREFIX = 'build task: no host hook event in the last 30 minutes';
const notice = (paths: string): string =>
  'build task: no host hook event in the last 30 minutes, so skill invocations in this ' +
  'session may not be recorded. Check that the session started in the repository root, ' +
  `where ${paths} is loaded.\n`;

let fx: Fixture | undefined;
afterEach(async () => {
  if (fx) {
    await fx.cleanup();
    fx = undefined;
  }
});

const DRAFT_MD = `---
phase: ${PHASE}
id: ${DRAFT_ID}
tier: standard
status: APPROVED
---

# ${DRAFT_ID} — hooks observed fixture

## Objective

Record a task and say whether host hooks were observed.

## Acceptance Criteria

### AC-1: It records
Given a precondition
When an action
Then an observable outcome

## Tasks

### T1: Do the thing
- files: \`src/foo.ts\`
- action: do the thing
- verify: run the test
- done: AC-1

### T2: Do the other thing
- files: \`src/bar.ts\`
- action: do the other thing
- verify: run the test
- done: AC-1

## Boundaries

- DO NOT touch anything else.
`;

function managedSettings(): string {
  return JSON.stringify(
    {
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'cadence-host hook' }], _managedBy: 'cadence' },
        ],
      },
    },
    null,
    2,
  );
}

async function arrange(opts: {
  lastHookEventAt?: string;
  claude?: string;
  codex?: string;
}): Promise<string> {
  fx = await tempRepo({ initialized: true, projectName: 'hooks-observed' });
  const root = fx.root;
  const phaseDir = join(root, '.cadence', 'phases', PHASE);
  await mkdir(phaseDir, { recursive: true });
  const state = emptyState('hooks-observed');
  state.loopPosition = 'BUILD';
  state.activePhase = PHASE;
  state.activeDraft = DRAFT_ID;
  state.tier = 'standard';
  if (opts.lastHookEventAt !== undefined) state.session.lastHookEventAt = opts.lastHookEventAt;
  await new SimpleStateBackend(root).commit(state);
  await writeFile(join(phaseDir, `${DRAFT_ID}-DRAFT.md`), DRAFT_MD, 'utf8');
  if (opts.claude !== undefined) {
    await mkdir(join(root, '.claude'), { recursive: true });
    await writeFile(join(root, '.claude', 'settings.json'), opts.claude, 'utf8');
  }
  if (opts.codex !== undefined) {
    await mkdir(join(root, '.codex'), { recursive: true });
    await writeFile(join(root, '.codex', 'hooks.json'), opts.codex, 'utf8');
  }
  return root;
}

function captureIO(): { io: CommandIO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s) => out.push(s), err: (s) => err.push(s) }, out, err };
}

async function progressRows(root: string): Promise<Record<string, Record<string, unknown>>> {
  const raw = JSON.parse(
    await readFile(join(root, '.cadence', 'phases', PHASE, `${DRAFT_ID}-PROGRESS.json`), 'utf8'),
  ) as { tasks: Record<string, Record<string, unknown>> };
  return raw.tasks;
}

function noticeLines(err: string[]): string[] {
  return err.filter((s) => s.startsWith(NOTICE_PREFIX));
}

describe('buildTaskService records hooksObserved (349-01 AC-2)', () => {
  it('349-01/AC-2: a live stamp records hooksObserved: true and prints no notice', async () => {
    const root = await arrange({
      lastHookEventAt: new Date(NOW.getTime() - 5 * MIN).toISOString(),
      claude: managedSettings(),
    });
    const { io, out, err } = captureIO();
    const res = await buildTaskService(root, { taskId: 'T1', status: 'DONE', now: NOW }, io);
    expect(res.exitCode).toBe(0);
    expect((await progressRows(root)).T1?.hooksObserved).toBe(true);
    expect(noticeLines(err)).toEqual([]);
    expect(out.join('')).toBe('Recorded T1: DONE\n');
  });

  it('349-01/AC-2: an absent stamp records hooksObserved: false and prints the notice exactly once, naming .claude/settings.json', async () => {
    const root = await arrange({ claude: managedSettings() });
    const { io, out, err } = captureIO();
    const res = await buildTaskService(root, { taskId: 'T1', status: 'DONE', now: NOW }, io);
    expect(res.exitCode).toBe(0);
    expect((await progressRows(root)).T1?.hooksObserved).toBe(false);
    expect(noticeLines(err)).toEqual([notice('.claude/settings.json')]);
    expect(out.join('')).toBe('Recorded T1: DONE\n');
  });

  it('349-01/AC-2: a 31-minute-old stamp records hooksObserved: false and prints the notice exactly once', async () => {
    const root = await arrange({
      lastHookEventAt: new Date(NOW.getTime() - 31 * MIN).toISOString(),
      claude: managedSettings(),
    });
    const { io, out, err } = captureIO();
    const res = await buildTaskService(root, { taskId: 'T1', status: 'DONE', now: NOW }, io);
    expect(res.exitCode).toBe(0);
    expect((await progressRows(root)).T1?.hooksObserved).toBe(false);
    expect(noticeLines(err)).toEqual([notice('.claude/settings.json')]);
    expect(out.join('')).toBe('Recorded T1: DONE\n');
  });

  it('349-01/AC-2: with no host hooks installed it records hooksObserved: false and prints no notice', async () => {
    const root = await arrange({});
    const { io, out, err } = captureIO();
    const res = await buildTaskService(root, { taskId: 'T1', status: 'DONE', now: NOW }, io);
    expect(res.exitCode).toBe(0);
    expect((await progressRows(root)).T1?.hooksObserved).toBe(false);
    expect(err.join('')).not.toContain(NOTICE_PREFIX);
    expect(out.join('')).toBe('Recorded T1: DONE\n');
  });

  it('349-01/AC-2: a settings file with only user-authored hooks, or invalid JSON, counts as not installed', async () => {
    const root = await arrange({
      claude: JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] } }),
      codex: '{ not json',
    });
    const { io, err } = captureIO();
    const res = await buildTaskService(root, { taskId: 'T1', status: 'DONE', now: NOW }, io);
    expect(res.exitCode).toBe(0);
    expect((await progressRows(root)).T1?.hooksObserved).toBe(false);
    expect(err.join('')).not.toContain(NOTICE_PREFIX);
  });

  it('349-01/AC-2: both host configs installed are named joined by " and ", Claude Code first', async () => {
    const root = await arrange({ claude: managedSettings(), codex: managedSettings() });
    const { io, err } = captureIO();
    const res = await buildTaskService(root, { taskId: 'T1', status: 'DONE', now: NOW }, io);
    expect(res.exitCode).toBe(0);
    expect(noticeLines(err)).toEqual([notice('.claude/settings.json and .codex/hooks.json')]);
  });

  it('349-01/AC-2: only the installed path is named when only .codex/hooks.json is installed', async () => {
    const root = await arrange({ codex: managedSettings() });
    const { io, err } = captureIO();
    await buildTaskService(root, { taskId: 'T1', status: 'DONE_WITH_CONCERNS', now: NOW }, io);
    expect(noticeLines(err)).toEqual([notice('.codex/hooks.json')]);
  });

  it('349-01/AC-2: re-recording a task overwrites the earlier hooksObserved value', async () => {
    const root = await arrange({
      lastHookEventAt: new Date(NOW.getTime() - 1 * MIN).toISOString(),
      claude: managedSettings(),
    });
    const first = captureIO();
    await buildTaskService(root, { taskId: 'T1', status: 'DONE', now: NOW }, first.io);
    expect((await progressRows(root)).T1?.hooksObserved).toBe(true);

    const later = new Date(NOW.getTime() + 45 * MIN);
    const second = captureIO();
    await buildTaskService(
      root,
      { taskId: 'T1', status: 'DONE_WITH_CONCERNS', now: later },
      second.io,
    );
    expect((await progressRows(root)).T1?.hooksObserved).toBe(false);
    expect(noticeLines(second.err)).toHaveLength(1);
  });

  it('349-01/AC-2: no notice and no row when the task id is unknown (nothing recorded)', async () => {
    const root = await arrange({ claude: managedSettings() });
    const { io, err } = captureIO();
    const res = await buildTaskService(root, { taskId: 'T9', status: 'DONE', now: NOW }, io);
    expect(res.exitCode).toBe(2);
    expect(err.join('')).not.toContain(NOTICE_PREFIX);
  });
});

describe('recordTaskOutcome hooksObserved option (349-01 AC-2)', () => {
  it('349-01/AC-2: a call without the option writes no hooksObserved key (block / needs-context path)', async () => {
    const root = await arrange({ claude: managedSettings() });
    await recordTaskOutcome(root, 'T1', 'BLOCKED', 'stuck');
    await recordTaskOutcome(root, 'T2', 'NEEDS_CONTEXT', 'need info');
    const rows = await progressRows(root);
    expect(rows.T1).toBeDefined();
    expect(rows.T2).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(rows.T1, 'hooksObserved')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(rows.T2, 'hooksObserved')).toBe(false);
  });

  it('349-01/AC-2: the option writes the value onto the row, false included', async () => {
    const root = await arrange({});
    await recordTaskOutcome(root, 'T1', 'DONE', '', { hooksObserved: false });
    await recordTaskOutcome(root, 'T2', 'DONE', '', { hooksObserved: true });
    const rows = await progressRows(root);
    expect(rows.T1?.hooksObserved).toBe(false);
    expect(rows.T2?.hooksObserved).toBe(true);
  });

  it('349-01/AC-2: a re-record without the option drops an earlier hooksObserved value rather than carrying it forward', async () => {
    const root = await arrange({});
    await recordTaskOutcome(root, 'T1', 'DONE', '', { hooksObserved: false });
    await recordTaskOutcome(root, 'T1', 'BLOCKED', 'reopened');
    const rows = await progressRows(root);
    expect(rows.T1?.status).toBe('BLOCKED');
    expect(Object.prototype.hasOwnProperty.call(rows.T1, 'hooksObserved')).toBe(false);
  });

  it('349-01/AC-2: a pre-349 PROGRESS.json row (no hooksObserved key) still reads back and survives a later record', async () => {
    const root = await arrange({ claude: managedSettings() });
    const progressPath = join(root, '.cadence', 'phases', PHASE, `${DRAFT_ID}-PROGRESS.json`);
    const legacyRow = {
      status: 'DONE',
      notes: 'pre-349',
      touchedFiles: ['src/foo.ts'],
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    await writeFile(
      progressPath,
      JSON.stringify({ draftId: DRAFT_ID, tasks: { T1: legacyRow } }, null, 2),
      'utf8',
    );
    const { io } = captureIO();
    const res = await buildTaskService(root, { taskId: 'T2', status: 'DONE', now: NOW }, io);
    expect(res.exitCode).toBe(0);
    const rows = await progressRows(root);
    expect(rows.T1).toEqual(legacyRow);
    expect(rows.T2?.hooksObserved).toBe(false);
  });
});

describe('installedHostHookConfigs / joinHostConfigPaths (349-01 AC-2)', () => {
  it('349-01/AC-2: returns [] for a root that does not exist, never throwing', async () => {
    await expect(
      installedHostHookConfigs(join('/', 'nonexistent-cadence-349', 'nowhere')),
    ).resolves.toEqual([]);
  });

  it('349-01/AC-2: returns the repo-relative installed paths in a fixed order', async () => {
    const root = await arrange({ claude: managedSettings(), codex: managedSettings() });
    expect(await installedHostHookConfigs(root)).toEqual([
      '.claude/settings.json',
      '.codex/hooks.json',
    ]);
  });

  it('349-01/AC-2: joins one path as-is and two with " and "', () => {
    expect(joinHostConfigPaths(['.claude/settings.json'])).toBe('.claude/settings.json');
    expect(joinHostConfigPaths(['.claude/settings.json', '.codex/hooks.json'])).toBe(
      '.claude/settings.json and .codex/hooks.json',
    );
  });
});
