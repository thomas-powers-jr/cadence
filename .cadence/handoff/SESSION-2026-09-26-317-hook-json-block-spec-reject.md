---
cadence_handoff: 2
generated_at: 2026-09-26T00:37:04.934Z
label: 317-hook-json-block-spec-reject
loop_position: IDLE
active_phase: 317-hook-json-block
active_draft: 
tier: 
git_branch: worktree-hook-json-block
git_dirty: true
git_head: 2b4c7210
git_ahead: 0
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-09-26 (317-hook-json-block-spec-reject)

## TL;DR for the next session
- Phase 317-hook-json-block's SPEC (`.cadence/phases/317-hook-json-block/317-01-SPEC.md`) was **REJECTED** by an independent Codex review (`317-01-SPEC-REVIEW-codex.md`, same directory) — 8 blocking findings, all independently re-verified against source before being trusted (the review file's own header records which).
- The SPEC's frontmatter still says `status: APPROVED` — that came from `cadence spec approve` running against this project's `specReview.provider: "mock"` config (deliberate, not a fallback) and abstaining. It is **not a real approval**. `spec.ts`'s status enum has no `REJECTED` value, so the sibling review file is the true record, not the frontmatter.
- **Biggest finding, verified true and worse than the review states:** `packages/host-toolkit/src/routing.ts` drops `agentId`/`agentType` when building outgoing hook stdin for both adapters, so `handleSubagentResult`'s `ok:false` safety-net block (`handlers.ts:368`) is currently unreachable dead code through any real host. Filed separately as `rec-20260926-001` (not part of this phase's fix — pre-existing, distinct bug).
- **Do not run `cadence draft new` for this phase** until the SPEC is revised against every verified finding.
- `dec-20260925-001` (D-BN: JSON-decision-on-stdout, exit 0, per event, not exit-2) is unaffected by the review and still stands.
- Nothing has been committed in this worktree yet — everything (SPEC, both review files, the carried-over rec/dec ledger entries) is uncommitted working-tree state on branch `worktree-hook-json-block`.

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `worktree-hook-json-block` (dirty), 0 ahead / 0 behind origin
- HEAD `2b4c7210`
- Recent commits:
```
2b4c7210 docs(checkpoint): Phase 0.4a active block-probe report (#534)
a341d696 chore(release): v1.68.0 -- checkpoint handoff schema reconcile (phase 316) (#533)
2ef7870a feat: checkpoint handoff schema reconcile, version-gated (phase 316) (#531)
f553841d chore(release): v1.67.3 -- skill-audit gateBypasses, core-skills phase-build requirement, systematic-debugging skill, worktree hook-shim cwd fix (#529)
eea11ae5 feat: checkpoint handoff validator, phases 0-1 (working name) (#528)
ff338a05 chore(cadence): file phase-315 scoping decisions and the identity-half split (rec-20260917-006) (#526)
3803113f docs(cadence): session handoff for 2026-09-22 (PR #521 merged, sync check) (#527)
225d9012 docs(cadence): session handoff for PC transfer (2026-09-18) (#521)
```
- Uncommitted (diff --stat):
```
.cadence/intelligence/DECISIONS.md         |  7 ++++
 .cadence/intelligence/RECOMMENDATIONS.md   | 33 ++++++++++++++++
 .cadence/intelligence/decisions.json       |  9 +++++
 .cadence/intelligence/evidence.json        | 14 +++++++
 .cadence/intelligence/recommendations.json | 62 ++++++++++++++++++++++++++++++
 5 files changed, 125 insertions(+)
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
- Files in play:
  - `packages/core/tsconfig.json` — affected by rec-20260907-002 packages/core/tsconfig.json includes only src/**/*, so no repo command ever typechecks tests/
  - `docs/reference/config.md` — affected by rec-20260917-008 docs/reference/config.md overclaims skill-audit: says it enforces skills were invoked 'during a phase', which the checkout-scoped invoked list does not support
  - `packages/core/src/parse/draft-parser.ts` — affected by rec-20260918-005 DRAFT.md with UTF-8 BOM (+ optionally CRLF) still throws the misleading 'missing frontmatter' error
  - `packages/core/src/parse/draft-mutate.ts` — affected by rec-20260918-006 draft-mutate.ts's add-ac/add-task splice regexes are \n-only, so a CRLF draft now fails with a different misleading error post-phase-310
  - `packages/core/src/parse/spec-parser.ts` — affected by rec-20260918-007 spec-parser.ts and ui-spec-parser.ts have the identical CRLF frontmatter-rejection bug phase 310 fixed for draft-parser.ts
  - `packages/core/src/parse/ui-spec-parser.ts` — affected by rec-20260918-007 spec-parser.ts and ui-spec-parser.ts have the identical CRLF frontmatter-rejection bug phase 310 fixed for draft-parser.ts

## What landed this session
1. Filed `rec-20260925-001` (Windows/PowerShell hook-blocking exit-code collapse, from `docs/checkpoint/REPORT-checkpoint-phase-0.4a.md` and independent reproduction), dedup-checked clean first.
2. Recorded `dec-20260925-001` (D-BN: transport = JSON decision on stdout, exit 0, per event).
3. Cut worktree `.claude/worktrees/hook-json-block` (branch `worktree-hook-json-block`) off fresh `origin/main` — the checkpoint 0.4a report (PR #534) was already merged there, so the primary checkout's local `docs/checkpoint-phase-0.4a-report` branch (one commit, already squash-merged) was correctly identified as stale and not used as the base. Carried the uncommitted rec-ledger diff over via `git diff`/`git apply` (saved as a patch, applied cleanly).
4. Scaffolded and authored `.cadence/phases/317-hook-json-block/317-01-SPEC.md` (via `cadence spec new --from-rec rec-20260925-001`, which converted the rec to `status: converted`). Went through two authoring passes with advisor consultation between each, incorporating live measurements: `curl` of the raw `code.claude.com/docs/en/hooks.md` (verbatim shapes for `PreToolUse`/`Stop`/`SubagentStop`/`shell` field), a live PowerShell exit-code-collapse reproduction on this box (`powershell.exe -NoProfile -Command "node -e 'process.exit(2)'"` → observed `1`; `; exit $LASTEXITCODE` restores `2`), a UTF-8-through-pipe encoding probe (non-ASCII survives byte-for-byte), a direct read of both `host-claude-code` and `host-codex`'s shim relay code, and a `windows-latest` CI log check confirming Git Bash is present there (`git version 2.55.0.windows.5`).
5. Ran `cadence spec approve 317-hook-json-block 01` with `CADENCE_HOST_CLI_BIN=codex` — discovered this project's `specReview.provider` is hardcoded `"mock"` in `.cadence/config.json` (only `verifier`/`perTaskVerifier`/`codeReview` are `"host-cli"`), so the env var had no effect; the gate abstained and the loop still advanced SPEC→IDLE. Corrected the memory that assumed this env var alone was sufficient for every host-cli-shaped gate — see the new `project_cadence_specreview_mock` memory.
6. Ran a real, manual independent review via `codex exec -s read-only --ephemeral`, with the raw hooks-doc excerpts pasted directly into the prompt (the sandbox may lack network). Result: **REJECT**, saved as `317-01-SPEC-REVIEW-codex.md`.
7. Independently re-verified every blocking finding against the actual source before accepting any of them (not taken on faith) — full verification notes are in that file's own header.
8. Discovered and filed `rec-20260926-001` (the `routing.ts` agentId/agentType drop making `SubagentStop`'s safety-net block unreachable) — a distinct, pre-existing bug surfaced by the review, dedup-checked clean before filing.
9. Wrote two new persistent-memory entries (`project_cadence_specreview_mock.md`, `project_phase317_spec_rejected.md`) and updated `MEMORY.md`'s index.
10. Ran the full `pnpm turbo run lint typecheck test build` gate: **28/28 tasks passed** (cached — no `packages/**` source was touched this session, only `.cadence/` artifacts).

## Carry-forward gotchas
- **Read `317-01-SPEC-REVIEW-codex.md`'s header before re-deriving anything** — it already states which of the 10 findings were independently verified true (1, 2, 3, 4, 6, 9 confirmed; 7, 8, 10 accepted as valid structural critique) and which citation is **not** to be trusted (finding 5's URL `learn.chatgpt.com/docs/hooks` does not match any known real OpenAI docs domain — don't propagate it as fact; the *code* claim in that same finding, that `ctx.raw.hostCapabilities` is a capability descriptor and not a host-identity field, was separately verified true by reading `packages/types/src/host.ts:11-29` directly).
- **`docs/handoffs/HANDOFF-hook-json-block.md`** (Thomas's original handoff for this phase) is still untracked and does not exist in this worktree at all — the SPEC cited it as if readable here, which the review correctly flagged. Either get it committed to the repo (so future worktrees inherit it) or stop citing it as a worktree-local file.
- **This project's `.cadence/config.json` has 4 of 7 verify-family gates hardcoded to `mock`**: `specReview`, `uiSpecReview`, `planReview`, `securityAudit`. `CADENCE_HOST_CLI_BIN` only matters for the 3 that are `"host-cli"`: `verifier`, `perTaskVerifier`, `codeReview`. Full detail in the `project_cadence_specreview_mock` memory. There's an existing open rec about wiring the rest: `rec-20260801-002` (candidate, needs-decision) — the code-level `HostCliSpecReviewVerifier` builder already exists, only the config flip (an operator decision, its own commit) is missing.
- **The primary checkout** (`C:\Users\softw\projects\cadence`, branch `docs/checkpoint-phase-0.4a-report`) may still have leftover uncommitted `.cadence/intelligence/*` changes from before this worktree was cut (a stale `candidate`-status copy of `rec-20260925-001`, superseded by this worktree's `converted`-status copy) — check and clean up if still present; do not let both copies get committed independently.
- **ID collision risk, unresolved**: `rec-20260925-001`, `dec-20260925-001`, and `rec-20260926-001` use date-based IDs. If the parallel checkpoint-arc session in `.claude/worktrees/checkpoint-phase-0-1` mints IDs the same way on the same days, they could collide at merge time — this is the exact fragility `rec-20260821-005` already describes as open. Worth a heads-up to that session if still active.
- **D-BO option (c)** from the SPEC's own Open Questions (a settle-time anomaly if a block was emitted for an edit that landed anyway) was dedup-checked clean but deliberately **not filed** — left as a written item per the operator's explicit preference to resume with a list rather than a growing set of speculative recs.

## Open decisions
- **D-BO, D-BP, D-BQ** (from the SPEC's Open Questions) — still genuinely open, not yet decided. Record each with `cadence decision add` once the DRAFT is being authored, per the SPEC's own instruction, not before.
- **Codex transport ambiguity (AC-9)** — does Codex honor an exit-0 JSON `decision:block`, or only exit code 2? `.cadence/research/codex-hooks.md` is 4 months stale on this exact point. Needs a fresh primary-source check before the SPEC can be re-submitted. If the answer is "exit 2 only," core needs a host-aware branch (via `ctx.raw.hostCapabilities` — but note the review's finding 5: that field is a capability descriptor, not a host-identity field, so the exact detection mechanism still needs designing, not just invoking).
- **Should `.cadence/config.json`'s `specReview.provider` move to `"host-cli"`?** Operator's call, its own commit, tracked already at `rec-20260801-002`. Not blocking this phase's SPEC rework, but blocking a *real* automated `spec approve` for this or any future phase until decided.
- **Primary-checkout cleanup and the ID-collision heads-up** (see Carry-forward gotchas) — raised to the operator, no explicit resolution captured yet.

## Next action
Revise `.cadence/phases/317-hook-json-block/317-01-SPEC.md` against every verified finding in `317-01-SPEC-REVIEW-codex.md` before touching `cadence draft new`:
1. Rescope AC-2 and AC-9 to acknowledge `SubagentStop`'s block path is currently unreachable (pending `rec-20260926-001`'s fix, out of this phase's scope) rather than assuming it's live.
2. Reword AC-6/AC-9 to drop "the host accepts"/"actually proven to block" language — pure transport-shape-and-exit-code assertions only, consistent with the SPEC's own no-live-host Constraint.
3. Fix AC-4 to require capturing the real `install --local`-registered command (absolute paths via `resolveLocalPaths()`), not a hand-written equivalent.
4. Tighten AC-7 (concrete doctor-check contract) and AC-10 (pin the new comment's actual text, not just assert the old text is gone).
5. Fix the two citation slips (`hook.ts:35` not `:36`; separate the dispatcher.ts handler-routing claim from routing.ts's event-name mapping).
6. Resolve the `docs/handoffs/HANDOFF-hook-json-block.md` worktree-visibility gap (get it into the repo, or stop citing it as readable here).

Then get a **second real review** — either ask the operator to flip `specReview.provider` to `host-cli` in its own commit (`rec-20260801-002`), or run another manual `codex exec` review — before treating the SPEC as ready for `spec approve`/`draft new`. Decide the open items (D-BO(c) filing, ID-collision heads-up, Codex host-detection design) at that point, not before.

Quick resume:
```
cd C:\Users\softw\projects\cadence\.claude\worktrees\hook-json-block
git status --short --branch
node packages/core/bin/cadence.cjs doctor
cat .cadence/phases/317-hook-json-block/317-01-SPEC-REVIEW-codex.md
```
