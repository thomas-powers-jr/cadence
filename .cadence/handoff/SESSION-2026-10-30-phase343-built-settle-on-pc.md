---
cadence_handoff: 2
generated_at: 2026-10-30T21:02:11.423Z
label: phase343-built-settle-on-pc
loop_position: BUILD
active_phase: 343-verification-fallback-refuse
active_draft: 343-01
tier: complex
git_branch: claude/zen-keller-cp16ug
git_dirty: true
git_head: 058b3896
git_ahead: 0
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-10-30 (phase343-built-settle-on-pc)

## TL;DR for the next session
- **Phase 343 is BUILT, not settled.** All six tasks are DONE, the whole-branch review returned "ready to settle", and the full pipeline passed 28/28 in the cloud container (core 512 files / 5266 tests). The settle is deliberately left for the operator's PC.
- **Why the PC:** standard × complex fires deep-verify and code-review on `host-cli`. From the cloud container they fall back to mock (no Codex installed; the claude family trips the self-invocation guard), which is exactly the silent downgrade this phase prevents.
- **The loop state travels by snapshot:** `.cadence/snapshots/state-2026-10-30T210211Z-vm.json` (BUILD, 343-01). Run `cadence state load` on the PC after pulling.
- **PR:** thomas-powers-jr/cadence#597 carries the branch; settle on the PC, push the settle commit to `claude/zen-keller-cp16ug`, and squash-merge.
- Phase 342 (decisions-only backlog triage + Studio intake) merged as #596; #595 (prior handoff) merged too.

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `claude/zen-keller-cp16ug` (dirty), 0 ahead / 0 behind origin
- HEAD `058b3896`
- Recent commits:
```
058b3896 wip(cadence): phase 343 -- ROADMAP and MILESTONES entries
00304482 wip(cadence): phase 343 -- whole-branch review fixes (I1 doc drift, message examples, M1-M3)
b1dcb4e3 wip(cadence): phase 343 -- T4 and T6 recorded, all six tasks DONE
0177d39d wip(cadence): phase 343 -- T3 recorded, anthropic refusal hint; T4/T6 snapshots
f27c5132 wip(cadence): phase 343 T6 in progress -- docs snapshot (not yet verified)
c458cc0e wip(cadence): phase 343 T3 -- selection-time downgrades refuse lazily; T5 wording fix
2d7b637e wip(cadence): phase 343 -- record T2 done
859121ca wip(cadence): phase 343 T5 -- doctor verification-fallback check, refuse-aware readiness wording
```
- Loop: BUILD · phase 343-verification-fallback-refuse · tier complex

## CADENCE context   ·  pre-filled from `cadence context handoff`
- Top recommendations:
  - rec-20260806-006 — build-test-must-pass silently swallows which test failed when bypassed via --allow-failing-build (candidate/ready-for-cadence-spec)
  - rec-20260917-006 — skillAudit.required proves a skill was invoked SOMETIME in this checkout, not during the phase being settled — state.skillAudit.invoked is deduped, append-only and never reset (candidate/ready-for-cadence-spec)
  - rec-20261030-001 — --json output for the mutating loop commands (draft new/set-*/add-*/check/approve, build task, settle run, spec approve) (candidate/ready-for-cadence-spec)
  - rec-20261030-004 — verification.fallback: "refuse" -- a hard refusal instead of the silent-continue mock fallback (candidate/ready-for-cadence-spec)
  - rec-20260726-005 — coverage.ts's coverageBypassed is false-negative when a --force-only bypass overrides real coverage gaps in assertion mode (candidate/ready-for-cadence-spec)
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
  - dec-20261029-001 — Studio save/load moves into core: 340 content-hash draft-read gate, then 341 cadence state save/load/list in .cadence/snapshots/ keeping the newest 3
  - dec-20261030-001 — 342 triage: defer rec-20260730-001 -- fix is real but nothing runs verify phase across a mode switch
  - dec-20261030-002 — 342 triage: promote rec-20260806-006 -- silent --allow-failing-build bypass, used in phases 296-298
  - dec-20261030-003 — 342 triage: reject rec-20260807-005 -- premise false: fresh init already defaults to phase-qualified
  - dec-20261030-004 — 342 triage: shipped rec-20260813-005 -- delivered by phase 309
  - dec-20261030-005 — 342 triage: defer rec-20260820-001 -- one occurrence in 70 days; decide with Studio ask rec-20261030-009
  - dec-20261030-006 — 342 triage: promote rec-20260917-006 -- phase 315 was designed but never built; the gap is live
  - dec-20261030-007 — 342 triage: promote rec-20260726-005 -- --force over coverage gaps records nothing
  - dec-20261030-008 — 342 triage: reject rec-20260728-002 -- duplicate of rec-20260907-002
  - dec-20261030-009 — 342 triage: defer rec-20260729-003 -- gap count is informational only
  - dec-20261030-010 — 342 triage: defer rec-20260729-005 -- working as specified; informational count only
  - dec-20261030-011 — 342 triage: shipped rec-20260731-007 -- phase 242 adopted merge-by-identity
  - dec-20261030-012 — 342 triage: reject rec-20260804-003 -- the deferred status it asks for already exists
  - dec-20261030-013 — 342 triage: reject rec-20260804-004 -- local worktree housekeeping, not ledger work
  - dec-20261030-014 — 342 triage: reject rec-20260806-001 -- duplicate of rec-20260927-001
  - dec-20261030-015 — 342 triage: reject rec-20260806-002 -- historical runbook, deleted before 256-02 settled
  - dec-20261030-016 — 342 triage: reject rec-20260806-003 -- duplicate of rec-20260806-002
  - dec-20261030-017 — 342 triage: reject rec-20260806-005 -- same deleted runbook, reworded
  - dec-20261030-018 — 342 triage: promote rec-20260806-007 -- persistent code-review attempt budget is undocumented
  - dec-20261030-019 — 342 triage: promote rec-20260806-008 -- dec-20260801-003 trigger met many times over
  - dec-20261030-020 — 342 triage: defer rec-20260808-001 -- pending-changesets already covers the common case
  - dec-20261030-021 — 342 triage: defer rec-20260809-005 -- test-seam-only, fails safe, no recurrence since 265
  - dec-20261030-022 — 342 triage: promote rec-20260811-003 -- conduction-drift-streak warns chronically
  - dec-20261030-023 — 342 triage: defer rec-20260812-001 -- rare: retention protects the current lastHandoff
  - dec-20261030-024 — 342 triage: reject rec-20260813-001 -- duplicate of rec-20260813-004
  - dec-20261030-025 — 342 triage: defer rec-20260815-003 -- codex host-cli now supplies real provenance
  - dec-20261030-026 — 342 triage: reject rec-20260820-002 -- wording slip in an append-only record, already annotated
  - dec-20261030-027 — 342 triage: promote rec-20260821-001 -- commands.md misstates bare-scheme --explain
  - dec-20261030-028 — 342 triage: promote rec-20260822-002 -- MCP drops stderr notices on success
  - dec-20261030-029 — 342 triage: defer rec-20260822-007 -- one known case; a manual reject sufficed
  - dec-20261030-030 — 342 triage: defer rec-20260822-008 -- nothing reads per-round deep-verify verdicts yet
  - dec-20261030-031 — 342 triage: defer rec-20260907-006 -- the routinely-bypassed premise did not hold
  - dec-20261030-032 — 342 triage: reject rec-20260916-003 -- helper shipped; enforcement owned by rec-20261008-007
  - dec-20261030-033 — 342 triage: defer rec-20260917-003 -- no pack needs an optional skill
  - dec-20261030-034 — 342 triage: promote rec-20260917-005 -- --allow-stale-draft and --allow-open-tasks record nothing
  - dec-20261030-035 — 342 triage: defer rec-20260918-001 -- three assumptions ever; workaround documented
  - dec-20261030-036 — 342 triage: defer rec-20260918-008 -- latent: no required name collides today
  - dec-20261030-037 — 342 triage: defer rec-20260926-002 -- needs schema design; no failure seen
  - dec-20261030-038 — 342 triage: reject rec-20260927-002 -- the minimal option (document the override) is done
  - dec-20261030-039 — 342 triage: defer rec-20261010-004 -- no consumer for a generated assurance page
  - dec-20261030-040 — 342 triage: reject rec-20261010-005 -- unreachable without a 309-digit phase number
  - dec-20261030-041 — 342 triage: defer rec-20261010-006 -- gated on measurement by D-BV and dec-20260813-003
  - dec-20261030-042 — 342 triage: defer rec-20261016-003 -- a fixed historical set since phase 332
  - dec-20261030-043 — 342 triage: defer rec-20261016-005 -- design question; one known instance
  - dec-20261030-044 — 342 triage: defer rec-20261021-001 -- optimization; the CI timeouts it caused are fixed
  - dec-20261030-045 — 342 triage: reject rec-20261023-001 -- premise false: normalization can only tighten settle
  - dec-20261030-046 — 342 triage: defer rec-20261023-002 -- overcount of at most one; needs a second Stop hook
  - dec-20261030-047 — 342 triage: reject rec-20260731-005 -- keeping a rejected finding suppressed is defensible
  - dec-20261030-048 — 342 triage: reject rec-20260731-006 -- routing volume is tiny in practice
  - dec-20261030-049 — 342 triage: reject rec-20260801-007 -- one item moot, two cosmetic after 90 days
  - dec-20261030-050 — 342 triage: reject rec-20260803-001 -- placeholder refs are no longer minted
  - dec-20261030-051 — 342 triage: defer rec-20260804-002 -- real but trivial and unhit; fold into the audit rec
  - dec-20261030-052 — 342 triage: promote rec-20260809-004 -- READMEs still claim init --demo is zero-prompt
  - dec-20261030-053 — 342 triage: reject rec-20260809-006 -- decision list already answers provenance
  - dec-20261030-054 — 342 triage: reject rec-20260811-004 -- one instance; milestone defer is the escape hatch
  - dec-20261030-055 — 342 triage: promote rec-20260821-002 -- wildcard boundary advisory re-fires across tasks
  - dec-20261030-056 — 342 triage: defer rec-20261015-001 -- needs a security-posture decision; nothing surfaced since 330
  - dec-20261030-057 — 342 triage: reject rec-20260801-002 -- duplicate of shipped rec-20260801-003
  - dec-20261030-058 — 342 triage: reject rec-20260801-008 -- subsumed by promoted rec-20260806-008
  - dec-20261030-059 — 342 triage: defer rec-20261013-002 -- latent until braces enters website/ or the row is renewed
  - dec-20261030-060 — 343 (a): the fallback setting is verification.fallback, not verifier.fallback
  - dec-20261030-061 — 343 (b): no new ProviderSelectionTag value; a refused call is recorded as a gate refusal
  - dec-20261030-062 — 343 (c): refusal is lazy, at call time; seams without a gate failure path refuse through the command's error exit
- Files in play:
  - `packages/core/src/gates/build-test-must-pass.ts` — affected by rec-20260806-006 build-test-must-pass silently swallows which test failed when bypassed via --allow-failing-build
  - `packages/core/src/verify/test-runner.ts` — affected by rec-20260806-006 build-test-must-pass silently swallows which test failed when bypassed via --allow-failing-build
  - `packages/core/src/hooks/handlers.ts` — affected by rec-20260917-006 skillAudit.required proves a skill was invoked SOMETIME in this checkout, not during the phase being settled — state.skillAudit.invoked is deduped, append-only and never reset
  - `packages/core/src/checks/skill-audit.ts` — affected by rec-20260917-006 skillAudit.required proves a skill was invoked SOMETIME in this checkout, not during the phase being settled — state.skillAudit.invoked is deduped, append-only and never reset
  - `packages/core/src/services/settle.ts` — affected by rec-20260917-006 skillAudit.required proves a skill was invoked SOMETIME in this checkout, not during the phase being settled — state.skillAudit.invoked is deduped, append-only and never reset
  - `packages/core/src/gates/coverage.ts` — affected by rec-20260726-005 coverage.ts's coverageBypassed is false-negative when a --force-only bypass overrides real coverage gaps in assertion mode
  - `packages/core/src/gates/registry.ts` — affected by rec-20260726-005 coverage.ts's coverageBypassed is false-negative when a --force-only bypass overrides real coverage gaps in assertion mode

## What landed this session
- **#595** — prior session handoff (Cadence Studio switched to `cadence state`), merged.
- **#596, phase 342 (settled, merged as `f936bf5`)** — decisions only. Studio's upstream asks filed as rec-20261030-001..013 (`scout-20261030-studio-intake`); 59 undecided recs each got one `342 triage:` decision (dec-20261030-001..059: 11 promote, 2 shipped, 22 reject, 24 defer); `needs-decision` 59 → 5. Assurance `mixed` (no AI verifier in standard × standard).
- **#597, phase 343 (built, unsettled)** — `verification.fallback: "mock" | "refuse"`:
  - T1 schema field (absent from every default layer) + dec-20261030-060/061/062 + rec-20261030-014 (default flip, reopen after Studio Phase 8) and rec-20261030-015 (`config explain`/`activate` wording).
  - T2 `VerifierFallbackRefusedError`, `VerifierSelectOptions.fallback` at all 7 selection sites, call-time host-cli refuse mode. T3 lazy selection-time refusal (`refusingProxy`).
  - T4 end-to-end tests through the real settle/approve/build-task services. T5 doctor `verification-fallback` check + refuse-aware readiness wording. T6 docs (config.md, providers.md, commands.md), docs test, minor changeset for core + types.
  - Every task: implementer subagent, independent reviewer, main-thread re-run. Whole-branch review: one Important (config.md overclaimed SUMMARY `providerSelection` recording) fixed, plus M1–M3; re-review "ready to settle".

## Carry-forward gotchas
- **Settle 343 with Codex or it is not a review:** `CADENCE_HOST_CLI_BIN=codex cadence settle run --auto --deep`, then open `343-01-SUMMARY.json` and confirm deep-verify and code-review show `provider: "host-cli"`. Any "falling back to mock" line means re-run, never "reviewed".
- **Deviations from phase-build, recorded:** built in the primary checkout on the session branch, not a `feat/` worktree (cloud sessions may push only the designated branch; nothing else was in flight). T1 implemented in the main thread (mostly ledger decisions). T4 and T6 per-task reviews were folded into the whole-branch review.
- **Deferred minors to note in the SUMMARY / a follow-up:** under refuse, doctor's readiness warnings still append the mock-capability sentence (harmless); a refused ui-spec-review call leaves the preceding spec-review attempt in its sidecar (pre-existing); T2's refusal says "host-cli unavailable" even for `output-error`/`aborted` (the parenthesised reason is accurate).
- **The branch history is WIP commits** plus merges of already-merged #595/#596 history (a force-push was blocked by the auto-mode guard, so merges were used instead). The squash-merge lands one commit; the settle commit on the PC should be the phase's single source of record.
- **rec-20261030-004 should be promoted to `shipped` in the settle commit** (`cadence recommendation promote rec-20261030-004 --status=shipped --ref "phase 343 (#597)"`).
- **Live evidence for rec-20260917-006:** in this cloud checkout, skill-audit counted `phase-build` as invoked from stale history (phase 342's SUMMARY shows it). Phase 343 did invoke `phase-build`, legitimately this time.

## Open decisions
- **Prune the tracked SESSION docs past `handoff.retain` (now 14)?** Deletes tracked files; operator decides (carried from the previous handoff).
- **Item 0 of the operator handoff, live Stop-gate capture:** operator-run on a PC; still outstanding.
- **Phase 344 scope:** cover both host-cli families (the claude path spawns `claude -p` with no `--setting-sources`/`--strict-mcp-config`, see ev-20261030-013 / rec-20261030-010), probe first.

## Next action
**Action (operator, on the PC holding Codex): settle phase 343.**
1. `git fetch origin && git checkout claude/zen-keller-cp16ug && git pull`, then `pnpm install --frozen-lockfile && pnpm build`.
2. `node packages/core/bin/cadence.cjs state load` (loads `.cadence/snapshots/state-2026-10-30T210211Z-vm.json`; the DRAFT was approved under 1.73.0's content hash, so a mid-BUILD load needs no flag).
3. `CADENCE_HOST_CLI_BIN=codex node packages/core/bin/cadence.cjs settle run --auto --deep`. If it refuses, the gate is right until proven otherwise: fix the cause, no `--force`.
4. Confirm `343-01-SUMMARY.json` shows `provider: "host-cli"` for deep-verify and code-review; promote rec-20261030-004 to shipped; commit SUMMARY/PROGRESS/RETRO + ledger together, push, and squash-merge #597 once CI is green.

**Verify:** `cadence state list` shows the snapshot before load; after settle, `cadence progress` reports IDLE and `cadence summary verify-all` reports 0 failed.

Then: phase 344 (Codex verifier isolation, probe first, both families).
