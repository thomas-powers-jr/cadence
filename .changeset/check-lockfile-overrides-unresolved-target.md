---
"@thomas-powers-jr/cadence-core": patch
---

Fix: `scripts/check-lockfile-overrides.mjs` no longer passes vacuously on a `pnpm.overrides` key whose package name matches zero resolved instances in `pnpm-lock.yaml`.

`checkOverrideCoverage`'s core loop only checks a declared override target once some lockfile instance's package name matches it, so a target for a package that no longer resolves anywhere in the tree — dead weight left over from a removed/renamed dependency, or a typo in the key — was never visited and the detector reported `ok: true` regardless. It now separately tracks which declared targets were matched by at least one resolved instance and reports any unmatched target as a new `unresolved-target` failure, without changing the existing `unsatisfied` / `unguarded-line` cases (`rec-20260907-005`).

This gap is distinct from, and was not the actual cause of, the phase-297 fast-uri incident the recommendation cited as motivating evidence — that incident was a too-low override range floor, correctly reported as satisfied by this detector and caught instead by `pnpm audit` (see `.cadence/phases/301-check-lockfile-overrides-flag-override-targets-with-zero-resolved-instances/301-01-DRAFT.md`'s Objective for the full premise correction). The vacuous-pass gap fixed here is real and independently reproduced.
