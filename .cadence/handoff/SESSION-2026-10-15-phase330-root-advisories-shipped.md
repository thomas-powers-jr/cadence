---
cadence_handoff: 2
generated_at: 2026-10-15T17:31:40.763Z
label: phase330-root-advisories-shipped
loop_position: IDLE
active_phase: 330-raise-override-floors-past-the-13-root-moderate-advisories
active_draft: 
tier: 
git_branch: chore/session-handoff-2026-10-15
git_dirty: false
git_head: a43874b0
git_ahead: 0
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-10-15 (phase330-root-advisories-shipped)

Continues `SESSION-2026-10-13-phase328-website-audit-shipped.md` (on the still-unmerged #566 branch `chore/session-handoff-2026-10-13`, not on `main`).

## TL;DR for the next session
- **Phase 330 shipped** (#568, squash `a43874b0`): root `pnpm audit` went from 13 moderate to **0** via caret `pnpm.overrides` floors (hono, qs, fast-uri, ip-address, vitest, @vitest/coverage-v8). Root Dependabot alerts: **0** open (only `website/pnpm-lock.yaml` has 1 moderate). `rec-20261008-002` → shipped. Not released (no changeset; nothing published changed).
- **Phase 329** (changesets 3.x, #567, `5ebc8408`) had already merged before this session started — the 2026-10-13 handoff's top pick is done.
- `main` = `a43874b0`, loop IDLE, last settled 330; next phase number is **331**. Full gate on this tree green on Windows: `pnpm turbo run lint typecheck test build` 28/28, core 486 test files passed (1 pre-existing lint warning in `src/demo/node-test-summary.ts`).
- **Open PRs needing the operator:** #566 (the 2026-10-13 handoff — the primary checkout is still on its branch), this handoff's PR, and Dependabot #484 (@vitest/mocker 5.0.0; still open at handoff, though its alert has cleared — see Open decisions).
- **Next action:** with the operator, pick among checkpoint Arc A Phase 2 (`docs/handoffs/HANDOFF-checkpoint-phase-2.md`, complex tier), the new `rec-20261015-001` (audit-gate severity decision), or the top-ranked recs (tests/ never typechecked, the CRLF/BOM parser cluster).

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `chore/session-handoff-2026-10-15` (clean), 0 ahead / 0 behind origin
- HEAD `a43874b0`
- Recent commits:
```
a43874b0 fix(security): raise override floors past the 13 root moderate advisories (phase 330) (#568)
5ebc8408 fix(security): adopt changesets 3.x and retire the braces audit exception (phase 329) (#567)
a34b222a fix(security): fix website dependency advisories and audit the website lockfile in CI (phase 328) (#565)
54651321 chore(cadence): file checkpoint Phase 2 decisions D-BJ/D-BR/D-BS and its handoff (#564)
c52e19c4 chore(cadence): session handoff -- v1.70.0 released (2026-10-10) (#563)
998356d4 docs: dated assurance report snapshot and phase 327 handoff pre-flight corrections (#562)
2037b5c4 chore(release): v1.70.0 -- cadence assurance report (#561)
8d47d003 chore(cadence): session handoff -- phase 326 merged (2026-10-09) (#558)
```
- Loop: IDLE · phase 330-raise-override-floors-past-the-13-root-moderate-advisories · tier (none)

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
- Files in play:
  - `packages/core/tsconfig.json` — affected by rec-20260907-002 packages/core/tsconfig.json includes only src/**/*, so no repo command ever typechecks tests/
  - `docs/reference/config.md` — affected by rec-20260917-008 docs/reference/config.md overclaims skill-audit: says it enforces skills were invoked 'during a phase', which the checkout-scoped invoked list does not support
  - `packages/core/src/parse/draft-parser.ts` — affected by rec-20260918-005 DRAFT.md with UTF-8 BOM (+ optionally CRLF) still throws the misleading 'missing frontmatter' error
  - `packages/core/src/parse/draft-mutate.ts` — affected by rec-20260918-006 draft-mutate.ts's add-ac/add-task splice regexes are \n-only, so a CRLF draft now fails with a different misleading error post-phase-310
  - `packages/core/src/parse/spec-parser.ts` — affected by rec-20260918-007 spec-parser.ts and ui-spec-parser.ts have the identical CRLF frontmatter-rejection bug phase 310 fixed for draft-parser.ts
  - `packages/core/src/parse/ui-spec-parser.ts` — affected by rec-20260918-007 spec-parser.ts and ui-spec-parser.ts have the identical CRLF frontmatter-rejection bug phase 310 fixed for draft-parser.ts

## What landed this session
- **Phase 330 — raise override floors past the 13 root moderate advisories** (`330-01`, standard tier; #568 → `a43874b0`). Re-measured 2026-10-15: hono 4.13.1 ×4, ip-address 10.4.0 ×4, qs 6.15.3 ×2, fast-uri 3.1.7, vitest 4.1.10, @vitest/mocker 4.1.10 (audit entries). **11 of 13 were on cadence-core's production path** via `@modelcontextprotocol/sdk` (hono, qs, ip-address via express-rate-limit, fast-uri via ajv); only the vitest pair was dev-only.
  - Overrides: new `hono@<4.13.7: ^4.13.7`, `qs@<6.16.0: ^6.16.0`, `vitest@<4.1.11: ^4.1.11`, `@vitest/coverage-v8@<4.1.11: ^4.1.11`; fast-uri key moved `<3.1.6` → `<3.1.8: ^3.1.8`; `ip-address@^10.0.0` target `^10.3.1` → `^10.7.1`. Lockfile: hono 4.13.13, qs 6.16.1, ip-address 10.7.4, fast-uri 3.1.8, vitest family 4.1.12, one version each. Overrides checker 11/11.
  - New `packages/core/tests/docs/phase330-root-moderate-advisories.test.ts` (AC-1 test and AC-2 floor test shown red against `origin/main` first); `lockfile-overrides-current-state.test.ts` fast-uri/ip-address assertions superseded with comments.
  - All 11 PR checks green, including Linux `pnpm install --frozen-lockfile`.
- **Ledger:** `rec-20261008-002` converted → shipped; **`rec-20261015-001` filed** (needs-decision, low): should the audit gate report or fail on moderate advisories reachable from published packages' production paths? (the rec's second half, split out rather than dropped).
- Reviews: per-task reviewers for T1 and T2 plus a whole-branch review (fresh-context Opus subagents). The whole-branch pass first returned NOT READY on a prose error (production path understated as hono+qs only, in four records) — fixed before settle.

## Carry-forward gotchas
- **Standard tier × standard profile has no AI gates.** `draft approve` wrote no PLAN-REVIEW and `settle run --auto` skipped deep-verify and code-review ("not in the active tier × profile gate set"); the SUMMARY carries no verifier identity, so the conduction-drift streak is now 3. The `.env` host-cli wiring doesn't help here — dispatch fresh-context reviewers for the independent look.
- **Single-file test runs:** `pnpm --filter @thomas-powers-jr/cadence-core test -- <file>` exits 1 on global coverage thresholds even when all tests pass. Use `npx vitest run <file> --coverage.enabled=false` from `packages/core`.
- **pnpm 9 records overridden importer specifiers.** After an override on a direct dependency (vitest), `pnpm-lock.yaml` shows `specifier: ^4.1.11` while every manifest keeps `^4.1.10`; `--frozen-lockfile` accepts it (CI confirmed). Bumping only the root devDependency instead left a duplicate vitest 4.1.10.
- **Future vitest 5.x phase (#484)** must retire or re-key `vitest@<4.1.11` and `@vitest/coverage-v8@<4.1.11`, or `check-lockfile-overrides.mjs` reports vitest 5 as `unguarded-line`; `phase330-…test.ts` AC-3 pins the published vitest specifier at `^4.1.10` and must be superseded too.
- **`cadence handoff` pruned three tracked docs again** (`SESSION-2026-09-26*.md`); restored with `git restore`. Retention is 10; expect the same on every run until the pruning rule is changed (fourth occurrence — still not filed as a rec).
- **Scaffolded frontmatter says `active_phase: 330-…` while the loop is IDLE** — that is the known stale-activePhase surfacing (`rec-20261004-007`), not an active phase.
- `gh pr merge --squash --delete-branch` run inside a worktree switched that worktree to `main` and pulled; the phase worktree `.claude/worktrees/330-root-moderate-advisories` was used for this handoff and is slated for removal afterwards.
- Carried from 2026-10-13, still true: phase worktrees need `.env`/`.env.local` copied in plus `cadence onboard --skip-host-wire`; `core.hooksPath` drifts to an absolute path; doctor `worktree-phases` false positive and `intelligence audit` 366-orphan report not filed; stale sibling worktree `315-skill-invocation-phase-scoping`; `origin/feat/kernel-assurance-v2` keeps fast-forwarding to `main`.
- Local-only in the primary checkout (do not stage): `.agents/`, `.cadence/state.json.stale-314-2026-10-13`, `docs/handoffs/HANDOFF-demo-progressive-disclosure.md`, `docs/handoffs/cadence-audit-20260724-handoff.md`, `docs/tutorial-rebuild-brief.md`, deleted `.claude/scheduled_tasks.lock`.
- The `/handoff` skill still hardcodes the old PC's `C:\Users\digit\...` paths (auto-memory dir, sibling synth repo). On this PC the auto-memory lives at `C:\Users\Thomas\.claude\projects\C--Users-Thomas-Documents-Projects-cadence\memory\`.
- Known non-blocking record quirks in phase 330: `330-01-PROGRESS.json` lists T2's files under T1's `touchedFiles`; the CLI ledger rewrite reordered `createdAt`/`updatedAt` keys on the archived phase 329 rec.

## Open decisions
- **rec-20261015-001** — audit-gate severity for production-path moderates: (a) keep high/critical only and record it as dropped, (b) report moderates as a non-failing notice, (c) fail on production-path moderates, notice for dev-only. Operator decides.
- **Dependabot #484** (@vitest/mocker 5.0.0, a grouped security-update PR) — still open at handoff time. Its underlying alert has cleared (root alerts 0), so Dependabot may close it on its own; check `gh pr view 484 --json state` before deciding. If it's still open, the operator decides whether vitest 5 becomes its own phase or the PR is closed.
- **#566** (2026-10-13 handoff PR) — merge or close; until it merges, the primary checkout's `cadence resume` still replays the 2026-10-13 doc.

## Next action
**Action:** with the operator, merge #566 and this handoff's PR, then choose the next unit (phase 331). Default recommendation: checkpoint Arc A Phase 2 (unblocked since 2026-10-13; complex tier, fresh worktree, `.env` files copied in), unless the operator wants the quick `rec-20261015-001` decision first.

**Verify before acting:**
- `git log origin/main --oneline -1` shows `a43874b0` (#568) or a handoff PR on top.
- `node packages/core/bin/cadence.cjs status` → `loop: IDLE`, `last settled: 330-raise-override-floors-…`.
- `gh api "repos/thomas-powers-jr/cadence/dependabot/alerts?state=open&per_page=100" --jq 'group_by(.dependency.manifest_path)|map({(.[0].dependency.manifest_path):length})|add'` → expect `{"website/pnpm-lock.yaml":1}` only.

## Conventions reaffirmed / decisions made
- Dependency advisories are fixed with durable caret override floors at the strictest patched version (never unbounded `>=`), not with bare lockfile refreshes — and direct devDependencies duplicated across workspace packages go through overrides too, so published manifests stay untouched and no changeset is owed.
- A rec with two questions ships only the half that was done; the other half is filed as its own rec before promotion (Unlogged Audit Finding rule).
- Doc-content tests assert offline repo state; live `pnpm audit` results are SUMMARY/PR evidence, never an asserting `it()`.

## Quick resume commands
```powershell
Set-Location C:\Users\Thomas\Documents\Projects\cadence
git fetch origin --prune
# The primary checkout is on chore/session-handoff-2026-10-13 (#566). Once #566 and
# this handoff's PR are merged:
git switch main; git pull --ff-only
git config core.hooksPath .githooks
pnpm install; pnpm build
node packages/core/bin/cadence.cjs resume
node packages/core/bin/cadence.cjs progress
node packages/core/bin/cadence.cjs doctor
node packages/core/bin/cadence.cjs recommendation show rec-20261015-001
Get-Content docs/handoffs/HANDOFF-checkpoint-phase-2.md
```
