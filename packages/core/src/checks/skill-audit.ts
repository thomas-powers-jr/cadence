import type { SettleContext } from '../gates/types.js';
import type { ResolvedPack } from '../packs/resolve.js';
import { missingSkills } from '../verify/skill-match.js';

/** Where one required-skill demand came from. `pack:<id>` names the resolved
 *  pack that declared it (phase 291, Slice 2). */
export type SkillRequirementSource = 'config' | 'draft' | `pack:${string}`;

/**
 * Result of the required-skill enforcement check. NOT a `GateResult`: it carries
 * `effectiveRequired` so the settle adapter can record it on
 * `state.skillAudit.required` (outside the `summaryPatch` contract), which is why
 * this check is intentionally not a `GateImpl`.
 */
export interface SkillAuditResult {
  readonly outcome: 'pass' | 'refuse';
  /** config.skillAudit.required ∪ DRAFT requiredSkills ∪ each successfully
   *  resolved pack's manifest.skillAudit.required (phase 291), deduped,
   *  order-preserved (config → draft → packs in resolution order).
   *  settle records it on state.skillAudit.required on every non-refuse path. */
  readonly effectiveRequired: string[];
  /** Phase 291 (291-01, T1): the same demands as `effectiveRequired`, but one
   *  entry per (skill, source) pair and NOT deduped across sources — a skill
   *  demanded by both config and a pack yields two entries, so a SUMMARY can
   *  attribute each requirement instead of collapsing it into one anonymous
   *  row. Same source order as `effectiveRequired`. Populated on both the
   *  `pass` and `refuse` paths; settle records it on
   *  `state.skillAudit.provenance` (T2). */
  readonly requiredWithProvenance: { skill: string; source: SkillRequirementSource }[];
  /**
   * Phase 311 (311-01, T1): present (and always `true`) only when a real
   * shortfall was turned into a pass by `--allow-skill-audit-miss`. Absent on
   * every other path — a clean pass (nothing was bypassed even if the flag was
   * passed), a refusal (nothing was bypassed), and the unenforceable
   * `telemetry.skillInvocations === false` path (a config state, not an
   * operator bypass; recording the flag there would name one nobody passed).
   *
   * Mirrors `PackResolutionResult.bypassed` deliberately. skill-audit cannot
   * use the registry's `gates[].skipReason` convention that records
   * `--allow-failing-build` and friends, because it is not a `Gate` enum member
   * and is dispatched outside the Phase 44.1 registry, so it produces no
   * `gates[]` entry at all. A direct `SUMMARY.gateBypasses` push by settle is
   * the only route, and this marker is what tells settle to make it. Before
   * this, the bypass reached stderr and the notifier and nothing else — the
   * durable artifact could not distinguish a bypassed settle from a clean one.
   */
  readonly bypassed?: true;
  /**
   * `required skill(s) not invoked: <missing, joined>`. Present iff
   * {@link SkillAuditResult.bypassed} is. Returned rather than only printed so
   * settle can record the bypass without re-deriving the message — the same
   * reason `PackResolutionResult` returns its own.
   */
  readonly reason?: string;
}

/**
 * Required-skill enforcement check (Phase 34.1 — ROADMAP 23.4). Extracted from
 * settle.ts verbatim (Phase 39.6). NOT a `Gate` enum member — declaring required
 * skills IS the opt-in, so it is an anomaly check, not a profile×tier gate. Lives
 * in `checks/` and is dispatched EXPLICITLY by settle, OUTSIDE the Phase 44.1
 * registry. It reuses `SettleContext` and reaches the notifier only through
 * `ctx.emit.skillAuditMiss`.
 *
 * `config` is `… | null` (null when loadConfig failed). Deliberate null-config
 * behavior: still compute + return the effective required set (so SUMMARY stays
 * truthful) but SKIP enforcement — cannot read telemetry reliably; never
 * false-refuse on a degraded-config path. The `skill-audit-miss` anomaly is
 * UNCONDITIONAL (not under the `anomaly-notify` guard).
 *
 * Phase 291 (Slice 2): `resolvedPacks` is the output of `resolvePacks` — each
 * successfully resolved pack's `manifest.skillAudit.required` joins the union
 * and enforces exactly like a config- or DRAFT-declared requirement. An
 * error-shaped entry (`{ id, source, error }`) contributes nothing here; the
 * refusal for an enabled-but-unresolvable pack is a separate check (T3).
 * `resolvedPacks` is threaded as an explicit parameter rather than a
 * `SettleContext` field because `gates/types.ts` stays free of any `packs/`
 * import. It defaults to `[]`, which reproduces the pre-Slice-2 behavior
 * exactly — the null-config path passes nothing.
 */
export const runSkillAuditCheck = async (
  ctx: SettleContext,
  resolvedPacks: ResolvedPack[] = [],
): Promise<SkillAuditResult> => {
  const config = ctx.config;

  // One pass builds both arrays: `requiredWithProvenance` keeps every
  // (skill, source) pair (deduped only WITHIN a source, so a degenerate
  // duplicate in one list collapses but a cross-source demand never does),
  // while `effectiveRequired` is the deduped, enforcement-facing union.
  const requiredWithProvenance: { skill: string; source: SkillRequirementSource }[] = [];
  const seenPairs = new Set<string>();
  const addAll = (skills: readonly string[], source: SkillRequirementSource): void => {
    for (const skill of skills) {
      const key = JSON.stringify([skill, source]);
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      requiredWithProvenance.push({ skill, source });
    }
  };

  addAll(config?.skillAudit?.required ?? [], 'config');
  addAll(ctx.draft.requiredSkills ?? [], 'draft');
  for (const pack of resolvedPacks) {
    if (!('manifest' in pack)) continue;
    addAll(pack.manifest.skillAudit?.required ?? [], `pack:${pack.id}`);
  }

  const effectiveRequired = [...new Set(requiredWithProvenance.map((e) => e.skill))];
  // Phase 311 (311-01, T1): set ONLY on the bypassed-shortfall branch below, so
  // the final `pass` return can hand settle the one fact it cannot re-derive.
  let bypassReason: string | undefined;
  if (effectiveRequired.length > 0 && config) {
    const invoked = ctx.state.skillAudit.invoked;
    if (!config.telemetry.skillInvocations) {
      await ctx.emit.skillAuditMiss({
        required: effectiveRequired,
        invoked,
        missing: effectiveRequired,
        severity: 'warn',
        unenforceable: true,
      });
    } else {
      const missing = missingSkills(effectiveRequired, invoked);
      if (missing.length > 0) {
        const bypass = ctx.opts.allowSkillAuditMiss === true;
        await ctx.emit.skillAuditMiss({
          required: effectiveRequired,
          invoked,
          missing,
          severity: bypass ? 'warn' : 'error',
          ...(bypass ? { bypassed: true } : {}),
        });
        if (!bypass) {
          ctx.io.err(
            `settle run refused: required skill(s) not invoked: ${missing.join(', ')}. ` +
              `Invoke them, or pass --allow-skill-audit-miss to override.\n`,
          );
          return { outcome: 'refuse', effectiveRequired, requiredWithProvenance };
        }
        ctx.io.err(
          `skill-audit: --allow-skill-audit-miss set; proceeding past ${missing.length} missing skill(s).\n`,
        );
        // Recorded here and nowhere else: this is the only branch where a real
        // shortfall became a pass. The stderr line above is kept exactly as it
        // was — the durable record supplements the loud notice, never replaces
        // it.
        bypassReason = `required skill(s) not invoked: ${missing.join(', ')}`;
      }
    }
  }
  return {
    outcome: 'pass',
    effectiveRequired,
    requiredWithProvenance,
    // Conditional spread, not `bypassed: undefined` — `exactOptionalPropertyTypes`
    // rejects explicitly assigning undefined to an optional field.
    ...(bypassReason !== undefined ? { bypassed: true as const, reason: bypassReason } : {}),
  };
};
