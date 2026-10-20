// Shell runners for the checkpoint statusline byte-transparency tests
// (phase 331, task T4, AC-1).
//
// Claude Code runs the statusline command through Git Bash on Windows when it
// is installed, otherwise through PowerShell (the same fallback 0.4a measured
// for hooks). These helpers reproduce both paths explicitly so a test can
// force each one regardless of what Claude Code would detect:
//
// - bash: on win32 a Git Bash resolved from the Git install (never bare
//   `bash` from PATH, which can be the WSL launcher in System32); on POSIX
//   `/bin/bash`, else `bash`.
// - PowerShell (win32): `powershell.exe -NoProfile -Command <cmd>`, the spawn
//   shape 0.4a §5c showed collapsing native exit codes.
//
// Every runner feeds the given stdin bytes and returns the raw stdout Buffer,
// the exit status, and stderr as text, and sets CHECKPOINT_RECORD_DEADLINE_MS
// in the child env (see GENEROUS_DEADLINE_MS).
import { spawnSync } from 'node:child_process';
import type { SpawnSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface ShellResult {
  status: number | null;
  stdout: Buffer;
  stderr: string;
}

export interface RunOptions {
  input: Buffer;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Record deadline for every wrapper these helpers run (the shell passes it on
 * to `checkpoint statusline`): their callers' subject is recording or bytes,
 * not the deadline, and loaded CI runners have missed even 1000 ms (run
 * 39461022835). Set only in the child env, never on process.env.
 */
const GENEROUS_DEADLINE_MS = 60_000;

function run(exe: string, args: string[], opts: RunOptions): ShellResult {
  const spawnOpts: SpawnSyncOptions = {
    input: opts.input,
    windowsHide: true,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    env: { ...(opts.env ?? process.env), CHECKPOINT_RECORD_DEADLINE_MS: String(GENEROUS_DEADLINE_MS) },
  };
  const r = spawnSync(exe, args, spawnOpts);
  if (r.error !== undefined) {
    throw new Error(`could not spawn ${exe}: ${r.error.message}`);
  }
  return {
    status: r.status,
    stdout: Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.from(r.stdout ?? ''),
    stderr: Buffer.isBuffer(r.stderr) ? r.stderr.toString('utf8') : String(r.stderr ?? ''),
  };
}

// ---------------------------------------------------------------------------
// bash
// ---------------------------------------------------------------------------

const MAX_GIT_ROOT_WALK = 6;

function isUnderSystem32(path: string): boolean {
  return /[\\/]system32[\\/]/i.test(path);
}

/**
 * Git Bash on win32, located from the Git install: `git --exec-path` (e.g.
 * `C:/Program Files/Git/mingw64/libexec/git-core`), then up a bounded number
 * of ancestors checking `bin/bash.exe`, then `usr/bin/bash.exe`. Throws when
 * none is found, so a missing Git Bash fails the test loudly rather than
 * skipping it.
 */
function resolveGitBash(): string {
  const r = spawnSync('git', ['--exec-path'], { windowsHide: true, encoding: 'utf8' });
  const execPath = typeof r.stdout === 'string' ? r.stdout.trim() : '';
  if (r.error !== undefined || r.status !== 0 || execPath.length === 0) {
    throw new Error(
      `cannot locate Git Bash: \`git --exec-path\` failed (status ${String(r.status)}${
        r.error !== undefined ? `, ${r.error.message}` : ''
      })`,
    );
  }
  let dir = execPath;
  for (let i = 0; i <= MAX_GIT_ROOT_WALK; i++) {
    for (const candidate of [join(dir, 'bin', 'bash.exe'), join(dir, 'usr', 'bin', 'bash.exe')]) {
      if (existsSync(candidate) && !isUnderSystem32(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`cannot locate Git Bash: no bin/bash.exe or usr/bin/bash.exe above ${execPath}`);
}

let cachedBash: string | undefined;

/** The bash executable the transparency tests run through. */
export function resolveBash(): string {
  if (cachedBash !== undefined) return cachedBash;
  if (process.platform === 'win32') {
    cachedBash = resolveGitBash();
  } else {
    cachedBash = existsSync('/bin/bash') ? '/bin/bash' : 'bash';
  }
  return cachedBash;
}

/**
 * `uname -s` through the resolved bash. On win32 it must report MINGW or
 * MSYS (Git Bash), never a Linux kernel name (the WSL launcher); this throws
 * otherwise. Returns the trimmed output on every platform.
 */
export function assertBashIsGitBashOnWin32(bash: string = resolveBash()): string {
  const r = run(bash, ['-c', 'uname -s'], { input: Buffer.alloc(0) });
  const uname = r.stdout.toString('utf8').trim();
  if (process.platform === 'win32' && !/MINGW|MSYS/.test(uname)) {
    throw new Error(`resolved bash ${bash} is not Git Bash: uname -s reported ${JSON.stringify(uname)}`);
  }
  return uname;
}

/**
 * A single-quoted bash word. On win32 the path is first written with forward
 * slashes, because Git Bash consumes unquoted backslashes (and the statusline
 * docs say to write paths that way).
 */
export function bashQuote(word: string): string {
  const text = process.platform === 'win32' ? word.replace(/\\/g, '/') : word;
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** `bash -c <command>` with the given stdin bytes. */
export function runBash(command: string, opts: RunOptions): ShellResult {
  return run(resolveBash(), ['-c', command], opts);
}

// ---------------------------------------------------------------------------
// PowerShell (win32)
// ---------------------------------------------------------------------------

/**
 * A single-quoted PowerShell string literal (no variable expansion; `'` is
 * escaped as `''`). Single quotes keep `"` out of the command string, which
 * Node's win32 argv builder would otherwise re-escape as `\"`.
 */
export function psQuote(word: string): string {
  return `'${word.replace(/'/g, "''")}'`;
}

/** `powershell.exe -NoProfile -Command <command>` with the given stdin bytes (win32). */
export function runPowerShell(command: string, opts: RunOptions): ShellResult {
  return run('powershell.exe', ['-NoProfile', '-Command', command], opts);
}
