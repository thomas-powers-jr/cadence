---
"@thomas-powers-jr/cadence-core": patch
---

Fix: `cadence doctor`'s `conduction-reachability` check's profile-axis remediation text is now pack-aware, matching the VERDICT phase 302 already made pack-aware.

`profileRemediationHint` (`packages/core/src/doctor/run.ts`) previously returned one of two hardcoded strings naming `code-review`/`security-audit`'s reachable `(profile, tier)` cells from raw `DELTAS` only. A pack that adds a gate at a cell absent from raw `DELTAS` made `assessGateReachability`'s reachability VERDICT correctly report the gate reachable (phase 302), but if the gate was still blocked under the operator's *current* profile, the remediation text never mentioned the pack-added cell as a place to switch to — the hint stayed matrix-blind even after the verdict itself became pack-aware (`rec-20260916-001`).

`profileRemediationHint` now enumerates a gate's reachable cells dynamically via `effectiveGateSet` across all 3 profiles × 3 tiers (the same pack-aware chokepoint the verdict already uses), grouped by profile in a fixed `['strict', 'standard', 'auto']` order with tiers in `['quick-fix', 'standard', 'complex']` order, rendering a single-cell or multi-cell sentence depending on how many cells are reachable. `gatesFor`, `DELTAS`, and `assessGateReachability` itself are unchanged. As with phase 302, this repo's only real pack manifest declares no `gates[]`, so `cadence doctor`'s own output is unchanged today — the gap was latent, not live.
