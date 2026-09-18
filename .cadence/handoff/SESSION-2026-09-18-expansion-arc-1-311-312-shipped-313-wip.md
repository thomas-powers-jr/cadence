---
cadence_handoff: 1
generated_at: 2026-09-18T01:03:25.586Z
label: expansion-arc-1-311-312-shipped-313-wip
loop_position: IDLE
active_phase: 311-skill-audit-bypass-recorded-in-gatebypasses
active_draft: 
tier: 
git_branch: main
git_dirty: true
git_head: 18d2bf78
git_ahead: 0
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-09-18 (expansion-arc-1-311-312-shipped-313-wip)

## TL;DR for the next session
- **The work is the expansion arc in `docs/handoffs/HANDOFF-expansion-arc-1.md`** (operator-written, now committed). It planned 2 phases; it became 3.
- **Phase 311 shipped** (`ccd5572f`, PR #515): `--allow-skill-audit-miss` now records in `SUMMARY.gateBypasses`. It was inserted because the arc's Phase 1 AC-4 asserted this already worked, and it did not.
- **Phase 312 shipped** (`18d2bf78`, PR #516): `cadence/core-skills` declares `skillAudit.required: ["phase-build"]`. **First non-empty `skillAudit.provenance` in 322 settle records** — the arc's actual objective.
- **Phase 313 is MID-BUILD and NOT settled.** Work is committed as WIP and pushed to `wip/systematic-debugging-skill`; the worktree is intact at `.claude/worktrees/313-systematic-debugging-skill`. **Resume in place — do not start a second session against this draft.**
- **Single next action:** finish 313. Four concrete items remain and the first two WILL refuse settle.
- **Read WIP commit `2c2bcc14`** on that branch — it restates the blockers at the point of pause.

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `main` (dirty), 0 ahead / 0 behind origin
- HEAD `18d2bf78`
- Recent commits:
```
18d2bf78 feat: cadence/core-skills declares phase-build as a required skill (phase 312) (#516)
ccd5572f fix: --allow-skill-audit-miss records the bypass in SUMMARY.gateBypasses (phase 311) (#515)
2857642f chore(cadence): file expansion-arc-1 preflight findings (rec-20260917-003/-004) (#514)
a9743257 chore(release): v1.67.2 -- DRAFT CRLF frontmatter, resume stale-handoff pointer, codex-hooks completeness (#513)
8f265f94 fix: DRAFT frontmatter parser rejects CRLF line endings (phase 310) (#TBD) (#512)
0abed4d2 docs(cadence): refresh v1.67.1 handoff machine facts after #507 merged (#508)
27770af6 fix: cadence resume no longer silently serves a stale handoff when the lastHandoff pointer names a file that still exists but is no longer freshest (phase 309) (#511)
b1a79cc8 fix: doctor codex-hooks check verifies completeness, not just existence (phase 308) (#510)
```
- Uncommitted (diff --stat):
```
.cadence/intelligence/RECOMMENDATIONS.md   | 17 +++++++++++++
 .cadence/intelligence/evidence.json        | 14 +++++++++++
 .cadence/intelligence/recommendations.json | 39 +++++++++++++++++++++++++++---
 3 files changed, 66 insertions(+), 4 deletions(-)
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
- **v1.67.2 independently verified** — all five packages `latest=1.67.2` on npm, tag `v1.67.2` → `615d406`, GitHub release published. The prior handoff predated this release and was stale in two of its three "next action" candidates.
- **Phase 311** (PR #515, merged `ccd5572f`). `runSkillAuditCheck` returns `bypassed`/`reason`; settle pushes a `GateBypass` beside the `pack-resolution` push. Settled with `gateBypasses: []`, all 5 ACs on `executed` evidence.
- **Phase 312** (PR #516, merged `18d2bf78`). Manifest declares the requirement, version `1.0.0` → `1.1.0`. All 6 ACs `executed`, no bypass.
- **Nine ledger filings, all measurement-driven.** `rec-20260917-003` (no manifest slot for a distributed skill), `-004` (bypass audit-trail gap; shipped PARTIAL), `-005` (its residuals, deliberately kept live so they did not retire with it), `-006` (checkout-scoped `invoked` semantics — **the most important open finding**), `-007` (Slice 5 completion; shipped), `-008` (config.md overclaim), `rec-20260918-001` (assumption transitions cannot record their observation), `-002` (the 313 phase rec). `rec-20260917-002` was **rejected and archived** — I overstated a gap and superseded it with `-004`.
- **`core.hooksPath` was unset on this checkout and is now `.githooks`.** The prior handoff flagged it; the pre-commit doc-sync gate had not been running.
- **Two independent reviews caught real defects I would have shipped**, most seriously a phase-294 audit-trail regression (`cadence verify phase` reported AC-3 drift after I retargeted its coverage token). Both are worth repeating on 313.

## Carry-forward gotchas
- **`pnpm --filter ... test -- <single-file>` EXITS NON-ZERO even when every test passes.** One file scores ~0.3% against a 70% global coverage threshold. Read the test results, never the exit code, on any filtered run. This looked like a failure twice.
- **Concurrent vitest runs race on `packages/core/coverage/.tmp`** and produce an `ENOENT` indistinguishable from a real failure. Two agents hit it independently. Run one vitest process at a time; if a run dies during coverage generation with no test summary printed, re-run it alone before believing it.
- **`turbo` replays a cached green run in ~2s.** If a full-pipeline result comes back implausibly fast after you changed files, re-run with `--force` before trusting it.
- **A DRAFT edited after `approve` refuses settle** via `draft-read`. The fix is to run `cadence draft approve` again — it does NOT reset `PROGRESS.json` task statuses (verified twice). Do **not** use `--allow-stale-draft`: it is one of the flags that records nowhere (`rec-20260917-005`).
- **The DRAFT parser reads only the FIRST literal `- files:` line** in a task block. A `- files (also):` line parses as nothing, silently. Edit the real line.
- **Backticks inside `recommendation add --summary "..."` are shell-substituted away**, silently corrupting stored text — it happened to `rec-20260918-001` (repaired with an evidence row). Avoid backticks in ledger prose, or single-quote the argument.
- **A fresh worktree has no `.cadence/state.json`** (gitignored) and no `node_modules`. Run `cadence onboard`, then `pnpm install --frozen-lockfile && pnpm build`. And **create the worktree BEFORE `draft new`** — there is no `discard` command to unwind a draft created in the wrong checkout.
- **Ledger edits in the primary checkout do not reach a worktree.** Copy `.cadence/intelligence/{recommendations,evidence}.json` + `RECOMMENDATIONS.md` across, or file the rec inside the worktree.
- **The primary checkout has uncommitted `.cadence/intelligence/` changes** (`rec-20260918-001`), which is ALSO committed on `wip/systematic-debugging-skill`. After 313 merges, `git restore` those three files rather than committing them twice.
- **`state.json` here still names `activePhase: 311-...`** — 312 and 313 were built in worktrees with private state. Harmless; clears on the next `draft new` in this checkout.
- **Skill resolution** (asked of `claude-code-guide`, partly undocumented): precedence is Enterprise > Personal > Project, plugin skills are *always* namespaced while project skills are bare, and Claude Code **does** pick up new skill files mid-session. That matches what was observed — the first probe hit the Superpowers copy only because the new file was not yet registered, and it registered moments later. The guide still recommends a distinctive name, since the Skill tool's bare-name resolution algorithm is not formally documented. See the naming decision under "Next action".
- **Node 24 locally vs Node 22 in CI.** Unchanged from prior handoffs.

## Next action

**Finish phase 313.** Reattach to the existing worktree — do not create a new one, do not re-clone the branch:

```sh
cd .claude/worktrees/313-systematic-debugging-skill
git log --oneline -1          # expect 2c2bcc14 wip(313) ...
```

Its DRAFT is approved and T1–T3 are done: `SKILL.md` written, a 5-test walkthrough passing (drives the real CLI against ephemeral repos, asserts ledger state from `--format json`), plus the `docs/packs-design.md` distributed-skills note and a changeset. **Four things remain. The first two will refuse settle.**

1. **Invoke the `phase-build` skill inside that worktree.** Its `state.skillAudit.invoked` reads `["systematic-debugging"]`, and the pack requires `phase-build` as of phase 312, so `satisfies()` fails and settle refuses. This is phase 312's requirement firing for real in a fresh worktree — resolve it by invoking the skill, **not** with `--allow-skill-audit-miss`. Worth stating in the PR: the first live exercise of the new requirement was a pass that was earned, not bypassed.
2. **AC-5 and AC-6 have no `313-01/AC-N` coverage token**, so `test-coverage` refuses (`assertion` + `phase-qualified` at `tier: standard`). Verify with `grep -rho "313-01/AC-[0-9]" packages/core/tests/ | sort -u` — expect only AC-1..AC-4. AC-5 needs a `docs/packs-design.md` content assertion. **AC-6 must be RESTATED before it gets a token**: as written it claims the skill's invocation proves observability, but the telemetry entry that exists came from the *Superpowers plugin* skill, not from the file this phase ships. Restate it as discoverability — correct path, valid frontmatter, `name:` matching the directory — which is honestly assertable. The live `[] → ["systematic-debugging"]` observation is corroborating evidence with a caveat, not the criterion.
3. **Run T4**: `pnpm turbo run lint typecheck test build --force`, and read the diff end to end.
4. **Re-approve before settling** — the DRAFT was amended after approve.

Then settle, make ONE commit (the WIP commit squashes at merge), promote `rec-20260918-002` to shipped, open a PR, and merge only with explicit operator consent.

**One decision is open and belongs to the operator:** whether the skill keeps the name `systematic-debugging`. Architecturally it is safe — plugin skills are always namespaced (`superpowers:systematic-debugging`), project skills are bare — and the observed collision was a registration-timing artifact that resolved itself. But `claude-code-guide` notes the bare-name resolution algorithm is not formally documented and recommends a distinctive name, and this repo's own skills (`phase-build`, `pr-land`, `release-cut`) all use distinctive names. A rename to e.g. `cadence-debug` guarantees reachability; keeping the name preserves the arc plan's framing of replacing the Superpowers skill. **Ask before renaming** — the arc doc names it explicitly.

### Say this to the operator when 313 goes up
Three phases, three claims narrowed to what the evidence supports: 311's AC-4 was false as written, 312 cannot prove per-phase enforcement, and 313 cannot prove a model obeys prose. That is the loop working as designed — but it also means the expansion track's pitch ("ship a skill that isn't advice") is thinner than the plan assumed: the debugging gate is a convention the model honors, not something the engine enforces. **The operator should hear that before choosing what phase 314 is.**

### Highest-value open finding
`rec-20260917-006` — `skillAudit.required` is ambiguous in **time** (`invoked` is checkout-scoped, deduped and never reset, so one invocation satisfies it effectively forever) and in **identity** (telemetry records the name *requested*, not the skill that *ran*, and `satisfies()` suffix-matching lets any plugin skill sharing the suffix satisfy a bare requirement). Phase 312 shipped a requirement resting on both. Net operational effect, which the operator has been told and should weigh: the gate is noisy in fresh worktrees (~75% refusal against phases 295–310) and inert in a long-lived checkout.
