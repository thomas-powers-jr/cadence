import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { discoverKey } from '../activate/key-discovery.js';
import { resolveHostCliCommand } from './win32-command.js';

/**
 * Phase 337 — "will this `host-cli` binary actually launch?" Readiness
 * surfaces (`assessReadiness`, doctor, onboard) used to call a `host-cli`
 * verifier ready purely from config, even when `CADENCE_HOST_CLI_BIN` named
 * a binary that is not installed. This module answers that question without
 * spawning anything.
 *
 * It mirrors what `makeRealSpawn` (`host-cli-client.ts`) will do: spawn is
 * given no `cwd`/`env` options, so the process cwd and the process env
 * apply. On POSIX that is libuv's execvp-style search (an empty PATH segment
 * means the cwd, an unset PATH means `/usr/bin:/bin`, a bin containing `/`
 * is used as given); on win32 it is the spawn path's own resolver,
 * `resolveHostCliCommand`, so an ENOENT and a refused `.cmd` launcher both
 * read as "won't launch".
 *
 * It deliberately does not reuse `doctor/run.ts`'s `commandOnPath`: that
 * helper is existence-only (no runnable-file check), lacks the libuv
 * empty-segment / default-PATH semantics, and has no shim refusal. It serves
 * doctor's Codex host checks and stays as is.
 *
 * Accepted limitation: a shebang script whose interpreter is missing reads
 * as found; spawn's ENOENT then falls back to mock loudly.
 *
 * Pure core (`hostCliBinaryResolves`, `hostCliBin`) plus an impure shell
 * (`realHostCliPresenceFacts`). `hostCliBinaryResolves` never throws: any
 * throw from a facts call reads as "won't launch".
 */
export interface HostCliPresenceFacts {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** True iff `p` names a runnable regular file — on POSIX a regular file
   *  with execute permission, on win32 any regular file. A directory, a
   *  non-executable file or an absent path is false. A relative `p` resolves
   *  against the process cwd. May throw; `hostCliBinaryResolves` treats a
   *  throw as false. */
  isRunnableFile(p: string): boolean;
  /** Reads a `.cmd`/`.bat` launcher (win32 only). May throw; the resolver
   *  call that uses it is wrapped, so a throw reads as "won't launch". */
  readFile(p: string): string;
  execPath: string;
}

function safeRunnable(facts: HostCliPresenceFacts, p: string): boolean {
  try {
    return facts.isRunnableFile(p);
  } catch {
    return false;
  }
}

export function hostCliBinaryResolves(bin: string, facts: HostCliPresenceFacts): boolean {
  if (facts.platform === 'win32') {
    try {
      resolveHostCliCommand(bin, {
        platform: facts.platform,
        env: facts.env,
        fileExists: facts.isRunnableFile,
        readFile: facts.readFile,
        execPath: facts.execPath,
      });
      return true;
    } catch {
      return false;
    }
  }
  if (bin.length === 0) return false;
  if (bin.includes('/')) return safeRunnable(facts, bin);
  const pathVar = facts.env['PATH'] ?? '/usr/bin:/bin';
  for (const segment of pathVar.split(':')) {
    // libuv joins with a literal '/', no normalization: the kernel then walks
    // the real path (a `..` after a symlink follows the link's target).
    const candidate = segment === '' ? bin : `${segment}/${bin}`;
    if (safeRunnable(facts, candidate)) return true;
  }
  return false;
}

/** The host-cli binary: `CADENCE_HOST_CLI_BIN` from env or `.env`, default
 *  `claude` — the verifier factory's rule. */
export function hostCliBin(env: NodeJS.ProcessEnv, cwd: string): string {
  return discoverKey('CADENCE_HOST_CLI_BIN', env, cwd).value ?? 'claude';
}

/** Impure shell: real filesystem facts. `isRunnableFile` never throws;
 *  `readFile` may, and `hostCliBinaryResolves` absorbs it. */
export function realHostCliPresenceFacts(env: NodeJS.ProcessEnv): HostCliPresenceFacts {
  const platform = process.platform;
  return {
    platform,
    env,
    isRunnableFile(p: string): boolean {
      try {
        if (!statSync(p).isFile()) return false;
        if (platform === 'win32') return true;
        accessSync(p, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    readFile: (p: string): string => readFileSync(p, 'utf8'),
    execPath: process.execPath,
  };
}
