import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hostCliBin,
  hostCliBinaryResolves,
  type HostCliPresenceFacts,
} from '../../src/verify/host-cli-presence.js';

/**
 * Phase 337 T1 — injected facts only. A fake filesystem maps a path to a
 * kind; `isRunnableFile` is true only for kind 'file' (a runnable regular
 * file), false for a directory, a non-runnable file, or an absent path.
 *
 * CWD REPRESENTATION (contract T2 implements to): an empty PATH segment
 * means "the process cwd", and the probe expresses that as the BARE bin name
 * (`codex`), exactly what libuv execs and what a real `statSync('codex')`
 * resolves against the cwd. It is never `./codex` and never joined to an
 * absolute cwd (the facts carry no cwd). A bin that already contains `/` is
 * passed to `isRunnableFile` exactly as given.
 */
type Kind = 'file' | 'dir' | 'nonexec';

function posixFacts(opts: {
  env?: NodeJS.ProcessEnv;
  fs?: Record<string, Kind>;
  throwing?: boolean;
}): HostCliPresenceFacts & { isRunnableFile: ReturnType<typeof vi.fn> } {
  const fs = opts.fs ?? {};
  const isRunnableFile = vi.fn((p: string) => {
    if (opts.throwing) throw new Error('boom: fake EIO');
    return fs[p] === 'file';
  });
  return {
    platform: 'linux',
    env: opts.env ?? {},
    isRunnableFile,
    readFile: () => {
      throw new Error('posix probe must never read file contents');
    },
    execPath: '/usr/local/bin/node',
  };
}

function probed(facts: { isRunnableFile: ReturnType<typeof vi.fn> }): string[] {
  return facts.isRunnableFile.mock.calls.map((c) => c[0] as string);
}

/** win32 fake fs: lowercase-keyed, like win32's case-insensitive filesystem. */
function winFacts(opts: {
  env?: NodeJS.ProcessEnv;
  files?: Record<string, string>;
  throwing?: boolean;
}): HostCliPresenceFacts {
  const map = new Map<string, string>();
  for (const [p, c] of Object.entries(opts.files ?? {})) map.set(p.toLowerCase(), c);
  return {
    platform: 'win32',
    env: opts.env ?? {},
    isRunnableFile: (p: string) => {
      if (opts.throwing) throw new Error('boom: fake EIO');
      return map.has(p.toLowerCase());
    },
    readFile: (p: string) => {
      const c = map.get(p.toLowerCase());
      if (c === undefined) throw new Error(`fake fs: no such file ${p}`);
      return c;
    },
    execPath: 'C:\\node-install\\node.exe',
  };
}

/** The canonical npm cmd-shim (mirrors tests/verify/win32-command.test.ts). */
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

describe('337-01/AC-1: hostCliBinaryResolves on POSIX', () => {
  it('337-01/AC-1: a bare name resolves when a later PATH dir holds a runnable file', () => {
    const facts = posixFacts({
      env: { PATH: '/opt/a:/opt/b:/opt/c' },
      fs: { '/opt/c/codex': 'file' },
    });
    expect(hostCliBinaryResolves('codex', facts)).toBe(true);
    expect(probed(facts)).toEqual(['/opt/a/codex', '/opt/b/codex', '/opt/c/codex']);
  });

  it('337-01/AC-1: a bare name with no match anywhere on PATH is a miss', () => {
    const facts = posixFacts({ env: { PATH: '/opt/a:/opt/b' }, fs: {} });
    expect(hostCliBinaryResolves('codex', facts)).toBe(false);
  });

  it('337-01/AC-1: a directory and a non-runnable entry earlier on PATH are skipped for a later runnable file', () => {
    const facts = posixFacts({
      env: { PATH: '/opt/a:/opt/b:/opt/c' },
      fs: { '/opt/a/codex': 'dir', '/opt/b/codex': 'nonexec', '/opt/c/codex': 'file' },
    });
    expect(hostCliBinaryResolves('codex', facts)).toBe(true);
    expect(probed(facts)).toEqual(['/opt/a/codex', '/opt/b/codex', '/opt/c/codex']);
  });

  it('337-01/AC-1: a PATH holding only a directory and a non-runnable entry resolves false', () => {
    const facts = posixFacts({
      env: { PATH: '/opt/a:/opt/b' },
      fs: { '/opt/a/codex': 'dir', '/opt/b/codex': 'nonexec' },
    });
    expect(hostCliBinaryResolves('codex', facts)).toBe(false);
  });

  it('337-01/AC-1: an empty LEADING PATH segment means the cwd (probed as the bare name, before later dirs)', () => {
    const facts = posixFacts({ env: { PATH: ':/opt/a' }, fs: { codex: 'file' } });
    expect(hostCliBinaryResolves('codex', facts)).toBe(true);
    expect(probed(facts)).toEqual(['codex']);
  });

  it('337-01/AC-1: an empty MIDDLE PATH segment means the cwd (probed between its neighbours)', () => {
    const facts = posixFacts({ env: { PATH: '/opt/a::/opt/b' }, fs: { codex: 'file' } });
    expect(hostCliBinaryResolves('codex', facts)).toBe(true);
    expect(probed(facts)).toEqual(['/opt/a/codex', 'codex']);
  });

  it('337-01/AC-1: an empty TRAILING PATH segment means the cwd (probed last)', () => {
    const facts = posixFacts({ env: { PATH: '/opt/a:/opt/b:' }, fs: { codex: 'file' } });
    expect(hostCliBinaryResolves('codex', facts)).toBe(true);
    expect(probed(facts)).toEqual(['/opt/a/codex', '/opt/b/codex', 'codex']);
  });

  it('337-01/AC-1: an unset PATH searches exactly /usr/bin then /bin', () => {
    const facts = posixFacts({ env: {}, fs: { '/bin/codex': 'file' } });
    expect(hostCliBinaryResolves('codex', facts)).toBe(true);
    expect(probed(facts)).toEqual(['/usr/bin/codex', '/bin/codex']);

    const miss = posixFacts({ env: {}, fs: {} });
    expect(hostCliBinaryResolves('codex', miss)).toBe(false);
    expect(probed(miss)).toEqual(['/usr/bin/codex', '/bin/codex']);
  });

  it('337-01/AC-1: an empty-string PATH searches only the cwd (bare name), not the unset-PATH defaults', () => {
    const facts = posixFacts({ env: { PATH: '' }, fs: { '/usr/bin/codex': 'file' } });
    expect(hostCliBinaryResolves('codex', facts)).toBe(false);
    expect(probed(facts)).toEqual(['codex']);

    const hit = posixFacts({ env: { PATH: '' }, fs: { codex: 'file' } });
    expect(hostCliBinaryResolves('codex', hit)).toBe(true);
    expect(probed(hit)).toEqual(['codex']);
  });

  it('337-01/AC-1: an absolute bin is checked as given and never joined to a PATH dir', () => {
    const facts = posixFacts({
      env: { PATH: '/opt/a' },
      fs: { '/abs/bin/codex': 'file', '/opt/a/abs/bin/codex': 'file', '/opt/a//abs/bin/codex': 'file' },
    });
    expect(hostCliBinaryResolves('/abs/bin/codex', facts)).toBe(true);
    expect(probed(facts)).toEqual(['/abs/bin/codex']);

    // Decoys at both spellings a PATH-searching mutation could probe
    // (normalized join and libuv-style concatenation), so the boolean result
    // itself catches it, not only the probe-order assertion.
    const miss = posixFacts({
      env: { PATH: '/opt/a' },
      fs: { '/opt/a/codex': 'file', '/opt/a/abs/bin/codex': 'file', '/opt/a//abs/bin/codex': 'file' },
    });
    expect(hostCliBinaryResolves('/abs/bin/codex', miss)).toBe(false);
    expect(probed(miss)).toEqual(['/abs/bin/codex']);
  });

  it('337-01/AC-1: a ./relative bin is checked as given and never joined to a PATH dir', () => {
    const facts = posixFacts({
      env: { PATH: '/opt/a' },
      fs: { './rel/codex': 'file', '/opt/a/rel/codex': 'file' },
    });
    expect(hostCliBinaryResolves('./rel/codex', facts)).toBe(true);
    expect(probed(facts)).toEqual(['./rel/codex']);

    const miss = posixFacts({
      env: { PATH: '/opt/a' },
      fs: { '/opt/a/rel/codex': 'file', '/opt/a/./rel/codex': 'file' },
    });
    expect(hostCliBinaryResolves('./rel/codex', miss)).toBe(false);
    expect(probed(miss)).toEqual(['./rel/codex']);
  });

  it('337-01/AC-1: an isRunnableFile that throws makes the answer false instead of throwing', () => {
    const facts = posixFacts({ env: { PATH: '/opt/a' }, throwing: true });
    expect(() => hostCliBinaryResolves('codex', facts)).not.toThrow();
    expect(hostCliBinaryResolves('codex', facts)).toBe(false);
    expect(hostCliBinaryResolves('/abs/codex', facts)).toBe(false);
  });
});

describe('337-01/AC-1: hostCliBinaryResolves on win32 (delegates to the spawn resolver)', () => {
  it('337-01/AC-1: a native claude.exe on PATH resolves true', () => {
    const facts = winFacts({
      env: { Path: 'C:\\tools' },
      files: { 'C:\\tools\\claude.exe': 'binary' },
    });
    expect(hostCliBinaryResolves('claude', facts)).toBe(true);
  });

  it('337-01/AC-1: a canonical npm codex.cmd shim on PATH resolves true', () => {
    const facts = winFacts({
      env: { Path: 'C:\\npm' },
      files: {
        'C:\\npm\\codex.cmd': npmCmdShim('node_modules\\@openai\\codex\\bin\\codex.js'),
        'C:\\npm\\node.exe': 'node',
      },
    });
    expect(hostCliBinaryResolves('codex', facts)).toBe(true);
  });

  it('337-01/AC-1: a non-canonical shim with no native binary is refused and resolves false', () => {
    const facts = winFacts({
      env: { Path: 'C:\\only-launcher' },
      files: {
        'C:\\only-launcher\\claude.cmd': ['@ECHO off', 'node "%dp0%\\claude.js" %*'].join('\r\n'),
      },
    });
    expect(hostCliBinaryResolves('claude', facts)).toBe(false);
  });

  it('337-01/AC-1: an escaping shim target with no native binary resolves false', () => {
    const facts = winFacts({
      env: { Path: 'C:\\pnpm-global' },
      files: {
        'C:\\pnpm-global\\claude.cmd': npmCmdShim('..\\pnpm-escape\\claude.js'),
        'C:\\pnpm-escape\\claude.js': 'escaping target',
      },
    });
    expect(hostCliBinaryResolves('claude', facts)).toBe(false);
  });

  it('337-01/AC-1: a binary missing from PATH resolves false', () => {
    const facts = winFacts({ env: { Path: 'C:\\tools' }, files: {} });
    expect(hostCliBinaryResolves('codex', facts)).toBe(false);
  });

  it('337-01/AC-1: an explicit C:\\tools\\codex.cmd path with canonical shim content resolves true', () => {
    const facts = winFacts({
      env: { Path: 'C:\\unrelated' },
      files: {
        'C:\\tools\\codex.cmd': npmCmdShim('node_modules\\@openai\\codex\\bin\\codex.js'),
        'C:\\tools\\node.exe': 'node',
      },
    });
    expect(hostCliBinaryResolves('C:\\tools\\codex.cmd', facts)).toBe(true);
  });

  it('337-01/AC-1: a throwing facts check on win32 makes the answer false instead of throwing', () => {
    const facts = winFacts({ env: { Path: 'C:\\tools' }, throwing: true });
    expect(() => hostCliBinaryResolves('codex', facts)).not.toThrow();
    expect(hostCliBinaryResolves('codex', facts)).toBe(false);
  });
});

describe('337-01/AC-1: hostCliBin precedence (env, then .env, then claude)', () => {
  const dirs: string[] = [];
  async function tempCwd(dotenv?: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'cadence-hostclibin-'));
    dirs.push(dir);
    if (dotenv !== undefined) await writeFile(join(dir, '.env'), dotenv, 'utf8');
    return dir;
  }
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('337-01/AC-1: the env value wins over a .env value', async () => {
    const cwd = await tempCwd('CADENCE_HOST_CLI_BIN=from-dotenv\n');
    expect(hostCliBin({ CADENCE_HOST_CLI_BIN: 'from-env' }, cwd)).toBe('from-env');
  });

  it('337-01/AC-1: a .env value wins over the claude default when env is unset', async () => {
    const cwd = await tempCwd('# comment\nCADENCE_HOST_CLI_BIN="codex"\n');
    expect(hostCliBin({}, cwd)).toBe('codex');
  });

  it('337-01/AC-1: an empty env value falls through to .env (discoverKey treats empty as unset)', async () => {
    const cwd = await tempCwd('CADENCE_HOST_CLI_BIN=codex\n');
    expect(hostCliBin({ CADENCE_HOST_CLI_BIN: '' }, cwd)).toBe('codex');
  });

  it('337-01/AC-1: with neither env nor .env the default is claude', async () => {
    const cwd = await tempCwd();
    expect(hostCliBin({}, cwd)).toBe('claude');
  });
});
