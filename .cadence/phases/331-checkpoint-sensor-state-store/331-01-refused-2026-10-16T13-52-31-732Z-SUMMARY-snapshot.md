# SETTLE Summary — 331-01

**Completed:** 2026-10-16T13:52:31.732Z
**Content hash (sha256):** e926680f1da99191ad4fa1f6b09e10ca25670cff6b3f3e85f6c1734a1e18ad49

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

- MEDIUM: Atomic rename at a symlink path replaces settings.json with a regular file instead of editing its target, breaking dotfile-managed settings and future source updates. (line 447) [id: fdcd1d00274c90d09c899318cf8d89b5e8fef957fa53543391d06678693cfbd1; target: artifact; anchor: kind=ac, ref=AC-7, tier=executable; disposition: open]

#### packages/checkpoint/src/sensor.ts

- HIGH: The wrapper waits for recordReading before exiting. A slow or retrying filesystem write delays or stalls statusline output, violating its non-blocking contract. (line 317) [id: da02b461d9374a184f5f64352c9294b27536bdc25aeb11ca003062b37f9c9716; target: artifact; anchor: kind=ac, ref=AC-2, tier=executable; disposition: open]

#### packages/checkpoint/src/state.ts

- MEDIUM: Any string is accepted as since although the store contract requires ISO-8601. A corrupt timestamp then looks valid and can break future time-based transitions. (line 190) [id: 65d1c860ed484f2774c1c763b9b1d2d19aec4c8d0d235bda860500b24cbb953a; target: artifact; anchor: kind=ac, ref=AC-3, tier=executable; disposition: open]

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
