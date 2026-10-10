---
cadence_handoff: 2
generated_at: 2026-09-24T20:02:09.126Z
label: checkpoint-probe-instructions
loop_position: IDLE
active_phase: 316-checkpoint-schema-reconcile
active_draft: 
tier: 
git_branch: main
git_dirty: false
git_head: 2ef7870a
git_ahead: 0
git_behind: 0
context_packet: .cadence/intelligence/context/handoff.json
---

# Session Handoff — 2026-09-24 (checkpoint-probe-instructions)

## TL;DR for the next session
- Checkpoint arc Phase 1.5 shipped: PR #531 merged and squashed onto `main` at `2ef7870a`. Loop is genuinely IDLE (the `active_phase: 316-checkpoint-schema-reconcile` line in this doc's frontmatter is a stale leftover field from this worktree's own state — the phase is settled and closed, don't act on it).
- **The single next action is entirely on the operator, not an AI session:** run the throwaway probe kit at `C:\Users\softw\checkpoint-probe\` (outside this repo, nothing to commit). Full instructions are under "Next action" below.
- The probe answers two things at once: whether `Stop`/`PreCompact` hooks actually block on exit 2 (checkpoint arc Phase 0.4a — a precondition for the not-yet-authorized Phase 3), and what the real statusline payload contains (checkpoint arc Open Decision D-BJ — blocks Phase 2's sensor design).
- Blocker for any session picking this up: neither Phase 0.4a nor Phase 2 can be drafted/built until the probe has actually run and reported back.
- No gate bypasses were used landing phase 316. Real independent review ran via Codex (not mock) — see `docs/checkpoint/REPORT-checkpoint-phase-1.5.md` for the full trail.

## State on handoff   ·  pre-filled — verify, don't retype
- Branch `main` (clean), 0 ahead / 0 behind origin
- HEAD `2ef7870a`
- Recent commits:
```
2ef7870a feat: checkpoint handoff schema reconcile, version-gated (phase 316) (#531)
f553841d chore(release): v1.67.3 -- skill-audit gateBypasses, core-skills phase-build requirement, systematic-debugging skill, worktree hook-shim cwd fix (#529)
eea11ae5 feat: checkpoint handoff validator, phases 0-1 (working name) (#528)
ff338a05 chore(cadence): file phase-315 scoping decisions and the identity-half split (rec-20260917-006) (#526)
3803113f docs(cadence): session handoff for 2026-09-22 (PR #521 merged, sync check) (#527)
225d9012 docs(cadence): session handoff for PC transfer (2026-09-18) (#521)
9c302913 chore(cadence): file post-PC-transfer ledger reconciliation findings (#522)
c1512959 docs(cadence): session handoff for 2026-09-18 (PC transfer, phase 314 shipped) (#525)
```
- Loop: IDLE · phase 316-checkpoint-schema-reconcile · tier (none)

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
- **Phase 316 (checkpoint handoff schema reconcile), the whole arc's Phase 1.5, built end to end via `phase-build` and merged as PR #531.** `cadence handoff` now emits `cadence_handoff: 2` + a required `Open decisions` section; the checkpoint validator version-gates its schema off that field so both old and new handoffs validate. Two drift tests pin the generator/validator/core/types apart from silently diverging again. Full detail: `docs/checkpoint/REPORT-checkpoint-phase-1.5.md`.
- Independent per-task review caught and fixed two real bugs before settle (a missing CLI-level check, a regex letting a malformed AC bullet through); real Codex-backed `deep-verify`+`code-review` at settle found one more (a BOM edge case), already documented as a Phase 3 precondition.
- **Built the throwaway probe kit** at `C:\Users\softw\checkpoint-probe\` for the arc's still-open Phase 0.4a and D-BJ work: `block-probe.cjs` (a sentinel-gated `Stop`/`PreCompact` hook, self-releases after 3 blocks, 10s timeout), `statusline-capture.cjs` (logs raw statusline payloads), and `RUNBOOK.md` (step-by-step). Self-tested with fake stdin — inert/blocking/JSON-mode/auto-release all confirmed — but **not yet run against a real interactive session**, by design (D-BK: the operator runs it, not an AI session).

## Carry-forward gotchas
- **`CADENCE_HOST_CLI_BIN=codex` alone does not work on this Windows machine.** Node's `spawn()` (no `shell: true`) can't launch npm's `codex.cmd`/POSIX shim — ENOENT/EINVAL. Workaround used this session: point `CADENCE_HOST_CLI_BIN` at the native `.exe` directly, e.g. `C:\Users\softw\AppData\Roaming\npm\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe` (path may differ after an npm update — re-find it with `find <npm-root>/node_modules/@openai -iname 'codex.exe'`). The real fix (patching `host-cli-client.ts`'s spawn call for Windows) is out of scope for any single phase and should be its own — file it if not already on the ledger.
- **`git diff`-based review gates cannot see untracked new files** (`settle-diff.ts`'s own doc comment: "Never-added untracked files are not part of any git diff basis"). Before running `settle run` on a phase with new files, `git add` everything the phase touched first (explicit paths, never `-A`) so `deep-verify`/`code-review` actually read them — this session's first settle attempt refused two ACs for exactly this reason before the fix.
- **Settle auto-files code-review findings into the shared Praxis ledger** (`.cadence/intelligence/{RECOMMENDATIONS.md,recommendations.json,evidence.json}`) as an unconditional side effect — no flag suppresses it. This collides with any arc rule that reserves ledger writes to the operator. This session stripped the auto-filed rec (`git restore --staged --worktree` on those three files) before committing, per the operator's call.
- **Claude Code's own worktree-isolation sandbox blocks compound Bash commands that `cd` into the primary checkout and run git there** — even read-only. `gh pr merge --delete-branch` switched this worktree's own checkout onto `main` after merging, so this worktree is synced, but the primary checkout at `C:\Users\softw\projects\cadence` still needs its own `git fetch`/`pull` — a worktree-scoped session can't do that for it.
- **In the probe kit specifically: use Git Bash, not PowerShell**, for every RUNBOOK.md command. PowerShell's `echo json > file` writes UTF-16 with a BOM, which the probe's `mode === 'json'` string check won't match, so a PowerShell run silently falls through to exit-2 mode instead of JSON-decision mode.
- Watch for a stray `console.log`-pattern false positive from CI's informational `CodeQL` check on any future PR touching handoff-doc test fixtures — it's not a required check and doesn't gate merge (confirmed via `.github/workflows/codeql.yml`'s own comments), but it will show red in `gh pr checks` and can look alarming at a glance.

## Open decisions
- **D-BJ (threshold unit for Phase 2's sensor) — still open.** Percentage, absolute tokens, or both. Blocked on the operator actually running the probe kit's statusline-capture step and looking at the real payload fields — nobody has re-captured this since the original Phase 0 pass, whose raw log (`~/.cache/checkpoint-probe/statusline.jsonl`) is gone from this machine. Decides once real data exists; the operator's call.
- **0.4a's verdict itself is open** — does `Stop`/`PreCompact` actually block on exit 2 on this Claude Code version (currently `2.1.281`)? Phase 0 recorded this NOT TESTED by deliberate choice. An honest "no, it doesn't block" is an equally valid, even valuable, outcome — it would mark Phases 3–5 not-authorizable as designed, per the arc's own standing rule.
- Everything else the arc's authorizing handoff (`docs/handoffs/HANDOFF-checkpoint-arc-phase-2.md`) left open (D-BI, D-BK, D-BL) was decided by the operator during this session's build; see that document's §3 for the record.

## Next action

**Action:** Run the probe kit yourself, interactively, in a **separate Git Bash terminal** (not this session — a nested headless run can't drive the interactive turns this needs):

```bash
cd C:/Users/softw/checkpoint-probe
claude --version > logs-version.txt 2>&1; cat logs-version.txt   # record for the report
claude
```

Then follow `RUNBOOK.md` in that folder, in order:
1. **Statusline capture (no blocking):** just send a message (e.g. "say hi") and wait for a reply — the status bar should read `probe | ctx …`. This alone answers D-BJ once you look at `logs/statusline.jsonl`.
2. **Stop, exit-2 mode:** `touch BLOCK_STOP` in a second terminal, then send a message in the probe session. Watch whether the assistant keeps going with the block reason instead of stopping, and whether it self-releases after 3 blocks.
3. **Stop, released:** confirm a normal stop once the sentinel is gone.
4. **Stop, JSON-decision mode (optional):** `echo json > BLOCK_STOP` (Git Bash only — see gotchas above), observe, then remove it.
5. **PreCompact:** `touch BLOCK_COMPACT`, type `/compact`, confirm it's refused with the reason shown; remove the sentinel, `/compact` again, confirm it succeeds.
6. `/exit`, then tell the next AI session "probe done" plus anything you noticed on-screen — the logs (`logs/hooks.jsonl`, `logs/statusline.jsonl`) carry the raw payloads and exit codes for the report.

**Verify:** After you say "probe done," the next session reads `C:\Users\softw\checkpoint-probe\logs\hooks.jsonl` and `logs\statusline.jsonl`, writes `docs/checkpoint/REPORT-checkpoint-phase-0.4a.md` (Pass/Fail on both blocking claims, with raw payloads), answers D-BJ from the real statusline fields, and only then drafts Phase 2 (and, if 0.4a passed, asks you to authorize Phase 3 separately — it is not authorized by anything in this document).

**If it fails:** If blocking doesn't work (Stop/PreCompact don't actually refuse on exit 2), that's a real, valuable, complete result — not a failure to fix. Report it exactly as observed; the arc's own standing rule marks Phases 3–5 not-authorizable in that case, and that's the correct outcome, not a bug to chase.
