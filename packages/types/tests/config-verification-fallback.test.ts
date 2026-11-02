import { describe, it, expect } from 'vitest';
import { CadenceConfigZ, defaultConfig } from '../src/config.js';

describe('verification.fallback (phase 343)', () => {
  it('343-01/AC-3: accepts "mock" and "refuse"', () => {
    for (const fallback of ['mock', 'refuse'] as const) {
      const cfg = CadenceConfigZ.parse({ ...defaultConfig, verification: { fallback } });
      expect(cfg.verification.fallback).toBe(fallback);
    }
  });

  it('343-01/AC-3: rejects an unknown value', () => {
    expect(() =>
      CadenceConfigZ.parse({ ...defaultConfig, verification: { fallback: 'warn' as never } }),
    ).toThrow();
  });

  it('343-01/AC-3: absent stays absent at every default layer, so pre-existing configs are unchanged', () => {
    // Field level: a verification block without the key.
    const fieldLevel = CadenceConfigZ.parse({
      ...defaultConfig,
      verification: { testGlobs: ['packages/**/*.test.ts'], coverageMode: 'assertion' },
    });
    expect('fallback' in fieldLevel.verification).toBe(false);

    // Object level: no verification block at all (Zod 4 returns the
    // `.default({...})` literal as-is).
    const { verification: _drop, ...withoutVerification } = defaultConfig;
    const objectLevel = CadenceConfigZ.parse(withoutVerification);
    expect('fallback' in objectLevel.verification).toBe(false);

    // defaultConfig, the base loadConfig merges user config over.
    expect('fallback' in defaultConfig.verification).toBe(false);
  });
});
