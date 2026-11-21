import { describe, it, expect } from 'vitest';
import { CadenceConfigZ, defaultConfig } from '../src/config.js';

// Phase 348 (348-01, T2): `verification.buildTestOutputTail` is an optional
// enum. Absent means "show"; the key is written by no default layer, so a
// pre-existing config and a fresh init parse and behave exactly as before.
//
// `CadenceConfigZ` itself has required top-level keys (`schemaVersion`,
// `tier`, ...), so a bare `{}` is never a whole config at the schema level:
// core's `loadConfig` merges config.json over `defaultConfig` first (the
// `{}` config.json case is pinned in core's
// settle-build-test-hide-tail.test.ts). Here `{}` is exercised where the
// schema does accept it: as the `verification` object, and as a config with
// no `verification` object at all.
const VerificationZ = CadenceConfigZ.shape.verification;
const withoutVerification: Record<string, unknown> = Object.fromEntries(
  Object.entries(defaultConfig).filter(([key]) => key !== 'verification'),
);

describe('verification.buildTestOutputTail (phase 348)', () => {
  it('348-01/AC-7: the key is absent from a parsed {} verification object and from a parsed config with no verification object', () => {
    // Field level: `{}` as the verification object.
    const fieldLevel = VerificationZ.parse({});
    expect('buildTestOutputTail' in fieldLevel).toBe(false);
    expect(fieldLevel.buildTestOutputTail).toBeUndefined();

    // Object level: no verification object at all (the `.default({...})` literal).
    expect('verification' in withoutVerification).toBe(false);
    expect('buildTestOutputTail' in VerificationZ.parse(undefined)).toBe(false);
    const objectLevel = CadenceConfigZ.parse(withoutVerification);
    expect('buildTestOutputTail' in objectLevel.verification).toBe(false);
    expect(objectLevel.verification).not.toHaveProperty('buildTestOutputTail');
  });

  it('348-01/AC-7: the key is absent from defaultConfig, parsed or not', () => {
    expect('buildTestOutputTail' in defaultConfig.verification).toBe(false);
    // And from defaultConfig once parsed, the shape loadConfig hands to core.
    const parsed = CadenceConfigZ.parse(defaultConfig);
    expect('buildTestOutputTail' in parsed.verification).toBe(false);
  });

  it('348-01/AC-7: { verification: { testGlobs: ["x"] } } parses, the key staying absent', () => {
    const res = CadenceConfigZ.safeParse({ ...withoutVerification, verification: { testGlobs: ['x'] } });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.verification.testGlobs).toEqual(['x']);
    expect('buildTestOutputTail' in res.data.verification).toBe(false);

    const sub = VerificationZ.safeParse({ testGlobs: ['x'] });
    expect(sub.success).toBe(true);
    expect(sub.success && 'buildTestOutputTail' in sub.data).toBe(false);
  });

  it('348-01/AC-7: "show" and "hide" parse and round-trip through JSON', () => {
    for (const buildTestOutputTail of ['show', 'hide'] as const) {
      const cfg = CadenceConfigZ.parse({
        ...withoutVerification,
        verification: { buildTestOutputTail },
      });
      expect(cfg.verification.buildTestOutputTail).toBe(buildTestOutputTail);
      const again = CadenceConfigZ.parse(JSON.parse(JSON.stringify(cfg)));
      expect(again.verification.buildTestOutputTail).toBe(buildTestOutputTail);
      expect(again).toEqual(cfg);
    }
  });

  it('348-01/AC-7: "Hide", true and null for the key are schema errors', () => {
    for (const bad of ['Hide', true, null]) {
      const res = CadenceConfigZ.safeParse({
        ...defaultConfig,
        verification: { ...defaultConfig.verification, buildTestOutputTail: bad },
      });
      expect(res.success, `value ${JSON.stringify(bad)}`).toBe(false);
      if (res.success) continue;
      // The only issue is the key's own.
      expect(res.error.issues.map((i) => i.path.join('.'))).toEqual([
        'verification.buildTestOutputTail',
      ]);
    }
  });
});
