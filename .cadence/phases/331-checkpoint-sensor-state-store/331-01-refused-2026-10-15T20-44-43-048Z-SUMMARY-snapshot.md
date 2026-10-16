# SETTLE Summary — 331-01

**Completed:** 2026-10-15T20:44:43.048Z
**Content hash (sha256):** 0408f64ddeef575fe0bf93ba5dca1b4deba12e0d60ff02563be2e44df5b4b60f

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

- HIGH: PowerShell treats U+2018–U+201B as quote delimiters, but only ASCII ' is rejected. A crafted checkout path can terminate the quote and inject commands into statusLine.command. (line 312) [id: 7fc99bbb24b636ffd620141a4cae3bf952d28759e696293d168d0831c5173a7e; target: artifact; anchor: kind=ac, ref=AC-7, tier=executable; disposition: open]
- HIGH: This replaces the target with a temp file using the default mode. A 0600 settings file can become 0644, exposing secrets in its env block; preserve the target mode. (line 434) [id: 87dddc5393b74822b4fc03fc17f1cf89b856c0329fde1f94d3377d8edce27d42; target: artifact; anchor: kind=ac, ref=AC-7, tier=executable; disposition: open]
- MEDIUM: Atomic rename replaces a symlinked settings.json with a regular file. Dotfile-managed settings lose their link, so future edits no longer reach the real config. (line 434) [id: 415c13b071a2c1add9a483109cbaf00bc6e5889e9f504cd882e462de0c3baa88; target: artifact; anchor: kind=ac, ref=AC-7, tier=executable; disposition: open]

#### packages/checkpoint/src/state.ts

- MEDIUM: Any string is accepted for since despite the state-file contract requiring an ISO timestamp. Corrupt state is accepted and can break time-based transitions; validate it. (line 190) [id: 5bdc8f29735a66038e2d13653aed1dc6774d69f7468392185ec6a999e7791612; target: artifact; anchor: kind=ac, ref=AC-3, tier=executable; disposition: open]

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
