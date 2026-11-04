import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeHookEvent } from '../src/shim.js';

const SHIM = join(dirname(fileURLToPath(import.meta.url)), '../dist/cli.js');

describe('routeHookEvent', () => {
  it('SessionStart with no extra payload → session-start, stdin unchanged', () => {
    const raw = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'abc' });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('session-start');
    expect(JSON.parse(r.translatedStdin)).toEqual({
      hook_event_name: 'SessionStart',
      session_id: 'abc',
    });
  });

  it('PostToolUse Edit → post-tool-edit + translated stdin has files[]', () => {
    const raw = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/abs/foo.ts', old_string: 'a', new_string: 'b' },
    });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('post-tool-edit');
    const parsed = JSON.parse(r.translatedStdin);
    expect(parsed.files).toEqual(['/abs/foo.ts']);
    // Original payload preserved alongside translated fields.
    expect(parsed.tool_name).toBe('Edit');
  });

  it('PostToolUse Bash → null (skip, non-edit tool)', () => {
    const raw = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBeNull();
  });

  it('PreToolUse Write → pre-tool-edit + files[]', () => {
    const raw = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: '/x.md', content: 'hi' },
    });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('pre-tool-edit');
    expect(JSON.parse(r.translatedStdin).files).toEqual(['/x.md']);
  });

  it('Notification → null (no abstract mapping)', () => {
    const raw = JSON.stringify({ hook_event_name: 'Notification', message: 'hi' });
    expect(routeHookEvent(raw).abstractEvent).toBeNull();
  });

  it('SubagentStop → subagent-result, stdin unchanged', () => {
    const raw = JSON.stringify({ hook_event_name: 'SubagentStop' });
    const r = routeHookEvent(raw);
    expect(r.abstractEvent).toBe('subagent-result');
  });

  it('empty stdin → null', () => {
    expect(routeHookEvent('').abstractEvent).toBeNull();
  });

  it('non-JSON stdin → null', () => {
    expect(routeHookEvent('not json {').abstractEvent).toBeNull();
  });

  it('missing hook_event_name → null', () => {
    expect(routeHookEvent('{"foo":1}').abstractEvent).toBeNull();
  });
});

describe('routeHookEvent PreCompact (345-01/AC-1)', () => {
  it('345-01/AC-1: PreCompact → pre-compact with compactTrigger forwarded', () => {
    const r = routeHookEvent(JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'manual' }));
    expect(r.abstractEvent).toBe('pre-compact');
    expect(JSON.parse(r.translatedStdin).compactTrigger).toBe('manual');
  });
});

// ---------------------------------------------------------------------------
// Phase 345 (AC-6): the shim clamps a non-zero core exit, a spawn failure,
// and any other shim error to exit 0 for the pre-compact event only, so a
// newer adapter running against an older core can never block a compaction.
// A stub "core" script stands in for `cadence` so the test controls its exit.
// ---------------------------------------------------------------------------

interface ShimRun {
  code: number;
  stdout: string;
  stderr: string;
}

function runShim(args: string[], stdin: string, cwd: string): Promise<ShimRun> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SHIM, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.stdin.write(stdin);
    p.stdin.end();
    p.on('exit', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

let stubDirs: string[] = [];
afterEach(async () => {
  for (const d of stubDirs) await rm(d, { recursive: true, force: true });
  stubDirs = [];
});

/** Writes a stub core that writes one stderr line and exits with `code`. */
async function stubCore(code: number, message: string): Promise<{ dir: string; cadence: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'cadence-shim-stub-'));
  stubDirs.push(dir);
  const script = join(dir, 'stub-core.cjs');
  await writeFile(
    script,
    `process.stdin.resume();\nprocess.stdin.on('end', () => {\n  process.stderr.write(${JSON.stringify(message)} + '\\n');\n  process.exit(${code});\n});\n`,
  );
  return { dir, cadence: `${process.execPath} ${script}` };
}

function shimLines(stderr: string, pattern: RegExp): string[] {
  return stderr.split(/\r?\n/).filter((l) => pattern.test(l));
}

const PRE_COMPACT = JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto' });

describe('shim exit clamp for pre-compact (345-01/AC-6)', () => {
  it('345-01/AC-6: a core that exits 2 for pre-compact (older core) leaves the shim at exit 0 with one stderr line naming the code', async () => {
    const { dir, cadence } = await stubCore(2, 'Unknown hook event: pre-compact');
    const r = await runShim(['hook', '--cadence', cadence], PRE_COMPACT, dir);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    // The stub core's own line is inherited; the shim adds exactly one more.
    expect(r.stderr).toContain('Unknown hook event: pre-compact');
    const clamp = shimLines(r.stderr, /pre-compact/i).filter((l) => !l.startsWith('Unknown hook event'));
    expect(clamp).toHaveLength(1);
    expect(clamp[0]).toMatch(/exit(ed)?( with)?( code)? 2\b/);
  });

  it('345-01/AC-6: a payload cwd that differs from the shim cwd adds no divergence line on pre-compact', async () => {
    const { dir, cadence } = await stubCore(2, 'Unknown hook event: pre-compact');
    const other = await mkdtemp(join(tmpdir(), 'cadence-shim-other-'));
    stubDirs.push(other);
    const payload = JSON.stringify({ hook_event_name: 'PreCompact', trigger: 'auto', cwd: other });
    const r = await runShim(['hook', '--cadence', cadence], payload, dir);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('hook cwd divergence');
    const own = r.stderr.split(/\r?\n/).filter((l) => l.length > 0 && !l.startsWith('Unknown hook event'));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatch(/pre-compact/);
  });

  it('345-01/AC-6: a core that exits 0 for pre-compact adds no shim stderr line', async () => {
    const { dir, cadence } = await stubCore(0, 'core-ok');
    const r = await runShim(['hook', '--cadence', cadence], PRE_COMPACT, dir);
    expect(r.code).toBe(0);
    expect(r.stderr.trim()).toBe('core-ok');
  });

  it('345-01/AC-6: a spawn failure on pre-compact exits 0 with one shim stderr line', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cadence-shim-stub-'));
    stubDirs.push(dir);
    const missing = join(dir, 'definitely-not-a-cadence-binary');
    const r = await runShim(['hook', '--cadence', missing], PRE_COMPACT, dir);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    const clamp = shimLines(r.stderr, /pre-compact/i);
    expect(clamp).toHaveLength(1);
    if (process.platform !== 'win32') {
      // Off Windows the spawn itself errors (no shell in between), so the
      // shim's line is the only stderr output.
      expect(r.stderr.trim().split(/\r?\n/)).toHaveLength(1);
    }
  });

  it('345-01/AC-6: an empty --cadence command (shim error) on pre-compact exits 0 with one stderr line', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cadence-shim-stub-'));
    stubDirs.push(dir);
    const r = await runShim(['hook', '--cadence', ' '], PRE_COMPACT, dir);
    expect(r.code).toBe(0);
    expect(r.stderr.trim().split(/\r?\n/)).toHaveLength(1);
    expect(r.stderr).toMatch(/pre-compact/);
  });

  it('345-01/AC-6: every other event keeps its non-zero core exit (no clamp)', async () => {
    const { dir, cadence } = await stubCore(2, 'blocked');
    const stop = await runShim(['hook', '--cadence', cadence], JSON.stringify({ hook_event_name: 'Stop' }), dir);
    expect(stop.code).toBe(2);
    expect(stop.stderr.trim()).toBe('blocked');
    const start = await runShim(
      ['hook', '--cadence', cadence],
      JSON.stringify({ hook_event_name: 'SessionStart' }),
      dir,
    );
    expect(start.code).toBe(2);
  });

  it('345-01/AC-6: a spawn failure on any other event still exits 1', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cadence-shim-stub-'));
    stubDirs.push(dir);
    const missing = join(dir, 'definitely-not-a-cadence-binary');
    const r = await runShim(['hook', '--cadence', missing], JSON.stringify({ hook_event_name: 'Stop' }), dir);
    expect(r.code).not.toBe(0);
  });

  it('345-01/AC-6: an empty --cadence command on any other event still exits 1', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cadence-shim-stub-'));
    stubDirs.push(dir);
    const r = await runShim(['hook', '--cadence', ' '], JSON.stringify({ hook_event_name: 'Stop' }), dir);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--cadence command is empty');
  });
});
