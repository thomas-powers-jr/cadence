---
cadence_handoff: 2
generated_at: 2026-10-10T01:17:22.089Z
label: phase-326-merged
loop_position: IDLE
active_phase: 311-skill-audit-bypass-recorded-in-gatebypasses
active_draft: 
tier: 
git_branch: chore/session-handoff-2026-10-09-phase-326
git_dirty: true
git_head: 7d96650e
git_ahead: 0
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-10-10 (phase-326-merged)

Continues `SESSION-2026-10-09-v1691-released.md`. (The file is dated 2026-10-10 because `cadence handoff` uses the UTC date. Locally it was still 2026-10-09.)

## TL;DR for the next session
- **Phase 326 merged.** PR #557 was squash-merged as `7d96650e` with operator consent. It fixed nine docs passages that said only `ci-success` is required on `main`. All nine now name `ci-success`, `security-success` and `codeql-success`. A new doc test, `packages/core/tests/docs/required-checks.test.ts`, pins them. rec-20261007-002 is shipped.
- **Phase 326 was built by a session that left no record.** The previous handoff's session went on after writing its doc. It drafted and built phase 326 in `.claude/worktrees/326-required-checks-docs` (2026-10-08, about 21:12–22:03 local), then stopped before settling. This session confirmed it was dead (no process, `phase-freshness` ok) and resumed it in place. Everything was re-verified, with a fresh Opus whole-branch review that found one real gap. It then settled through Codex.
- **`main` is IDLE at `7d96650e`.** `cadence status` says `last settled: 326-docs-name-all-three-required-checks`. Gate on `main`: `pnpm turbo run lint typecheck test build` passed 28/28, but 23 of those were cached. Core is 4806 passed, 15 skipped. The uncached proof is the `--force` run in the phase worktree (28/28, 0 cached) plus CI on #557, which passed all 12 checks on Ubuntu, macOS and Windows. `main`'s tree is #557's tree. No `.changeset/*.md` is pending, and none was due: the phase changed only docs, skills, workflow comments and a test.
- **Two new low-priority recs were filed:** rec-20261009-002 (`audit-exceptions.md` future-tense "once registered" sentence) and rec-20261010-001 (the `.githooks/pre-push` header says `main` has no branch protection).
- **Next action:** run `cadence recommend` and pick the next phase with the operator (see Next action). No phase is pre-chosen.

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `chore/session-handoff-2026-10-09-phase-326` (dirty), 0 ahead / 0 behind origin
- HEAD `7d96650e`
- Recent commits:
```
7d96650e docs: name all three required status checks on main (phase 326) (#557)
061b5f69 chore(cadence): session handoff -- phase 325 merged, v1.69.1 released (2026-10-09) (#556)
847ad7d9 chore(release): v1.69.1 -- release verify budget, MCP SDK / proxy-addr / source-map-js advisories (#555)
4c4b4c87 fix: phase 324's changeset test survives release consumption (phase 325) (#554)
d0d761ea chore(cadence): session handoff -- phases 324 and 323 merged (2026-10-08) (#553)
0160f4d2 fix(release): post-publish npm verification outlasts registry cache propagation (phase 323) (#551)
d6f5c5f6 fix(security): bump MCP SDK, proxy-addr and source-map-js past audit advisories (phase 324) (#552)
0b1c8335 chore(cadence): session handoff -- phase 322 merged, v1.69.0 released (2026-10-04) (#550)
```
- Uncommitted (diff --stat):
```
.cadence/intelligence/RECOMMEND.md   |  200 ++++-
 .cadence/intelligence/recommend.json | 1462 ++++++++++++++++++++++++++++++----
 .claude/commands/cadence-handoff.md  |    2 +-
 .claude/commands/cadence-resume.md   |    4 +-
 .claude/scheduled_tasks.lock         |    1 -
 .claude/settings.json                |   16 +-
 6 files changed, 1499 insertions(+), 186 deletions(-)
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
- **`7d96650e` docs: name all three required status checks on main (phase 326) (#557).** One squash commit (branch `docs/326-required-checks`, commit `16fa29af`, since deleted locally and on origin). It contains:
  - CLAUDE.md ×3 ("Land via branch + PR", the Enforcement-layers "CI" bullet, "The Direct Push")
  - `.claude/skills/pr-land/SKILL.md` (description and opening paragraph; the description now scopes the flake protocol to test legs)
  - `.claude/skills/release-cut/SKILL.md` step 4
  - `docs/release.md` step 5
  - the comments above the `security-success` job (security.yml) and the `codeql-success` job (codeql.yml), which are comment-only edits
  - the new test, the phase 326 artifacts (DRAFT/PROGRESS/RETRO/SUMMARY), the ROADMAP `### Phase 326` entry, the MILESTONES bullet, and the ledger changes
- **Settle:** `CADENCE_HOST_CLI_BIN=codex node packages/core/bin/cadence.cjs settle run --auto --deep --verifier host-cli --ship-ref "phase 326 settled 2026-10-09 on docs/326-required-checks"` passed AC-1 to AC-5, with `observedProvider: host-cli`, no `gateBypasses`, and zero "mock" strings in the SUMMARY. Bare `codex` resolved from the worktree's main-based build. `code-review` was **skipped** because it is not in the standard tier's gate set. The only code review on record is the fresh-context Opus subagent (two passes, final verdict "ready to merge").
- **Review fix this session.** The first review found that `cadence verify coverage --explain AC-2` was NOT SATISFIED. The AC-2 tests, and two of the AC-3 tests, asserted only through the `expectNamesAll`/`expectNoneOf` helpers. Those helpers became the pure `missingNames`/`stalePhrases`, and each test now asserts `expect(…).toEqual([])` in its own `it()` body. All five ACs are now SATISFIED. Mutation checks: restoring the old pr-land paragraph turns 2 tests red, and a planted "`ci-success` is required" CLAUDE.md bullet turns 1 red. DRAFT "As built" items 4–5 record this, including the correction that the original workflow-comment drift is pinned by AC-4, not the AC-5 guard.
- **Recs.** rec-20261007-002 is shipped. Filed in the 326 commit: rec-20261009-002 (by the prior session) and rec-20261010-001.
- **Memory (outside the repo).** Deleted the auto-memory `project_cadence_required_checks.md`; its own text said to delete it once the rec shipped. Replaced `~/.memory/cadence-required-checks-three.md` with `cadence-audit-red-fix-pattern.md`, which keeps the still-useful "verify 'patched' claims with `npm view`" gotcha.

## Carry-forward gotchas
- **Check for in-flight worktrees before starting "new" work.** Phase 326 was fully built in a worktree that the previous handoff never mentioned. On resume, run `git worktree list` and `cadence status` inside any `.claude/worktrees/*` that looks recent. If a session there is dead, resume it in place (The Zombie Session).
- **Editing a DRAFT after approve makes settle refuse** (`draft-read`: "DRAFT.md was edited after approve"). This includes "As built" notes.
  - The non-bypass fix is `node packages/core/bin/cadence.cjs draft approve <phase> <num>`, run from BUILD. It re-runs coherence, approve and plan-review, re-stamps `draftReadAt`, and leaves task records alone. In a non-TTY the approve gate auto-passes with a stderr note.
  - The refused attempt writes a SUMMARY, and the retry overwrites it. The conduction-drift streak counter briefly counts that refused SUMMARY.
- **The assertion-mode coverage scanner credits only an `expect(` written directly in the `it()` body.** Assertions inside helpers don't count. Run `cadence verify coverage --explain AC-N` for every AC before settling.
- **The handoff file date is UTC.** A late-evening local session gets tomorrow's date.
- **Orphan folders to delete by hand** (`git worktree remove` failed with "Result too large" again): add `.claude/worktrees/326-required-checks-docs` to the previous list (`322-idle-last-settled`, `323-release-verify-budget`, `324-audit-advisories-bump`, `325-changeset-test-survives-release`, `hook-json-block`). `checkpoint-phase-0-1` and `checkpoint-schema-reconcile` are still registered worktrees with resumable 2026-09-22 handoffs.
- **`cadence handoff` pruned 11 older SESSION docs again.** They were restored with `git restore .cadence/handoff/`. Expect this every time.
- **Unchanged from the previous handoff:**
  - The `braces` exception row expires on **2026-11-18**. The unblock is Dependabot #474 (`@changesets/cli` 3.x); comment `@dependabot rebase` first.
  - The global `cadence` is still **1.69.0**.
  - Primary-checkout local-only dirt (`.claude/settings.json`, the slash commands, `RECOMMEND.md`/`recommend.json`, the deleted `scheduled_tasks.lock`, `settings.json.bak-…`). Never commit it.
  - `release.yml`'s "three public packages" comment.
  - Open PRs: #544 is CONFLICTING. #539 and #530 are old handoffs. Dependabot #545, #485, #484, #478, #477, #476, #474 and #448.

## Open decisions
None.

## Next action
**Action:** run `cadence recommend` and agree the next phase with the operator. Candidates, in suggested order:
1. **rec-20260907-002:** typecheck `tests/`. Phase 326 again needed a one-off strict `tsc` from a scratchpad tsconfig to check its new test.
2. **Dependabot #474:** `@dependabot rebase`, then land it before the `braces` exception expires on 2026-11-18.
3. **rec-20261008-007:** guard against direct `.changeset/*.md` reads in tests.
4. **Small docs batch (low):**
   - rec-20261009-002: `audit-exceptions.md` tense. Keep the `required_status_checks.contexts` line byte-stable, because `required-checks.test.ts` parses it.
   - rec-20261010-001: the pre-push header.
   - the `release.yml` comment
5. **rec-20261009-001:** dotted branch names in the handoff git facts (low). This session named its handoff branch without dots to avoid it.

Also, outside the loop: `npm i -g @thomas-powers-jr/cadence-core@1.69.1`. Then confirm bare `CADENCE_HOST_CLI_BIN=codex` resolves from the released CLI before dropping the primary checkout's `.env` `codex.exe` line.

**Verify:**
- `git log origin/main --oneline -2` shows `7d96650e` (#557) over `061b5f69` (#556), plus this handoff's own PR if it merged.
- `cadence status` in the primary shows `loop: IDLE` and `last settled: 326-…`.
- `gh api repos/thomas-powers-jr/cadence/branches/main/protection --jq .required_status_checks.contexts` still prints the three checks. If it changed, update `docs/security/audit-exceptions.md`, and `required-checks.test.ts` will follow.

**If it fails:** if `origin/main` has moved past `7d96650e`, read `git log --oneline 7d96650e..origin/main` before acting on anything here.

## Conventions reaffirmed / decisions made
- **A dead session's "all tasks DONE" is a claim to check, not a fact.** Resume in place, re-run the uncached gate, get a fresh-context independent review, and only then settle.
- **When the draft-read gate refuses after an "As built" edit, re-approve.** Use `draft approve` rather than `--allow-stale-draft`.

## Quick resume commands
```bash
git fetch origin --prune && git checkout main && git pull --ff-only origin main
git config core.hooksPath .githooks
pnpm install && pnpm build
node packages/core/bin/cadence.cjs status      # expect IDLE, last settled 326-…
git worktree list                               # check for unrecorded in-flight work
node packages/core/bin/cadence.cjs recommend   # pick the next phase with the operator
```
