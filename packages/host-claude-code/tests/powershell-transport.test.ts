import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';

// Phase 317 (317-01, T4): the Windows PowerShell transport fixture.
//
// AC-3 is the runner control: it proves, on the box actually running the
// suite, that `powershell.exe -NoProfile -Command "node ..."` collapses a
// child's exit code 2 to 1 — the reason the old exit-2 block transport was
// non-blocking on Windows. If a runner's PowerShell ever stops collapsing,
// the control fails loudly instead of silently passing.
//
// AC-4 is the fix, proven through the real three-process chain (outer
// powershell.exe -> host-claude-code shim -> core `cadence hook`), using the
// exact hook command a real, built `install --local` writes into
// `.claude/settings.json` — never a hand-written equivalent. Method mirrors
// `.cadence/phases/317-hook-json-block/317-01-red-state-capture.md`, which
// recorded the pre-fix result for case 1 (exit 1, empty stdout).
//
// Win32-only by design, and deliberately NOT gated on Git Bash presence:
// `powershell.exe` is spawned directly as the executable (never
// `spawn(..., { shell: true })`, which resolves to cmd.exe on win32).

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADAPTER_BIN = join(__dirname, '../bin/cadence-host-claude-code.cjs');
const EDIT_TOOL_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';

interface RawResult {
  stdout: Buffer;
  stderr: string;
  code: number | null;
}

function runProcess(
  exe: string,
  args: string[],
  cwd: string | undefined,
  stdin: string | null,
): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(cwd !== undefined ? { cwd } : {}),
    });
    const chunks: Buffer[] = [];
    let stderr = '';
    p.stdout.on('data', (c: Buffer) => chunks.push(c));
    p.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    p.on('error', reject);
    // 'close' (not 'exit') so the stdout pipe is fully drained before we assert.
    p.on('close', (code) => resolve({ stdout: Buffer.concat(chunks), stderr, code }));
    if (stdin !== null) p.stdin.write(stdin);
    p.stdin.end();
  });
}

function runThroughPowerShell(command: string, cwd: string, payload: unknown): Promise<RawResult> {
  return runProcess('powershell.exe', ['-NoProfile', '-Command', command], cwd, JSON.stringify(payload));
}

interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string }[];
}

const DRAFT_MD = `---\nphase: 01-foundation\nid: 01-01\ntier: standard\nstatus: APPROVED\n---\n\n# 01-01 — Demo\n\n## Objective\n\nDemo.\n\n## Acceptance Criteria\n\n### AC-1: Demo\nGiven setup\nWhen action\nThen outcome\n\n## Tasks\n\n### T1: done thing\n- files: \`src/a.ts\`\n- action: do\n- verify: vitest\n- done: AC-1\n\n### T2: pending thing\n- files: \`src/b.ts\`\n- action: do\n- verify: vitest\n- done: AC-1\n\n## Boundaries\n\n- _(none)_\n`;

// Same seeding as packages/core/tests/cli/hook.test.ts's phase-317 block:
// BUILD state, an active draft whose T1 owns src/a.ts and is DONE.
async function seedBuild(root: string, configPatch: Record<string, unknown>): Promise<void> {
  const cfgPath = join(root, '.cadence/config.json');
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
  await writeFile(cfgPath, JSON.stringify({ ...cfg, ...configPatch }, null, 2));
  const phaseDir = join(root, '.cadence/phases/01-foundation');
  await mkdir(phaseDir, { recursive: true });
  await writeFile(join(phaseDir, '01-01-DRAFT.md'), DRAFT_MD);
  const now = new Date().toISOString();
  await writeFile(
    join(phaseDir, '01-01-PROGRESS.json'),
    JSON.stringify({
      draftId: '01-01',
      tasks: {
        T1: { status: 'DONE', notes: '', touchedFiles: ['src/a.ts'], updatedAt: now },
        T2: { status: 'PENDING', notes: '', touchedFiles: [], updatedAt: now },
      },
    }),
  );
  const statePath = join(root, '.cadence/state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.activePhase = '01-foundation';
  state.activeDraft = '01-01';
  state.loopPosition = 'BUILD';
  state.tier = 'standard';
  state.openDrafts = [{ id: '01-01', since: now }];
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

function parseSingleDocument(stdout: Buffer): Record<string, unknown> {
  // Trim surrounding whitespace only; JSON.parse then refuses anything that
  // is not exactly one JSON document (e.g. two concatenated documents).
  const text = stdout.toString('utf8').trim();
  expect(text.length).toBeGreaterThan(0);
  return JSON.parse(text) as Record<string, unknown>;
}

function expectDeny(stdout: Buffer, reason: RegExp): string {
  const doc = parseSingleDocument(stdout);
  expect(Object.keys(doc)).toEqual(['hookSpecificOutput']);
  const hso = doc.hookSpecificOutput as Record<string, unknown>;
  expect(hso.hookEventName).toBe('PreToolUse');
  expect(hso.permissionDecision).toBe('deny');
  expect(typeof hso.permissionDecisionReason).toBe('string');
  expect(hso.permissionDecisionReason).toMatch(reason);
  return hso.permissionDecisionReason as string;
}

describe.runIf(process.platform === 'win32')('PowerShell hook transport (phase 317, win32)', () => {
  it('317-01/AC-3 317-01/AC-8: powershell.exe -NoProfile -Command collapses a child exit 2 to 1 on this runner', async () => {
    const r = await runProcess(
      'powershell.exe',
      ['-NoProfile', '-Command', "node -e 'process.exit(2)'"],
      undefined,
      null,
    );
    // Exactly 1. If this runner's PowerShell ever propagates 2 (or anything
    // else), this control fails loudly — a control that never trips proves
    // nothing about AC-4.
    expect(r.code).toBe(1);
  });

  describe('real chain: install --local command -> shim -> core', () => {
    let installRepo: Fixture | null = null;
    let capturedCommand = '';
    let caseRepo: Fixture | null = null;

    beforeAll(async () => {
      installRepo = await tempRepo({ initialized: true, projectName: 'ps-transport' });
      const inst = await runProcess(
        process.execPath,
        [ADAPTER_BIN, 'install', '--local', '--cwd', installRepo.root],
        installRepo.root,
        null,
      );
      expect(inst.code, `install --local failed: ${inst.stderr}`).toBe(0);
      const settings = JSON.parse(
        await readFile(join(installRepo.root, '.claude/settings.json'), 'utf8'),
      ) as { hooks: Record<string, HookEntry[]> };
      const pre = settings.hooks.PreToolUse?.find((e) => e.matcher === EDIT_TOOL_MATCHER);
      const stop = settings.hooks.Stop?.[0];
      expect(pre?.hooks[0]?.command).toBeTypeOf('string');
      expect(stop?.hooks[0]?.command).toBeTypeOf('string');
      capturedCommand = pre!.hooks[0]!.command;
      // The same installed command drives every managed entry, including Stop.
      expect(stop!.hooks[0]!.command).toBe(capturedCommand);
      // The command embeds no repo path, so reusing it in fresh per-case
      // repos is exactly what Claude Code would run in those repos.
      expect(capturedCommand.toLowerCase()).not.toContain(installRepo.root.toLowerCase());
      expect(capturedCommand).toMatch(/host-claude-code[\\/]dist[\\/]cli\.js hook /);
    });

    afterEach(async () => {
      if (caseRepo) {
        await caseRepo.cleanup();
        caseRepo = null;
      }
    });

    afterAll(async () => {
      if (installRepo) {
        await installRepo.cleanup();
        installRepo = null;
      }
    });

    it('317-01/AC-4 317-01/AC-8: build-gate block (handlers.ts:256) → PreToolUse deny JSON on stdout, outer exit 0', async () => {
      caseRepo = await tempRepo({ initialized: true });
      const root = caseRepo.root;
      const cfgPath = join(root, '.cadence/config.json');
      const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
      cfg.hooks.preToolUseBuildGate = true;
      await writeFile(cfgPath, JSON.stringify(cfg, null, 2));

      const r = await runThroughPowerShell(capturedCommand, root, {
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: join(root, 'src', 'x.ts'), content: 'x' },
        cwd: root,
        session_id: 'ps-transport-256',
      });
      expect(r.code, `stderr: ${r.stderr}`).toBe(0);
      expectDeny(r.stdout, /^preToolUseBuildGate is enabled and loopPosition=IDLE\./);
    });

    it('317-01/AC-4 317-01/AC-8: redundant-work block (handlers.ts:230) → PreToolUse deny JSON with the em dash byte-for-byte, outer exit 0', async () => {
      caseRepo = await tempRepo({ initialized: true });
      const root = caseRepo.root;
      await seedBuild(root, { redundantWorkEnforcement: 'block' });
      const filePath = join(root, 'src', 'a.ts');

      const r = await runThroughPowerShell(capturedCommand, root, {
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
        cwd: root,
        session_id: 'ps-transport-230',
      });
      expect(r.code, `stderr: ${r.stderr}`).toBe(0);
      // U+2014 EM DASH must arrive as its exact UTF-8 bytes in the raw stream.
      expect(r.stdout.includes(Buffer.from([0xe2, 0x80, 0x94]))).toBe(true);
      const reason = expectDeny(r.stdout, /^redundantWorkEnforcement=block: .+ belongs to T1, already DONE — /);
      expect(reason).toContain(`${filePath} belongs to T1, already DONE — mark it back to NEEDS_CONTEXT first`);
    });

    it('317-01/AC-4 317-01/AC-8: strict-loop Stop block (handlers.ts:297) → top-level decision:block JSON on stdout, outer exit 0', async () => {
      caseRepo = await tempRepo({ initialized: true });
      const root = caseRepo.root;
      await seedBuild(root, { loopEnforcement: 'strict' });

      const r = await runThroughPowerShell(capturedCommand, root, {
        hook_event_name: 'Stop',
        stop_hook_active: false,
        cwd: root,
        session_id: 'ps-transport-297',
      });
      expect(r.code, `stderr: ${r.stderr}`).toBe(0);
      const doc = parseSingleDocument(r.stdout);
      expect(Object.keys(doc)).toEqual(['decision', 'reason']);
      expect(doc.decision).toBe('block');
      expect(doc.reason).toMatch(/^loopEnforcement=strict and 1 unclosed draft\(s\)\./);
    });
  });
});
