---
cadence_handoff: 1
generated_at: 2026-09-26T15:13:28.622Z
label: expansion-arc
loop_position: IDLE
active_phase: 311-skill-audit-bypass-recorded-in-gatebypasses
active_draft: 
tier: 
git_branch: main
git_dirty: true
git_head: 69369a9e
git_ahead: 0
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-09-26 (expansion-arc)

## TL;DR for the next session
- **Checkpoint arc Phase 0.4a shipped (#534):** ran the operator's interactive active block-probe. `Stop`'s JSON decision blocking (`{"decision":"block","reason":...}`) is proven working end to end. `Stop`'s plain exit-code-2 path was never actually exercised — root-caused to a Windows-specific bug: `powershell.exe -Command` collapses a wrapped command's real exit code 2 down to 1 before Claude Code sees it, confirmed via Claude Code's own transcript instrumentation and an independent reproduction. `PreCompact` is documented to block the same two ways as `Stop`; its exit-2 attempt is presumed hit by the same bug but isn't independently instrumented the way `Stop`'s is.
- **That finding spawned a real product-fix thread**, `HANDOFF-hook-json-block.md` (#537, already merged, landed by someone/something outside this session's direct work): CADENCE's own `hook.ts:33-37` uses exit-code-2 as its *only* blocking transport, across five handler sites (boundary enforcement, redundant-work block, `SubagentStop` safety net, `Stop` handler) — none emit a JSON decision. On this class of Windows machine, every one of those gates is currently silently fail-open. Not yet built as an actual phase.
- **Landed the operator's `HANDOFF-checkpoint-arc-phase-3.md` (#538)** — supersedes phase-2, sequences the (now-done) release cut + 0.4a, then Phase 2 (sensor/state store) and an unauthorized Phase 3 design brief. Phase 2 explicitly does not depend on the hook-json-block fix.
- **Recovered a stranded commit** from the `checkpoint-schema-reconcile` worktree (`9c5210a5`, the 2026-09-24 checkpoint-probe-instructions `SESSION` doc — it predates and originally authorized the 0.4a work) onto its own branch and opened **PR #539** — **deliberately left unmerged, operator said "we'll merge it later."**
- **Worktree/branch hygiene, not yet fully settled:** the `checkpoint-schema-reconcile` worktree is now in a **detached HEAD** state at `69369a9e` (not on any branch) — freed up so the primary checkout could reclaim `main`. See gotchas below before touching either.
- **Single next action:** decide on PR #539 (merge or keep deferring), then pick between the hook-json-block product fix and checkpoint arc Phase 2 — see "Next action" below. Nothing is blocking or time-critical.

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `main` (dirty), 0 ahead / 0 behind origin
- HEAD `69369a9e`
- Recent commits:
```
69369a9e docs(checkpoint): add checkpoint arc phase 2/0.4a/design-brief handoff (#538)
ef4a6b13 docs(checkpoint): add hook-json-block phase handoff (#537)
2b4c7210 docs(checkpoint): Phase 0.4a active block-probe report (#534)
a341d696 chore(release): v1.68.0 -- checkpoint handoff schema reconcile (phase 316) (#533)
2ef7870a feat: checkpoint handoff schema reconcile, version-gated (phase 316) (#531)
f553841d chore(release): v1.67.3 -- skill-audit gateBypasses, core-skills phase-build requirement, systematic-debugging skill, worktree hook-shim cwd fix (#529)
eea11ae5 feat: checkpoint handoff validator, phases 0-1 (working name) (#528)
ff338a05 chore(cadence): file phase-315 scoping decisions and the identity-half split (rec-20260917-006) (#526)
```
- Uncommitted (diff --stat):
```
.cadence/intelligence/RECOMMEND.md   |  635 +-----
 .cadence/intelligence/recommend.json | 3697 +---------------------------------
 .claude/commands/cadence-handoff.md  |    2 +-
 .claude/commands/cadence-resume.md   |    4 +-
 .claude/scheduled_tasks.lock         |    1 -
 .claude/settings.json                |   16 +-
 6 files changed, 63 insertions(+), 4292 deletions(-)
```
- Loop: IDLE · phase 311-skill-audit-bypass-recorded-in-gatebypasses · tier (none)

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
- Files in play:
  - `packages/core/tsconfig.json` — affected by rec-20260907-002 packages/core/tsconfig.json includes only src/**/*, so no repo command ever typechecks tests/
  - `docs/reference/config.md` — affected by rec-20260917-008 docs/reference/config.md overclaims skill-audit: says it enforces skills were invoked 'during a phase', which the checkout-scoped invoked list does not support
  - `packages/core/src/parse/draft-parser.ts` — affected by rec-20260918-005 DRAFT.md with UTF-8 BOM (+ optionally CRLF) still throws the misleading 'missing frontmatter' error
  - `packages/core/src/parse/draft-mutate.ts` — affected by rec-20260918-006 draft-mutate.ts's add-ac/add-task splice regexes are \n-only, so a CRLF draft now fails with a different misleading error post-phase-310
  - `packages/core/src/parse/spec-parser.ts` — affected by rec-20260918-007 spec-parser.ts and ui-spec-parser.ts have the identical CRLF frontmatter-rejection bug phase 310 fixed for draft-parser.ts
  - `packages/core/src/parse/ui-spec-parser.ts` — affected by rec-20260918-007 spec-parser.ts and ui-spec-parser.ts have the identical CRLF frontmatter-rejection bug phase 310 fixed for draft-parser.ts

## What landed this session
- **#534** — `docs(checkpoint): Phase 0.4a active block-probe report`. `docs/checkpoint/REPORT-checkpoint-phase-0.4a.md` (verdicts + root-cause chain) plus a sibling `docs/checkpoint/phase-0.4a-findings.md` (raw `hooks.jsonl`, transcript attachments, both `/compact` outputs, statusline payloads — preserved independently of the throwaway probe folder, which Phase 0's original raw log was not, costing a full extra phase to re-derive D-BJ). Answers D-BJ (statusline threshold unit: both `used_percentage` and absolute `current_usage`/`context_window_size` are present; recommendation only, decision left to the operator per the arc's no-AI-ledger-writes rule). One correction made mid-write-up: an AI web-fetch summarizer silently truncated Claude Code's hooks doc and produced a wrong first-draft claim that `PreCompact` isn't blockable — caught and fixed by re-fetching the raw doc source directly.
- **#538** — `docs(checkpoint): add checkpoint arc phase 2/0.4a/design-brief handoff`. Lands `docs/handoffs/HANDOFF-checkpoint-arc-phase-3.md` (operator-authored, 2026-09-24) unedited, as the arc's current instructing document. Its own first CI run had two consecutive macOS-only test timeouts on two *different* tests before a second re-run went green (see gotchas).
- **PR #539 opened, not merged** — `docs(cadence): session handoff for 2026-09-24 (checkpoint probe instructions)`. Recovers commit `9c5210a5` (was local-only in the `checkpoint-schema-reconcile` worktree, unreachable from any remote branch, at real risk of loss if that worktree were deleted or reset without pushing first).
- Reset the `checkpoint-schema-reconcile` worktree's `main` to match `origin/main` (it was 1 ahead / 3 behind before the `9c5210a5` recovery), then detached it from `main` entirely so the primary checkout — which had been stuck on an already-merged, remote-deleted branch (`docs/checkpoint-arc-phase-3-handoff`) purely because that worktree was occupying `main` — could check out `main` again.

## Carry-forward gotchas
- **CADENCE's own hook-based gates are fail-open on Windows machines where Claude Code can't find Git Bash.** `hook.ts`'s exit-code-2 transport (the only one it uses, across 5 `ok: false` sites) silently collapses to a non-blocking `1` under `powershell.exe -Command` — proven in `REPORT-checkpoint-phase-0.4a.md` §5 and already turned into a fix proposal (`HANDOFF-hook-json-block.md`, #537). Until that phase is built, treat any hook-enforced block (boundary enforcement, redundant-work, `SubagentStop`, `Stop`) as advisory-only on affected Windows setups — it will not actually refuse anything there.
- **PR #539 is intentionally unmerged.** The operator said "leave for now, we'll merge it later" — don't merge it without asking again, even though it's green and conflict-free.
- **`checkpoint-schema-reconcile` worktree is in detached HEAD**, not on a branch, at `69369a9e`. This was deliberate (to free `main` for the primary checkout) but means anyone picking that worktree back up needs to `git checkout -b <name>` or `git checkout main` there first — and checking out `main` there again will re-block the primary checkout from holding it. `git worktree list` before assuming any checkout can freely switch to `main`.
- **`gh pr merge --squash --delete-branch`'s local cleanup step can fail even when the merge itself succeeded**, specifically with `fatal: 'main' is already used by worktree at ...` — that error is from `gh`'s post-merge local checkout, not the remote merge. Happened twice this session (PRs #534, #538). Always verify via `gh pr view <n> --json state,mergedAt` before assuming a merge failed; then `git push origin --delete <branch>` and `git fetch --prune` manually if the local cleanup didn't run.
- **The primary checkout has ~10 files of unexplained, uncommitted local state**, all timestamped within the same minute (2026-09-26 ~08:56–08:57), consistent with a `cadence` self-update/reinstall that this session did not initiate and has not investigated: `.claude/settings.json` (hook command rewritten from a local repo-relative path to a global `npx @thomas-powers-jr/cadence-host-claude-code hook` — plus a `.bak` copy), three new slash commands (`cadence-dispatch.md`, `cadence-next.md`, `cadence-recommend.md`), edits to `cadence-handoff.md`/`cadence-resume.md`, a large prune of `.cadence/intelligence/RECOMMEND.md`/`recommend.json` (~4,280 lines removed), and a deleted `.claude/scheduled_tasks.lock` (expected to stay local/deleted per this repo's own conventions — the rest is not). None of this has been staged, committed, or discarded — ask the operator before touching it.
- **A single markdown-only PR (#538) hit two consecutive macOS-only CI timeouts on two different tests** (`tests/cli/milestone.test.ts`, then `tests/intelligence/debugging-skill-walkthrough.test.ts` 313-01/AC-2 — the latter matches the already-tracked `rec-20260918-004` macOS flake) before a third run went green. Ubuntu and Windows were green throughout. If this keeps recurring on unrelated diffs, it may be worth escalating past "known flake, re-run once" — the macOS runners may just be under load, or the flake surface may be widening beyond the one previously-named file.
- **Don't trust an AI-summarized `WebFetch` of a long reference doc for exhaustive claims** (full tables, complete enumerations). It silently truncated Claude Code's hooks doc mid-table three separate times and produced a confidently wrong conclusion in an early draft of `REPORT-checkpoint-phase-0.4a.md` (that `PreCompact` isn't a blocking event) — caught only by re-fetching the raw doc source with `curl` directly. For anything load-bearing, sample the raw source, not the summarizer's account of it.

## Next action

**Action:** Check whether PR #539 (`docs(cadence): session handoff for 2026-09-24 (checkpoint probe instructions)`) should be merged yet — the operator deferred it deliberately, so ask rather than assume. `gh pr checks 539` first to confirm it's still green.
**Verify:** `gh pr view 539 --json state,mergedAt` shows `"state":"OPEN","mergedAt":null` (still deferred) or `"state":"MERGED"` (landed) — either is a valid outcome, just confirm which one and act accordingly.
**If it fails:** If checks have gone red or the branch now conflicts with `main` (unlikely — it was clean and conflict-free when opened), investigate before re-running blindly; rebase onto current `origin/main` if a real conflict exists, don't force-push over it without checking what changed.

Then, operator's pick — nothing here is blocking:

1. **Build the hook-json-block fix** (`HANDOFF-hook-json-block.md`, read §5a–5c of `REPORT-checkpoint-phase-0.4a.md` first per that handoff's own instruction). This is a real correctness bug in a shipped feature — every CADENCE hook-based block is currently fail-open on affected Windows machines.
2. **Pick up checkpoint arc Phase 2** (sensor + state store) per `HANDOFF-checkpoint-arc-phase-3.md` — independent of #1, can run in parallel.
3. **Triage the unexplained uncommitted local state** in the primary checkout (settings.json rewrite, new slash commands, RECOMMEND ledger prune) before it's accidentally lost or swept into an unrelated commit — see gotchas.
4. Otherwise `cadence progress` / `cadence recommend` and follow what it suggests.
