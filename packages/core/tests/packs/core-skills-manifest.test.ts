import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PackManifestZ } from '@thomas-powers-jr/cadence-types';
import type { CadenceConfig } from '@thomas-powers-jr/cadence-types';
import { resolvePacks } from '../../src/packs/resolve.js';
import type { ResolvedPack } from '../../src/packs/resolve.js';
import { runSkillAuditCheck } from '../../src/checks/skill-audit.js';
import { checkPacks, checkPackCommands } from '../../src/doctor/run.js';
import type { SettleContext } from '../../src/gates/types.js';

/**
 * Slice 5 (phase 294): tests against the real, committed
 * `.cadence/packs/cadence/core-skills/pack.json` and the real repo root --
 * not `tempRepo` fixtures -- proving AC-1/AC-3/AC-4/AC-5 against the actual
 * shipped manifest, distinct from `resolve.test.ts`'s fixture-based suite.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const PACK_ID = 'cadence/core-skills';
const MANIFEST_PATH = join(REPO_ROOT, '.cadence/packs/cadence/core-skills/pack.json');

/** Minimal `SettleContext` stub covering only the fields `runSkillAuditCheck`
 *  reads. Mirrors the `ctx()` factory in `checks/skill-audit.test.ts`. */
function minimalCtx(): SettleContext {
  return {
    config: {
      skillAudit: { required: [] },
      telemetry: { skillInvocations: true },
    } as never,
    state: { skillAudit: { required: [], invoked: [] } } as never,
    draft: { requiredSkills: [] } as never,
    opts: {},
    emit: { skillAuditMiss: async () => {} },
    io: { err: () => {} },
  } as unknown as SettleContext;
}

describe('294-01 — cadence/core-skills: the first real pack', () => {
  it('294-01/AC-1: resolvePacks resolves the real committed manifest with source local', async () => {
    const config: Pick<CadenceConfig, 'packs'> = { packs: { enabled: [PACK_ID], disabled: [] } };
    const result = await resolvePacks(REPO_ROOT, config);
    expect(result).toHaveLength(1);
    const raw = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    expect(result[0]).toEqual({ id: PACK_ID, source: 'local', manifest: raw });

    // Pin the manifest's actual shape (D-AV/D-AW) so the resolved-pack
    // fixture above can't silently drift from the design intent it proves.
    // SUPERSEDED IN PART by phase 312: this originally asserted
    // `skillAudit` was undefined, which was phase 294's deliberate choice
    // while the Skill-tool telemetry matcher was missing (phase 295 fixed
    // it). Phase 312 declares the requirement, so the assertion is
    // retargeted to the new shape rather than dropped — `gates` is still
    // pinned absent, and 312-01/AC-1 below pins the declared value itself.
    const resolved = result[0];
    if (resolved && 'manifest' in resolved) {
      expect(resolved.manifest.skillAudit).toEqual({ required: ['phase-build'] });
      expect(resolved.manifest.gates).toBeUndefined();
      expect(resolved.manifest.commands).toEqual([
        'cadence-draft',
        'cadence-approve',
        'cadence-build',
        'cadence-settle',
      ]);
    } else {
      throw new Error('expected resolved[0] to carry a manifest');
    }
  });

  it('294-01/AC-4: disabled wins over enabled for the real manifest', async () => {
    const config: Pick<CadenceConfig, 'packs'> = {
      packs: { enabled: [PACK_ID], disabled: [PACK_ID] },
    };
    const result = await resolvePacks(REPO_ROOT, config);
    expect(result).toHaveLength(0);
  });

  it('294-01/AC-5: a malformed copy of the real manifest fails closed under .strict()', async () => {
    const raw = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    const malformed = { ...raw, unrecognizedTopLevelKey: true };
    const parsed = PackManifestZ.safeParse(malformed);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some(
          (i) => i.code === 'unrecognized_keys' && i.keys.includes('unrecognizedTopLevelKey'),
        ),
      ).toBe(true);
    }
  });

  it('294-01/AC-2: cadence doctor reports the enabled pack resolved with no command warning', async () => {
    const packsCheck = await checkPacks(REPO_ROOT);
    expect(packsCheck.severity).toBe('ok');
    expect(packsCheck.detail).toContain(PACK_ID);

    const commandsCheck = await checkPackCommands(REPO_ROOT);
    expect(commandsCheck.severity).toBe('ok');
  });

  // Phase 294's AC-3 originally asserted this against the REAL manifest, which
  // was commands-only at the time. Phase 312 declares a requirement there, so
  // the real manifest can no longer demonstrate the property — but the property
  // itself (a resolved pack that declares no `skillAudit` contributes zero
  // provenance, i.e. the `?? []` arm in skill-audit.ts) is still true and still
  // worth pinning, and 294-01-SUMMARY.json records AC-3 as PASS/executed with
  // `coverageScheme: phase-qualified`, so `cadence verify phase 294-…` re-derives
  // it from this token. Retitling it to 312 broke that re-derivation. The token
  // is kept here against a synthetic commands-only pack, which preserves both
  // phase 294's audit trail and the assertion it was evidence for.
  it('294-01/AC-3: a pack declaring no skillAudit contributes zero skillAudit.provenance entries', async () => {
    const commandsOnly: ResolvedPack = {
      id: PACK_ID,
      source: 'local',
      manifest: {
        id: PACK_ID,
        version: '1.0.0',
        commands: ['cadence-draft', 'cadence-approve', 'cadence-build', 'cadence-settle'],
      },
    };
    const result = await runSkillAuditCheck(minimalCtx(), [commandsOnly]);
    expect(result.outcome).toBe('pass');
    expect(result.effectiveRequired).toEqual([]);
    expect(result.requiredWithProvenance.some((e) => e.source === `pack:${PACK_ID}`)).toBe(false);
  });

  it('312-01/AC-3: the real manifest refuses when phase-build is absent from telemetry, attributing the demand to the pack', async () => {
    const config: Pick<CadenceConfig, 'packs'> = { packs: { enabled: [PACK_ID], disabled: [] } };
    const resolved = await resolvePacks(REPO_ROOT, config);
    // Prove the pack actually resolved -- otherwise the provenance result
    // would be equally consistent with "never resolved" as with "resolved and
    // declaring the requirement", and this test wouldn't distinguish the two.
    expect(resolved).toHaveLength(1);
    expect(resolved[0] && 'manifest' in resolved[0]).toBe(true);

    // minimalCtx() has telemetry.skillInvocations ENABLED but an empty
    // state.skillAudit.invoked, so the declared requirement is genuinely
    // unsatisfied. The distinction is load-bearing: had telemetry been
    // disabled the check would take the `unenforceable` warn path and PASS,
    // so this test would prove nothing about refusal.
    // This is the ONLY place the refusal path can be shown: in
    // any checkout that has ever invoked phase-build, state.skillAudit.invoked
    // is deduped, append-only and never reset (rec-20260917-006), so the live
    // path cannot refuse. A green settle for this phase is therefore NOT
    // evidence that enforcement fires -- this fixture is.
    const result = await runSkillAuditCheck(minimalCtx(), resolved);
    expect(result.outcome).toBe('refuse');
    expect(result.effectiveRequired).toEqual(['phase-build']);
    expect(result.requiredWithProvenance).toContainEqual({
      skill: 'phase-build',
      source: `pack:${PACK_ID}`,
    });
  });

  it('312-01/AC-4: --allow-skill-audit-miss turns that refusal into a pass carrying the phase-311 bypass marker', async () => {
    const config: Pick<CadenceConfig, 'packs'> = { packs: { enabled: [PACK_ID], disabled: [] } };
    const resolved = await resolvePacks(REPO_ROOT, config);
    const ctx = minimalCtx() as unknown as { opts: { allowSkillAuditMiss?: boolean } };
    ctx.opts.allowSkillAuditMiss = true;

    const result = await runSkillAuditCheck(ctx as unknown as SettleContext, resolved);
    expect(result.outcome).toBe('pass');
    // Phase 311: the bypass is reported so settle can record it in
    // SUMMARY.gateBypasses. Without this the requirement landing here would
    // make a routinely-used bypass invisible in the durable artifact.
    expect(result.bypassed).toBe(true);
    expect(result.reason).toContain('phase-build');
  });

  it('294-01/AC-6: docs/packs-design.md records Slice 5', async () => {
    const doc = await readFile(join(REPO_ROOT, 'docs/packs-design.md'), 'utf8');
    expect(doc).toContain('Slice 5 shipped (phase');
    expect(doc).toContain('the first real pack, `cadence/core-skills`');
  });

  // -------------------------------------------------------------------------
  // Phase 312 (312-01). Slice 5 completion: the manifest now declares
  // skillAudit.required, which phase 294 deliberately omitted because the
  // Skill-tool telemetry matcher was missing (phase 295 fixed it). The two
  // 294 assertions that pinned the commands-only shape are updated above
  // rather than deleted -- they pinned a design intent this phase supersedes.
  // -------------------------------------------------------------------------

  it('312-01/AC-1: the real manifest declares skillAudit.required: ["phase-build"] and still resolves under .strict()', async () => {
    const config: Pick<CadenceConfig, 'packs'> = { packs: { enabled: [PACK_ID], disabled: [] } };
    const result = await resolvePacks(REPO_ROOT, config);
    expect(result).toHaveLength(1);
    const resolved = result[0];
    if (!resolved || !('manifest' in resolved)) {
      throw new Error('expected the real manifest to resolve');
    }
    expect(resolved.source).toBe('local');
    expect(resolved.manifest.skillAudit).toEqual({ required: ['phase-build'] });
    // The declaration must not have smuggled in any other payload: gates stay
    // absent (Boundaries) and commands[] is untouched.
    expect(resolved.manifest.gates).toBeUndefined();
    expect(resolved.manifest.commands).toEqual([
      'cadence-draft',
      'cadence-approve',
      'cadence-build',
      'cadence-settle',
    ]);
    // And the on-disk bytes really parse under the strict schema.
    const raw = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    expect(PackManifestZ.safeParse(raw).success).toBe(true);
  });

  it('312-01/AC-5: the manifest version is bumped and the design record documents the completion honestly', async () => {
    const raw = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    expect(raw.version).not.toBe('1.0.0');

    const doc = await readFile(join(REPO_ROOT, 'docs/packs-design.md'), 'utf8');
    // The completion is recorded ...
    expect(doc).toContain('completed phase 312');
    expect(doc).toContain('*Completed (phase 312).*');
    // ... and the original Slice 5 narrative it amends is preserved, not
    // rewritten (CLAUDE.md's "Freshen Reflex").
    expect(doc).toContain('Finding, not a gap left open:');
    // ... and the limitation is stated rather than claiming enforcement.
    expect(doc).toContain('rec-20260917-006');
    expect(doc).toMatch(/does not enforce that every phase/i);
  });

  it('312-01/AC-2: with phase-build in telemetry the real pack passes and attributes its demand to pack:cadence/core-skills', async () => {
    const config: Pick<CadenceConfig, 'packs'> = { packs: { enabled: [PACK_ID], disabled: [] } };
    const resolved = await resolvePacks(REPO_ROOT, config);
    const ctx = minimalCtx() as unknown as {
      state: { skillAudit: { required: string[]; invoked: string[] } };
    };
    ctx.state.skillAudit.invoked = ['phase-build'];

    const result = await runSkillAuditCheck(ctx as unknown as SettleContext, resolved);
    expect(result.outcome).toBe('pass');
    // This is the attribution settle copies into SUMMARY.skillAudit.provenance.
    expect(result.requiredWithProvenance).toContainEqual({
      skill: 'phase-build',
      source: `pack:${PACK_ID}`,
    });
    // Nothing was bypassed to get here — the requirement was genuinely met.
    expect(result.bypassed).toBeUndefined();
    // ATTRIBUTION, not enforcement: this passes because 'phase-build' is in the
    // invoked list, which is checkout-scoped, deduped and never reset
    // (rec-20260917-006). It does not show the skill ran during any phase.
    // Asserted at the check level rather than by reading this phase's own
    // SUMMARY, which would be self-referential — the artifact is corroborating
    // evidence, not the proof.
  });

  it('312-01/AC-6: declaring the requirement leaves doctor packs and pack-commands checks clean', async () => {
    // Blast-radius guard: the bundled pack now ships a requirement, and every
    // consumer that enables it resolves this manifest. A declaration that broke
    // either doctor check would degrade every such repo, not just this one.
    const packsCheck = await checkPacks(REPO_ROOT);
    expect(packsCheck.severity).toBe('ok');
    expect(packsCheck.detail).toContain(PACK_ID);

    const commandsCheck = await checkPackCommands(REPO_ROOT);
    expect(commandsCheck.severity).toBe('ok');
  });
});
