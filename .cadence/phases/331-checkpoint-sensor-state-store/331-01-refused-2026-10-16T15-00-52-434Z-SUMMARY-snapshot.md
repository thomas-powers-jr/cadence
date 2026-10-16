# SETTLE Summary — 331-01

**Completed:** 2026-10-16T15:00:52.434Z
**Content hash (sha256):** 6c1f5b0ce80f5a37aba89844f5322878ad6509cecaaf348f8514f48d0cb9a2e3

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

- HIGH: On Windows, rename replaces the target DACL with the temp file’s inherited ACL; `mode` does not preserve it. A restrictive settings file can expose env secrets to the parent ACL. (line 447) [id: 8610f1fad3bbe2469be09872321195ae4694ff89657e0d0bfc349250c81280d1; target: artifact; anchor: kind=ac, ref=AC-7, tier=executable; disposition: open]
- MEDIUM: `statSync` follows a settings.json symlink, but atomic rename replaces the link itself. Dotfile-managed settings lose their link despite the command promising to change only statusLine. (line 447) [id: 09e2c16ec38d120750776bde58e042865ebfc24df73d9e93be99dfea8b5813ef; target: artifact; anchor: kind=ac, ref=AC-7, tier=executable; disposition: open]

#### packages/checkpoint/src/state.ts

- MEDIUM: Any string is accepted for `since`, so `{state:"armed",since:"not-a-date"}` becomes valid state. Future mtime/timeout consumers can misbehave instead of treating the store as corrupt. (line 190) [id: 0ad47b4d802611749aaeee6ce9ef12999f5ff90846ec1fe03a0b00e9d49787d1; target: artifact; anchor: kind=ac, ref=AC-3, tier=executable; disposition: open]

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
