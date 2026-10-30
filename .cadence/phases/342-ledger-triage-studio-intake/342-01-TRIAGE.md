# 342-01 — Triage record

The SUMMARY schema has no free-text notes field, so this file carries what AC-3 asks the SUMMARY notes to hold, plus the full decision index.

## Readiness histogram (candidate recs, active set)

| readiness | before (main @ 655b20ef) | after |
|---|---|---|
| needs-decision | 56 (+3 soft-archived) | 5 |
| ready-for-cadence-spec | 21 | 36 |
| needs-evidence | 21 | 25 |
| raw-idea | 21 | 21 |
| blocked | 1 | 1 |
| total candidates | 120 | 88 |

All 5 remaining needs-decision recs are new Studio asks filed by this phase (rec-20261030-002, -003, -006, -007, -009). None of the 59 that were undecided at phase start remains undecided.

Dispositions over the 59: 11 promote, 2 shipped, 22 reject, 24 defer.

## Decisions

| decision | rec | disposition | reason |
|---|---|---|---|
| dec-20261030-001 | rec-20260730-001 | defer | fix is real but nothing runs verify phase across a mode switch |
| dec-20261030-002 | rec-20260806-006 | promote | silent --allow-failing-build bypass, used in phases 296-298 |
| dec-20261030-003 | rec-20260807-005 | reject | premise false: fresh init already defaults to phase-qualified |
| dec-20261030-004 | rec-20260813-005 | shipped | delivered by phase 309 |
| dec-20261030-005 | rec-20260820-001 | defer | one occurrence in 70 days; decide with Studio ask rec-20261030-009 |
| dec-20261030-006 | rec-20260917-006 | promote | phase 315 was designed but never built; the gap is live |
| dec-20261030-007 | rec-20260726-005 | promote | --force over coverage gaps records nothing |
| dec-20261030-008 | rec-20260728-002 | reject | duplicate of rec-20260907-002 |
| dec-20261030-009 | rec-20260729-003 | defer | gap count is informational only |
| dec-20261030-010 | rec-20260729-005 | defer | working as specified; informational count only |
| dec-20261030-011 | rec-20260731-007 | shipped | phase 242 adopted merge-by-identity |
| dec-20261030-012 | rec-20260804-003 | reject | the deferred status it asks for already exists |
| dec-20261030-013 | rec-20260804-004 | reject | local worktree housekeeping, not ledger work |
| dec-20261030-014 | rec-20260806-001 | reject | duplicate of rec-20260927-001 |
| dec-20261030-015 | rec-20260806-002 | reject | historical runbook, deleted before 256-02 settled |
| dec-20261030-016 | rec-20260806-003 | reject | duplicate of rec-20260806-002 |
| dec-20261030-017 | rec-20260806-005 | reject | same deleted runbook, reworded |
| dec-20261030-018 | rec-20260806-007 | promote | persistent code-review attempt budget is undocumented |
| dec-20261030-019 | rec-20260806-008 | promote | dec-20260801-003 trigger met many times over |
| dec-20261030-020 | rec-20260808-001 | defer | pending-changesets already covers the common case |
| dec-20261030-021 | rec-20260809-005 | defer | test-seam-only, fails safe, no recurrence since 265 |
| dec-20261030-022 | rec-20260811-003 | promote | conduction-drift-streak warns chronically |
| dec-20261030-023 | rec-20260812-001 | defer | rare: retention protects the current lastHandoff |
| dec-20261030-024 | rec-20260813-001 | reject | duplicate of rec-20260813-004 |
| dec-20261030-025 | rec-20260815-003 | defer | codex host-cli now supplies real provenance |
| dec-20261030-026 | rec-20260820-002 | reject | wording slip in an append-only record, already annotated |
| dec-20261030-027 | rec-20260821-001 | promote | commands.md misstates bare-scheme --explain |
| dec-20261030-028 | rec-20260822-002 | promote | MCP drops stderr notices on success |
| dec-20261030-029 | rec-20260822-007 | defer | one known case; a manual reject sufficed |
| dec-20261030-030 | rec-20260822-008 | defer | nothing reads per-round deep-verify verdicts yet |
| dec-20261030-031 | rec-20260907-006 | defer | the routinely-bypassed premise did not hold |
| dec-20261030-032 | rec-20260916-003 | reject | helper shipped; enforcement owned by rec-20261008-007 |
| dec-20261030-033 | rec-20260917-003 | defer | no pack needs an optional skill |
| dec-20261030-034 | rec-20260917-005 | promote | --allow-stale-draft and --allow-open-tasks record nothing |
| dec-20261030-035 | rec-20260918-001 | defer | three assumptions ever; workaround documented |
| dec-20261030-036 | rec-20260918-008 | defer | latent: no required name collides today |
| dec-20261030-037 | rec-20260926-002 | defer | needs schema design; no failure seen |
| dec-20261030-038 | rec-20260927-002 | reject | the minimal option (document the override) is done |
| dec-20261030-039 | rec-20261010-004 | defer | no consumer for a generated assurance page |
| dec-20261030-040 | rec-20261010-005 | reject | unreachable without a 309-digit phase number |
| dec-20261030-041 | rec-20261010-006 | defer | gated on measurement by D-BV and dec-20260813-003 |
| dec-20261030-042 | rec-20261016-003 | defer | a fixed historical set since phase 332 |
| dec-20261030-043 | rec-20261016-005 | defer | design question; one known instance |
| dec-20261030-044 | rec-20261021-001 | defer | optimization; the CI timeouts it caused are fixed |
| dec-20261030-045 | rec-20261023-001 | reject | premise false: normalization can only tighten settle |
| dec-20261030-046 | rec-20261023-002 | defer | overcount of at most one; needs a second Stop hook |
| dec-20261030-047 | rec-20260731-005 | reject | keeping a rejected finding suppressed is defensible |
| dec-20261030-048 | rec-20260731-006 | reject | routing volume is tiny in practice |
| dec-20261030-049 | rec-20260801-007 | reject | one item moot, two cosmetic after 90 days |
| dec-20261030-050 | rec-20260803-001 | reject | placeholder refs are no longer minted |
| dec-20261030-051 | rec-20260804-002 | defer | real but trivial and unhit; fold into the audit rec |
| dec-20261030-052 | rec-20260809-004 | promote | READMEs still claim init --demo is zero-prompt |
| dec-20261030-053 | rec-20260809-006 | reject | decision list already answers provenance |
| dec-20261030-054 | rec-20260811-004 | reject | one instance; milestone defer is the escape hatch |
| dec-20261030-055 | rec-20260821-002 | promote | wildcard boundary advisory re-fires across tasks |
| dec-20261030-056 | rec-20261015-001 | defer | needs a security-posture decision; nothing surfaced since 330 |
| dec-20261030-057 | rec-20260801-002 | reject | duplicate of shipped rec-20260801-003 |
| dec-20261030-058 | rec-20260801-008 | reject | subsumed by promoted rec-20260806-008 |
| dec-20261030-059 | rec-20261013-002 | defer | latent until braces enters website/ or the row is renewed |

## Studio intake (scout-20261030-studio-intake)

| rec | priority | readiness | title |
|---|---|---|---|
| rec-20261030-001 | high | ready-for-cadence-spec | --json output for the mutating loop commands (draft new/set-*/add-*/check/approve, build task, settle run, spec approve) |
| rec-20261030-002 | high | needs-decision | Documented exit-code contract separating gate-refused from transport/spawn failure from usage error |
| rec-20261030-003 | medium | needs-decision | Export the services layer as a library entry point with injected IO |
| rec-20261030-004 | high | ready-for-cadence-spec | verification.fallback: "refuse" -- a hard refusal instead of the silent-continue mock fallback |
| rec-20261030-005 | medium | ready-for-cadence-spec | doctor: report the deep-verify seam's session axis (claude self-invocation), not only code-review/security-audit |
| rec-20261030-006 | medium | needs-decision | Per-seam host-cli binary in config.json, not only the CADENCE_HOST_CLI_BIN env var |
| rec-20261030-007 | high | needs-decision | First-class 'AC deferred/parked' settle verdict, recorded without a --force bypass and queryable later |
| rec-20261030-008 | medium | ready-for-cadence-spec | Non-interactive init/onboard flags for verification.testCommand and testGlobs |
| rec-20261030-009 | high | needs-decision | Amend an approved DRAFT under an explicit recorded reason, or a documented split-into-a-new-phase recipe |
| rec-20261030-010 | high | needs-evidence | host-cli verifiers inherit the operator's full user config (Codex ~/.codex MCPs, plugins, hooks, global AGENTS.md; Claude settings likewise) |
| rec-20261030-011 | medium | needs-evidence | draft check misses a task count over maxTasks, a missing Acceptance Criteria section, and a done: naming a missing AC |
| rec-20261030-012 | medium | needs-evidence | draft add-task needs --stop (and --name), and draft new's placeholder AC-1/T1 cannot be replaced by the structured writers |
| rec-20261030-013 | medium | needs-evidence | settle --auto's blocked-task refusal is not recorded as a gate in SUMMARY gates[] |

Roadmap §3 asks 1-9 are rec-20261030-001..009, and Studio's rec-20261028-008 is rec-20261030-010. The last three came from Studio's `docs/engine/probes.md` upstream notes, which the phase's independent review found had never reached §3.

Dedup outcome: no item was fully covered. Ask 1 is the unbuilt remainder of rec-20260701-004, which was converted to phase 134 and shipped progress --json only. Ask 5 was filed as a residual only. Asks 7 and 9 name the adjacent recs rec-20261016-005 and rec-20260820-001.

## As built

- **AC-2's population was 59, not 56.** Three candidate/needs-decision recs (rec-20260801-002, rec-20260801-008, rec-20261013-002) had been soft-archived while still undecided, so the active listing the DRAFT counted from never showed them. The independent review found them. Each was unarchived through the CLI, given a 342 triage decision, and re-archived where rejected. The test pins all 59.
- **One false fact, corrected by evidence.** dec-20261030-002 says the --allow-failing-build bypass was used in phases 296-298. Phase 298 did not use it. ev-20261030-011 on rec-20260806-006 records the correct set: 39, 226, 256, 296, 297 and 319. The decision is append-only and stays as written.
- **Approximate figures in rationales.** dec-20261030-050's "20 legacy refs" is approximate (the review counts 19-22). dec-20261030-040's line cite is ~101-104, not 98-102.
- **Promoted phase 315 work.** dec-20260918-002..005 designed phase 315 (per-phase skill-invocation scoping), but it was never built: no 315-* phase directory exists. rec-20260917-006 is therefore promoted, not shipped.
- **AC-4 test strength.** The sweep test proves 0 failed and no MISMATCH line. It cannot detect a historical SUMMARY that was edited and rehashed. That clause holds because the phase diff contains no SUMMARY.json, which the review checked by hand.
- **T3's verify command.** As written in the DRAFT, it exits 1 on the package's global coverage thresholds, because a filtered run measures 0%. The tests themselves pass. Run it with `--coverage.enabled=false`.
- **Red-first evidence.** The ledger test was written before T2's writes but was not run red locally. CI did run it red: on the WIP push c250cff (pre-triage ledger), 342-01/AC-2 and 342-01/AC-3 failed on all three OSes, with 5214 other tests passing.
