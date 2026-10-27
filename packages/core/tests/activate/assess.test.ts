import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CadenceConfigZ, defaultConfig } from '@thomas-powers-jr/cadence-types';
import {
  assessReadiness,
  credsPresent,
  isClaudeCodeSession,
  VERIFIER_SEAMS,
} from '../../src/activate/assess.js';

const cfg = (overrides: Record<string, unknown> = {}) =>
  CadenceConfigZ.parse({ ...defaultConfig, ...overrides });

const dirs: string[] = [];
const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cadence-assess-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('assessReadiness (AC-6)', () => {
  it('reports all-mock posture on a default config', () => {
    const r = assessReadiness(cfg(), {});
    expect(r.provider).toBe('mock');
    expect(r.ready).toBe(false);
    expect(r.seamsReal).toEqual([]);
    expect(r.seamsMock).toEqual([...VERIFIER_SEAMS]);
    expect(r.reason).toMatch(/mock/i);
  });

  it('is ready when deep-verify is anthropic and the key is present', () => {
    const r = assessReadiness(cfg({ verifier: { provider: 'anthropic' } }), {
      ANTHROPIC_API_KEY: 'sk-test',
    });
    expect(r.provider).toBe('anthropic');
    expect(r.keyPresent).toBe(true);
    expect(r.ready).toBe(true);
    expect(r.seamsReal).toContain('verifier');
  });

  it('is not ready when anthropic is selected but the key is absent', () => {
    const r = assessReadiness(cfg({ verifier: { provider: 'anthropic' } }), {});
    expect(r.keyPresent).toBe(false);
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/missing/i);
  });

  // Phase 239 (issue #331) — `seamsReal`/`seamsMock` partition by *configured*
  // provider, which says nothing about whether that provider can actually run.
  // `seamsDowngraded` names the seams whose configured provider WILL fall back
  // to mock at runtime for want of credentials — the set that made
  // `verification-readiness` report a false green.
  it('seamsDowngraded names a non-deep-verify seam whose creds are missing', () => {
    // phase 337: inject a present host-cli binary; this test's intent (no credential env needed) is unchanged
    const r = assessReadiness(
      cfg({ verifier: { provider: 'host-cli' }, specReview: { provider: 'anthropic' } }),
      {},
      undefined,
      () => true,
    );
    // deep-verify itself is healthy — this is exactly the false-green shape.
    expect(r.provider).toBe('host-cli');
    expect(r.keyPresent).toBe(true);
    expect(r.ready).toBe(true);
    expect(r.seamsDowngraded).toEqual(['specReview']);
    // The configured-provider partition is unchanged by this addition.
    expect(r.seamsReal).toContain('specReview');
  });

  it('seamsDowngraded is empty when every real seam has its creds', () => {
    const withKey = assessReadiness(
      cfg({ verifier: { provider: 'anthropic' }, specReview: { provider: 'anthropic' } }),
      { ANTHROPIC_API_KEY: 'sk-test' },
    );
    expect(withKey.seamsDowngraded).toEqual([]);
  });

  it('seamsDowngraded never flags host-cli or mock seams', () => {
    // host-cli has no required credential by design (checked lazily at spawn),
    // and a mock seam is not a downgrade — it announces itself.
    const r = assessReadiness(
      cfg({ verifier: { provider: 'host-cli' }, specReview: { provider: 'host-cli' } }),
      {},
    );
    expect(r.seamsDowngraded).toEqual([]);
  });

  it('seamsDowngraded flags a local seam missing its base URL', () => {
    const r = assessReadiness(
      cfg({ verifier: { provider: 'host-cli' }, codeReview: { provider: 'local', model: 'm' } }),
      {},
    );
    expect(r.seamsDowngraded).toEqual(['codeReview']);
  });

  it('seamsDowngraded lists every affected seam, in VERIFIER_SEAMS order', () => {
    const r = assessReadiness(
      cfg({
        verifier: { provider: 'host-cli' },
        specReview: { provider: 'anthropic' },
        codeReview: { provider: 'anthropic' },
        planReview: { provider: 'anthropic' },
      }),
      {},
    );
    expect(r.seamsDowngraded).toEqual(['specReview', 'codeReview', 'planReview']);
  });

  it('local creds need a base URL and a model', () => {
    const c = cfg({ verifier: { provider: 'local', model: 'm' } });
    expect(credsPresent('local', 'verifier', c, {})).toBe(false);
    expect(credsPresent('local', 'verifier', c, { CADENCE_LOCAL_BASE_URL: 'http://x' })).toBe(true);
  });

  it('credsPresent treats a key discoverable only via .env as present (AC-1)', () => {
    const cwd = makeTmpDir();
    writeFileSync(join(cwd, '.env'), 'ANTHROPIC_API_KEY=from-dotenv\n');
    const c = cfg({ verifier: { provider: 'anthropic' } });
    expect(credsPresent('anthropic', 'verifier', c, {}, cwd)).toBe(true);
  });

  it('credsPresent resolves local base URL + model from .env (AC-1)', () => {
    const cwd = makeTmpDir();
    writeFileSync(
      cwd + '/.env',
      'CADENCE_LOCAL_BASE_URL=http://dotenv-host\nCADENCE_LOCAL_MODEL=dotenv-model\n',
    );
    const c = cfg({ verifier: { provider: 'local' } });
    expect(credsPresent('local', 'verifier', c, {}, cwd)).toBe(true);
  });

  it('assessReadiness is ready for a teammate whose key lives only in .env, once anthropic is committed to config (AC-1, AC-3)', () => {
    const cwd = makeTmpDir();
    writeFileSync(join(cwd, '.env'), 'ANTHROPIC_API_KEY=from-dotenv\n');
    // Simulates a teammate who never ran `cadence activate` themselves: the
    // provider choice came from committed config, and their key is only in .env.
    const r = assessReadiness(cfg({ verifier: { provider: 'anthropic' } }), {}, cwd);
    expect(r.provider).toBe('anthropic');
    expect(r.keyPresent).toBe(true);
    expect(r.ready).toBe(true);
    expect(r.reason).toMatch(/credentials present/i);
  });

  it('assessReadiness without a cwd still defaults safely (no .env, no crash)', () => {
    const r = assessReadiness(cfg({ verifier: { provider: 'anthropic' } }), {});
    expect(r.provider).toBe('anthropic');
  });

  it('host-cli creds are present with no env at all — no required credential by design (AC-1)', () => {
    const c = cfg({ verifier: { provider: 'host-cli' } });
    expect(credsPresent('host-cli', 'verifier', c, {})).toBe(true);
  });

  it('host-cli creds are present when CADENCE_HOST_CLI_BIN overrides the default binary (AC-1)', () => {
    const c = cfg({ verifier: { provider: 'host-cli' } });
    expect(
      credsPresent('host-cli', 'verifier', c, { CADENCE_HOST_CLI_BIN: '/usr/local/bin/codex' }),
    ).toBe(true);
  });

  it('host-cli does not fall through to the local provider baseURL/model check (AC-1)', () => {
    // Regression guard: prior to the host-cli branch, an unhandled provider
    // silently fell through to local's `CADENCE_LOCAL_BASE_URL` + model check,
    // which would misreport a bare host-cli setup as "credentials missing".
    const c = cfg({ verifier: { provider: 'host-cli' } });
    expect(credsPresent('host-cli', 'verifier', c, {})).toBe(true);
  });

  it('assessReadiness reports host-cli as ready with no CADENCE_LOCAL_* / CADENCE_HOST_CLI_BIN env set (AC-1)', () => {
    // phase 337: inject a present host-cli binary; this test's intent (no credential env needed) is unchanged
    const r = assessReadiness(
      cfg({ verifier: { provider: 'host-cli' } }),
      {},
      undefined,
      () => true,
    );
    expect(r.provider).toBe('host-cli');
    expect(r.keyPresent).toBe(true);
    expect(r.ready).toBe(true);
    expect(r.reason).toMatch(/host-cli/i);
  });
});

describe('isClaudeCodeSession (AC-1, phase 211)', () => {
  it('is true only when CLAUDECODE is exactly the string "1"', () => {
    expect(isClaudeCodeSession({ CLAUDECODE: '1' })).toBe(true);
  });

  it('is false when CLAUDECODE is unset', () => {
    expect(isClaudeCodeSession({})).toBe(false);
  });

  it('is false when CLAUDECODE is set to "0"', () => {
    expect(isClaudeCodeSession({ CLAUDECODE: '0' })).toBe(false);
  });

  it('is false when CLAUDECODE is set to "true"', () => {
    expect(isClaudeCodeSession({ CLAUDECODE: 'true' })).toBe(false);
  });
});

describe('assessReadiness host-cli binary resolution (phase 337)', () => {
  const hostCfg = () =>
    cfg({ verifier: { provider: 'host-cli' }, codeReview: { provider: 'host-cli' } });

  it('337-01/AC-2 missing binary: lists both seams, names the env bin, not ready', () => {
    const probe = vi.fn(() => false);
    const r = assessReadiness(hostCfg(), { CADENCE_HOST_CLI_BIN: 'codex' }, undefined, probe);
    expect(r.seamsUnresolvable).toEqual(['verifier', 'codeReview']);
    expect(r.hostCliBin).toBe('codex');
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('"codex"');
    expect(r.reason).toMatch(/fall back to mock/i);
    expect(probe).toHaveBeenCalledWith('codex');
  });

  it('337-01/AC-2 effective bin comes from a .env file in cwd', () => {
    const cwd = makeTmpDir();
    writeFileSync(join(cwd, '.env'), 'CADENCE_HOST_CLI_BIN=from-dotenv\n');
    const r = assessReadiness(hostCfg(), {}, cwd, () => false);
    expect(r.hostCliBin).toBe('from-dotenv');
    expect(r.reason).toContain('"from-dotenv"');
  });

  it('337-01/AC-2 effective bin defaults to claude', () => {
    const cwd = makeTmpDir();
    const r = assessReadiness(hostCfg(), {}, cwd, () => false);
    expect(r.hostCliBin).toBe('claude');
    expect(r.reason).toContain('"claude"');
  });

  it('337-01/AC-2 present binary: ready, names bin, login and guard checked at review time', () => {
    const r = assessReadiness(hostCfg(), { CADENCE_HOST_CLI_BIN: 'codex' }, undefined, () => true);
    expect(r.seamsUnresolvable).toEqual([]);
    expect(r.hostCliBin).toBe('codex');
    expect(r.ready).toBe(true);
    expect(r.reason).toContain('"codex"');
    expect(r.reason).toMatch(
      /login and the self-invocation guard are checked only when a review runs/,
    );
    expect(r.reason).not.toMatch(/credentials present/i);
  });

  it('337-01/AC-2 a config with no host-cli seam never calls the probe and has no hostCliBin key', () => {
    const probe = vi.fn(() => false);
    const r = assessReadiness(
      cfg({ verifier: { provider: 'anthropic' } }),
      { ANTHROPIC_API_KEY: 'k' },
      undefined,
      probe,
    );
    expect(probe).not.toHaveBeenCalled();
    expect(r.seamsUnresolvable).toEqual([]);
    expect('hostCliBin' in r).toBe(false);
  });

  it('337-01/AC-2 probes at most once per call with several host-cli seams', () => {
    const probe = vi.fn(() => false);
    assessReadiness(
      cfg({
        verifier: { provider: 'host-cli' },
        specReview: { provider: 'host-cli' },
        codeReview: { provider: 'host-cli' },
      }),
      {},
      undefined,
      probe,
    );
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('337-01/AC-2 an unresolvable non-deep-verify host-cli seam does not change ready/reason for other providers', () => {
    const missing = () => false;
    const onMock = assessReadiness(
      cfg({ codeReview: { provider: 'host-cli' } }),
      {},
      undefined,
      missing,
    );
    expect(onMock.seamsUnresolvable).toEqual(['codeReview']);
    expect(onMock.ready).toBe(false);
    expect(onMock.reason).toBe('deep-verify uses the mock provider — no real AI verification.');
    const onAnthropic = assessReadiness(
      cfg({ verifier: { provider: 'anthropic' }, codeReview: { provider: 'host-cli' } }),
      { ANTHROPIC_API_KEY: 'k' },
      undefined,
      missing,
    );
    expect(onAnthropic.seamsUnresolvable).toEqual(['codeReview']);
    expect(onAnthropic.ready).toBe(true);
    expect(onAnthropic.reason).toBe('deep-verify uses anthropic with credentials present.');
  });

  it('337-01/AC-5 a missing binary leaves credsPresent true and seamsDowngraded free of host-cli seams', () => {
    const c = hostCfg();
    expect(credsPresent('host-cli', 'verifier', c, {})).toBe(true);
    const r = assessReadiness(c, {}, undefined, () => false);
    expect(r.keyPresent).toBe(true);
    expect(r.seamsDowngraded).toEqual([]);
    expect(r.seamsUnresolvable).toEqual(['verifier', 'codeReview']);
  });
});
