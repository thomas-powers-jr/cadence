---
cadence_handoff: 2
generated_at: 2026-09-26T19:39:59.407Z
label: 317-settled-pr541
loop_position: IDLE
active_phase: 317-hook-json-block
active_draft: 
tier: 
git_branch: worktree-hook-json-block
git_dirty: true
git_head: 0e3d0396
git_ahead: 0
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-09-26 (317-settled-pr541)

## TL;DR for the next session
- **Phase 317 (hook JSON block) is settled and open as PR #541 against `main`, with CI fully green**, including `windows-latest`, where the new PowerShell tests really ran: the control confirmed exit 2 collapses to 1, and all three real-chain blocks held. rec-20260925-001 is shipped. **Not merged — needs the operator's explicit go-ahead.**
- **Phase 318 (PR #540) is stacked on the 317 branch and must merge after #541**, then be rebased onto `main` (recipe below). CI has never run on #540 because it targets a non-main branch.
- New high-priority rec **rec-20260926-005** (on #540's branch): on Windows, `CADENCE_HOST_CLI_BIN=codex` silently falls back to mock because Node can't spawn npm's `codex.cmd`. Workaround: point it at the native `codex.exe` (path in the `project_codex_exe_host_cli_windows` memory).
- Next action: operator decides whether to merge #541; then rebase #540 onto main, retarget it, and wait for CI.

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `worktree-hook-json-block` (dirty), 0 ahead / 0 behind origin
- HEAD `0e3d0396`
- Recent commits:
```
0e3d0396 fix: hook blocks delivered as per-event JSON decisions on stdout, exit 0 (phase 317)
3eaec833 chore: phase 317 changeset; build stale-scope fixtures from the exported STALE_NPM_SCOPE sentinel (T8)
0fbbcbe3 test: Windows PowerShell transport fixture and Codex relay tests; docs no longer describe hook blocks as exit 2 (phase 317 T4, T6)
bdb88aa8 feat(core): cadence hook delivers blocks as per-event JSON decisions on stdout, exit 0 (phase 317 T3)
bf13b1de feat(core): hook renderer, doctor hook-transport check, CI windows-leg guard (phase 317 wave 1: T2, T5, T7)
d8249bde test(core): capture golden hook stdout before transport change (phase 317 T1, AC-5)
b71465a9 docs(cadence): record 317-01 plan review (REJECT -> fixed -> APPROVE)
da470878 docs(cadence): 317 DRAFT reframes SubagentStop reachability as scope, not a permanent claim (plan review finding)
```
- Uncommitted (diff --stat):
```
.cadence/handoff/SESSION-2026-08-21.md | 165 ---------------------------------
 1 file changed, 165 deletions(-)
```
- Loop: IDLE · phase 317-hook-json-block · tier (none)

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
1. **317 SPEC finished review.** Review #4 found 1 blocker (AC-7 had no outcome for an unsupported `shell` value). It was fixed in `feffec21`, then a delta check caught a nonexistent `warn()` helper in the fix, fixed in `28390f1e` and approved. Full trail: 10 → 4 → 2 → 1 → 0 blocking findings.
2. **317 DRAFT** was seeded from the SPEC (10 ACs), with 8 tasks authored and tier raised to `complex`. A Codex plan review rejected it once for stale "SubagentStop unreachable" wording, then approved after the fix (`317-01-PLAN-REVIEW-codex.md`).
3. **Build, T1–T8** (commits `d8249bde`, `bf13b1de`, `bdb88aa8`, `0fbbcbe3`, `3eaec833`): pure `renderHookResult` + `hook.ts` wiring; golden stdout captured before the change; doctor `hook-transport` check with a shared install-state classifier; CI windows-leg guard test; win32 PowerShell real-chain fixture; Codex relay tests; `exit-codes.md` / `host-adapters.md` corrected. Every task was re-verified in the main thread and reviewed by a fresh Opus subagent.
4. **The full pipeline caught 2 real bugs that per-file runs missed**: a changeset quote style, and fixtures spelling out the old npm scope (fixed by exporting `STALE_NPM_SCOPE`). The final run was 28/28, with core at 4592 passed.
5. **Settle** (`0e3d0396`): deep-verify ran on real Codex over the real diff (95 KB, 19 files) with 10/10 ACs. In-loop code-review timed out at 180s and fell back to mock, which settle recorded as skipped. The code review of record is the manual Codex whole-branch review (READY TO MERGE). SPEC as-built note added about 318 reachability.
6. PR #541 opened; all checks green. rec-20260926-005 filed and pushed on #540's branch (`4e3945ec`).

## Carry-forward gotchas
- **Rebase #540 after #541 merges:** `git fetch origin && git rebase --onto origin/main 686cd7aa worktree-subagent-agentid-routing`, then `gh pr edit 540 --base main`, re-run `pnpm turbo run lint typecheck test build`, and let CI run. Expect conflicts in `.cadence/intelligence/recommendations.json` / `evidence.json` (both branches changed recs); resolve the JSON, then regenerate the derived `.md` files.
- **Don't create new rec/ev/dec IDs on the 317 branch.** The 318 branch already uses ev-20260926-006..008 and rec-20260926-004..005, so new IDs there would collide.
- **The phase-collision guard trips in the 317 worktree** because the 318 worktree inherits 317's phase folder. `--allow-phase-collision` was used at `draft new` and `settle`, after 4 checks each time. SUMMARY.json does not record it (rec-20260917-005).
- **Editing a DRAFT during BUILD makes settle refuse it as stale**, and `draft approve` auto-passes when non-TTY. The re-approval this session was approved by the operator in chat. Batch as-built notes, or ask first.
- **`phase-build` was loaded at settle, not at build start**; the build followed its steps throughout. The skill audit accepted the late load, a weakness related to rec-20260917-006.
- **`CADENCE_HOST_CLI_BIN=codex` is mock on this Windows box** (rec-20260926-005). The global CLAUDE.md instruction needs a Windows note; the operator should edit it, not an agent. Manual `codex exec` reviews from bash were real.
- `hook.ts` now writes stdout with `process.stdout.write`. Unlike `console.log`, an EPIPE (host closing the pipe early) would crash instead of being swallowed. Theoretical: both shims read all output. Noted by the T3 review, not fixed.
- The legacy exit-2 path (block on an event with no JSON shape; none today) now drops `contextPayload` from stdout with a loud stderr notice. The old code printed it.
- `cadence handoff` prunes old SESSION docs as tracked deletions; restore them with `git restore` (done again this session). The unstaged deletion of `SESSION-2026-08-21.md` in the 317 worktree predates this session and was left alone.

## Open decisions
- **Merge #541?** Operator's decision. CI is green and all reviews are recorded. Then #540 follows after its rebase.
- **File a rec for the approve gate?** The operator asked why `draft approve` passes without a human. Answer given: phase 116's non-TTY auto-pass, recorded only on stderr, and `--no-approve` lets any agent skip it. Not filed yet; waiting on the operator.
- **Should the global CLAUDE.md "use Codex" rule get a Windows note** pointing to `codex.exe`? The operator's call (see the `project_codex_exe_host_cli_windows` memory).

## Next action
1. Get the operator's decision on merging #541. If yes: `gh pr merge 541 --squash --delete-branch`, then sync `main`.
2. Rebase #540 per the recipe above, retarget it to `main`, run the full pipeline and CI, then ask before merging.
3. Next candidate recs: rec-20260926-005 (Windows host-cli spawn, high), rec-20260926-003 (Codex agent identity, the twin of 318), rec-20260907-002 (tests/ never typechecked; hit repeatedly this session).
