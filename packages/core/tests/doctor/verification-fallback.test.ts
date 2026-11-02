import { describe, it, expect, afterEach } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import type { CadenceConfig } from '@thomas-powers-jr/cadence-types';
import {
  checkVerificationFallback,
  checkVerificationReadiness,
  runDoctor,
} from '../../src/doctor/run.js';
import { loadConfig, writeConfig } from '../../src/config/loader.js';

// Phase 343 T5 — doctor reports the effective `verification.fallback` and,
// under "refuse", stops promising a mock fallback in `verification-readiness`.

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

const HEALTHY_ENV = { nodeVersion: 'v22.11.0', platform: 'linux' as const };
const MISSING_BIN = join(tmpdir(), 'cadence-343-missing-host-cli-bin');

type Fallback = 'mock' | 'refuse' | undefined;

/** Rewrite the repo config with `verification.fallback` set — or the key removed when `undefined`. */
async function setFallback(
  root: string,
  fallback: Fallback,
  patch: (cfg: CadenceConfig) => CadenceConfig = (c) => c,
): Promise<void> {
  const cfg = patch(await loadConfig(root));
  const { fallback: _dropped, ...rest } = cfg.verification;
  void _dropped;
  const verification = fallback === undefined ? rest : { ...rest, fallback };
  await writeConfig(root, { ...cfg, verification } as CadenceConfig);
}

describe('verification-fallback doctor check (343-01 T5)', () => {
  it('343-01/AC-6: doctor --json (runDoctor report) carries verification-fallback reporting mock when the key is absent', async () => {
    active = await tempRepo({ initialized: true });
    await setFallback(active.root, undefined);
    const report = await runDoctor(active.root, HEALTHY_ENV);
    const json = JSON.parse(JSON.stringify(report)) as typeof report;
    const names = json.checks.map((c) => c.name);
    const c = json.checks.find((x) => x.name === 'verification-fallback');
    expect(c).toBeDefined();
    expect(c?.severity).toBe('ok');
    expect(c?.detail).toContain('"mock"');
    expect(c?.detail).toMatch(/default/);
    expect(c?.detail).toContain('"refuse"');
    expect(c?.detail).toMatch(/automated consumers/);
    // Placed right after verification-readiness.
    expect(names.indexOf('verification-fallback')).toBe(names.indexOf('verification-readiness') + 1);
  });

  it('343-01/AC-6: doctor --json (runDoctor report) reports mock when verification.fallback is "mock"', async () => {
    active = await tempRepo({ initialized: true });
    await setFallback(active.root, 'mock');
    const report = await runDoctor(active.root, HEALTHY_ENV);
    const c = (JSON.parse(JSON.stringify(report)) as typeof report).checks.find(
      (x) => x.name === 'verification-fallback',
    );
    expect(c?.severity).toBe('ok');
    expect(c?.detail).toContain('"mock"');
    expect(c?.detail).toMatch(/automated consumers/);
  });

  it('343-01/AC-6: doctor --json (runDoctor report) reports refuse when verification.fallback is "refuse"', async () => {
    active = await tempRepo({ initialized: true });
    await setFallback(active.root, 'refuse');
    const report = await runDoctor(active.root, HEALTHY_ENV);
    const c = (JSON.parse(JSON.stringify(report)) as typeof report).checks.find(
      (x) => x.name === 'verification-fallback',
    );
    expect(c?.severity).toBe('ok');
    expect(c?.detail).toContain('"refuse"');
    expect(c?.detail).toMatch(/will refuse/);
    expect(c?.detail).not.toMatch(/fall back to mock/i);
  });

  it('343-01/AC-6: never throws — an unreadable config degrades to a skipped pass', async () => {
    active = await tempRepo({ initialized: true });
    await writeFile(join(active.root, '.cadence', 'config.json'), '{ not json');
    const c = await checkVerificationFallback(active.root);
    expect(c.name).toBe('verification-fallback');
    expect(c.severity).toBe('ok');
    expect(c.detail).toMatch(/not determinable/);
  });
});

describe('verification-readiness wording under verification.fallback (343-01 T5)', () => {
  const scenarios: {
    label: string;
    env: NodeJS.ProcessEnv;
    patch: (cfg: CadenceConfig) => CadenceConfig;
  }[] = [
    {
      label: 'host-cli seam whose binary is missing',
      env: { CADENCE_HOST_CLI_BIN: MISSING_BIN },
      patch: (cfg) => ({ ...cfg, verifier: { ...cfg.verifier, provider: 'host-cli' } }),
    },
    {
      label: 'host-cli binary missing plus a credential-downgraded seam',
      env: { CADENCE_HOST_CLI_BIN: MISSING_BIN },
      patch: (cfg) => ({
        ...cfg,
        verifier: { ...cfg.verifier, provider: 'host-cli' },
        specReview: { ...cfg.specReview, provider: 'anthropic' },
      }),
    },
    {
      label: 'deep-verify anthropic missing its key inside Claude Code',
      env: { CLAUDECODE: '1' },
      patch: (cfg) => ({ ...cfg, verifier: { ...cfg.verifier, provider: 'anthropic' } }),
    },
    {
      label: 'deep-verify anthropic missing its key',
      env: {},
      patch: (cfg) => ({ ...cfg, verifier: { ...cfg.verifier, provider: 'anthropic' } }),
    },
    {
      label: 'healthy deep-verify with a credential-downgraded sibling seam',
      env: { CADENCE_HOST_CLI_BIN: process.execPath },
      patch: (cfg) => ({
        ...cfg,
        verifier: { ...cfg.verifier, provider: 'host-cli' },
        codeReview: { ...cfg.codeReview, provider: 'anthropic' },
      }),
    },
  ];

  for (const s of scenarios) {
    it(`343-01/AC-6: under refuse, the ${s.label} warning says refuse and never promises a mock fallback`, async () => {
      active = await tempRepo({ initialized: true });
      await setFallback(active.root, 'refuse', s.patch);
      const c = await checkVerificationReadiness(active.root, s.env);
      expect(c.severity).toBe('warning');
      expect(c.detail).toMatch(/refuse/);
      expect(c.detail).not.toMatch(/fall back to mock/i);
    });

    it(`343-01/AC-6: absent and "mock" leave the ${s.label} warning byte-identical`, async () => {
      active = await tempRepo({ initialized: true });
      await setFallback(active.root, undefined, s.patch);
      const absent = await checkVerificationReadiness(active.root, s.env);
      await setFallback(active.root, 'mock', s.patch);
      const mock = await checkVerificationReadiness(active.root, s.env);
      expect(absent.severity).toBe('warning');
      expect(absent.detail).toMatch(/fall back to mock/);
      expect(absent.detail).not.toMatch(/refuse/);
      expect(mock.detail).toBe(absent.detail);
      expect(mock.remediation).toBe(absent.remediation);
    });
  }

  it('343-01/AC-6: the host-cli missing-binary warning reads exactly as before when the key is absent', async () => {
    active = await tempRepo({ initialized: true });
    await setFallback(active.root, undefined, (cfg) => ({
      ...cfg,
      verifier: { ...cfg.verifier, provider: 'host-cli' },
    }));
    const c = await checkVerificationReadiness(active.root, { CADENCE_HOST_CLI_BIN: MISSING_BIN });
    expect(c.detail).toContain(
      "1 host-cli seam will fall back to mock when a review runs, because that binary will not launch: verifier ('host-cli').",
    );
  });
});
