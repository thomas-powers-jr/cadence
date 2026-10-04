---
cadence_handoff: 2
generated_at: 2026-10-04T17:59:26.672Z
label: 320-321-merged-322-built
loop_position: BUILD
active_phase: 322-idle-status-names-the-latest-settled-phase
active_draft: 322-01
tier: standard
git_branch: fix/322-idle-last-settled
git_dirty: true
git_head: afdb0916
git_ahead: 0
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-10-04 (320-321-merged-322-built)

## TL;DR for the next session
- Operator asked for two hotfixes followed by a release: (1) ROADMAP/MILESTONES fall behind settled phases, and (2) `/cadence-progress`/status go stale. Diagnosis: rec-20261004-001/002, with a systematic-debugging trail (as-20261004-001..003, all validated).
- **Phase 320 merged** (#546, `afdb0916`): a settle notice for a missing roadmap entry, checklist lines, a backfill of 314–320, and a per-settled-phase record test.
- **Phase 321 merged** (#547, `5b284d96`), inserted mid-run: `security-success` (required) had gone red repo-wide on new brace-expansion/braces advisories. `brace-expansion` is pinned to `^5.0.11`; `braces` has an **operator-approved exception expiring 2026-11-18**.
- **Phase 322 is BUILT, NOT SETTLED/COMMITTED**, in this worktree (`.claude/worktrees/322-idle-last-settled`, branch `fix/322-idle-last-settled`). T1–T3 are DONE; every review is approved; the whole-branch review says **READY TO MERGE**; the forced pipeline is green (28/28).
- Session was **paused by the operator** before 322's minor wording fixes and settle. **Next action:** apply the minor fixes below → settle 322 → PR → merge → release PR → **ask the operator before `gh workflow run Release`**.

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `fix/322-idle-last-settled` (dirty), 0 ahead / 0 behind origin
- HEAD `afdb0916`
- Recent commits:
```
afdb0916 fix: settle names a missing ROADMAP/MILESTONES entry (phase 320) (#546)
5b284d96 fix(security): pin brace-expansion past its advisories, time-box the unpatched braces exception (phase 321) (#547)
ec706481 fix: host-cli launches npm-installed CLIs on Windows without a shell (phase 319) (#543)
c899fcf4 chore(cadence): session handoff docs for 2026-09-26/27 (#542)
140815e6 fix: forward subagent agentId/agentType through Claude Code hook routing (phase 318) (#540)
5363da21 fix: hook blocks delivered as per-event JSON decisions on stdout, exit 0 (phase 317) (#541)
69369a9e docs(checkpoint): add checkpoint arc phase 2/0.4a/design-brief handoff (#538)
ef4a6b13 docs(checkpoint): add hook-json-block phase handoff (#537)
```
- Uncommitted (diff --stat):
```
.cadence/MILESTONES.md                       |  11 ++-
 .cadence/ROADMAP.md                          |  41 +++++++-
 .cadence/intelligence/RECOMMENDATIONS.md     |  79 ++++++++++++++-
 .cadence/intelligence/evidence.json          |  14 +++
 .cadence/intelligence/recommendations.json   | 143 +++++++++++++++++++++++++--
 docs/quickstart.md                           |   2 +-
 docs/reference/commands.md                   |  28 ++++++
 packages/core/src/hooks/dispatcher.ts        |  15 ++-
 packages/core/src/hooks/handlers.ts          |  29 +++++-
 packages/core/src/render/state-md.ts         |  18 +++-
 packages/core/src/status.ts                  |  29 +++++-
 packages/core/tests/cli/status.test.ts       |  84 ++++++++++++++++
 packages/core/tests/hooks/dispatcher.test.ts |  70 ++++++++++++-
 packages/core/tests/render/state-md.test.ts  |  40 ++++++++
 packages/core/tests/status.test.ts           | 109 ++++++++++++++++++++
 15 files changed, 691 insertions(+), 21 deletions(-)
```
- Loop: BUILD · phase 322-idle-status-names-the-latest-settled-phase · tier standard

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
- Files in play:
  - `packages/core/tsconfig.json` — affected by rec-20260907-002 packages/core/tsconfig.json includes only src/**/*, so no repo command ever typechecks tests/
  - `docs/reference/config.md` — affected by rec-20260917-008 docs/reference/config.md overclaims skill-audit: says it enforces skills were invoked 'during a phase', which the checkout-scoped invoked list does not support
  - `packages/core/src/parse/draft-parser.ts` — affected by rec-20260918-005 DRAFT.md with UTF-8 BOM (+ optionally CRLF) still throws the misleading 'missing frontmatter' error
  - `packages/core/src/parse/draft-mutate.ts` — affected by rec-20260918-006 draft-mutate.ts's add-ac/add-task splice regexes are \n-only, so a CRLF draft now fails with a different misleading error post-phase-310
  - `packages/core/src/parse/spec-parser.ts` — affected by rec-20260918-007 spec-parser.ts and ui-spec-parser.ts have the identical CRLF frontmatter-rejection bug phase 310 fixed for draft-parser.ts
  - `packages/core/src/parse/ui-spec-parser.ts` — affected by rec-20260918-007 spec-parser.ts and ui-spec-parser.ts have the identical CRLF frontmatter-rejection bug phase 310 fixed for draft-parser.ts

## What landed this session
- **#546 phase 320 — settle names a missing ROADMAP/MILESTONES entry** (ships rec-20261004-001).
  - New `packages/core/src/roadmap/phase-entry.ts`. Successful settle prints a best-effort stderr notice per settled phase. It is read-only, never blocks, and stays silent for init stubs.
  - phase-build step 7 and release-cut step 3 checklists updated.
  - Backfilled 314 and 316–320; fixed the stale `(in progress)` markers on 292/303.
  - New `tests/docs/roadmap-per-phase-entries.test.ts` requires both entries for every **settled** phase ≥ 314 (a dir holding a `-SUMMARY.json`).
  - Also committed the diagnosis ledger rows and the repo's first `assumptions.json`. `io.test.ts`'s "no assumptions.json" premise moved to a temp repo.
- **#547 phase 321 — security.** The `pnpm.overrides` key `brace-expansion@5.0.6` became `brace-expansion@^5.0.0: ^5.0.11` (resolves 5.0.12). `docs/security/audit-exceptions.md` gained the `braces` GHSA-vfj7-8cjw-p6xm row (expiry 2026-11-18; unblock = patched braces or `@changesets/cli` 3.x / Dependabot #474). New `tests/docs/phase321-brace-advisories.test.ts` drives the gate's own `decideAdvisories`. The live Linux `audit` job confirmed it: "1 high/critical advisory, all documented".
- **Phase 322 (uncommitted, this worktree)** — ships rec-20261004-002.
  - New `packages/core/src/phases/latest-settled.ts`: the latest phase dir whose `*-SUMMARY.json` has `stateAtSettle`, written only on successful settle.
  - IDLE `status` prints `last settled: X`, falling back to `last phase in this checkout: <activePhase>`. `--json` keeps `activePhase` and adds `lastSettledPhase`.
  - STATE.md IDLE reads `**Active phase:** (none — loop is IDLE)`, followed by `**Last phase in this checkout:**`.
  - SessionStart banner IDLE is the same idea. Non-IDLE output is byte-identical.
  - Docs: commands.md status section; quickstart.md example.
  - Records: ROADMAP/MILESTONES 322 entry; `(#546)`/`(#547)` suffixes on 320/321.
  - Changeset `idle-status-last-settled.md`.
  - Follow-up recs filed: rec-20261004-003 (corepack spawn on Windows), -004 (repeated `--file` dropped), -005 (stranded DRAFT/BUILD, needs-evidence), -006 (progress ignores ledger hints), -007 (handoff/resume/context still raw activePhase). Also ev-20261004-008 on rec-20260805-002 (`brace-expansion@^2.0.0 → ^2.1.4` floor below the 2.x fixes) and ev-009 narrowing rec-007's MCP scope.

## Carry-forward gotchas
- **Before settling 322, apply the whole-branch review's minors (all wording):**
  1. DRAFT line ~16 and ev-20261004-009 say "only `cadence://state.json`" is raw, but the MCP `cadence_handoff` and `cadence_resume` tools also carry the raw value. Fix with a DRAFT As-built note, and add a new evidence note on rec-007. Never hand-edit the ledger.
  2. Add `cadence inspect` (`intelligence/render-inspection.ts:40`) to rec-007 via evidence.
  3. rec-006: passing ledger hints alone doesn't change `progress` output, since it prints `action.command` while hints only reorder `legalMoves`. Add evidence.
  4. commands.md IDLE paragraph and the changeset say "committed `.cadence/phases/` directories". The finder reads the working tree, so drop "committed".
- **Settle mechanics that bit this session:**
  - The skill-audit gate requires `phase-build` to be invoked from **inside the worktree**. Invoking it from the primary checkout records into the primary's state.json. Re-invoke the Skill there before `settle run`.
  - After editing a DRAFT post-approve, re-run `cadence draft approve <phase> 01` so `draft-read` passes. Task records survive this.
  - Settle with the local build: `CADENCE_HOST_CLI_BIN=codex node packages/core/bin/cadence.cjs settle run --auto`. At standard tier, deep-verify and code-review are not in the gate set, so the Opus subagent reviews are the independent review of record (see each phase's `-TASK-REVIEW-opus.md`).
- **Single-file vitest runs always exit 1**, because coverage thresholds are global. Use `npx vitest run <file> --coverage.enabled=false`.
- **`cadence handoff` auto-prunes old SESSION docs** (deletes tracked files). This session restored the 7 it pruned in this worktree. Keep pruning for a deliberate housekeeping PR.
- **The primary checkout (`C:/Users/softw/projects/cadence`) is behind `main`.** It still holds uncommitted diagnosis ledger edits (`ASSUMPTIONS.md`, `RECOMMENDATIONS.md`, `evidence.json`, `recommendations.json`, untracked `assumptions.json`) that are now committed on main, so `git pull` there will refuse.
  - Diff those 5 against `origin/main` first. They should be a subset of main.
  - Only then restore them, with operator OK.
  - **Do not touch `RECOMMEND.md`/`recommend.json`**: they were dirty before this session.
- **Worktrees from this session:**
  - `320-roadmap-entry-at-settle`, branch merged.
  - `321-brace-advisories`, branch merged; the remote branch was deleted by gh, but the local `fix/321-brace-advisories` may remain.
  - `322-idle-last-settled`, active.
  - Remove the first two when idle.
- **The global `cadence` on PATH is 1.67.1** (npm has 1.68.0). `/cadence-progress` runs the global, so the 320/322 fixes reach it only after release plus `npm i -g @thomas-powers-jr/cadence-core`.
- **Release plan:** 6 changesets are pending (`hook-json-block`, `subagent-agentid-routing`, `win32-host-cli-resolve`, `roadmap-entry-at-settle`, `brace-advisories`, `idle-status-last-settled`). Follow `.claude/skills/release-cut`.
  - Any numbered phase dir that settles needs ROADMAP and MILESTONES entries, or `roadmap-per-phase-entries.test.ts` fails CI.
  - The release-cut skill says "all four published packages", but there are five, including `host-toolkit`.

## Open decisions
- **Merge consent (operator, given 2026-10-04):** merge the phase PRs and the release PR once CI is green and review is clean, **but ask before running the Release workflow** (`gh workflow run Release`, irreversible npm publish). That pause still applies.
- **What did "/cadence-progress is stale" mean?** The operator was asked whether it meant the stale phase line (fixed by 322) or `progress` never surfacing milestone/recommendation suggestions in IDLE (rec-20261004-006). Not answered yet. Ask when convenient.
- **`braces` exception (decided):** time-boxed to 2026-11-18. Before then, adopt `@changesets/cli` 3.x (Dependabot #474) or pick up a patched `braces`. Otherwise `security-success` goes red again on 2026-11-19.

## Next action
1. In `.claude/worktrees/322-idle-last-settled`, apply the four wording minors listed under gotchas, then re-run `npx vitest run tests/docs/ --coverage.enabled=false` from `packages/core`.
2. Re-approve the DRAFT, re-invoke the `phase-build` skill from inside the worktree, then `CADENCE_HOST_CLI_BIN=codex node packages/core/bin/cadence.cjs settle run --auto`.
3. Promote rec-20261004-002 to shipped. Make a single commit with explicit staging, and include this handoff doc. Then push, open the PR, and merge on green per the consent above.
4. Run release-cut (steps 1–4), merge the release PR on green, then **stop and ask the operator** before `gh workflow run Release`. Afterwards, verify npm, the tag and the GitHub release independently.
