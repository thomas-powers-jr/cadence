# SETTLE Summary — 331-01

**Completed:** 2026-10-16T14:28:22.604Z
**Content hash (sha256):** 31054f989c4f0a9c653bfaae255c7fa40a1a3e4337ecb143a68a7a11f3b4bd81

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

- MEDIUM: Atomic rename replaces a symlinked settings path. Dotfile-managed settings lose their symlink while the target stays unchanged; refuse symlinks or write the resolved target. (line 447) [id: cfdcfecaddb95d9dfb4a7247e1aa933f793695385afaf28826520c238b665b09; target: artifact; anchor: kind=ac, ref=AC-7, tier=executable; disposition: open]

#### packages/checkpoint/src/sensor.ts

- HIGH: `recordReading()` runs its synchronous stat/realpath project walk before `runInner()` starts. A stalled UNC/network path blocks the statusline before the 250 ms deadline exists. (line 338) [id: 66e26ddf06d7dc136ca21ef51161d1834a8a9ec81e58098a4c3345fe24800bac; target: artifact; anchor: kind=ac, ref=AC-2, tier=executable; disposition: open]

#### packages/checkpoint/src/state.ts

- MEDIUM: Any string is accepted as `since`, including invalid timestamps. This treats corrupt state as valid despite callers needing `since` for ordering; validate an ISO timestamp before returning ok. (line 190) [id: 9a673fe94ee407d0ec57455057abcaeea699b5b46fa9d5599757d90ebbc6db4b; target: artifact; anchor: kind=ac, ref=AC-3, tier=executable; disposition: open]

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
