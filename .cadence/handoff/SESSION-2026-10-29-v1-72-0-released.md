---
cadence_handoff: 2
generated_at: 2026-10-29T18:39:41.563Z
label: v1-72-0-released
loop_position: IDLE
active_phase: 
active_draft: 
tier: 
git_branch: claude/zen-keller-cp16ug
git_dirty: false
git_head: b2cb17db
git_ahead: 0
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-10-29 (v1-72-0-released)

## TL;DR for the next session
- **v1.72.0 is live:** all five packages are on npm, tag `v1.72.0` points at `b2cb17db` (#586), and the GitHub release is published. It ships phases 335, 336, 337 and 338.
- **`main` = `b2cb17db`. The loop is IDLE and the next phase number is 339.** No changesets are pending.
- **This supersedes `SESSION-2026-10-29-336-merged-cloud-workspace.md`.** That doc's open decision (release or 339) is resolved: the operator released first. Its cloud-workspace gotchas still apply and are repeated below.
- **Next action:** the operator picks phase 339. The candidates are the CRLF/BOM parser family (rec-20260918-005/006/007) or hardening 336's checkpoint Stop gate (rec-20261023-001/002).

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `claude/zen-keller-cp16ug` (clean), 0 ahead / 0 behind origin
- HEAD `b2cb17db`
- Recent commits:
```
b2cb17db chore(release): v1.72.0 -- checkpoint force-releases reach gateBypasses (#586)
2bb895dc chore(cadence): session handoff -- phase 336 merged, cloud workspace set up (2026-10-29) (#585)
ec1b545b feat(checkpoint): Stop gate, single-winner SessionStart reset and hook installer (phase 336) (#581)
6cd1d971 fix(core): doctor and onboard check that the host-cli binary exists (phase 337) (#583)
006bcbd8 fix(security): clear the zod, body-parser and undici high advisories with override floors (phase 338) (#584)
572b3317 fix(core): handoff retention prune never deletes a git-tracked doc (phase 335) (#579)
eb31cb2a chore(release): v1.71.0 -- findings bypasses reach gateBypasses (#578)
d2156c3a chore(cadence): session handoffs -- phases 331-334 landed (2026-10-20, 2026-10-21) (#574)
```
- Loop: IDLE · phase (none) · tier (none)

## CADENCE context   ·  pre-filled from `cadence context handoff`
- Top recommendations:
  - rec-20260907-002 — packages/core/tsconfig.json includes only src/**/*, so no repo command ever typechecks tests/ (candidate/ready-for-cadence-spec)
  - rec-20260917-008 — docs/reference/config.md overclaims skill-audit: says it enforces skills were invoked 'during a phase', which the checkout-scoped invoked list does not support (candidate/ready-for-cadence-spec)
  - rec-20260918-005 — DRAFT.md with UTF-8 BOM (+ optionally CRLF) still throws the misleading 'missing frontmatter' error (candidate/ready-for-cadence-spec)
  - rec-20260918-006 — draft-mutate.ts's add-ac/add-task splice regexes are \n-only, so a CRLF draft now fails with a different misleading error post-phase-310 (candidate/ready-for-cadence-spec)
  - rec-20260918-007 — spec-parser.ts and ui-spec-parser.ts have the identical CRLF frontmatter-rejection bug phase 310 fixed for draft-parser.ts (candidate/ready-for-cadence-spec)
- Open assumptions:
  - (none)
- Active decisions:
  - dec-20260711-001 — Multi-language assertion-coverage: fast diagnose-fix now, shared-lexer engine as a later phase
  - dec-20260721-001 — cadence next extends nextAction(), does not subsume quickstart or reimplement
  - dec-20260721-002 — Shared legal-moves computation also powers empty-state footers (rec-20260721-001)
  - dec-20260721-003 — cadence next --json includes schemaVersion: 1
  - dec-20260721-004 — Ship /cadence-next slash command alongside the CLI command
  - dec-20260724-001 — Enforce ledger-diff at audit close, not a standing rule
  - dec-20260724-002 — Scope rec-20260724-003 to a CHANGELOG-currency gate only, defer auto-generation
  - dec-20260726-001 — Split SUMMARY.json attestation: content-hash now, full signing deferred to threat model
  - dec-20260730-001 — Coverage phase-scoping uses a phase-qualified test token, not file-ownership scoping
  - dec-20260728-001 — Phase 233 AC-3 tripwire cleared: assurance-record derivation is gate-agnostic
  - dec-20260729-001 — Phase 234 AC-1 narrowed: contracts/ is the type-naming surface, not the resolution surface
  - dec-20260729-002 — Uniform opts? on VerifierPort is what makes zero-special-cases true
  - dec-20260729-003 — Phase 235 scope: criteria-anchoring is code-review only, not spec-review/ui-spec-review/plan-review
  - dec-20260729-004 — Anchor executable tier: non-empty verify + build-test-must-pass ran, no prose heuristic
  - dec-20260729-005 — Criteria-gap refusal reuses code-review's existing HIGH-severity refuse path, not gates.evidenceFloor
  - dec-20260729-006 — D3 unconditional declaration binds the floor outcome, not the empty-gap case
  - dec-20260731-001 — Findings-to-ledger routing merges same-identity findings by design; the identity hash itself is not changed
  - dec-20260801-001 — Add a settle-time guard for global-CLI-shadowing-branch-build; interim rule is settle via the local build
  - dec-20260801-002 — Finding identity narrowed to (file, normalized message); anchor/severity dropped as identity inputs
  - dec-20260801-003 — Defer finding-identity message-drift dedup: wait for real-provider data, offline analyzer first
  - dec-20260802-001 — Refused gate-loop settles thread acc's findings into the SUMMARY, with a conditional contentHash
  - dec-20260802-002 — Attempt preservation via timestamp-slugged sibling artifact, invisible to all current SUMMARY consumers by construction
  - dec-20260802-003 — Ledger routing stays finalize-only on refusal; Slice 3's revisit trigger amended to name its precondition
  - dec-20260803-001 — Conduction stays operator-initiated: guard and gate set retained; mock-provider default is a separate ordinary config decision
  - dec-20260804-001 — Defer baseline profile change to v1.56 Phase P
  - dec-20260806-001 — 256-01's assurance:strong record is void -- empty-diff false pass, not a real certification result
  - dec-20260808-001 — D-A: Do not rename the mock provider identity
  - dec-20260808-002 — D-B: Do not require a real verifier provider at cadence init
  - dec-20260808-003 — v1.56 Phase O sequenced after Phase P, not before (amends HANDOFF-v1.56 §5 priority table)
  - dec-20260808-004 — J.1 (overall: strong structurally unreachable) resolved for the profile-override path; still true for the default auto-profile path
  - dec-20260808-005 — Phase L's providerSelection field widens to a third state covering empty-diff false-pass, not just configured/fallback
  - dec-20260808-007 — providerSelection field: optional enum, no default, no schemaVersion bump (corrected citation)
  - dec-20260808-008 — Phase 263 (v1.56 Phase L): narrow providerSelection persistence to 5 seams, exclude deep-verify/per-task-verify
  - dec-20260808-009 — Phase M: render-time join over AssuranceRecordZ schema change for providerSelection
  - dec-20260808-010 — Phase M: umbrella mock-capability label, not per-verifier-family variants
  - dec-20260809-001 — Bundle rec-20260806-010 + rec-20260809-002 into one CI-timeout-remediation phase
  - dec-20260809-002 — Phase P (267): mock abstains on review gates rather than passing them
  - dec-20260809-004 — Phase 267 (P.1, corrected): mock abstention is identity-at-recording, not no-dispatch
  - dec-20260809-005 — Phase 267 (P.1, mechanism correction): plan-review/spec-review/ui-spec-review abstain via converge.ts's shared sidecar, not registry.ts
  - dec-20260810-001 — Phase 267 (T6): repo profile flipped auto -> standard, closing dec-20260804-001's revisit trigger
  - dec-20260810-002 — Phase 267 (fix round): converge.ts sidecar persists verdict:'abstained'+pass:false/converged:false for mockAbstained entries, not pass:true+sibling flag
  - dec-20260810-003 — Phase 267 (fix round 3): code-review.ts's own CODE-REVIEW.json sidecar also abstains under mock, independent of registry.ts's SUMMARY-level relabel
  - dec-20260810-004 — Phase O (268): build the drift counter now, defer O.3's measured threshold
  - dec-20260810-005 — Phase O (268): add an indeterminate rung to DoctorSeverity, resolving v1.55 J.2
  - dec-20260811-001 — D-E: security-audit stays unreachable through v1.56 (option 2, matrix change, deferred to v1.57)
  - dec-20260811-002 — Reaffirm deep-verify/per-task-verify provenance exclusion through v1.56.0, defer to v1.57
  - dec-20260812-002 — D-H: 'unobservable' evidence class sits off-ladder, orthogonal to AcEvidenceZ
  - dec-20260812-003 — D-I: reaffirm security-audit deferral at profile=standard, do not reopen the DELTAS matrix in v1.57
  - dec-20260812-004 — D-G (corrected measurement): unobservable-AC criteria get a new settle-time verdict class, DRAFT-time refusal deferred to v1.58
  - dec-20260813-001 — W.0: rec-20260812-004 is a duplicate of rec-20260809-001 -- reconciled into the earlier filing
  - dec-20260813-002 — Phase U (v1.57 arc): skipped -- D-I already reaffirmed security-audit deferral
  - dec-20260813-003 — W.2: reaffirm dec-20260810-004's deferral of O.3's measured threshold -- corrected real-data measurement recorded, no new number invented
  - dec-20260813-004 — W.3: reaffirm documented-blocker posture -- no CLI path exists to close a milestone whose sole rec shipped out-of-band; building one is out of scope for a decisions-only phase
  - dec-20260814-001 — D-M: accept archiveReason=manual for the pre-phase-102 archive backfill
  - dec-20260815-001 — D-DQ1: Task execution class -- declared field wins, heuristic cross-checks via coherence warn
  - dec-20260815-002 — D-DQ2: boundaryEnforcement escalates to block, dispatch-scoped, once DP-B lands
  - dec-20260815-003 — D-DQ3: contextBudgetThreshold stays inert this arc -- tokenUtilization is a fake signal
  - dec-20260815-004 — D-DQ4: stop-condition coherence severity is warn, not a blocker, for now
  - dec-20260815-005 — D-N: cadence done becomes a true alias for build task --status=DONE
  - dec-20260815-006 — D-N2: done inherits buildTaskService's unknown-task-id guard too, a third pre-existing gate
  - dec-20260815-007 — D-N3: buildTaskService gains an additive optional anomalySource param for the LoopViolation tag
  - dec-20260816-001 — Fix demo-gutting-coverage-scheme.test.ts flake via per-test timeout, not global bump
  - dec-20260816-002 — D-P amendment: four coverage-dedup filings exist, not three; primary chosen on decision-carrying not chronology
  - dec-20260816-003 — D-O: fix coverage dedup via prefer-qualifying (option 1), not drop-dedup or align-explain-down
  - dec-20260816-004 — Phase D folds into Phase C itself, not a future phase
  - dec-20260816-005 — D-R: bypass/deepVerify honesty enters via a new third argument to deriveAssuranceRecord, acResults untouched
  - dec-20260816-006 — D-S: cap overall at mixed on error-severity bypass, no AssuranceRecordZ schema change
  - dec-20260816-007 — D-T: dec-20260728-001's gate-agnostic invariant is honored, not relitigated
  - dec-20260816-008 — D-U: report-only, no backfill of historical SUMMARY.json grades
  - dec-20260820-001 — D-V: 282-01/AC-2 amended -- pre-fix repro proven impossible
  - dec-20260820-002 — D-V: 282-01/AC-4 split verdict -- runs-summary-verify-all strengthened, phase-id-enumeration already satisfied
  - dec-20260820-003 — D-W: amendment-vs-verifier gap filed as recommendation only (file-only)
  - dec-20260820-004 — Normalize an already-qualified --explain arg, don't reject it
  - dec-20260821-001 — D-Y: boundary files: glob expansion -- full vocabulary, wildcard-only zero-match detection, warn-only, isolated from refusal paths
  - dec-20260821-002 — 286-01/AC-2 amended -- pre-change temporal capture proven unverifiable by a static-tree-reading verifier, not just hard
  - dec-20260821-003 — rec-20260821-003 is a duplicate of rec-20260821-002 -- reconciled into the earlier, richer filing
  - dec-20260821-004 — D-Z: rec-20260807-005 premise corrected -- fresh init already defaults to phase-qualified since phase 239
  - dec-20260822-001 — rec-20260731-003 is shipped: top-level provider field (phase 232) + fallback distinction (phase 263) both landed; remaining deep-verify sliver already answered by dec-20260808-008
  - dec-20260822-003 — D-Z: hasRealVerifier excludes empty-diff-only non-mock gates from earning strong (option 1 of HANDOFF-verifier-honesty-verify-premises.md D-Z)
  - dec-20260822-004 — rec-20260813-002's deep-verify fallback-visibility ask is already answered by dec-20260808-008, not a live gap
  - dec-20260822-005 — AC-J1/AC-J2 amendment: 're-scope rec summary' executed via evidence+decision+promote, not literal summary-text edit
  - dec-20260822-006 — D-AB: no backfill of historical SUMMARY.json records for the empty-diff assurance-grade fix
  - dec-20260822-007 — Reconciliation: dec-20260822-002 was an unauthorized write by a fork agent, not a rival human session
  - dec-20260822-008 — Correction: empty-diff is easily reachable, not merely 'latent' -- 298-record corpus count still stands for D-AB
  - dec-20260822-009 — Correction to dec-20260822-008: 283-01/AC-2's settle.test.ts assertion was NOT invariant to the fix -- 283-02/AC-1 was
  - dec-20260822-010 — D-AD: zero-AC drafts refuse at approve+settle, not a schema minimum
  - dec-20260822-011 — D-AE: non-numeric AC headings reject loudly, AC_TOKEN_RE stays numeric-only
  - dec-20260822-012 — D-AF: dispatch write authority -- env-var read-only mode is viable, env DOES propagate to dispatched sub-agents
  - dec-20260822-013 — D-AL: reject rec-20260822-006 -- writeLedger is guarded, full intelligence/** writer audit found zero bypass
  - dec-20260822-014 — D-AM: file the routing-reconciliation gap, not a staleness-of-review-finding claim
  - dec-20260822-015 — D-AN: item-2 evidence via reconstruction (option 3), not a repeat live deep-verify run or a schema change
  - dec-20260822-016 — D-AO: item 2 does not block the packs arc
  - dec-20260822-017 — Packs I-1: namespaced id grammar <scope>/<name>, internal packs use 'cadence' scope
  - dec-20260822-018 — Packs I-2: manifest carries id/version/integrity from day one; integrity optional for source=local
  - dec-20260822-019 — Packs I-3: gate deltas are tighten-only, enforced for internal packs too, structurally and behaviorally
  - dec-20260822-020 — Packs I-4: resolution via resolvePacks() (impure shell), application via effectiveGateSet() -- both single chokepoints
  - dec-20260822-021 — Packs I-5: precedence is trivial by construction -- union of a monotonic-only payload can't conflict
  - dec-20260822-022 — Packs I-6: packs declare skills by name only, never ship skill bodies through CADENCE
  - dec-20260822-023 — Packs D-AP: payload allowlist = skillAudit.required + gates[].add + declared commands (doctor-checked only)
  - dec-20260822-024 — Packs D-AQ: no pack dependencies in v1; on enabled/disabled id collision, disabled wins
  - dec-20260822-025 — Packs D-AR: discovery via .cadence/packs/<id>/pack.json (filesystem-local, git-tracked); doctor warns now, refuses once behaviorally consumed
  - dec-20260822-026 — Packs D-AS: skillAudit provenance recorded per-requirement (config/draft/pack:<id>), not flattened
  - dec-20260822-027 — Packs D-AT: public naming deferred, not decided; 'packs' stays the config/internal term
  - dec-20260822-028 — Packs 4c: softCap is orthogonal to gate enforcement, verified not assumed -- no exemption needed for pack gates
  - dec-20260915-001 — rec-20260907-004's hono/fast-uri premise is discharged; current audit failure is a fresh js-yaml advisory
  - dec-20260915-003 — Inline gitleaks:allow comments do not retroactively suppress historical commits -- .gitleaksignore fingerprints are also required
  - dec-20260916-001 — Correction to dec-20260822-020: doctor's reachability scan is pack-aware since phase 302, not the deferred exception
  - dec-20260918-001 — D-BF-adjacent: classifyTier's minTasks floor is not wired into the coherence gate
  - dec-20260918-002 — Phase 315: per-phase skill-invocation scoping via a timestamped invocations map, watermarked against draftReadAt
  - dec-20260918-003 — Phase 315: invocations map needs no cap; SKILL_AUDIT_CAP=100 on invoked is unaffected
  - dec-20260918-004 — Phase 315 reaffirms D-BE/D-BF: tightening skill-audit will legitimately refuse more phases; build phase 315 itself via phase-build in a fresh worktree
  - dec-20260918-005 — Phase 315: no backfill of historical SUMMARY.json/state.json records under the temporal fix
  - dec-20260925-001 — D-BN: hook blocks transport via per-event JSON decision on stdout, exit 0 -- not exit code 2
  - dec-20260926-001 — Correction to rec-20260926-001: bug is Claude-Code-specific, Codex's SubagentStop inertness is a declared, self-reported gap
  - dec-20260926-002 — D-BP: doctor states the hook-shell transport rule, does not claim to measure the resolved shell
  - dec-20260926-003 — D-BO: doctor reports the posture now (b); a settle-time anomaly (c) is filed, not built, in this phase
  - dec-20260926-004 — Correction to dec-20260926-001: Codex's agentIdentification:false is now stale documentation, not a permanent protocol gap
  - dec-20261010-001 — D-BT: the corpus rollup is a new top-level noun, cadence assurance report
  - dec-20261010-002 — D-BU: report stored grades, re-derived grades, and the delta -- for the 86 graded records only
  - dec-20261010-003 — D-BV: assurance report ships descriptive only -- no floors, no doctor check
  - dec-20261010-004 — D-BW: the generated docs/evidence/assurance.md page is filed (rec-20261010-004), not built in phase 327
  - dec-20261013-001 — D-BJ: checkpoint sensor threshold is a percentage with absolute-token fallback; state records both units
  - dec-20261013-002 — D-BR: packages/checkpoint depends on cadence-core for atomicWriteText; no copy, no extraction
  - dec-20261013-003 — D-BS: checkpoint state file lives at .cadence/checkpoint/, project-keyed
  - dec-20261016-001 — D-BX: decline after-the-fact authorization of 331-01 code-review finding 7; slice 331-02 owns the fix
  - dec-20261016-002 — D-BY: fix 331-01's red CI in a new slice 331-02, not a post-settle fix-forward
  - dec-20261016-003 — D-BZ: 331-01's SUMMARY is not edited; its strong grade stays as the record
  - dec-20261016-004 — D-CA: code-review/security-audit findings bypasses reach gateBypasses by direct push keyed on reviewFindingsBypassed, not via a new anomaly
  - dec-20261016-005 — D-CB: a --force bypass of failing code-review is recorded too, naming the flag the gate printed
  - dec-20261016-006 — D-CC: security-audit findings bypasses are fixed in the same phase
  - dec-20261016-007 — D-CD: correction to D-BZ -- the corpus re-derivation will not show 331-01's drift; measure it on a copy and file the gap
  - dec-20261022-002 — D-CE (rev. 1): a checkpoint Stop-gate force-release leaves a sticky lastForcedAt in checkpoint state.json; settle surfaces it as a 'checkpoint-force-released' anomaly mapped to gateBypasses
- Files in play:
  - `packages/core/tsconfig.json` — affected by rec-20260907-002 packages/core/tsconfig.json includes only src/**/*, so no repo command ever typechecks tests/
  - `docs/reference/config.md` — affected by rec-20260917-008 docs/reference/config.md overclaims skill-audit: says it enforces skills were invoked 'during a phase', which the checkout-scoped invoked list does not support
  - `packages/core/src/parse/draft-parser.ts` — affected by rec-20260918-005 DRAFT.md with UTF-8 BOM (+ optionally CRLF) still throws the misleading 'missing frontmatter' error
  - `packages/core/src/parse/draft-mutate.ts` — affected by rec-20260918-006 draft-mutate.ts's add-ac/add-task splice regexes are \n-only, so a CRLF draft now fails with a different misleading error post-phase-310
  - `packages/core/src/parse/spec-parser.ts` — affected by rec-20260918-007 spec-parser.ts and ui-spec-parser.ts have the identical CRLF frontmatter-rejection bug phase 310 fixed for draft-parser.ts
  - `packages/core/src/parse/ui-spec-parser.ts` — affected by rec-20260918-007 spec-parser.ts and ui-spec-parser.ts have the identical CRLF frontmatter-rejection bug phase 310 fixed for draft-parser.ts

## What landed this session
- **#581 (phase 336), the checkpoint Stop gate,** was squash-merged as `ec1b545b`. CI was green 13/13, and the PR head re-ran locally at 28/28.
- **#585, the first cloud-workspace handoff,** merged as `2bb895dc`.
- **#586, the v1.72.0 release cut** (`release-cut` skill), merged as `b2cb17db`:
  - `pnpm changeset:version` consumed the 335, 336 and 337 changesets. All five published packages went to 1.72.0; `testkit` (1.4.0) and `checkpoint` (0.0.0) did not move.
  - Phase 338 had no changeset, as its DRAFT's boundaries required. It is recorded by hand under Security in the root CHANGELOG.
  - Doc-sync: `CLAUDE.md` and `DESIGN.md` version lines bumped. The two remaining `1.71` hits, in `docs/checkpoint/REPORT-checkpoint-phase-3.md`, are historical work-order file names.
  - Local pipeline 28/28 (core 5019 passed); CI on #586 13/13.
- **The Release workflow:**
  - Run #91 was a `dry_run`; it was green, and publish, tag and release were skipped.
  - Run #92 was the real run; every step was green.
- **Independent verification:**
  - `npm view` shows 1.72.0 for core, types, host-claude-code, host-codex and host-toolkit.
  - `git ls-remote` shows tag `v1.72.0` pointing at `b2cb17db`.
  - The GitHub API shows the `v1.72.0` release published, neither draft nor prerelease.
- **Recommendations:** no promotion was needed. rec-20261016-004 (335), rec-20261027-001 (337) and rec-20261027-002 (338) were already `shipped` at settle. Phase 336 was handoff-authorized and had no rec.

## Carry-forward gotchas
- **This cloud session's git proxy refuses branch deletion and force-pushes.**
  - Deleting a branch fails with `git push --delete` → "remote end hung up". The merged `feat/336-checkpoint-stop-gate` branch therefore still exists on the remote; the operator was asked to delete it in the GitHub UI.
  - Force-push is denied. When a session branch's earlier PR was squash-merged, restart from `origin/main` and then merge the old remote tip (no content change) so the push fast-forwards. The squash-merge flattens it.
- **`gh` is unauthenticated in the container.** Workflow dispatch and release checks went through the GitHub MCP tools and the public GitHub API (`curl api.github.com`); `npm view` works directly.
- **Filtered doc-test runs exit 1** (`pnpm --filter … test -- docs-published`) because a subset can't meet the global coverage thresholds. Read the vitest test counts, not the exit code. The unfiltered pipeline is the real gate.
- **The `publish-proof.test.ts` stderr prints `FAIL loop: cadence init`** as part of an expected-failure test. It is not a test failure.
- **Every gotcha from `SESSION-2026-10-29-336-merged-cloud-workspace.md` still applies:**
  - Container state is ephemeral; rerun `cadence onboard --skip-host-wire` in a new container.
  - The setup-script draft is still pending in the environment settings.
  - `deja` and `codex` are missing.
  - `cadence recommend` rewrites its output files.
  - CLAUDE.md's package table omits `checkpoint`.

## Open decisions
- **What phase 339 is.** The operator decides between:
  - the CRLF/BOM parser family (rec-20260918-005/006/007), which matters on the Windows PCs;
  - checkpoint Stop-gate hardening (rec-20261023-001/002, both MEDIUM);
  - rec-20260907-002 (no repo command typechecks `tests/`).

## Next action
**Action:** once the operator picks phase 339, draft it through the loop: SPEC/DRAFT → BUILD → SETTLE, with the `phase-build` skill for a non-trivial phase.

**Verify before acting:**
- `git log origin/main --oneline -1` shows `b2cb17db` or later.
- `npm view @thomas-powers-jr/cadence-core version` shows `1.72.0`.
- `node packages/core/bin/cadence.cjs status` shows `loop: IDLE`.
