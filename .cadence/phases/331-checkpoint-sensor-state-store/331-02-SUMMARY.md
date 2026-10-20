# SETTLE Summary — 331-02

**Completed:** 2026-10-20T18:28:56.129Z
**Content hash (sha256):** 17dabccfd30692756c8d5159c6bd353d92a124df2ff8e660d922cdc60fb5599f

## Acceptance Criteria

- AC-1: PASS (ai-verified)
- AC-2: PASS (ai-verified)
- AC-3: PASS (ai-verified)
- AC-4: PASS (ai-verified)
- AC-5: PASS (ai-verified)
- AC-6: PASS (ai-verified)
- AC-7: PASS (ai-verified)

## Tasks

- T1: DONE — Red step: 4 tests in tests/sensor.test.ts (331-02/AC-1 constant + default-deadline notice, replacing the 250/300 ms debounce test; 331-02/AC-3 two-chunk signal-file handshake with a 10 s bounded wait in the test body; 331-02/AC-2 ppid side-file through the built bin, exit 3 forwarded) + fixtures inner-ppid.cjs, inner-two-chunks.cjs. Main-thread re-run: 4 failed | 45 passed (49), each for its AC's stated reason (250!=1000; notice names 250 ms; first chunk not seen before signal; inner ppid != bin pid). Independent review APPROVE WITH MINOR (reviewer's scratch copy with minimal T2-T4 went 49/49 twice); minors applied in main thread (joined-text first-chunk check, softened recording comment, dropped unused timestamps), re-run unchanged. Boundary base: phaseGuard.integrationRef set to local ref slice-base/331-02 (75df07d5, 331-02's start) by operator decision 2026-10-20, so the boundary gate scopes to this slice instead of inheriting 331-01's unmerged commits. Candidate finding: packages/checkpoint tsconfig/lint cover src only, so tests/ and fixtures are never typechecked or linted.
- T2: DONE — RECORD_DEADLINE_MS 250 -> 1000 with a rewritten doc comment: an operator-chosen wait ceiling (331-02), not a measured tail; render-on-exit, 300 ms trigger debounce (a quiet period, not a budget) and cancel-on-retrigger cited to code.claude.com/docs/en/statusline; worst measured +84.6 ms (windows-latest under load, probe run 39450266774); uncaptured slower-runner tail stated; bounds the wait, not process lifetime. Independent review APPROVE WITH MINOR (verified the cited docs live); its comment-wording minors applied. Main-thread: build 0, checkpoint 247 passed / 1 failed (T4's AC-3, expected red), eslint 0; both 331-02/AC-1 tests pass. Stale 250 ms / 300 ms-budget lines remain in REPORT-checkpoint-phase-2.md :342/:344/:346/:377, all in 331-01's sections: T6 adds a 331-02 as-built note instead of rewriting them (D-BZ).
- T3: DONE — bin/checkpoint.cjs now dynamic-imports dist/cli.js (pathToFileURL) in-process after the unchanged Node >=22 guard, instead of spawning a second Node; cli.ts unchanged (argv.slice(2) still yields the subcommand args). Load/top-level failure writes one stderr line with the stack and exits 1. Independent review APPROVE WITH MINOR: exit codes equivalent on every cli.ts path, stdin/isTTY same fd, path-to-URL handles spaces/#/%/non-ASCII/drive letters/UNC, signal-killed process now reports real signal status instead of the old shim's 0 (benign improvement), win32 kill of the bin still kills the inner; minor (catch message + stack) applied. Main-thread: 331-02/AC-2 passes; checkpoint 247 passed / 1 failed (T4's AC-3); local AC-5 per-invocation wall p50 115 ms (was ~150 ms before the hop cut in the local probe). REPORT lines describing the two-process shape (:326/:334/:342/:347) are 331-01's; T6 adds an as-built note.
- T4: DONE — runInner writes each inner stdout chunk to opts.stdout as it arrives (settled-guarded) instead of buffering until close; start failure (127) still writes nothing; exit code still forwarded after 'close'. Per T4's stop clause the comment states backpressure is NOT applied (opts.stdout exposes only write), so a slow reader can still queue output in the stream buffer: the gain is no wrapper-held copy, not bounded memory; render time unchanged (render-on-exit). Also corrected the stderr guard comment (catches synchronous throws only; a pipe EPIPE arrives as a stream 'error' event). Independent review APPROVE WITH MINOR: byte order/no loss confirmed, 331-01/AC-1 bash + powershell.exe tests ran on win32 equal (62 bytes); F1 (unhandled EPIPE on a closed statusline pipe, reproduced, made earlier by streaming) became AC-6/T7 by operator decision; F5 real-pipe streaming test folded into T7. Main-thread after minors: build 0, checkpoint 248 passed / 1 skipped (POSIX-only), eslint 0.
- T5: DONE — AC-5 test logs per-invocation wall p50/p90 (and now asserts the log line carries them) and carries the 331-02/AC-4 token. Shrink rule agreed before measuring (shrink if 15 x p90 > 20 s): on PR #571 run 39461022835 macos-latest (after the hop cut) p50 999 / p90 1446 ms, 15 x 1446 = 21.7 s > 20 s, so INVOCATIONS_PER_WRITER 15 -> 8 (8 x 1446 = 11.6 s), cited in the test comment; the 2 x 15 test had passed there in 17.2 s, so this was the rule, not an observed timeout. Ambient CHECKPOINT_RECORD_DEADLINE_MS stripped from its spawn (deadline-subject). Verify met: AC-5 green on all three legs on two consecutive CI runs of PR #571 with vitest.shared.ts unchanged: run 39468308041 (d0e14424; ubuntu 6.4 s, macOS 6.1 s, windows 12.5 s; payloads 930/2028, 1446/765, 777/486; 0 notices; that run's macOS leg red only from core's tests/cli/milestone.test.ts 20 s timeout, untouched by this slice) and run 39471208128 (dfbdae47; all legs and ci-success green; windows p50 1522 / p90 1887 ms, 0 notices). Independent review APPROVE WITH MINOR; comment numbers corrected and verified against CI logs.
- T6: DONE — Appended '## Slice 331-02 (as built, 2026-10-20)' to docs/checkpoint/REPORT-checkpoint-phase-2.md (append-only vs slice-base: 0 removed lines): statusline docs facts (render on exit, 300 ms trigger debounce not a budget, cancel on retrigger); per-leg probe table from runs 39448948337/39450266774/39452805430 with 'worst' defined and sourced; run 39461022835's 1000 ms misses and the 675/825 ms rename-retry budget; operator decisions (1500 ms ceiling, abandon + notice, CHECKPOINT_RECORD_DEADLINE_MS); what changed; corrections to 331-01's record (as an additive list, D-BZ); Phase 3 notes (unbounded lifetime, inner left running on cancel); candidate findings (multi-slice boundary base, untypechecked/unlinted checkpoint tests, the preload wiring-test technique). Doc test packages/checkpoint/tests/report-331-02.test.ts (5 x 331-02/AC-5) passes; core checkpoint-phase-2-report and roadmap-per-phase-entries tests pass. Whole-branch review NOT READY on one stale bullet -> fixed in 818f48d5 -> fresh re-check READY. PR #571 all three legs + ci-success green on run 39471208128 (dfbdae47).
- T7: DONE — cli.ts statusline guards process.stdout/stderr with persistent 'error' listeners and hands runStatusline/exitAfterFlush wrappers that become silent no-ops after an error (flush callback invoked at once), so a reader closing the pipe mid-run no longer crashes the wrapper; inner exit code forwarded, reading still recorded; no uncaughtException handler; sensor.ts untouched. inner-two-chunks.cjs gained an optional exit code. Tests: built-wrapper 331-02/AC-6 (destroy read end after 'first', signal, assert exit 5, no unhandled/EPIPE/stack on stderr, reading recorded) RED before (unhandled EPIPE, exit 1) and GREEN after; built-wrapper real-pipe 331-02/AC-3 (coverage gap close, passes before and after). Main-thread re-verify at commit 10927855: build 0, checkpoint 250 passed / 1 skipped, eslint 0, encoding intact. Independent review APPROVE WITH MINOR: reverted-cli AC-6 failed 3/3, fixed passes 10/10; crash/hang/exit-code matrix probed on the built bin; comment minors (all errors silenced, socketpair/ECONNRESET on POSIX) applied. POSIX red not run locally: Linux/macOS CI is the check.
- T8: DONE — RECORD_DEADLINE_MS 1000 -> 1500 (operator decision after run 39461022835) with an honest doc comment (leaves room for walk p99 366 ms plus atomicWriteText's rename retries: at most 675 ms before a succeeding rename, 825 ms if all 10 fail; ceiling, not measured tail; bounds the wait, not lifetime). Pure exported recordDeadlineFromEnv (strict /^[1-9][0-9]*$/, <= 2147483647) wired into cli.ts's statusline command only. Recording/bytes tests inject a 10 s deadline (in-process recordDeadlineMs, built-wrapper/shell CHECKPOINT_RECORD_DEADLINE_MS in the child env only); deadline tests keep the default and strip any ambient override. RED first (8 targeted tests). Independent review CHANGES REQUIRED -> fixed in main thread: F1 deterministic CLI wiring test via a --require preload that hangs fs/promises.stat (proved green with wiring, red with the cli.ts spread removed, file restored byte-identical); F2 two remaining in-process byte tests injected; F4 comment wording; F6 ambient override stripped from the process-shape and AC-5 spawns; F7 generous deadline 60 s -> 10 s (spawnSync is uninterruptible). Main-thread: checkpoint 262 passed / 1 skipped, eslint (src + touched tests) 0, strict typecheck of touched tests 0.

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
- evidence tally: ai-verified=7, executed=0, assertion=0, mention=0, unverified=0
- verifier: host-cli (1 gate(s)) (configured)

## Decisions

_(none)_

## Deferred

_(none)_

## Skill audit

- phase-build: invoked

## State at settle

- loop position before settle: BUILD
- revision: 407
- session subagent spawns: 65
