import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import type { CadenceConfig } from '@thomas-powers-jr/cadence-types';
import {
  checkHostCliIsolation,
  evaluateHostCliIsolation,
  runDoctor,
} from '../../src/doctor/run.js';
import { loadConfig, writeConfig } from '../../src/config/loader.js';
import { hostCliIsolationFlags, inferFamily } from '../../src/verify/host-cli-client.js';

// Phase 344 T4 — `cadence doctor` reports the isolation flags the configured
// host-cli binary gets. The check reads config and the binary NAME only: it
// never probes for the binary and never spawns it. No test here selects or
// spawns a host-cli verifier.

// Counts every child-process launch made through `node:child_process`, so a
// test can prove the check launched nothing. Everything still calls through.
const launches = vi.hoisted(() => ({ count: 0 }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  type AnyFn = (...args: unknown[]) => unknown;
  const counted = (fn: unknown): AnyFn => {
    const real = fn as AnyFn;
    return (...args: unknown[]) => {
      launches.count += 1;
      return real(...args);
    };
  };
  const withPromisify = (fn: unknown): AnyFn => {
    const wrapped = counted(fn);
    const custom = (fn as Record<symbol, unknown>)[promisify.custom];
    if (custom !== undefined) {
      Object.defineProperty(wrapped, promisify.custom, { value: counted(custom) });
    }
    return wrapped;
  };
  return {
    ...actual,
    spawn: counted(actual.spawn),
    spawnSync: counted(actual.spawnSync),
    exec: withPromisify(actual.exec),
    execSync: counted(actual.execSync),
    execFile: withPromisify(actual.execFile),
    execFileSync: counted(actual.execFileSync),
    fork: counted(actual.fork),
  };
});

let active: Fixture | null = null;
let scratch: string | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
  if (scratch) {
    await rm(scratch, { recursive: true, force: true });
    scratch = null;
  }
});

const HEALTHY_ENV = { nodeVersion: 'v22.11.0', platform: 'linux' as const };

const CODEX_MESSAGE =
  'host-cli reviews run "codex" with --ignore-user-config; the global AGENTS.md still reaches the reviewer';
const CLAUDE_MESSAGE =
  'host-cli reviews run "claude" with --setting-sources project --strict-mcp-config; the global CLAUDE.md still reaches the reviewer';
const OFF_MESSAGE =
  "host-cli isolation is off (verification.hostCliIsolation): reviews inherit the user's own configuration";
const NO_HOST_CLI_MESSAGE = 'no review gate uses host-cli';

type Isolation = 'on' | 'off' | undefined;

/** An initialized repo whose config has `hostCliIsolation` set (or absent) and,
 *  when `hostCliSeam` is given, that one seam's provider set to `host-cli`. */
async function repoWith(
  isolation: Isolation,
  hostCliSeam: 'verifier' | 'codeReview' | null = 'verifier',
): Promise<string> {
  active = await tempRepo({ initialized: true });
  const cfg = await loadConfig(active.root);
  const { hostCliIsolation: _dropped, ...rest } = cfg.verification;
  void _dropped;
  const verification = isolation === undefined ? rest : { ...rest, hostCliIsolation: isolation };
  const seamPatch =
    hostCliSeam === null ? {} : { [hostCliSeam]: { ...cfg[hostCliSeam], provider: 'host-cli' } };
  await writeConfig(active.root, { ...cfg, ...seamPatch, verification } as CadenceConfig);
  return active.root;
}

describe('host-cli-isolation doctor check (344-01 T4)', () => {
  it('344-01/AC-6: codex gets --ignore-user-config and the AGENTS.md residual is named', async () => {
    const root = await repoWith(undefined);
    const c = await checkHostCliIsolation(root, { CADENCE_HOST_CLI_BIN: 'codex' });
    expect(c.name).toBe('host-cli-isolation');
    expect(c.severity).toBe('ok');
    expect(c.status).toBe('ok');
    expect(c.detail).toBe(CODEX_MESSAGE);
    expect(c.remediation).toBeNull();
    expect(c.fixId).toBeNull();
  });

  it('344-01/AC-6: with CADENCE_HOST_CLI_BIN unset the binary is claude and both claude flags are named', async () => {
    const root = await repoWith(undefined);
    const c = await checkHostCliIsolation(root, {});
    expect(c.name).toBe('host-cli-isolation');
    expect(c.severity).toBe('ok');
    expect(c.detail).toBe(CLAUDE_MESSAGE);
    expect(c.fixId).toBeNull();
  });

  it('344-01/AC-6: a custom binary path gets the claude message quoting the value verbatim', async () => {
    const root = await repoWith(undefined);
    const c = await checkHostCliIsolation(root, { CADENCE_HOST_CLI_BIN: '/opt/bin/my-reviewer' });
    expect(c.name).toBe('host-cli-isolation');
    expect(c.severity).toBe('ok');
    expect(c.detail).toBe(
      'host-cli reviews run "/opt/bin/my-reviewer" with --setting-sources project --strict-mcp-config; the global CLAUDE.md still reaches the reviewer',
    );
  });

  it('344-01/AC-6: an explicit "on" reads exactly like an absent key', async () => {
    const root = await repoWith('on');
    const codex = await checkHostCliIsolation(root, { CADENCE_HOST_CLI_BIN: 'codex' });
    const claude = await checkHostCliIsolation(root, {});
    expect(codex.severity).toBe('ok');
    expect(codex.detail).toBe(CODEX_MESSAGE);
    expect(claude.severity).toBe('ok');
    expect(claude.detail).toBe(CLAUDE_MESSAGE);
  });

  it('344-01/AC-6: "off" is a warning with no automatic fix, whichever binary is configured', async () => {
    const root = await repoWith('off');
    for (const env of [{}, { CADENCE_HOST_CLI_BIN: 'codex' }]) {
      const c = await checkHostCliIsolation(root, env);
      expect(c.name).toBe('host-cli-isolation');
      expect(c.severity).toBe('warning');
      expect(c.status).toBe('warning');
      expect(c.detail).toBe(OFF_MESSAGE);
      expect(c.fixId).toBeNull();
      expect(c.remediation).toContain('verification.hostCliIsolation');
    }
  });

  it('344-01/AC-6: a host-cli seam other than deep-verify counts (the assessReadiness seam rule)', async () => {
    const root = await repoWith('off', 'codeReview');
    const off = await checkHostCliIsolation(root, {});
    expect(off.severity).toBe('warning');
    expect(off.detail).toBe(OFF_MESSAGE);
  });

  it('344-01/AC-6: with no host-cli seam the check is ok, whatever hostCliIsolation says', async () => {
    for (const isolation of [undefined, 'on', 'off'] as const) {
      const root = await repoWith(isolation, null);
      const c = await checkHostCliIsolation(root, { CADENCE_HOST_CLI_BIN: 'codex' });
      expect(c.name).toBe('host-cli-isolation');
      expect(c.severity).toBe('ok');
      expect(c.detail).toBe(NO_HOST_CLI_MESSAGE);
      expect(c.fixId).toBeNull();
      await active?.cleanup();
      active = null;
    }
  });

  it('344-01/AC-6: the binary name is also read from the project .env', async () => {
    const root = await repoWith(undefined);
    await writeFile(join(root, '.env'), 'CADENCE_HOST_CLI_BIN=codex\n');
    const c = await checkHostCliIsolation(root, {});
    expect(c.severity).toBe('ok');
    expect(c.detail).toBe(CODEX_MESSAGE);
  });

  it('344-01/AC-6: the message is built from hostCliIsolationFlags, the helper the spawn uses', () => {
    for (const bin of ['codex', 'claude', '/opt/bin/my-reviewer', 'C:\\tools\\Codex.cmd']) {
      const family = inferFamily(bin);
      const c = evaluateHostCliIsolation({ usesHostCli: true, isolation: undefined, bin });
      expect(c.severity).toBe('ok');
      expect(c.detail).toBe(
        `host-cli reviews run "${bin}" with ${hostCliIsolationFlags(family).join(' ')}; the global ${
          family === 'codex' ? 'AGENTS.md' : 'CLAUDE.md'
        } still reaches the reviewer`,
      );
    }
  });

  it('344-01/AC-6: the check launches no process and does not depend on the binary being on PATH', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'cadence-344-empty-path-'));
    const root = await repoWith(undefined);
    // Control: the counter does see launches made from src/doctor/run.ts (the
    // other checks shell out to git), so the zero below is not vacuous. The
    // config is still all-mock here apart from the name-only host-cli check.
    const control = await tempRepo({ initialized: true });
    try {
      launches.count = 0;
      await runDoctor(control.root, HEALTHY_ENV);
      expect(launches.count).toBeGreaterThan(0);
    } finally {
      await control.cleanup();
    }
    const emptyPath = { PATH: scratch };
    vi.stubEnv('PATH', scratch);
    try {
      launches.count = 0;
      const claude = await checkHostCliIsolation(root, emptyPath);
      const codex = await checkHostCliIsolation(root, { ...emptyPath, CADENCE_HOST_CLI_BIN: 'codex' });
      const missing = await checkHostCliIsolation(root, {
        ...emptyPath,
        CADENCE_HOST_CLI_BIN: join(scratch, 'not-installed-reviewer'),
      });
      expect(launches.count).toBe(0);
      expect(claude.severity).toBe('ok');
      expect(claude.detail).toBe(CLAUDE_MESSAGE);
      expect(codex.detail).toBe(CODEX_MESSAGE);
      expect(missing.severity).toBe('ok');
      expect(missing.detail).toContain(`"${join(scratch, 'not-installed-reviewer')}"`);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('344-01/AC-6: the check function takes root and env only, with no spawn parameter', () => {
    expect(checkHostCliIsolation.length).toBeLessThanOrEqual(2);
    // The pure half is synchronous over plain data: no functions go in.
    const c = evaluateHostCliIsolation({ usesHostCli: true, isolation: 'off', bin: 'codex' });
    expect(c).not.toBeInstanceOf(Promise);
    expect(c.detail).toBe(OFF_MESSAGE);
  });

  it('344-01/AC-6: never throws, an unreadable config degrades to a skipped pass', async () => {
    active = await tempRepo({ initialized: true });
    await writeFile(join(active.root, '.cadence', 'config.json'), '{ not json');
    const c = await checkHostCliIsolation(active.root, {});
    expect(c.name).toBe('host-cli-isolation');
    expect(c.severity).toBe('ok');
    expect(c.detail).toMatch(/not determinable/);
  });

  it('344-01/AC-6: runDoctor carries the check right after verification-fallback', async () => {
    // Default config: every seam is mock, so nothing about a host CLI is read.
    active = await tempRepo({ initialized: true });
    const report = await runDoctor(active.root, HEALTHY_ENV);
    const names = report.checks.map((c) => c.name);
    const c = report.checks.find((x) => x.name === 'host-cli-isolation');
    expect(c).toBeDefined();
    expect(c?.severity).toBe('ok');
    expect(c?.detail).toBe(NO_HOST_CLI_MESSAGE);
    expect(names.indexOf('host-cli-isolation')).toBe(names.indexOf('verification-fallback') + 1);
  });
});
