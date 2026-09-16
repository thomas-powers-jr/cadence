---
"@thomas-powers-jr/cadence-core": patch
---

Fix: `cadence doctor`'s `conduction-reachability` check's profile axis now routes through `effectiveGateSet` (the pack-aware chokepoint) instead of raw `gatesFor`, so a pack that adds `code-review`/`security-audit` via `gates[].add` at a (profile, tier) cell absent from the raw tier×profile matrix is correctly reported reachable once that pack is enabled.

Previously, `assessGateReachability`'s profile axis checked only `gatesFor(tier, profile).gates` across all tiers, never consulting `config.packs` — a false negative in the doctor's own honesty tooling, since `effectiveGateSet` (the real gate-computation chokepoint, pack-aware since phase 292) could report the gate reachable while doctor still said otherwise (`rec-20260823-001`). `gatesFor` itself is unchanged and stays pure/pack-free; only the doctor check's caller now threads `resolvedPacks` through, mirroring the precedent `config-explain`'s current-tier row already set in phase 292. The gap was latent, not live: this repo's only real pack manifest (`.cadence/packs/cadence/core-skills/pack.json`) declares no `gates[]`, so `cadence doctor`'s own output is unchanged today.

`docs/reference/commands.md`'s `conduction-reachability` row and `docs/packs-design.md` §4b are updated to describe the pack-aware profile axis.
