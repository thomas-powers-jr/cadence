import { describe, it, expect } from 'vitest';
import { z } from 'zod/v4';
import {
  hostCliJSON,
  hostCliIsolationFlags,
  inferFamily,
  HostCliError,
  makeRealSpawn,
  type SpawnFn,
  type SpawnedProcessLike,
  type UnderlyingSpawnFn,
} from '../../src/verify/host-cli-client.js';

// Phase 344 T1 - the isolation flags the host-cli client passes to the review
// agent's CLI, the client-level opt-out, and the hint added when a CLI rejects
// one of the flags. No real `claude`/`codex` binary is ever invoked: every
// test injects a fake spawn.

const Schema = z.object({ ok: z.boolean() });

interface FakeCall {
  bin: string;
  args: string[];
  stdin: string;
  stdinEnded: boolean;
}

interface FakeResponse {
  stdout?: string;
  stderr?: string;
  code?: number;
}

/** Records each spawn call and replays the scripted responses in order (the last one repeats). */
function fakeSpawn(responses: FakeResponse[], calls: FakeCall[]): SpawnFn {
  let i = 0;
  return (bin, args) => {
    const call: FakeCall = { bin, args, stdin: '', stdinEnded: false };
    calls.push(call);
    const resp = responses[Math.min(i++, responses.length - 1)] ?? {};

    const stdoutListeners: Array<(chunk: Buffer) => void> = [];
    const stderrListeners: Array<(chunk: Buffer) => void> = [];
    let closeListener: ((code: number | null) => void) | undefined;

    const proc: SpawnedProcessLike = {
      stdin: {
        write: (chunk: string | Buffer) => {
          call.stdin += chunk.toString();
          return true;
        },
        end: () => {
          call.stdinEnded = true;
        },
        on: () => proc.stdin as NodeJS.WritableStream,
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
        if (event === 'close') closeListener = cb as (code: number | null) => void;
        return proc;
      },
      kill: () => true,
    };

    queueMicrotask(() => {
      if (resp.stdout !== undefined) stdoutListeners.forEach((l) => l(Buffer.from(resp.stdout as string)));
      if (resp.stderr !== undefined) stderrListeners.forEach((l) => l(Buffer.from(resp.stderr as string)));
      closeListener?.(resp.code ?? 0);
    });

    return proc;
  };
}

const claudeOk = (): FakeResponse => ({ stdout: JSON.stringify({ is_error: false, result: '{"ok":true}' }) });
const codexOk = (): FakeResponse => ({
  stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"ok":true}' } }),
});

// `env: {}` keeps the claude family clear of the self-invocation guard whatever
// the process running this suite exports (a Claude Code session sets CLAUDECODE=1).
const base = { system: 's', user: 'u', schema: Schema, env: {} };
/** `flattenMessages`' output for `base`: what the child must receive on stdin. */
const PROMPT = '[SYSTEM]\ns\n\n[USER]\nu';

const HINT = (flag: string) =>
  ` -- this CLI may not accept the isolation flag "${flag}"; update it, or set verification.hostCliIsolation to "off"`;

/** Runs one call and returns the argv the fake spawn received. */
async function argvFor(
  o: { bin?: string; model?: string; isolation?: 'on' | 'off' },
  ok: FakeResponse,
): Promise<{ args: string[]; calls: FakeCall[] }> {
  const calls: FakeCall[] = [];
  const r = await hostCliJSON({ ...base, ...o, spawnImpl: fakeSpawn([ok], calls) });
  expect(r.ok).toBe(true);
  expect(calls).toHaveLength(1);
  return { args: calls[0]!.args, calls };
}

/** Runs one failing call and returns the rejection plus the recorded spawn calls. */
async function rejectionFor(
  o: { bin?: string; isolation?: 'on' | 'off' },
  resp: FakeResponse,
): Promise<{ err: unknown; calls: FakeCall[] }> {
  const calls: FakeCall[] = [];
  const err = await hostCliJSON({ ...base, ...o, spawnImpl: fakeSpawn([resp], calls) }).catch((e: unknown) => e);
  return { err, calls };
}

describe('hostCliIsolationFlags', () => {
  it('344-01/AC-1: the codex family gets exactly --ignore-user-config', () => {
    expect(hostCliIsolationFlags('codex')).toEqual(['--ignore-user-config']);
  });

  it('344-01/AC-2: the claude family gets exactly --setting-sources project --strict-mcp-config', () => {
    expect(hostCliIsolationFlags('claude')).toEqual(['--setting-sources', 'project', '--strict-mcp-config']);
  });

  it('344-01/AC-1: returns a fresh array each call, so mutating one result does not change the next', () => {
    const codex = hostCliIsolationFlags('codex');
    codex.push('--mutated');
    codex[0] = '--clobbered';
    expect(hostCliIsolationFlags('codex')).toEqual(['--ignore-user-config']);
    expect(hostCliIsolationFlags('codex')).not.toBe(hostCliIsolationFlags('codex'));

    const claude = hostCliIsolationFlags('claude');
    claude.length = 0;
    expect(hostCliIsolationFlags('claude')).toEqual(['--setting-sources', 'project', '--strict-mcp-config']);
    expect(hostCliIsolationFlags('claude')).not.toBe(hostCliIsolationFlags('claude'));
  });
});

describe('inferFamily (exported)', () => {
  it('344-01/AC-2: a basename containing "codex" is the codex family, case-insensitively and through a path', () => {
    expect(inferFamily('codex')).toBe('codex');
    expect(inferFamily('/usr/local/bin/codex')).toBe('codex');
    expect(inferFamily('Codex.exe')).toBe('codex');
  });

  it('344-01/AC-2: any other binary name is the claude family', () => {
    expect(inferFamily('claude')).toBe('claude');
    expect(inferFamily('my-reviewer')).toBe('claude');
  });
});

describe('hostCliJSON - isolation on (the default)', () => {
  it('344-01/AC-1: codex with no model is spawned with --ignore-user-config, isolation absent', async () => {
    const { args, calls } = await argvFor({ bin: 'codex' }, codexOk());
    expect(calls[0]!.bin).toBe('codex');
    expect(args).toEqual(['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '-']);
  });

  it('344-01/AC-1: codex with model gpt-5 is spawned with --ignore-user-config before -m, isolation absent', async () => {
    const { args } = await argvFor({ bin: 'codex', model: 'gpt-5' }, codexOk());
    expect(args).toEqual(['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '-m', 'gpt-5', '-']);
  });

  it('344-01/AC-1: an explicit isolation "on" gives codex the same two argv as an absent one', async () => {
    const noModel = await argvFor({ bin: 'codex', isolation: 'on' }, codexOk());
    expect(noModel.args).toEqual(['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '-']);
    const withModel = await argvFor({ bin: 'codex', model: 'gpt-5', isolation: 'on' }, codexOk());
    expect(withModel.args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '-m',
      'gpt-5',
      '-',
    ]);
  });

  it('344-01/AC-1: the prompt is still written to codex stdin and stdin is ended, with the isolation flag in argv', async () => {
    for (const isolation of [undefined, 'on'] as const) {
      const { args, calls } = await argvFor({ bin: 'codex', ...(isolation ? { isolation } : {}) }, codexOk());
      expect(args).toContain('--ignore-user-config');
      expect(calls[0]!.stdin).toBe(PROMPT);
      expect(calls[0]!.stdinEnded).toBe(true);
      // The prompt is on stdin only: no argv element carries it.
      expect(args.some((a) => a.includes('[USER]'))).toBe(false);
    }
  });

  it('344-01/AC-1: through makeRealSpawn on linux the spawn options are exactly { stdio: [pipe,pipe,pipe] } with no env key', async () => {
    const calls: FakeCall[] = [];
    const opts: unknown[] = [];
    const inner = fakeSpawn([codexOk()], calls);
    const underlying: UnderlyingSpawnFn = (command, args, options) => {
      opts.push(options);
      return inner(command, args);
    };
    const spawnImpl = makeRealSpawn({ platform: 'linux', spawn: underlying });

    const r = await hostCliJSON({ ...base, bin: 'codex', spawnImpl });

    expect(r.ok).toBe(true);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toEqual({ stdio: ['pipe', 'pipe', 'pipe'] });
    expect(Object.keys(opts[0] as object)).toEqual(['stdio']);
    expect('env' in (opts[0] as object)).toBe(false);
    expect(calls[0]!.bin).toBe('codex');
    expect(calls[0]!.args).toEqual(['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '-']);
    expect(calls[0]!.stdin).toBe(PROMPT);
    expect(calls[0]!.stdinEnded).toBe(true);
  });

  it('344-01/AC-2: claude with no model is spawned with --setting-sources project --strict-mcp-config', async () => {
    const { args, calls } = await argvFor({ bin: 'claude' }, claudeOk());
    expect(calls[0]!.bin).toBe('claude');
    expect(args).toEqual(['-p', '--output-format', 'json', '--setting-sources', 'project', '--strict-mcp-config']);
  });

  it('344-01/AC-2: claude with model opus is spawned with the isolation flags before --model', async () => {
    const { args } = await argvFor({ bin: 'claude', model: 'opus' }, claudeOk());
    expect(args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--setting-sources',
      'project',
      '--strict-mcp-config',
      '--model',
      'opus',
    ]);
  });

  it('344-01/AC-2: an explicit isolation "on" gives claude the same two argv as an absent one', async () => {
    const noModel = await argvFor({ bin: 'claude', isolation: 'on' }, claudeOk());
    expect(noModel.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--setting-sources',
      'project',
      '--strict-mcp-config',
    ]);
    const withModel = await argvFor({ bin: 'claude', model: 'opus', isolation: 'on' }, claudeOk());
    expect(withModel.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--setting-sources',
      'project',
      '--strict-mcp-config',
      '--model',
      'opus',
    ]);
  });

  it('344-01/AC-2: a binary named my-reviewer (no "codex" in its basename) gets the same claude argv, bare and through a path', async () => {
    for (const bin of ['my-reviewer', '/opt/bin/my-reviewer']) {
      const noModel = await argvFor({ bin }, claudeOk());
      expect(noModel.calls[0]!.bin).toBe(bin);
      expect(noModel.args).toEqual([
        '-p',
        '--output-format',
        'json',
        '--setting-sources',
        'project',
        '--strict-mcp-config',
      ]);
      const withModel = await argvFor({ bin, model: 'opus' }, claudeOk());
      expect(withModel.args).toEqual([
        '-p',
        '--output-format',
        'json',
        '--setting-sources',
        'project',
        '--strict-mcp-config',
        '--model',
        'opus',
      ]);
    }
  });

  it('344-01/AC-2: the default binary (no bin option) is claude and gets the claude isolation argv', async () => {
    const { args, calls } = await argvFor({}, claudeOk());
    expect(calls[0]!.bin).toBe('claude');
    expect(args).toEqual(['-p', '--output-format', 'json', '--setting-sources', 'project', '--strict-mcp-config']);
  });

  it('344-01/AC-2: the argv on each family is the pre-phase argv with exactly hostCliIsolationFlags(inferFamily(bin)) inserted', async () => {
    const codex = await argvFor({ bin: 'codex' }, codexOk());
    expect(codex.args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      ...hostCliIsolationFlags(inferFamily('codex')),
      '-',
    ]);
    const claude = await argvFor({ bin: 'my-reviewer' }, claudeOk());
    expect(claude.args).toEqual(['-p', '--output-format', 'json', ...hostCliIsolationFlags(inferFamily('my-reviewer'))]);
  });
});

describe('hostCliJSON - isolation off', () => {
  it('344-01/AC-3: isolation "off" gives codex exactly the pre-phase argv, with and without a model', async () => {
    const noModel = await argvFor({ bin: 'codex', isolation: 'off' }, codexOk());
    expect(noModel.args).toEqual(['exec', '--json', '--skip-git-repo-check', '-']);
    const withModel = await argvFor({ bin: 'codex', model: 'gpt-5', isolation: 'off' }, codexOk());
    expect(withModel.args).toEqual(['exec', '--json', '--skip-git-repo-check', '-m', 'gpt-5', '-']);
  });

  it('344-01/AC-3: isolation "off" gives claude exactly the pre-phase argv, with and without a model', async () => {
    const noModel = await argvFor({ bin: 'claude', isolation: 'off' }, claudeOk());
    expect(noModel.args).toEqual(['-p', '--output-format', 'json']);
    const withModel = await argvFor({ bin: 'claude', model: 'opus', isolation: 'off' }, claudeOk());
    expect(withModel.args).toEqual(['-p', '--output-format', 'json', '--model', 'opus']);
  });

  it('344-01/AC-3: isolation "off" still writes the prompt to stdin and ends it', async () => {
    const { calls } = await argvFor({ bin: 'codex', isolation: 'off' }, codexOk());
    expect(calls[0]!.stdin).toBe(PROMPT);
    expect(calls[0]!.stdinEnded).toBe(true);
  });
});

describe('hostCliJSON - a CLI that rejects an isolation flag', () => {
  it('344-01/AC-4: codex exiting 2 over --ignore-user-config rejects nonzero-exit with the original text and the hint, spawned once', async () => {
    const stderr = "error: unexpected argument '--ignore-user-config' found";
    const { err, calls } = await rejectionFor({ bin: 'codex' }, { code: 2, stderr });

    expect(err).toBeInstanceOf(HostCliError);
    expect(err).toMatchObject({ name: 'HostCliError', reason: 'nonzero-exit' });
    const message = (err as Error).message;
    expect(message).toContain('exited with code 2');
    expect(message).toContain(stderr);
    expect(message).toBe(`host-cli provider: "codex" exited with code 2: ${stderr}${HINT('--ignore-user-config')}`);
    expect(
      message.endsWith(
        ' -- this CLI may not accept the isolation flag "--ignore-user-config"; update it, or set verification.hostCliIsolation to "off"',
      ),
    ).toBe(true);
    // No retry, with or without the flag.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '-']);
  });

  it('344-01/AC-4: claude exiting 1 over --setting-sources rejects nonzero-exit with the original text and the hint, spawned once', async () => {
    const stderr = "error: unknown option '--setting-sources'";
    const { err, calls } = await rejectionFor({ bin: 'claude' }, { code: 1, stderr });

    expect(err).toBeInstanceOf(HostCliError);
    expect(err).toMatchObject({ name: 'HostCliError', reason: 'nonzero-exit' });
    const message = (err as Error).message;
    expect(message).toContain('exited with code 1');
    expect(message).toContain(stderr);
    expect(message).toBe(`host-cli provider: "claude" exited with code 1: ${stderr}${HINT('--setting-sources')}`);
    expect(
      message.endsWith(
        ' -- this CLI may not accept the isolation flag "--setting-sources"; update it, or set verification.hostCliIsolation to "off"',
      ),
    ).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('344-01/AC-4: claude stderr naming only --strict-mcp-config gets the hint naming that flag, spawned once', async () => {
    const { err, calls } = await rejectionFor(
      { bin: 'claude' },
      { code: 1, stderr: "error: unknown option '--strict-mcp-config'" },
    );

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'nonzero-exit' });
    expect((err as Error).message.endsWith(HINT('--strict-mcp-config'))).toBe(true);
    expect((err as Error).message).not.toContain('"--setting-sources"');
    expect(calls).toHaveLength(1);
  });

  it('344-01/AC-4: claude stderr naming both flags gets the hint naming --setting-sources, the first in hostCliIsolationFlags order, spawned once', async () => {
    const { err, calls } = await rejectionFor(
      { bin: 'claude' },
      { code: 1, stderr: 'error: unknown options --strict-mcp-config, --setting-sources' },
    );

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'nonzero-exit' });
    expect((err as Error).message.endsWith(HINT('--setting-sources'))).toBe(true);
    expect((err as Error).message).not.toContain('isolation flag "--strict-mcp-config"');
    expect(calls).toHaveLength(1);
  });

  it('344-01/AC-4: a nonzero-exit whose stderr is "not authenticated" carries no hint, for either family, spawned once', async () => {
    for (const bin of ['codex', 'claude']) {
      const { err, calls } = await rejectionFor({ bin }, { code: 1, stderr: 'not authenticated' });

      expect(err).toMatchObject({ name: 'HostCliError', reason: 'nonzero-exit' });
      expect((err as Error).message).toBe(`host-cli provider: "${bin}" exited with code 1: not authenticated`);
      expect((err as Error).message).not.toContain('isolation flag');
      expect(calls).toHaveLength(1);
    }
  });

  it('344-01/AC-4: a claude nonzero-exit whose stderr is "no project found" carries no hint: the value "project" never counts, spawned once', async () => {
    const { err, calls } = await rejectionFor({ bin: 'claude' }, { code: 1, stderr: 'no project found' });

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'nonzero-exit' });
    expect((err as Error).message).toBe('host-cli provider: "claude" exited with code 1: no project found');
    expect((err as Error).message).not.toContain('isolation flag');
    expect(calls).toHaveLength(1);
  });

  it('344-01/AC-4: with isolation off no hint is added even when stderr names an isolation flag, spawned once', async () => {
    const codexStderr = "error: unexpected argument '--ignore-user-config' found";
    const codex = await rejectionFor({ bin: 'codex', isolation: 'off' }, { code: 2, stderr: codexStderr });
    expect(codex.err).toMatchObject({ name: 'HostCliError', reason: 'nonzero-exit' });
    expect((codex.err as Error).message).toBe(`host-cli provider: "codex" exited with code 2: ${codexStderr}`);
    expect((codex.err as Error).message).not.toContain('isolation flag');
    expect(codex.calls).toHaveLength(1);
    expect(codex.calls[0]!.args).toEqual(['exec', '--json', '--skip-git-repo-check', '-']);

    const claude = await rejectionFor(
      { bin: 'claude', isolation: 'off' },
      { code: 1, stderr: "error: unknown option '--setting-sources'" },
    );
    expect(claude.err).toMatchObject({ name: 'HostCliError', reason: 'nonzero-exit' });
    expect((claude.err as Error).message).not.toContain('isolation flag');
    expect(claude.calls).toHaveLength(1);
  });

  it('344-01/AC-4: a codex stderr naming a claude-only flag carries no hint: only a flag that was passed counts', async () => {
    const { err, calls } = await rejectionFor(
      { bin: 'codex' },
      { code: 2, stderr: "error: unexpected argument '--setting-sources' found" },
    );

    expect(err).toMatchObject({ name: 'HostCliError', reason: 'nonzero-exit' });
    expect((err as Error).message).not.toContain('isolation flag');
    expect(calls).toHaveLength(1);
  });

  it('344-01/AC-4: a successful exit whose stderr names an isolation flag is not an error at all', async () => {
    const calls: FakeCall[] = [];
    const r = await hostCliJSON({
      ...base,
      bin: 'codex',
      spawnImpl: fakeSpawn([{ ...codexOk(), stderr: 'warning: --ignore-user-config is in effect' }], calls),
    });

    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
