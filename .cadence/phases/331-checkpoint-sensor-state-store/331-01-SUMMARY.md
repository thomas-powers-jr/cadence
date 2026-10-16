# SETTLE Summary — 331-01

**Completed:** 2026-10-16T16:44:59.903Z
**Content hash (sha256):** 06954d31f3092100171cde864177d3b373f64e43a3e2cf3041ae84e58e45c669

## Acceptance Criteria

- AC-1: PASS (ai-verified)
- AC-2: PASS (ai-verified)
- AC-3: PASS (ai-verified)
- AC-4: PASS (ai-verified)
- AC-5: PASS (ai-verified)
- AC-6: PASS (ai-verified)
- AC-7: PASS (ai-verified)
- AC-8: PASS (ai-verified)
- AC-9: PASS (ai-verified)
- AC-10: PASS (ai-verified)

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

- HIGH: On Windows, rename replaces settings.json with a temp file inheriting the parent DACL, dropping explicit ACLs. Secrets in its env block may become readable by directory principals. (line 447) [id: e63627c9fa2b609fc120e49484cfce8f02f34d5ef9ab403a8dc7b97eca06629a; target: artifact; anchor: kind=ac, ref=AC-7, tier=executable; disposition: open]
- MEDIUM: Only some shell builtins are rejected. Commands such as `alias foo` or `cd dir` can be installed, then fail or change semantics under the no-shell spawn. (line 172) [id: 6514b2e33f9fa20a7b6fa5ac3e7fafb29c01beff9f67cd9247236c530970f05d; target: artifact; anchor: kind=ac, ref=AC-7, tier=executable; disposition: open]
- MEDIUM: Atomic rename replaces a symlinked settings file itself, leaving its target unchanged and breaking dotfile-manager links. Detect/reject symlinks or update their target. (line 447) [id: e86f6246c1426b35d4f8db54d1c2f40b68b67641473ef7afe1c391e40adba1d5; target: artifact; anchor: kind=ac, ref=AC-7, tier=executable; disposition: open]

#### packages/checkpoint/src/sensor.ts

- HIGH: All inner stdout is buffered until exit. A verbose or non-terminating statusline grows memory without bound and never renders; stream output with backpressure instead. (line 322) [id: 682039fb60dca6ecdb52291347ad65d8f3046d8354c30ca8af4836ad54ea91e2; target: artifact; anchor: kind=ac, ref=AC-2, tier=executable; disposition: open]
- MEDIUM: A recording continues after the deadline; an older delayed invocation can finish after a newer one and overwrite reading.json with stale data. (line 371) [id: 25c63ea6bb621fddf033918fcd223f1668bbfcc8117c821108f6a304070592da; target: artifact; anchor: kind=ac, ref=AC-2, tier=executable; disposition: open]

#### packages/checkpoint/src/state.ts

- MEDIUM: Any string is accepted for `since`, so a corrupt non-ISO timestamp is treated as valid despite the state-file contract and can break timestamp-based consumers. (line 190) [id: 8cc4440f4473407ffaafa85e1380653194b03dcf4b51173470decf67867caa15; target: artifact; anchor: kind=ac, ref=AC-3, tier=executable; disposition: open]

## Gate provenance

- draft-read: ran
- structural-verifier: ran
- boundary-scan: ran
- task-verify-required: ran
- build-test-must-pass: ran
- test-coverage: ran
- interactive-verdict: skipped — not requested (no --deep / --interactive, not in gate set)
- deep-verify: ran
- code-review: ran
- security-audit: skipped — not in the active tier × profile gate set

## Assurance

- overall: strong
- evidence tally: ai-verified=10, executed=0, assertion=0, mention=0, unverified=0
- verifier: host-cli (1 gate(s)) (configured)

## Decisions

_(none)_

## Deferred

_(none)_

## Skill audit

- phase-build: invoked

## State at settle

- loop position before settle: BUILD
- revision: 283
- session subagent spawns: 47
