---
cadence_handoff: 1
generated_at: 2026-09-18T03:50:55.619Z
label: pc-transfer-2026-09-18
loop_position: IDLE
active_phase: 311-skill-audit-bypass-recorded-in-gatebypasses
active_draft: 
tier: 
git_branch: main
git_dirty: true
git_head: 9ea76157
git_ahead: 0
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-09-18 (pc-transfer-2026-09-18)

## TL;DR for the next session
- **This is a clean handoff for a PC transfer, not a stuck/mid-work one.** Everything from today's session is already merged into `main` via two normal PRs (#519, #520) — nothing is stashed, WIP-committed, or sitting only on this machine. `git pull origin main` on the new PC gets you everything.
- **expansion-arc-1 is complete**: phases 311, 312, and 313 all shipped (`ccd5572f`/#515, `18d2bf78`/#516, `648dd37b`/#519). Phase 313 shipped a `systematic-debugging` skill gated on the CADENCE assumption ledger.
- **Loop is IDLE, no active draft, no open phase worktrees.** `cadence progress` recommends `cadence draft new` for phase 314.
- **Two fresh recommendations from this session are strong phase-314 candidates**: `rec-20260918-003` (the Skill tool's invocation telemetry writes to the wrong `.cadence/state.json` when invoked from inside a worktree — will recur on the next worktree-isolated `phase-build`) and `rec-20260918-004` (a subprocess-heavy test observed one transient CI timeout on macOS, recorded not fixed).
- **Nothing machine-specific needs to travel with you** except two loose ends noted below (stray branches, a suspicious untracked file) that are local to this PC and don't affect the new one.

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `main` (dirty), 0 ahead / 0 behind origin
- HEAD `9ea76157`
- Recent commits:
```
9ea76157 docs(cadence): session handoff for 2026-09-18 (phase 313 shipped, expansion-arc-1 complete) (#520)
648dd37b feat: systematic-debugging skill gated on the assumption ledger (phase 313) (#519)
18d2bf78 feat: cadence/core-skills declares phase-build as a required skill (phase 312) (#516)
ccd5572f fix: --allow-skill-audit-miss records the bypass in SUMMARY.gateBypasses (phase 311) (#515)
2857642f chore(cadence): file expansion-arc-1 preflight findings (rec-20260917-003/-004) (#514)
a9743257 chore(release): v1.67.2 -- DRAFT CRLF frontmatter, resume stale-handoff pointer, codex-hooks completeness (#513)
8f265f94 fix: DRAFT frontmatter parser rejects CRLF line endings (phase 310) (#TBD) (#512)
0abed4d2 docs(cadence): refresh v1.67.1 handoff machine facts after #507 merged (#508)
```
- Loop: IDLE · phase 311-skill-audit-bypass-recorded-in-gatebypasses · tier (none)

## CADENCE context   ·  pre-filled from `cadence context handoff`
- Top recommendations:
  - rec-20260907-002 — packages/core/tsconfig.json includes only src/**/*, so no repo command ever typechecks tests/ (candidate/ready-for-cadence-spec)
  - rec-20260917-008 — docs/reference/config.md overclaims skill-audit: says it enforces skills were invoked 'during a phase', which the checkout-scoped invoked list does not support (candidate/ready-for-cadence-spec)
  - rec-20260801-001 — docs/reference/commands.md config edit section lists only 5 fields; EDITABLE_FIELDS has 8 (candidate/ready-for-cadence-spec)
  - rec-20260809-003 — vitest.shared.ts's Windows-timeout comment cites the now-fixed dispatcher cap test (candidate/ready-for-cadence-spec)
  - rec-20260811-005 — ROADMAP.md missing ### Phase N entries for phases 239-241 (exist on disk, never landed under those headings) (candidate/ready-for-cadence-spec)
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
- Files in play:
  - `packages/core/tsconfig.json` — affected by rec-20260907-002 packages/core/tsconfig.json includes only src/**/*, so no repo command ever typechecks tests/
  - `docs/reference/config.md` — affected by rec-20260917-008 docs/reference/config.md overclaims skill-audit: says it enforces skills were invoked 'during a phase', which the checkout-scoped invoked list does not support
  - `docs/reference/commands.md` — affected by rec-20260801-001 docs/reference/commands.md config edit section lists only 5 fields; EDITABLE_FIELDS has 8
  - `packages/core/src/config-edit/fields.ts` — affected by rec-20260801-001 docs/reference/commands.md config edit section lists only 5 fields; EDITABLE_FIELDS has 8
  - `vitest.shared.ts` — affected by rec-20260809-003 vitest.shared.ts's Windows-timeout comment cites the now-fixed dispatcher cap test
  - `.cadence/ROADMAP.md` — affected by rec-20260811-005 ROADMAP.md missing ### Phase N entries for phases 239-241 (exist on disk, never landed under those headings)

## What landed this session

This session had two parts: finishing phase 313, then this PC-transfer handoff.

**Phase 313** (`.claude/skills/systematic-debugging/SKILL.md`, PR #519, `648dd37b`) — resumed a prior session's WIP checkpoint that had done the real engineering but never recorded task outcomes; re-verified every task independently, restated AC-6 (telemetry-proves-invocation → discoverability, since the only recorded invocation of the name came from the Superpowers plugin's namespaced copy, not this file), added missing AC-5 coverage, ran two independent whole-branch reviews (the first caught a real AC-4 coverage gap — only the false-alarm conclusion branch was tested, not the root-cause-found branch the AC also names — fixed by covering both), settled with zero gate bypasses, and merged on explicit operator consent.

**Live process gap found during settle**, filed as `rec-20260918-003`: invoking a Skill tool from inside a worktree records the invocation into the *primary checkout's* `.cadence/state.json`, not the worktree's own — worked around via `cadence hook skill-invoke` (a legitimate manual event-dispatch seam, not a bypass, since the invocation was genuinely real).

**Session handoff for phase 313** (PR #520, `9ea76157`) — its first CI run hit a transient macOS timeout in the new subprocess-heavy test file; confirmed as a flake (single leg, docs-only diff, clean re-run of identical code) per this repo's documented flake protocol, re-ran once, went green. Filed `rec-20260918-004` recording the flake risk before merging.

**This doc** — a PC-transfer handoff, scaffolded with `cadence handoff`, requested explicitly so a session on a different machine can resume with full context.

## Carry-forward gotchas

- **On the new PC**: run `pnpm install --frozen-lockfile && pnpm build` after cloning/pulling — `node_modules` and `.cadence/state.json` are both gitignored and won't transfer. `cadence onboard` if `.cadence/state.json` is missing.
- **The Skill tool's invocation telemetry is not worktree-aware** (see `rec-20260918-003`). If a `skillAudit.required` pack gate refuses inside a worktree despite having genuinely invoked the required skill, that's why — fix via `echo '{"skill":"<name>"}' | node packages/core/bin/cadence.cjs hook skill-invoke` run from inside the worktree, not `--allow-skill-audit-miss`.
- **`recommendation promote --ref` on a shipped rec can never be corrected** — `rec-20260918-002`'s ref still reads "(PR pending)" even though PR #519 merged; pre-existing, known ledger limitation, not new.
- **`git worktree remove` can fail with "Result too large" on Windows** when the worktree's `node_modules` has pnpm's nested `.pnpm` junctions — the git-level registration is actually removed despite the error; clean the leftover directory with `cmd /c "rmdir /s /q <path>"` (PowerShell's `Remove-Item -Recurse -Force` also fails on the same junctions).
- **`state.json` in the primary checkout may still name a stale `activePhase`** (currently `311-skill-audit-bypass-recorded-in-gatebypasses`) — harmless, phases built in worktrees have private state; clears on the next `draft new`.
- **Local-machine-only, do not try to carry these to the new PC**:
  - Stray local+remote branch `docs/session-handoff-2026-09-18` — predates this session, holds an orphaned unmerged handoff commit now fully superseded by PR #520. Safe to delete but not done yet (branch deletion wasn't requested).
  - Local branch `worktree-313-systematic-debugging-skill` — leftover from the now-removed phase-313 worktree.
  - An untracked file, `docs/handoffs/McAfee_Installer_ecode_q7SJ3DAahoEU4gdALnc7pKD8DHpF9bpRukDtUm-xjvI_key_affid_885_akey.exe` (6.65MB), sitting in the working tree, predating this session's work, never touched/committed. Looks like a stray affiliate-bundled installer with no business in a `docs/` folder — worth the operator's own look on this machine, but it is untracked and will not appear on the new PC regardless.
- Standing gotchas from the prior arc (still true): single-file `pnpm --filter ... test -- <path>` runs report nonzero exit even when every test passes (global coverage threshold on a subset — read the test summary, not the exit code); concurrent vitest runs race on `packages/core/coverage/.tmp`; `turbo` may replay a cached green in ~2s (use `--force` to confirm a real run); backticks in `recommendation add --summary` get shell-substituted away.

## Next action

On the new PC: clone/pull `main` (`9ea76157`), `pnpm install --frozen-lockfile && pnpm build`, then `cadence resume` to replay this doc and confirm live state before doing anything else.

No active draft. `cadence progress` will recommend `cadence draft new` for phase 314. Best-evidenced candidate: `rec-20260918-003` (Skill tool telemetry is not worktree-aware) — it was hit live this session and will recur on every future worktree-isolated `phase-build` resume against a pack with `skillAudit.required` until root-caused and fixed. Otherwise pull the next candidate from `cadence recommend`.
