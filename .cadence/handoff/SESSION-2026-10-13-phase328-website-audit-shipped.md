---
cadence_handoff: 2
generated_at: 2026-10-13T18:47:58.917Z
label: phase328-website-audit-shipped
loop_position: IDLE
active_phase: 
active_draft: 
tier: 
git_branch: chore/session-handoff-2026-10-13
git_dirty: true
git_head: a34b222a
git_ahead: 0
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-10-13 (phase328-website-audit-shipped)

Continues `SESSION-2026-10-10-v1-70-0-released.md` (resumed via `cadence resume --pick 1`).

## TL;DR for the next session
- **Phase 328 shipped** (#565, squash `a34b222a`): the docs site's Dependabot alerts went from 26 (1 critical astro RCE, 10 high) to **1 moderate**, and the required `security-success` check now also audits `website/pnpm-lock.yaml`. `rec-20260802-006` → shipped. Not released (no changeset; nothing published changed).
- **Checkpoint Arc A Phase 2 is unblocked**: D-BJ/D-BR/D-BS filed as `dec-20261013-001..003` and the operator's `docs/handoffs/HANDOFF-checkpoint-phase-2.md` committed (#564, `54651321`). Its phase number is no longer 328 — next free is **329**.
- **New PC is set up** (user `Thomas`): global cadence 1.70.0, codex logged in, `.env`/`.env.local` written, doctor shows real verification wired. Stale BUILD-on-314 `state.json` replaced via `cadence onboard`.
- `main` = `origin/main` = `a34b222a`, loop IDLE, last settled 328. Full gate on `main` green on Windows: `pnpm turbo run lint typecheck test build` 28/28, core 484 test files passed.
- **Next action:** pick among (a) root-lockfile moderates `rec-20261008-002` (now 13 alerts, +2 new today), (b) `rec-20261010-007` (#474 changesets 3.x, **hard deadline 2026-11-18**), (c) checkpoint Phase 2 — see "Next action"; (a) and (b) touch the same root override block, so sequence them.

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `chore/session-handoff-2026-10-13` (dirty), 0 ahead / 0 behind origin
- HEAD `a34b222a`
- Recent commits:
```
a34b222a fix(security): fix website dependency advisories and audit the website lockfile in CI (phase 328) (#565)
54651321 chore(cadence): file checkpoint Phase 2 decisions D-BJ/D-BR/D-BS and its handoff (#564)
c52e19c4 chore(cadence): session handoff -- v1.70.0 released (2026-10-10) (#563)
998356d4 docs: dated assurance report snapshot and phase 327 handoff pre-flight corrections (#562)
2037b5c4 chore(release): v1.70.0 -- cadence assurance report (#561)
8d47d003 chore(cadence): session handoff -- phase 326 merged (2026-10-09) (#558)
7d306570 chore(cadence): session handoff -- phase 327 merged (2026-10-10) (#560)
7264b428 feat: cadence assurance report, a corpus-wide assurance rollup (phase 327) (#559)
```
- Uncommitted (diff --stat):
```
.claude/scheduled_tasks.lock | 1 -
 1 file changed, 1 deletion(-)
```
- Loop: IDLE · phase (none) · tier (none)

## CADENCE context   ·  pre-filled from `cadence context handoff`
- Top recommendations:
  - rec-20261010-007 — Land Dependabot #474 (@changesets/cli 3.x): drop the two pnpm.overrides keys it leaves dead, before the braces exception expires 2026-11-18 (candidate/ready-for-cadence-spec)
  - rec-20260907-002 — packages/core/tsconfig.json includes only src/**/*, so no repo command ever typechecks tests/ (candidate/ready-for-cadence-spec)
  - rec-20260917-008 — docs/reference/config.md overclaims skill-audit: says it enforces skills were invoked 'during a phase', which the checkout-scoped invoked list does not support (candidate/ready-for-cadence-spec)
  - rec-20260918-005 — DRAFT.md with UTF-8 BOM (+ optionally CRLF) still throws the misleading 'missing frontmatter' error (candidate/ready-for-cadence-spec)
  - rec-20260918-006 — draft-mutate.ts's add-ac/add-task splice regexes are \n-only, so a CRLF draft now fails with a different misleading error post-phase-310 (candidate/ready-for-cadence-spec)
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
  - `package.json` — affected by rec-20261010-007 Land Dependabot #474 (@changesets/cli 3.x): drop the two pnpm.overrides keys it leaves dead, before the braces exception expires 2026-11-18
  - `pnpm-lock.yaml` — affected by rec-20261010-007 Land Dependabot #474 (@changesets/cli 3.x): drop the two pnpm.overrides keys it leaves dead, before the braces exception expires 2026-11-18
  - `scripts/check-lockfile-overrides.mjs` — affected by rec-20261010-007 Land Dependabot #474 (@changesets/cli 3.x): drop the two pnpm.overrides keys it leaves dead, before the braces exception expires 2026-11-18
  - `packages/core/tests/docs/lockfile-overrides-current-state.test.ts` — affected by rec-20261010-007 Land Dependabot #474 (@changesets/cli 3.x): drop the two pnpm.overrides keys it leaves dead, before the braces exception expires 2026-11-18
  - `docs/security/audit-exceptions.md` — affected by rec-20261010-007 Land Dependabot #474 (@changesets/cli 3.x): drop the two pnpm.overrides keys it leaves dead, before the braces exception expires 2026-11-18
  - `packages/core/tsconfig.json` — affected by rec-20260907-002 packages/core/tsconfig.json includes only src/**/*, so no repo command ever typechecks tests/
  - `docs/reference/config.md` — affected by rec-20260917-008 docs/reference/config.md overclaims skill-audit: says it enforces skills were invoked 'during a phase', which the checkout-scoped invoked list does not support
  - `packages/core/src/parse/draft-parser.ts` — affected by rec-20260918-005 DRAFT.md with UTF-8 BOM (+ optionally CRLF) still throws the misleading 'missing frontmatter' error
  - `packages/core/src/parse/draft-mutate.ts` — affected by rec-20260918-006 draft-mutate.ts's add-ac/add-task splice regexes are \n-only, so a CRLF draft now fails with a different misleading error post-phase-310

## What landed this session
| PR | What | Merge commit |
|---|---|---|
| #564 | `chore(cadence)`: D-BJ / D-BR / D-BS decisions (`dec-20261013-001..003`) + `docs/handoffs/HANDOFF-checkpoint-phase-2.md` | `54651321` |
| #565 | `fix(security)`: phase 328 — website advisories fixed + website lockfile audited in CI | `a34b222a` |

Both merged with the operator's explicit consent; remote branches deleted via `gh api -X DELETE`.

Phase 328 (`328-01`, standard tier, from `rec-20260802-006`), built with the phase-build skill in worktree `328-website-audit-advisories` (now removed):
- `website/package.json`: in-range refresh (astro 7.3.8, starlight 0.41.11, typedoc 0.28.20, vitest 4.1.11 resolved; **vitest specifier held at `^4.1.10`** for phase 260's repo-wide pin) + five per-major-line `pnpm.overrides` (brace-expansion, http-cache-semantics, js-yaml, postcss-selector-parser, smol-toml).
- `scripts/check-audit-exceptions.mjs` / `check-lockfile-overrides.mjs`: optional project-dir arg via shared pure `resolveProjectDir` (refuses missing / lockfile-less / out-of-repo dirs, no fallback). `security.yml` audit job: two more steps for `website`, no new install or job. Linux CI log confirmed: `check-audit-exceptions: no high/critical advisories reported` for website.
- Settle: 6/6 ACs `executed`, no `gateBypasses`, assurance `mixed`. **No AI review gate ran** — code-review/deep-verify/security-audit are not in the standard×standard cell; independent review came from per-task + whole-branch reviewer subagents (all: no Critical/Important).
- Filed from the whole-branch review: `rec-20261013-001` (scripts' CLI wiring untested — Quiet Fallback risk), `rec-20261013-002` (braces exception row's root-only justification now spans both lockfiles).
- Closed Dependabot #485 as superseded by #565 (operator-approved).
- Live Dependabot after merge: `website/pnpm-lock.yaml` 1 medium (the expected `GHSA-rj75-hqrm-r3gf`); root `pnpm-lock.yaml` **13 medium** (was 11 this morning — 2 new, untriaged).

Setup / housekeeping (no commits): pulled 32 commits (`9c302913` → `c52e19c4`); rebuilt; installed global CLIs; wrote `.env`/`.env.local`; `git config core.hooksPath .githooks`; renamed stale `state.json` (BUILD on already-shipped 314) aside and bootstrapped IDLE via `cadence onboard --skip-host-wire` (operator ran the delete).

## Carry-forward gotchas
- **Phase worktrees need `.env` + `.env.local` copied in** (gitignored, not carried) and `cadence onboard --skip-host-wire` (no `state.json`). Without the env files, approve/settle silently use mock. Check `cadence doctor` → `verification-readiness: deep-verify uses host-cli`.
- **`cadence handoff` prunes to `handoff.retain: 10` and deletes untracked docs irrecoverably.** This run pruned 7: three tracked (`SESSION-2026-09-26*.md`, restored with `git restore`) and **four untracked `SESSION-2026-09-17*.md` local leftovers (phase 309, phase 310, v1.67.2, plain) — permanently deleted, never committed on any ref.** Their phases' outcomes are in git/ROADMAP. Before the next `cadence handoff`, commit or move any untracked handoff you want kept. Third time this pruning has bitten (see the 2026-10-10 handoff) — likely worth a recommendation.
- **Editing a DRAFT after approve trips settle's `draft-read` gate** (mtime > `draftReadAt`). The honest path is re-approve (`cadence draft approve <phase> <num>` works from BUILD and keeps task progress), not `--allow-stale-draft`. Do all As-built edits first, then re-approve once.
- **Every AC needs an asserting `it()`** (coverage gate, assertion mode) — process ACs like "the site builds" need a precondition test; the build itself stays CI evidence.
- **`pnpm update` rewrites `package.json` specifiers.** Run the WHOLE `packages/core/tests/docs` directory after any manifest change; doc tests pin repo state (phase 260 caught it here).
- **Worktree-isolated session guard** refuses commands with runtime-computed names/paths (variables, loops, `cd $X`). Use plain absolute paths, or a script file in the scratchpad taking args.
- **VS Code `!cmd` does not execute** here; operator-run commands go to a separate non-admin terminal, prefixed `Set-Location C:\Users\Thomas\Documents\Projects\cadence;`.
- **`core.hooksPath` drifts to an absolute path** (seen after worktree creation). Functional; doctor warns. Reset with `git config core.hooksPath .githooks` if it matters.
- **`cadence doctor` `worktree-phases` false positive**: flags every committed phase number as "claimed" by sibling checkouts. Not filed yet.
- **`cadence intelligence audit` reports 366 orphan links** (decisions/evidence → archived recs); doctor's archive-aware `orphaned-evidence` check passes. Likely the audit not reading the archive. Not filed yet.
- Local-only in the primary (do not stage): `.agents/`, `.cadence/state.json.stale-314-2026-10-13` (safe to delete), `docs/handoffs/HANDOFF-demo-progressive-disclosure.md`, `docs/handoffs/cadence-audit-20260724-handoff.md`, `docs/tutorial-rebuild-brief.md`, deleted `.claude/scheduled_tasks.lock`.
- Stale sibling worktree `.claude/worktrees/315-skill-invocation-phase-scoping` at `9c302913` (pre-PC-transfer, 34 commits behind `a34b222a`). Its own `SESSION-2026-09-18.md` is resumable but almost certainly stale; operator to decide keep/remove.
- `origin/feat/kernel-assurance-v2` keeps fast-forwarding to `main` (seen again at `54651321`, `a34b222a`); something else tracks it.

## Open decisions
- **Order of the next three units** (operator): root moderates `rec-20261008-002` vs `rec-20261010-007` (#474, deadline 2026-11-18) vs checkpoint Phase 2. The first two collide on root `package.json` `pnpm.overrides`, `pnpm-lock.yaml` and `lockfile-overrides-current-state.test.ts`; whichever lands second rebases and re-runs the override check + docs tests.
- **Checkpoint Phase 2 handoff doc is partly stale** (written 2026-09-26 at v1.68.0): it says the hook-JSON-block work runs in parallel (it shipped in phase 317/v1.69.0). Its own rule — "if measurements differ, yours are correct" — governs; no edit made.
- **`postcss-selector-parser` moderate `GHSA-rj75-hqrm-r3gf`** in `website/` needs a cross-major move (via a starlight/expressive-code bump); left by design. Not filed as a rec.
- Whether to file recs for: handoff pruning deleting untracked docs; doctor `worktree-phases` false positive; `intelligence audit` archive blindness.

## Next action
**Action:** with the operator, choose the next unit. Default recommendation: `rec-20261010-007` (Dependabot #474) first because of its hard 2026-11-18 deadline, then `rec-20261008-002` (re-measure the 13 root moderates first — 2 are new), then checkpoint Phase 2 (phase number from `cadence progress`, tier `complex`, fresh worktree, `.env` files copied in).

**Verify before acting:**
- `git log origin/main --oneline -1` shows `a34b222a` (#565) or this handoff's PR on top; if it moved further, read `git log --oneline a34b222a..origin/main` first.
- `node packages/core/bin/cadence.cjs status` → `loop: IDLE`, `last settled: 328-fix-website-…`.
- `gh api "repos/thomas-powers-jr/cadence/dependabot/alerts?state=open&per_page=100" --jq 'group_by(.dependency.manifest_path)|map({(.[0].dependency.manifest_path):length})|add'` → expect root ~13, website 1.

## Conventions reaffirmed / decisions made
- `dec-20261013-001` D-BJ: checkpoint threshold is a **percentage** with absolute-token fallback; state records both units (operator narrowed the Phase 2 doc's "config names its unit").
- `dec-20261013-002` D-BR: `packages/checkpoint` depends on `cadence-core` for `atomicWriteText`.
- `dec-20261013-003` D-BS: checkpoint state file at `.cadence/checkpoint/`.
- Fix-not-except for advisories with a patched release; override keys per major line only (never a key spanning majors).
- The one exceptions table at the repo root covers both lockfiles.

## Quick resume commands
```powershell
Set-Location C:\Users\Thomas\Documents\Projects\cadence
git fetch origin --prune; git switch main; git pull --ff-only
git config core.hooksPath .githooks
pnpm install; pnpm build
node packages/core/bin/cadence.cjs resume
node packages/core/bin/cadence.cjs progress
node packages/core/bin/cadence.cjs doctor        # expect verification-readiness: host-cli
node packages/core/bin/cadence.cjs recommendation show rec-20261010-007
gh pr view 474
```
