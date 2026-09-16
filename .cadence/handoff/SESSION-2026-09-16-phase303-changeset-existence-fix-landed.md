---
cadence_handoff: 1
generated_at: 2026-09-16T19:35:12.565Z
label: phase303-changeset-existence-fix-landed
loop_position: IDLE
active_phase: 303-changeset-existence-coverage-tests-survive-release-consumption
active_draft: 
tier: 
git_branch: main
git_dirty: true
git_head: 34eb6980
git_ahead: 13
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-09-16 (phase303-changeset-existence-fix-landed)

## TL;DR for the next session
- Resumed into a **replayed handoff that was already stale** (its top two candidates — `rec-20260907-005` lockfile check, doctor conduction-reachability — had already shipped as phases 301/302 since it was written). Re-oriented from live `state.json`/`cadence recommend` instead of trusting the replay.
- **Shipped phase 303, PR #496, merged clean**: fixed `rec-20260916-002` — phase 300's and phase 301's coverage-token tests each hard-asserted `existsSync('.changeset/<name>.md')` to satisfy a meta-AC's coverage token; a release's `changeset version` step deletes consumed changeset files, so the next release would have permanently redded both. Extracted a shared `changesetEvidencePresent` helper (`packages/core/tests/support/changeset-evidence.ts`) that falls back to a pinned, CHANGELOG.md discriminator string post-consumption — verified by live grep to have zero pre-existing hits (not the package name, which is trivially present everywhere). Full `phase-build` pipeline: advisor-reviewed DRAFT (three real correctness issues caught pre-approval — see gotchas), dispatched implementer + independent whole-branch review (ready to merge, zero findings), CI green on all three OSes, merged.
- **Correction, not a discovery**: `rec-20260916-002` was already filed by **phase 302's own settle** (its independent pre-settle review caught the same pattern a third time and filed it rather than repeating it) — this session found it as the top-ranked existing recommendation via `cadence recommend` and executed it. Don't credit this session with discovering the bug.
- **Filed `rec-20260916-003`** (file-only, per boundaries): the underlying convention — satisfying a meta-AC's coverage token under `coverageMode: assertion` + `coverageScheme: phase-qualified` by asserting a changeset file exists — is still live and will keep reproducing this bug class for future phases. Phase 303 deliberately fixed only the two known instances, not the convention.
- **No mandatory next action.** `cadence doctor` is back to the same 4 pre-existing/expected warnings from before this session (git-hooks, release-currency — now 4 pending changesets after phase 303's own As-built work, conduction-reachability, conduction-drift-streak). Best candidates unchanged from the stale replay's ranking, minus the two already shipped: `rec-20260823-006` (checkCodexHooks completeness gap), `rec-20260907-002` (tests/ never typechecked), `rec-20260916-001` (profileRemediationHint matrix-blind), or a release cut to consume the 4 pending patch changesets.
- One self-inflicted process note: this session drafted phase 303 in the **primary checkout first**, then isolated to a worktree — the worktree's phase-collision guard fired against the primary's now-stale copy of the same phase directory (fixed by deleting the untracked copy from primary), and after merge, primary's own `state.json` was stuck at `loopPosition: BUILD` from the pre-isolation approve (fixed by copying the worktree's post-settle `state.json`/`STATE.md` over). Next time: isolate into the worktree **before** running `draft new`, not after.

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `main` (dirty), 13 ahead / 0 behind origin
- HEAD `34eb6980`
- Recent commits:
```
34eb6980 Merge remote-tracking branch 'origin/main'
2a3124fd fix: changeset-existence coverage tests survive release consumption (phase 303) (#496)
00a7a900 Merge remote-tracking branch 'origin/main'
fc246273 fix: doctor conduction-reachability profile axis is pack-aware (phase 302) (#495)
3932c866 Merge remote-tracking branch 'origin/main'
bd17d88e fix: check-lockfile-overrides flags override targets with zero resolved instances (phase 301) (#494)
f7b13eb0 Merge remote-tracking branch 'origin/main'
7eac2dda docs(cadence): session handoff for 2026-09-16 (phase 300 shipped, recs promoted) (#493)
```
- Uncommitted (diff --stat):
```
.claude/scheduled_tasks.lock | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```
- Loop: IDLE · phase 303-changeset-existence-coverage-tests-survive-release-consumption · tier (none)

## CADENCE context   ·  pre-filled from `cadence context handoff`
- Top recommendations:
  - rec-20260823-006 — checkCodexHooks has the identical existence-only completeness gap that phase 295 fixed for checkHostHooks (candidate/ready-for-cadence-spec)
  - rec-20260907-002 — packages/core/tsconfig.json includes only src/**/*, so no repo command ever typechecks tests/ (candidate/ready-for-cadence-spec)
  - rec-20260907-003 — The DRAFT frontmatter parser rejects CRLF, failing with 'missing frontmatter' and no hint about line endings (candidate/ready-for-cadence-spec)
  - rec-20260916-001 — profileRemediationHint stays matrix-blind after phase 302's pack-aware profile-axis fix (candidate/ready-for-cadence-spec)
  - rec-20260801-001 — docs/reference/commands.md config edit section lists only 5 fields; EDITABLE_FIELDS has 8 (candidate/ready-for-cadence-spec)
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
  - `packages/core/src/doctor/run.ts` — affected by rec-20260823-006 checkCodexHooks has the identical existence-only completeness gap that phase 295 fixed for checkHostHooks
  - `packages/core/tsconfig.json` — affected by rec-20260907-002 packages/core/tsconfig.json includes only src/**/*, so no repo command ever typechecks tests/
  - `docs/reference/commands.md` — affected by rec-20260801-001 docs/reference/commands.md config edit section lists only 5 fields; EDITABLE_FIELDS has 8
  - `packages/core/src/config-edit/fields.ts` — affected by rec-20260801-001 docs/reference/commands.md config edit section lists only 5 fields; EDITABLE_FIELDS has 8

## What landed this session

**PR #496** (merged, squash, `2a3124fd`) — **phase 303, the only work this session**: fixed `rec-20260916-002`. Extracted `changesetEvidencePresent` (`packages/core/tests/support/changeset-evidence.ts`, its own test file with 4 real assertions) and wired it into `settle.test.ts`'s 300-01/AC-5 test and `check-lockfile-overrides.test.ts`'s 301-01/AC-3 test, replacing their bare `existsSync('.changeset/<name>.md')` assertions. Pinned discriminators: `unresolved-target` (lockfile fix) and `already-shipped draft's canonical` (settle fix) — both confirmed present verbatim in their source changesets and absent from the live `packages/core/CHANGELOG.md` at drafting time, so the fallback isn't hollow.

**As-built T4 amendment, discovered mid-build**: creating phase 303's own directory pushed the on-disk highest phase number to 303 while `.cadence/ROADMAP.md`/`MILESTONES.md`'s documented max was still 292 (10-phase drift threshold, already maxed out before this phase existed — any next phase would have tripped it). Tripped `tests/docs/phase271-record-integrity.test.ts`'s hard `drift <= 10` assertion. Fixed by adding phase 303's own entry to both files (in-progress-style, matching phase 292's precedent) — explicitly not a backfill of phases 293-302, which stays tracked by `rec-20260815-004`/`rec-20260811-005`.

Full pipeline: DRAFT authored, advisor-reviewed **three times** before/during build (see gotchas — this DRAFT needed more correction passes than most), dispatched implementer for T2, independent whole-branch review (verdict: ready to merge, zero Critical/Important findings, verified `changesetEvidencePresent`'s logic, both discriminators byte-level including an ASCII-apostrophe check, boundary compliance, and the roadmap-drift math), settled (2/2 ACs), CI green on Windows/macOS/Ubuntu + security/CodeQL, merged. `rec-20260916-002` promoted to `shipped` in the settle commit, ref `"phase 303 (<slug>), this commit"`.

## Carry-forward gotchas

- **The `shippedRef` convention for a same-commit promotion, resolved**: CLAUDE.md says promote to `shipped` "in that same commit, then push" (before a PR number exists); `cadence doctor`'s hint text says "once merged" (implying a PR/tag ref). The actual convention, confirmed by reading phase 302's own ledger record: `--ref "phase <N> (<slug>), this commit"` — a self-referential ref, not a PR number. Use this pattern; don't wait for the PR number or invent a two-commit split to get one.
- **The phase-300-DRAFT-bug class recurred, twice, in this DRAFT** — worth remembering as a pattern, not just this instance. (1) The first draft of the AC-2/AC-3 fallback used the package name as the CHANGELOG discriminator — trivially true forever, since it appears throughout `CHANGELOG.md` (hollow token, same defect class as the bug being fixed). (2) After fixing that, the *replacement* discriminator candidates (`writeRefusedSettleSummary`, `clobber`) turned out to already appear in the live CHANGELOG from **earlier, already-shipped** phases — also hollow. The fix both times was the same: grep the live file for the literal candidate string and require zero hits before pinning it, not "distinctive-sounding" by inspection. A plausible-sounding discriminator is not a verified one.
- **T2's literal "delete the changeset file and confirm the test still passes" verify step could not fully pass, correctly.** `changeset version` both deletes the changeset file *and* writes its body into `CHANGELOG.md` in the same release step; renaming the file away only simulates the deletion half, so with `CHANGELOG.md` still at its pre-release state, `changesetEvidencePresent` correctly returned `false`. Substituted verification (changeset-body grep + ASCII-apostrophe check + T1's isolated fallback-branch unit tests + `changelogPath` resolution check) is recorded as an As-built note on T2 — this is expected for any phase testing "does X survive an event that hasn't happened yet."
- **Drafting in the primary checkout before isolating to a worktree caused two real problems** (see TL;DR) — the phase-collision guard fired on primary's stale copy, and primary's `state.json` desynced from the worktree's after settle. Isolate into the worktree with `EnterWorktree` **before** `cadence draft new`, and if you don't, remember to delete the primary's copy of `.cadence/phases/<phase>/` once you've moved the authoritative version into the worktree, and re-sync `state.json`/`STATE.md` from the worktree back to primary after settle.
- **`gh pr merge --squash --delete-branch`'s local cleanup step failed again** (PR #496, identical to phases 298-302's sessions): `'main' is already used by worktree at <primary-checkout>`. Remote squash-merge succeeded regardless (verified via `gh pr view --json state,mergedAt,mergeCommit`). Fixed with `git push origin --delete <branch>` + `git fetch && git merge origin/main --no-edit` in the primary checkout — same well-worn manual pattern as every recent session.
- **The phase-303 worktree wouldn't fully delete** (`git worktree remove` errored `Result too large`, same as phase 300's worktree). It's no longer a registered git worktree (`git worktree list` confirms empty), so it's harmless orphaned disk clutter: `C:\Users\Thomas\Documents\Projects\cadence\.claude\worktrees\303-changeset-existence-coverage` is still physically present and needs a manual delete (or investigation of what's holding a lock) from a future session — same unresolved issue as phase 300's worktree; now two of these accumulating.
- Local `main` again picked up no-op merge commits reconciling local divergence against fresh pushes mid-session (`git diff origin/main main` was empty before this session's push, same recurring pattern as every prior session's handoff — not something to force-push away).

## Next action

**No mandatory next action** — phase 303 merged clean, `main`'s CI is green, `cadence doctor` shows only the pre-existing/expected 4 warnings (`git-hooks`, `release-currency` now with 4 pending changesets, `conduction-reachability`, `conduction-drift-streak`).

If continuing immediately: best candidates in rough priority order — (1) `rec-20260916-001` (profileRemediationHint stays matrix-blind after phase 302's own fix — same axis, filed by phase 302 itself); (2) `rec-20260823-006` (checkCodexHooks completeness gap, same class phase 295 already fixed for checkHostHooks); (3) `rec-20260907-002` (tests/ never typechecked — a pre-existing gap this session's own new test files also fell into, harmlessly); (4) a release cut to consume the 4 pending patch changesets, now that `rec-20260916-002`'s underlying bug can no longer break that release; (5) two accumulated orphaned worktree directories (phase 300's and phase 303's) worth investigating/cleaning up together rather than one at a time.

**Verify:** `cadence doctor` should show 4 problems, all the pre-existing/expected kind listed above — re-check live before trusting this.

**If it fails:** N/A — nothing left mid-flight.
