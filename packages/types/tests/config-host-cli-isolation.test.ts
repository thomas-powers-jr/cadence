import { describe, it, expect } from 'vitest';
import { CadenceConfigZ, defaultConfig } from '../src/config.js';

// Phase 344 (T2) - `verification.hostCliIsolation`, schema only. The
// `loadConfig`, fresh-init and selector behaviour is asserted in core
// (`packages/core/tests/verify/host-cli-isolation-optout.test.ts`).

/** Parses a config whose verification block is `defaultConfig`'s plus `hostCliIsolation: value`. */
function parseWith(value: unknown): ReturnType<typeof CadenceConfigZ.safeParse> {
  return CadenceConfigZ.safeParse({
    ...defaultConfig,
    verification: { ...defaultConfig.verification, hostCliIsolation: value },
  });
}

describe('verification.hostCliIsolation (phase 344)', () => {
  it.each(['on', 'off'] as const)('344-01/AC-3: accepts %j', (value) => {
    const r = parseWith(value);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.verification.hostCliIsolation).toBe(value);
  });

  it.each([['"Off"', 'Off'], ['true', true], ['null', null]])(
    '344-01/AC-3: rejects %s, with the issue at verification.hostCliIsolation',
    (_label, value) => {
      const r = parseWith(value);
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0]?.path).toEqual(['verification', 'hostCliIsolation']);
    },
  );

  it('344-01/AC-3: absent stays absent when the verification block omits the key', () => {
    const cfg = CadenceConfigZ.parse({
      ...defaultConfig,
      verification: { testGlobs: ['packages/**/*.test.ts'], coverageMode: 'assertion' },
    });
    expect('hostCliIsolation' in cfg.verification).toBe(false);
    expect(cfg.verification.hostCliIsolation).toBeUndefined();
  });

  it('344-01/AC-3: absent stays absent when there is no verification block at all (the object-level default)', () => {
    const withoutVerification: Record<string, unknown> = { ...defaultConfig };
    delete withoutVerification.verification;
    expect('verification' in withoutVerification).toBe(false);
    const cfg = CadenceConfigZ.parse(withoutVerification);
    expect('hostCliIsolation' in cfg.verification).toBe(false);
  });

  it('344-01/AC-3: defaultConfig.verification has no hostCliIsolation key', () => {
    expect('hostCliIsolation' in defaultConfig.verification).toBe(false);
    expect(Object.keys(defaultConfig.verification)).not.toContain('hostCliIsolation');
  });
});
