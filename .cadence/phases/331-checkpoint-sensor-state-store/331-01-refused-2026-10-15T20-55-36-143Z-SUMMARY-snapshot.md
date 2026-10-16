# SETTLE Summary — 331-01

**Completed:** 2026-10-15T20:55:36.143Z
**Content hash (sha256):** 1ffaf3284be940da76a65960f2b4362ca9cd9b3d60d6386056b433082930928e

## Acceptance Criteria


## Tasks

- T1: DONE — core re-exports atomicWriteText; checkpoint depends on core at runtime; release plan keeps checkpoint at 0.0.0 (type none); independent review approved
- T2: DONE — transition table (7 legal / 29 rejected), unconditional unknown predicate, machine-state store; two review rounds (win32 corrupt-store-as-idle, 29-pair store coverage, POSIX ENOTDIR parity) fixed and re-verified in main thread
- T3: DONE — statusline sensor: parse/record/pass-through, nearest-.cadence resolution with realpath-based ~/.cadence exclusion, best-effort notices; two review rounds (alias bypass, notice path) fixed; re-verified in main thread 10 files/193 tests
- T4: DONE — bash (Git Bash) + powershell.exe -NoProfile -Command byte transparency, both run on win32; measurements captured; independent review approved, 3 minor hardening fixes applied in main thread
- T5: DONE — statusline-install (token-aware splice, strict UTF-8, win32 PATH x PATHEXT resolution) + AC-7 tool sweep; two review rounds; re-verified in main thread 12 files/233 tests
- T6: DONE — REPORT-checkpoint-phase-2.md + checkpoint-phase-2-report.test.ts (6/6) + handoff As-built note; settle-time items marked pending-settle; core tests/docs 53 files green

## Findings

### Code review

#### packages/checkpoint/src/install.ts

- HIGH: Allows `command foo`; `command` is usually a shell builtin, but the wrapper spawns argv without a shell, so installation can turn a working statusline into ENOENT. (line 169) [id: a6afb0f55faf4b3374177674e4ee23cb18add7ecb6222564245e6d9377405532; target: artifact; anchor: kind=ac, ref=AC-7, tier=executable; disposition: open]

#### packages/checkpoint/src/state.ts

- MEDIUM: Accepts any string as `since`, despite state requiring an ISO timestamp. A valid-JSON corrupt state can pass validation and break later time-based transitions. (line 190) [id: c381074cacb57cdc889a73b2f5c82a60b827ac1d9be7dbc0668fff9429f155aa; target: artifact; anchor: kind=ac, ref=AC-3, tier=executable; disposition: open]

## Gate provenance

- draft-read: ran
- structural-verifier: ran
- boundary-scan: ran
- task-verify-required: ran
- build-test-must-pass: ran
- test-coverage: ran
- interactive-verdict: skipped — not requested (no --deep / --interactive, not in gate set)
- deep-verify: ran
- code-review: refused

## Assurance

- overall: mixed
- evidence tally: ai-verified=0, executed=0, assertion=0, mention=0, unverified=0
- verifier: host-cli (1 gate(s)) (configured)

## Decisions

_(none)_

## Deferred

_(none)_

## Skill audit

_(none)_
