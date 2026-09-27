import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod/v4';
import {
  hostCliJSON,
  HostCliError,
  makeRealSpawn,
  type SpawnFn,
  type SpawnedProcessLike,
  type UnderlyingSpawnFn,
} from '../../src/verify/host-cli-client.js';

// AC-3 (structural, satisfied by the diff): this test file, and the module it
// exercises, import nothing from `@thomas-powers-jr/cadence-types`'s host.ts or
// `packages/host-claude-code/` — the host-cli provider spawns the CLI binary
// directly from `packages/core/src/verify/` the same way `local-client.ts`
// calls an arbitrary HTTP endpoint, adding zero new HostAdapter/HostCapabilities
// surface.

const Schema = z.object({ ok: z.boolean() });

interface FakeCall {
  bin: string;
  args: string[];
  /** Phase 178 T3: signals passed to the fake process's `kill()`, in call order. */
  killSignals: NodeJS.Signals[];
  /** Phase 296 T1: everything the client wrote to the child's stdin, concatenated. */
  stdin: string;
  /** Phase 296 T1: whether the client closed stdin. A host CLI reading `-` blocks on
   *  EOF, so leaving the stream open hangs the call until the spawn timeout fires. */
  stdinEnded: boolean;
}

interface FakeResponse {
  stdout?: string;
  stderr?: string;
  code?: number;
  err?: NodeJS.ErrnoException;
  /** Phase 178 T3: AC-3's "never closes stdout or exits" case — no listener is
   *  ever invoked, simulating the documented hung-subprocess limitation. */
  hang?: boolean;
  /** Phase 296 T4: AC-4's case, the child exits before the prompt is fully
   *  written and stdin emits EPIPE. */
  stdinError?: NodeJS.ErrnoException;
}

/** Stubs the subprocess transport: records each spawn call and replays scripted responses in order (last one repeats). No real `claude`/`codex` binary is ever invoked. */
function fakeSpawn(responses: FakeResponse[], calls: FakeCall[]): SpawnFn {
  let i = 0;
  return (bin, args) => {
    const call: FakeCall = { bin, args, killSignals: [], stdin: '', stdinEnded: false };
    calls.push(call);
    const resp = responses[Math.min(i++, responses.length - 1)] ?? {};

    const stdoutListeners: Array<(chunk: Buffer) => void> = [];
    const stderrListeners: Array<(chunk: Buffer) => void> = [];
    let errorListener: ((err: NodeJS.ErrnoException) => void) | undefined;
    let closeListener: ((code: number | null) => void) | undefined;

    let stdinErrorListener: ((err: NodeJS.ErrnoException) => void) | undefined;

    const proc: SpawnedProcessLike = {
      stdin: {
        write: (chunk: string | Buffer) => {
          call.stdin += chunk.toString();
          return true;
        },
        end: () => {
          call.stdinEnded = true;
        },
        on: (event: string, cb: (err: NodeJS.ErrnoException) => void) => {
          if (event === 'error') stdinErrorListener = cb;
          return proc.stdin as NodeJS.WritableStream;
        },
      } as unknown as NodeJS.WritableStream,
      stdout: {
        on: (event: string, cb: (chunk: Buffer) => void) => {
          if (event === 'data') stdoutListeners.push(cb);
          return proc.stdout as NodeJS.ReadableStream;
        },
      } as unknown as NodeJS.ReadableStream,
      stderr: {
        on: (event: string, cb: (chunk: Buffer) => void) => {
          if (event === 'data') stderrListeners.push(cb);
          return proc.stderr as NodeJS.ReadableStream;
        },
      } as unknown as NodeJS.ReadableStream,
      on: (event: 'error' | 'close', cb: ((err: NodeJS.ErrnoException) => void) | ((code: number | null) => void)) => {
        if (event === 'error') errorListener = cb as (err: NodeJS.ErrnoException) => void;
        if (event === 'close') closeListener = cb as (code: number | null) => void;
        return proc;
      },
      kill: (signal?: NodeJS.Signals) => {
        call.killSignals.push(signal ?? 'SIGTERM');
        return true;
      },
    };

    queueMicrotask(() => {
      if (resp.stdinError) {
        stdinErrorListener?.(resp.stdinError);
        return;
      }
      if (resp.hang) return; // never fires error/close — the timeout guard must catch this
      if (resp.err) {
        errorListener?.(resp.err);
        return;
      }
      if (resp.stdout !== undefined) stdoutListeners.forEach((l) => l(Buffer.from(resp.stdout as string)));
      if (resp.stderr !== undefined) stderrListeners.forEach((l) => l(Buffer.from(resp.stderr as string)));
      closeListener?.(resp.code ?? 0);
    });

    return proc;
  };
}

const claudeEnvelope = (result: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ is_error: false, result, ...extra });

describe('hostCliJSON', () => {
  // `env: {}` pins every pre-existing test to a deterministic, self-invocation-
  // -free environment regardless of what the *actual* process this test suite
  // runs under happens to export (e.g. this repo's own dev sessions often run
  // under Claude Code itself, which sets `CLAUDECODE=1` — without this default
  // those ambient variables would leak into `hostCliJSON`'s default
  // `env ?? process.env` and spuriously trip the AC-2 guard added below).
  const base = { system: 's', user: 'u', schema: Schema, env: {} };

  it('AC-1: spawns claude in headless/non-interactive mode with the flattened prompt and parses the JSON envelope into a schema-valid verdict', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);

    const r = await hostCliJSON({ ...base, spawnImpl });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.bin).toBe('claude');
    expect(calls[0]!.args[0]).toBe('-p');
    // Phase 296: the flattened prompt moved from argv to stdin. Same two
    // assertions, read off the channel that now carries it.
    expect(calls[0]!.stdin).toContain('[SYSTEM]\ns');
    expect(calls[0]!.stdin).toContain('[USER]\nu');
    expect(calls[0]!.args.slice(1)).toEqual(['--output-format', 'json']);
  });

  it('passes --model when a model is configured (claude family)', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);

    await hostCliJSON({ ...base, model: 'opus', spawnImpl });

    expect(calls[0]!.args.slice(1)).toEqual(['--output-format', 'json', '--model', 'opus']);
  });

  it('does not pass a --model flag when no model is configured', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);

    await hostCliJSON({ ...base, spawnImpl });

    expect(calls[0]!.args).not.toContain('--model');
  });

  it('spawns codex exec --json for a codex-named binary and parses the last agent_message event', async () => {
    const calls: FakeCall[] = [];
    const jsonl = [
      JSON.stringify({ type: 'thread.started', thread_id: 'x' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: '{"ok":true}' } }),
      JSON.stringify({ type: 'turn.completed', usage: {} }),
    ].join('\n');
    const spawnImpl = fakeSpawn([{ stdout: jsonl }], calls);

    const r = await hostCliJSON({ ...base, bin: 'codex', spawnImpl });

    expect(r.ok).toBe(true);
    expect(calls[0]!.bin).toBe('codex');
    expect(calls[0]!.args[0]).toBe('exec');
    expect(calls[0]!.args).toContain('--json');
    expect(calls[0]!.args).toContain('--skip-git-repo-check');
    // Phase 296: argv now ends with the `-` stdin operand; the prompt itself
    // is on stdin.
    expect(calls[0]!.args[calls[0]!.args.length - 1]).toBe('-');
    expect(calls[0]!.stdin).toContain('[USER]\nu');
  });

  // Phase 296: the prompt travels on stdin, not argv. Windows caps a command
  // line at 32,767 characters, so a deep-verify prompt carrying a real diff
  // used to throw `spawn ENAMETOOLONG`; the provider then degraded to `mock`
  // and every AC came back "no linked test found" from a settle that looked
  // like it had run. Both binaries accept the prompt on stdin, verified
  // against the real binaries on 2026-09-07: `codex exec --json
  // --skip-git-repo-check -` read a 53,960-byte prompt (input_tokens 65151,
  // no truncation), and `claude -p --output-format json` with the prompt
  // piped returned `"is_error": false`.

  it('AC-1/AC-5: a prompt larger than the Windows argv ceiling is absent from argv and arrives whole on stdin', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);
    // 40,000 chars clears the 32,767 ceiling with room to spare. Generated,
    // never a literal, so this test file stays small.
    const huge = 'x'.repeat(40_000);

    const r = await hostCliJSON({ ...base, user: huge, spawnImpl });

    expect(r.ok).toBe(true);
    // AC-1: no argument carries the prompt, and argv does not grow with it.
    expect(calls[0]!.args.some((a) => a.includes(huge))).toBe(false);
    expect(calls[0]!.args.join('').length).toBeLessThan(1_000);
    // AC-5: the prompt arrived in full, untruncated.
    expect(calls[0]!.stdin).toContain(huge);
    expect(calls[0]!.stdin).toContain('[SYSTEM]');
    expect(calls[0]!.stdinEnded).toBe(true);
  });

  it('AC-2: claude is invoked as `-p --output-format json` with no positional prompt', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);

    await hostCliJSON({ ...base, spawnImpl });

    expect(calls[0]!.args).toEqual(['-p', '--output-format', 'json']);
  });

  it('AC-2: codex is invoked with a trailing `-` so it reads the prompt from stdin', async () => {
    const calls: FakeCall[] = [];
    const jsonl = JSON.stringify({
      type: 'item.completed',
      item: { id: 'i', type: 'agent_message', text: '{"ok":true}' },
    });
    const spawnImpl = fakeSpawn([{ stdout: jsonl }], calls);

    await hostCliJSON({ ...base, bin: 'codex', model: 'gpt-5', spawnImpl });

    expect(calls[0]!.args).toEqual(['exec', '--json', '--skip-git-repo-check', '-m', 'gpt-5', '-']);
  });

  it('AC-3: stdin is closed, so a CLI that blocks on EOF cannot hang', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);

    await hostCliJSON({ ...base, spawnImpl });

    expect(calls[0]!.stdinEnded).toBe(true);
  });

  it('AC-4: an EPIPE on stdin rejects as a HostCliError instead of crashing the process', async () => {
    const calls: FakeCall[] = [];
    const epipe: NodeJS.ErrnoException = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    const spawnImpl = fakeSpawn([{ stdinError: epipe }], calls);

    await expect(hostCliJSON({ ...base, spawnImpl })).rejects.toBeInstanceOf(HostCliError);
  });

  it('AC-1: reuses the shared repair-retry harness — repairs once then succeeds', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn(
      [{ stdout: claudeEnvelope('not json at all') }, { stdout: claudeEnvelope('{"ok":true}') }],
      calls,
    );

    const r = await hostCliJSON({ ...base, spawnImpl });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('AC-1: two repair retries — succeeds on the second retry', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn(
      [
        { stdout: claudeEnvelope('bad') },
        { stdout: claudeEnvelope('still bad') },
        { stdout: claudeEnvelope('{"ok":true}') },
      ],
      calls,
    );

    const r = await hostCliJSON({ ...base, spawnImpl });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('throws after two failed repairs, naming the bin/family in the error', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn(
      [{ stdout: claudeEnvelope('n1') }, { stdout: claudeEnvelope('n2') }, { stdout: claudeEnvelope('n3') }],
      calls,
    );

    await expect(hostCliJSON({ ...base, spawnImpl })).rejects.toThrow(/2 repair retries.*bin=claude/);
  });

  it('rejects with a distinguishable HostCliError(reason="not-found") when the binary is missing (ENOENT) — no retry, no hang', async () => {
    const calls: FakeCall[] = [];
    const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException;
    const spawnImpl = fakeSpawn([{ err: enoent }], calls);

    await expect(hostCliJSON({ ...base, spawnImpl })).rejects.toMatchObject({
      name: 'HostCliError',
      reason: 'not-found',
    });
    // A spawn-level failure is not JSON/schema-repairable — must not retry the process.
    expect(calls).toHaveLength(1);
  });

  it('rejects with a HostCliError(reason="nonzero-exit") including stderr content on a non-zero exit', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ code: 1, stderr: 'not authenticated' }], calls);

    const err = await hostCliJSON({ ...base, spawnImpl }).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'nonzero-exit' });
    expect((err as Error).message).toMatch(/not authenticated/);
  });

  it('rejects with a HostCliError(reason="output-error") when stdout is not valid JSON (claude family)', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: 'not json envelope at all' }], calls);

    await expect(hostCliJSON({ ...base, spawnImpl })).rejects.toMatchObject({
      reason: 'output-error',
    });
  });

  it('rejects with a HostCliError(reason="output-error") when the claude envelope reports is_error', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn(
      [{ stdout: JSON.stringify({ is_error: true, subtype: 'error_max_turns', result: 'boom' }) }],
      calls,
    );

    const err = await hostCliJSON({ ...base, spawnImpl }).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'output-error' });
    expect((err as Error).message).toMatch(/boom/);
  });

  it('AC-1: emits a one-time quota-transparency notice on first real spawn, and never repeats it across multiple calls in the same process', async () => {
    // Fresh module instance so this test's "once per process" assertion is
    // not polluted by earlier tests in this file already having spawned
    // (and thus already flipped the module-level once-per-process flag).
    vi.resetModules();
    const { hostCliJSON: freshHostCliJSON } = await import('../../src/verify/host-cli-client.js');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const calls: FakeCall[] = [];
      const spawnImpl = fakeSpawn(
        [{ stdout: claudeEnvelope('{"ok":true}') }, { stdout: claudeEnvelope('{"ok":true}') }],
        calls,
      );

      await freshHostCliJSON({ ...base, spawnImpl });
      await freshHostCliJSON({ ...base, spawnImpl });

      expect(calls).toHaveLength(2); // two real spawns happened...
      const quotaNotices = stderrSpy.mock.calls.filter(
        ([chunk]) => typeof chunk === 'string' && chunk.toLowerCase().includes('quota'),
      );
      expect(quotaNotices).toHaveLength(1); // ...but the notice fired only once
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('AC-2: refuses to spawn and rejects with HostCliError(reason="self-invocation") when CLAUDECODE=1 is set (claude family)', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);

    const err = await hostCliJSON({
      ...base,
      env: { CLAUDECODE: '1' },
      spawnImpl,
    }).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'self-invocation' });
    expect((err as Error).message).toMatch(/self-invocation|already running inside a headless/i);
    // No-hang guarantee (AC-2): the refusal happens before any subprocess is
    // created — no spawn call was ever made, no retry either (a
    // self-invocation refusal is not JSON/schema-repairable).
    expect(calls).toHaveLength(0);
  });

  it('AC-2: does not refuse when CLAUDECODE is unset — proceeds to spawn normally (no false positive)', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);

    const r = await hostCliJSON({ ...base, env: {}, spawnImpl });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('AC-2: does not refuse when CLAUDECODE is set to something other than "1" (e.g. unset/empty-string ambient var)', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);

    const r = await hostCliJSON({ ...base, env: { CLAUDECODE: '' }, spawnImpl });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('AC-2: CLAUDECODE=1 does not affect the codex family — self-invocation detection is not (yet) wired for codex, since no reliable documented session env var was found', async () => {
    const calls: FakeCall[] = [];
    const jsonl = JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"ok":true}' } });
    const spawnImpl = fakeSpawn([{ stdout: jsonl }], calls);

    const r = await hostCliJSON({ ...base, bin: 'codex', env: { CLAUDECODE: '1' }, spawnImpl });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('AC-2: propagating through the standard fallback path — the self-invocation HostCliError has the same shape (name/reason) as the other spawn-boundary errors so wrapWithFallback needs no new logic', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([], calls);

    const err = await hostCliJSON({
      ...base,
      env: { CLAUDECODE: '1' },
      spawnImpl,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as { name: string }).name).toBe('HostCliError');
    expect((err as { reason: string }).reason).toBe('self-invocation');
  });

  it('AC-3: kills the subprocess and rejects with HostCliError(reason="timeout") when it never closes stdout or exits', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ hang: true }], calls);

    const err = await hostCliJSON({ ...base, spawnImpl, timeoutMs: 20 }).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'timeout' });
    // Killed via the optional `SpawnedProcessLike.kill` capability, not left running.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.killSignals).toContain('SIGKILL');
    // A timeout is not JSON/schema-repairable — must not retry the process.
  });

  it('AC-3: a normally-closing process is unaffected by the timeout guard (no regression)', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);

    const r = await hostCliJSON({ ...base, spawnImpl, timeoutMs: 50 });

    expect(r.ok).toBe(true);
    expect(calls[0]!.killSignals).toHaveLength(0);
  });

  it('AC-3: the timeout timer is cleared on normal completion (resolve path) — no dangling/spurious timer', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    try {
      const r = await hostCliJSON({ ...base, spawnImpl, timeoutMs: 50 });

      expect(r.ok).toBe(true);
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });

  it('AC-3: the timeout timer is cleared on the reject path too (non-zero exit), not just on resolve', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ code: 1, stderr: 'boom' }], calls);
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    try {
      await expect(hostCliJSON({ ...base, spawnImpl, timeoutMs: 50 })).rejects.toMatchObject({
        reason: 'nonzero-exit',
      });

      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });

  it('AC-3: resolves the timeout from CADENCE_HOST_CLI_TIMEOUT_MS when no explicit timeoutMs override is given', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ hang: true }], calls);

    const err = await hostCliJSON({
      ...base,
      env: { CADENCE_HOST_CLI_TIMEOUT_MS: '15' },
      spawnImpl,
    }).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'timeout' });
  });

  // Phase 184 T1 — AbortSignal + traceId plumbing.

  it('AC-1: an external signal that aborts mid-call kills the child and rejects with HostCliError(reason="aborted")', async () => {
    const calls: FakeCall[] = [];
    // Never closes stdout or exits on its own — the abort must be what ends
    // the call, not the (much larger) timeout.
    const spawnImpl = fakeSpawn([{ hang: true }], calls);
    const controller = new AbortController();

    // `spawnCapture`'s Promise executor (which registers the abort listener)
    // runs synchronously as part of calling `hostCliJSON` — nothing awaits
    // before that point — so aborting here, before awaiting the returned
    // promise, reliably lands after the listener is registered and before
    // the fake process's queued microtask (which never settles anyway, per
    // `hang: true`) could matter. No real sleeping/timers needed.
    const promise = hostCliJSON({ ...base, spawnImpl, timeoutMs: 60_000, signal: controller.signal });
    controller.abort();

    const err = await promise.catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'aborted' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.killSignals).toContain('SIGKILL');
  });

  it('AC-1: a signal that is already aborted before the call starts rejects immediately with reason="aborted" and never spawns a child', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);
    const controller = new AbortController();
    controller.abort();

    const err = await hostCliJSON({ ...base, spawnImpl, signal: controller.signal }).catch(
      (e: unknown) => e,
    );

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'aborted' });
    expect(calls).toHaveLength(0); // never spawned
  });

  it('AC-1: a signal that never fires does not affect a normally-closing call (no regression)', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);
    const controller = new AbortController();

    const r = await hostCliJSON({ ...base, spawnImpl, signal: controller.signal });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.killSignals).toHaveLength(0);
  });

  it('omitting signal entirely keeps today\'s behavior byte-identical (no regression)', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);

    const r = await hostCliJSON({ ...base, spawnImpl });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('AC-1: an optional traceId is accepted without changing behavior or output', async () => {
    const calls: FakeCall[] = [];
    const spawnImpl = fakeSpawn([{ stdout: claudeEnvelope('{"ok":true}') }], calls);

    const r = await hostCliJSON({ ...base, spawnImpl, traceId: 'trace-abc-123' });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

// Phase 319 T2 — wiring the win32 command resolver (`win32-command.ts`, T1's
// finished, unedited file) into the real spawn seam via `makeRealSpawn`.
// Everything below except the single `it.runIf(process.platform === 'win32')`
// real-process test injects fake resolver facts + a fake underlying spawn,
// so it runs deterministically on Linux/macOS CI too — no real `claude`/
// `codex` binary and no real filesystem probing in those tests.
describe('makeRealSpawn', () => {
  const base = { system: 's', user: 'u', schema: Schema, env: {} };
  const codexJsonl = () =>
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"ok":true}' } });

  /** Fake win32 filesystem: lowercase-keyed map, mirroring win32's
   *  case-insensitive filesystem (same fixture shape as win32-command.test.ts,
   *  reimplemented inline here rather than imported — importing a test file
   *  would re-run its top-level `describe`s a second time). */
  function makeFakeFs(files: Record<string, string>) {
    const map = new Map<string, string>();
    for (const [p, content] of Object.entries(files)) map.set(p.toLowerCase(), content);
    return {
      // `vi.fn(...)`-wrapped (not plain functions) so tests can assert
      // call counts (e.g. "never even asked" / "never even opened") in
      // addition to the resolved outcome.
      fileExists: vi.fn((p: string) => map.has(p.toLowerCase())),
      readFile: vi.fn((p: string) => {
        const content = map.get(p.toLowerCase());
        if (content === undefined) throw new Error(`fake fs: no such file ${p}`);
        return content;
      }),
    };
  }

  /** The canonical npm cmd-shim, verbatim shape from the DRAFT, CRLF line endings. */
  function npmCmdShim(rel: string): string {
    return [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      '',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ') ELSE (',
      '  SET "_prog=node"',
      '  SET PATHEXT=%PATHEXT:;.JS;=;%',
      ')',
      '',
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${rel}" %*`,
    ].join('\r\n');
  }

  /** Wraps the outer fixture's `fakeSpawn` behind an `UnderlyingSpawnFn`
   *  signature, additionally recording each call's `options` object so tests
   *  can assert on it (AC-2's options/no-shell claim). */
  function fakeUnderlying(
    responses: FakeResponse[],
    calls: FakeCall[],
  ): { spawn: UnderlyingSpawnFn; opts: Array<{ stdio: unknown }> } {
    const opts: Array<{ stdio: unknown }> = [];
    const inner = fakeSpawn(responses, calls);
    return {
      spawn: (command, args, options) => {
        opts.push(options);
        return inner(command, args);
      },
      opts,
    };
  }

  /** Wraps a `SpawnFn` to record the `bin` it is invoked with — verifies
   *  `makeRealSpawn`'s returned function still receives the *configured* bin
   *  unchanged (AC-4): resolution happens inside the call, not before it. */
  function spyOnSpawnFn(fn: SpawnFn): { fn: SpawnFn; received: string[] } {
    const received: string[] = [];
    return {
      fn: (bin, args) => {
        received.push(bin);
        return fn(bin, args);
      },
      received,
    };
  }

  it('319-01/AC-2: win32 seam calls the underlying spawn with piped stdio, no shell key, and the resolved command', async () => {
    const calls: FakeCall[] = [];
    const { fileExists, readFile } = makeFakeFs({ 'C:\\tools\\codex.exe': 'exe' });
    const { spawn: underlyingSpawn, opts } = fakeUnderlying([{ stdout: codexJsonl() }], calls);
    const spawnImpl = makeRealSpawn({
      platform: 'win32',
      env: { Path: 'C:\\tools' },
      fileExists,
      readFile,
      execPath: 'C:\\node-install\\node.exe',
      spawn: underlyingSpawn,
    });

    const r = await hostCliJSON({ ...base, bin: 'codex', spawnImpl });

    expect(r.ok).toBe(true);
    expect(opts).toHaveLength(1);
    expect(Object.keys(opts[0]!)).toEqual(['stdio']);
    expect('shell' in opts[0]!).toBe(false);
    expect(opts[0]!.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(calls[0]!.bin).toBe('C:\\tools\\codex.exe');
    expect(calls[0]!.args).toEqual(['exec', '--json', '--skip-git-repo-check', '-']);
  });

  it('319-01/AC-2: non-win32 seam still calls the underlying spawn with piped stdio, no shell key, and the bin unchanged', async () => {
    const calls: FakeCall[] = [];
    const { spawn: underlyingSpawn, opts } = fakeUnderlying([{ stdout: codexJsonl() }], calls);
    const spawnImpl = makeRealSpawn({ platform: 'linux', spawn: underlyingSpawn });

    const r = await hostCliJSON({ ...base, bin: 'codex', spawnImpl });

    expect(r.ok).toBe(true);
    expect(opts).toHaveLength(1);
    expect(Object.keys(opts[0]!)).toEqual(['stdio']);
    expect('shell' in opts[0]!).toBe(false);
    expect(calls[0]!.bin).toBe('codex');
    expect(calls[0]!.args).toEqual(['exec', '--json', '--skip-git-repo-check', '-']);
  });

  it('319-01/AC-3: a .cmd that does not match the canonical invoking line is refused as spawn-error naming the bin and CADENCE_HOST_CLI_BIN, underlying spawn never called', async () => {
    const calls: FakeCall[] = [];
    const { fileExists, readFile } = makeFakeFs({ 'C:\\tools\\codex.cmd': '@ECHO off\r\necho not a shim\r\n' });
    const { spawn: underlyingSpawn } = fakeUnderlying([{ stdout: codexJsonl() }], calls);
    const spawnImpl = makeRealSpawn({
      platform: 'win32',
      env: { Path: 'C:\\tools' },
      fileExists,
      readFile,
      spawn: underlyingSpawn,
    });

    const err = await hostCliJSON({ ...base, bin: 'codex', spawnImpl }).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'spawn-error' });
    expect((err as Error).message).toContain('"codex"');
    expect((err as Error).message).toContain('CADENCE_HOST_CLI_BIN');
    expect(calls).toHaveLength(0);
  });

  it('319-01/AC-3: a shim target that escapes its own directory (sibling-prefix escape) is refused as spawn-error, underlying spawn never called', async () => {
    const calls: FakeCall[] = [];
    const { fileExists, readFile } = makeFakeFs({
      'C:\\npm\\codex.cmd': npmCmdShim('..\\npm-evil\\payload.js'),
    });
    const { spawn: underlyingSpawn } = fakeUnderlying([{ stdout: codexJsonl() }], calls);
    const spawnImpl = makeRealSpawn({
      platform: 'win32',
      env: { Path: 'C:\\npm' },
      fileExists,
      readFile,
      spawn: underlyingSpawn,
    });

    const err = await hostCliJSON({ ...base, bin: 'codex', spawnImpl }).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'spawn-error' });
    expect((err as Error).message).toContain('"codex"');
    expect((err as Error).message).toContain('CADENCE_HOST_CLI_BIN');
    expect(calls).toHaveLength(0);
  });

  it('319-01/AC-4: the underlying spawn receives the Node command and codex argv from the configured bin, not from node.exe, and an injected spawnImpl still receives the configured bin unchanged', async () => {
    const calls: FakeCall[] = [];
    const { fileExists, readFile } = makeFakeFs({
      'C:\\npm\\codex.cmd': npmCmdShim('node_modules\\@openai\\codex\\bin\\codex.js'),
      'C:\\npm\\node.exe': 'node',
    });
    const { spawn: underlyingSpawn } = fakeUnderlying([{ stdout: codexJsonl() }], calls);
    const realSpawn = makeRealSpawn({
      platform: 'win32',
      env: { Path: 'C:\\npm' },
      fileExists,
      readFile,
      spawn: underlyingSpawn,
    });
    const { fn: spawnImpl, received } = spyOnSpawnFn(realSpawn);

    const r = await hostCliJSON({ ...base, bin: 'codex', spawnImpl });

    expect(r.ok).toBe(true);
    // `makeRealSpawn`'s returned function received the configured bin unchanged.
    expect(received).toEqual(['codex']);
    // The underlying spawn received the resolved Node command + codex family argv.
    expect(calls[0]!.bin).toBe('C:\\npm\\node.exe');
    expect(calls[0]!.args).toEqual([
      'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-',
    ]);
  });

  it('319-01/AC-4: a bare bin resolvable only via relative ".", drive-relative, or root-relative PATH segments — never a fully-qualified directory — is not resolved: rejects not-found, `fileExists` is never even asked, underlying spawn never called', async () => {
    const calls: FakeCall[] = [];
    // Every one of these keys "exists" in the fake fs — specifically the
    // exact filenames a resolver bug that let a relative/drive-relative/
    // root-relative segment through `isFullyQualifiedDir` would probe, via
    // `win32.join(dir, bin + ext)`:
    //   join('.', 'codex.exe')          -> 'codex.exe'
    //   join('C:relative', 'codex.exe') -> 'C:relative\codex.exe'
    //   join('\tools', 'codex.exe')     -> '\tools\codex.exe'
    // If `getPathDirs` ever (wrongly) let one of those three segments
    // through, `locateBinary`'s native pass would find one of these files
    // and resolve successfully — turning this test's "rejects not-found"
    // assertion into a failure. That is what makes this a real regression
    // guard rather than the previous, vacuous "nothing is on PATH at all"
    // version of this test (Path: '' — trivially not-found regardless of
    // whether the cwd-skipping logic works).
    const { fileExists, readFile } = makeFakeFs({
      'codex.exe': 'exe',
      'C:relative\\codex.exe': 'exe',
      '\\tools\\codex.exe': 'exe',
    });
    const { spawn: underlyingSpawn } = fakeUnderlying([{ stdout: codexJsonl() }], calls);
    const spawnImpl = makeRealSpawn({
      platform: 'win32',
      env: { Path: '.;C:relative;\\tools' },
      fileExists,
      readFile,
      spawn: underlyingSpawn,
    });

    const err = await hostCliJSON({ ...base, bin: 'codex', spawnImpl }).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'not-found' });
    // None of the three segments ever contributed a directory to search, so
    // the fake filesystem — despite "containing" a matching file at every
    // address a bug would have probed — was never even consulted.
    expect(fileExists).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('319-01/AC-4: every exhausted lookup form — bare name, already-suffixed bare name, nonexistent separator-bearing path — rejects not-found naming the configured bin, underlying spawn never called', async () => {
    for (const bin of ['codex', 'codex.cmd', 'C:\\tools\\codex.exe']) {
      const calls: FakeCall[] = [];
      const { fileExists, readFile } = makeFakeFs({});
      const { spawn: underlyingSpawn } = fakeUnderlying([{ stdout: codexJsonl() }], calls);
      const spawnImpl = makeRealSpawn({
        platform: 'win32',
        env: { Path: 'C:\\tools' },
        fileExists,
        readFile,
        spawn: underlyingSpawn,
      });

      const err = await hostCliJSON({ ...base, bin, spawnImpl }).catch((e: unknown) => e);

      expect(err).toMatchObject({ name: 'HostCliError', reason: 'not-found' });
      expect((err as Error).message).toContain(bin);
      expect(calls).toHaveLength(0);
    }
  });

  // Phase 319 T2 review round — AC-1 as-built amendment (2026-09-27):
  // resolution is now two-pass (native .com/.exe across all PATH directories
  // first, ignoring PATHEXT; only then .bat/.cmd by PATH x PATHEXT). These
  // two seam-level tests, with the DEFAULT bin (no `bin` option -> 'claude'),
  // reproduce the two regressions an independent review proved on Windows 11
  // against the ORIGINAL single-pass order, and prove `makeRealSpawn` no
  // longer has them now that T1's resolver implements the two-pass order.

  it('319-01/AC-1 (seam): default bin (claude) with PATHEXT=.CMD still resolves claude.exe via the native pass, ignoring PATHEXT entirely', async () => {
    const calls: FakeCall[] = [];
    const { fileExists, readFile } = makeFakeFs({ 'C:\\tools\\claude.exe': 'exe' });
    const { spawn: underlyingSpawn, opts } = fakeUnderlying([{ stdout: claudeEnvelope('{"ok":true}') }], calls);
    const spawnImpl = makeRealSpawn({
      platform: 'win32',
      env: { Path: 'C:\\tools', PATHEXT: '.CMD' },
      fileExists,
      readFile,
      spawn: underlyingSpawn,
    });

    // No `bin` passed at all — exercising the real default ('claude'),
    // matching how an unconfigured `CADENCE_HOST_CLI_BIN` behaves.
    const r = await hostCliJSON({ ...base, spawnImpl });

    expect(r.ok).toBe(true);
    expect(calls[0]!.bin).toBe('C:\\tools\\claude.exe');
    expect(calls[0]!.args).toEqual(['-p', '--output-format', 'json']);
    expect(opts).toHaveLength(1);
  });

  it('319-01/AC-4: default bin (claude) resolves to a later PATH directory\'s claude.exe, never even reading an earlier directory\'s non-canonical claude.cmd', async () => {
    const calls: FakeCall[] = [];
    const { fileExists, readFile } = makeFakeFs({
      // Dir A (earlier on PATH) has ONLY a non-canonical .cmd — if the
      // resolver's native pass didn't search every PATH directory before
      // falling back to the launcher pass, this would either refuse (a
      // real regression the review caught) or, worse, silently prefer this
      // .cmd over the real claude.exe one directory later.
      'C:\\A\\claude.cmd': 'this is not a canonical npm cmd-shim at all',
      'C:\\B\\claude.exe': 'exe',
    });
    const { spawn: underlyingSpawn } = fakeUnderlying([{ stdout: claudeEnvelope('{"ok":true}') }], calls);
    const spawnImpl = makeRealSpawn({
      platform: 'win32',
      env: { Path: 'C:\\A;C:\\B' },
      fileExists,
      readFile,
      spawn: underlyingSpawn,
    });

    const r = await hostCliJSON({ ...base, spawnImpl });

    expect(r.ok).toBe(true);
    expect(calls[0]!.bin).toBe('C:\\B\\claude.exe');
    expect(calls[0]!.args).toEqual(['-p', '--output-format', 'json']);
    // `readFile` is only ever called to parse a `.cmd`/`.bat` hit — proving
    // dir A's claude.cmd was never even opened, let alone refused.
    expect(readFile).not.toHaveBeenCalled();
  });

  // AC-3 seam-level coverage for the two refusal shapes not yet exercised
  // through the real `hostCliJSON` seam above (the resolver-level cases live
  // in win32-command.test.ts; these confirm the seam maps them the same way).

  it('319-01/AC-3 (seam): a shim target containing an unexpanded "%" is refused as spawn-error naming the bin and CADENCE_HOST_CLI_BIN, underlying spawn never called', async () => {
    const calls: FakeCall[] = [];
    const { fileExists, readFile } = makeFakeFs({
      'C:\\npm\\codex.cmd': npmCmdShim('%VARIABLE%\\codex.js'),
    });
    const { spawn: underlyingSpawn } = fakeUnderlying([{ stdout: codexJsonl() }], calls);
    const spawnImpl = makeRealSpawn({
      platform: 'win32',
      env: { Path: 'C:\\npm' },
      fileExists,
      readFile,
      spawn: underlyingSpawn,
    });

    const err = await hostCliJSON({ ...base, bin: 'codex', spawnImpl }).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'spawn-error' });
    expect((err as Error).message).toContain('"codex"');
    expect((err as Error).message).toContain('CADENCE_HOST_CLI_BIN');
    expect(calls).toHaveLength(0);
  });

  it('319-01/AC-3 (seam): a shim target that is neither JS nor a native executable (e.g. .ps1) is refused as spawn-error naming the bin and CADENCE_HOST_CLI_BIN, underlying spawn never called', async () => {
    const calls: FakeCall[] = [];
    const { fileExists, readFile } = makeFakeFs({
      'C:\\npm\\codex.cmd': npmCmdShim('codex.ps1'),
    });
    const { spawn: underlyingSpawn } = fakeUnderlying([{ stdout: codexJsonl() }], calls);
    const spawnImpl = makeRealSpawn({
      platform: 'win32',
      env: { Path: 'C:\\npm' },
      fileExists,
      readFile,
      spawn: underlyingSpawn,
    });

    const err = await hostCliJSON({ ...base, bin: 'codex', spawnImpl }).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'spawn-error' });
    expect((err as Error).message).toContain('"codex"');
    expect((err as Error).message).toContain('CADENCE_HOST_CLI_BIN');
    expect(calls).toHaveLength(0);
  });

  it('319-01: makeRealSpawn reads env/platform facts at call time, not at construction time — a process.env change after construction is honored', async () => {
    const calls: FakeCall[] = [];
    const { fileExists, readFile } = makeFakeFs({ 'C:\\latecall\\claude.exe': 'exe' });
    const { spawn: underlyingSpawn } = fakeUnderlying([{ stdout: claudeEnvelope('{"ok":true}') }], calls);
    // Built with NO `env` override at all — every call reads `process.env`
    // fresh, per `makeRealSpawn`'s doc comment.
    const spawnImpl = makeRealSpawn({
      platform: 'win32',
      fileExists,
      readFile,
      execPath: 'C:\\node-install\\node.exe',
      spawn: underlyingSpawn,
    });

    // Save the real keys under their EXISTING casing on this platform (win32
    // env vars are case-insensitive, but `process.env`'s own key casing is
    // whatever the OS handed Node — commonly "Path"/"PATHEXT" here) so the
    // restore in `finally` puts things back exactly as found, not just to
    // some assumed casing.
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'Path';
    const pathextKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'pathext') ?? 'PATHEXT';
    const originalPath = process.env[pathKey];
    const originalPathext = process.env[pathextKey];
    try {
      // Mutate AFTER construction — this is the whole point of the test.
      process.env[pathKey] = 'C:\\latecall';
      process.env[pathextKey] = '.CMD';

      const r = await hostCliJSON({ ...base, bin: 'claude', spawnImpl });

      expect(r.ok).toBe(true);
      expect(calls[0]!.bin).toBe('C:\\latecall\\claude.exe');
    } finally {
      if (originalPath === undefined) {
        delete process.env[pathKey];
      } else {
        process.env[pathKey] = originalPath;
      }
      if (originalPathext === undefined) {
        delete process.env[pathextKey];
      } else {
        process.env[pathextKey] = originalPathext;
      }
    }
  });
});

describe('makeRealSpawn — real process, win32 only (extra evidence)', () => {
  // Phase 319 T2 — the bare-name regression path this whole phase exists to
  // fix, exercised end-to-end with the REAL filesystem and the REAL
  // `node:child_process.spawn`: an npm-style `codex.cmd` sitting on a real
  // win32 PATH, resolved and launched with no shell. Gated to win32 only —
  // `it.runIf` skips it elsewhere, so this file still passes on Linux/macOS
  // CI; the dev box this was authored on is Windows, so it runs for real
  // here rather than merely type-checking.
  it.runIf(process.platform === 'win32')(
    '319-01/AC-4 (extra evidence, real fs + real spawn): a real npm-style codex.cmd on a real win32 PATH resolves through Node and runs to completion',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'cadence-win32-hostcli-'));
      try {
        const shimText = [
          '@ECHO off',
          'GOTO start',
          ':find_dp0',
          'SET dp0=%~dp0',
          'EXIT /b',
          ':start',
          'SETLOCAL',
          'CALL :find_dp0',
          '',
          'IF EXIST "%dp0%\\node.exe" (',
          '  SET "_prog=%dp0%\\node.exe"',
          ') ELSE (',
          '  SET "_prog=node"',
          '  SET PATHEXT=%PATHEXT:;.JS;=;%',
          ')',
          '',
          'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\fake\\codex.js" %*',
        ].join('\r\n');
        writeFileSync(join(dir, 'codex.cmd'), shimText);
        mkdirSync(join(dir, 'node_modules', 'fake'), { recursive: true });
        writeFileSync(
          join(dir, 'node_modules', 'fake', 'codex.js'),
          [
            "let data = '';",
            "process.stdin.on('data', (chunk) => { data += chunk; });",
            "process.stdin.on('end', () => {",
            '  process.stdout.write(JSON.stringify({ type: \'item.completed\', item: { type: \'agent_message\', text: \'{"ok":true}\' } }) + \'\\n\');',
            '  process.exit(0);',
            '});',
          ].join('\n'),
        );

        // No `node.exe` sibling in `dir` — the resolver must fall back to
        // `process.execPath` (the real Node running this test).
        const spawnImpl = makeRealSpawn({ env: { Path: dir, PATHEXT: '.CMD' } });

        const r = await hostCliJSON({
          system: 's',
          user: 'u',
          schema: Schema,
          env: {},
          bin: 'codex',
          spawnImpl,
          timeoutMs: 15_000,
        });

        expect(r.ok).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      }
    },
    30_000,
  );
});
