# SETTLE Summary — 345-01

**Completed:** 2026-11-04T02:22:23.233Z
**Content hash (sha256):** 54815968635d286ba1c495202e8742031f47ab7a84bf47b25e318c1cb97cb7f5

## Acceptance Criteria


## Tasks

- T1: DONE — types: pre-compact in AbstractEventZ, optional compactTrigger on HookContextZ/ExtractedPayload; dispatcher stub keeps core building. Red first (2 failed; the non-string case also fails pre-change since z.object strips unknown keys), then types 9/9; repo typecheck+lint 18/18, host pkgs tests 10/10, core tests/hooks 91/91 re-run in main thread. Independent review: no Critical/Important; M2 fixed (event-list test pins all nine against AbstractEventZ.options); M1 (stub after prologue) is T4's job.
- T2: DONE — PreCompact -> pre-compact in host-toolkit routing with compactTrigger forwarded (step 8); PreCompact in both CLAUDE_CODE_EXPECTED_HOOKS copies; capabilities.hooks lists pre-compact (not blocking); shim clamps every pre-compact failure path to exit 0 via pure host-toolkit resolveHookShimExit (deviation: cli.ts runs only as a subprocess and host-claude-code branch coverage had zero headroom). Red first (toolkit 6, claude-code 13, doctor 2 failed). Re-run in main thread with --force: toolkit/claude-code/codex test+typecheck+lint 15/15; core tests/doctor 280/280. Independent review: no Critical/Important; Minor 1 fixed (signal-killed core on pre-compact now reported in one stderr line), Minors 2-3 (stdin-read failure precedes routing; docs mention of the helper) go to T6 docs.
- T3: DONE — precompact.ts: pure planPrecompactRecord/payloadFieldNames/selectPrunablePrecompact + best-effort writePrecompactRecord (refuses without .cadence/, wx + -N suffix, silent prune of newest-5, never throws) and findNewestPrecompactRecord. Red first (module missing), then 16/16. Independent review: no Critical; I1 (suffix order: '-' < '.') fixed with a stem+numeric-suffix comparator, I2 (snapshot lacked SESSION/ledger files) fixed by seeding both; minors fixed: CRLF read, U+2028/2029 escaped, stdout captured in prune-silence test, non-EEXIST write failure tested. 19/19, typecheck+lint clean, re-run in main thread. Hook-level AC-4 and banner/resume AC-7 tests belong to T4/T5.
- T4: DONE — hook.ts copies a string compactTrigger into ctx and its outer catch exits 0 (one flattened line) for pre-compact; dispatcher routes pre-compact to handlePreCompact before the readState/loadConfig prologue (other events via dispatchWithState, unchanged); handlePreCompact writes one stderr line and returns ok:true; renderHookResult('pre-compact') is always exit 0, empty stdout. Red first (11 failed), then green. Re-run in main thread: full core 514 files / 5298 tests, typecheck+lint clean. Independent review: no Critical/Important, probed every AC-4 path in scratch repos (exit 0, 0 stdout bytes, 1 stderr line); M2 (multi-line catch message) and M3 (mislabelled test) fixed, re-run tests/hooks+tests/cli 1251/1251; M1 (non-JSON stdin lists a synthetic 'raw' field) and the subdirectory-cwd note go to T6 docs.
- T5: DONE — Banner + resume pointer: pure isPrecompactRecordNewer (strict >, no SESSION doc -> newer, undated doc -> end of its file-name date) and renderPrecompactPointerLine in run-resume.ts; ResumeResultZ gains optional precompactRecord on both branches; resume prints the line before the narrative or after 'no handoff found'; --list/--pick skip the lookup; session-start banner appends one line. Before-fixtures captured from pre-change dist; byte-identity tests green on old and new code. Red first (core 9 failed, types 2 failed). Re-run in main thread: core 516 files / 5314 tests, types 392, repo typecheck+lint 18/18. Independent review: no Critical/Important; minors noted, not changed: M1 pointer compares against the local freshest doc even when --path serves a sibling's, M2 locate's string ranking vs end-of-day rule for same-day undated docs, M3 pointer after the declined autoList menu (beyond AC-7, consistent with JSON), M4 unparseable generated_at falls back to the file-name date, M5 redundant try/catch.
- T6: DONE — Docs: commands.md hook-events marker list (all 9 AbstractEventZ options, outside the commands block) + pre-compact section + limitations + resume pointer; claude-code.md event table (adds stale SubagentStart row + PreCompact), counts derived from CLAUDE_CODE_EXPECTED_HOOKS, capabilities table corrected; host-adapters.md event list, ExtractedPayload fields, host-toolkit exports incl. resolveHookShimExit; concepts.md .cadence/local/ row only. hook-events.test.ts (5 tests, 345-01/AC-8) red first 5/5, then green; core tests/docs 64 files / 412 tests. Changeset minor (core, types, host-claude-code, host-toolkit; fixed group bumps the rest) with both upgrade notes. ROADMAP/MILESTONES entries in final form; orchestrator filed rec-20261102-001 (Codex follow-up) and named it in ROADMAP. Full pipeline re-run in main thread with --force: 28/28. Per-task review folded into the whole-branch review (docs re-read last).

## Findings

### Code review

#### packages/core/src/handoff/precompact.ts

- MEDIUM: The hook runs up to seven serial 5s Git commands. On a slow repo it can delay compaction for ~35s; add a total Git time budget. (line 245) [id: 3a8cd604faa322e0440f5260beb0e255aef5e804553394728328912a3c669f1c; target: artifact; anchor: kind=ac, ref=AC-3, tier=executable; disposition: open]
- MEDIUM: After a non-EEXIST write error this unconditionally unlinks the target. A concurrent writer can create that name before unlink, losing its valid record. (line 340) [id: 9879c389f35c8967746ab52da04d7052bc8df97fcaf764d838c8adf8762d38ca; target: artifact; anchor: kind=ac, ref=AC-3, tier=executable; disposition: open]

#### packages/host-claude-code/src/cli.ts

- MEDIUM: A nonzero pre-compact core exit emits inherited child stderr, then the shim adds a clamp line. This violates the advertised one-line stderr contract. (line 150) [id: 1166cbafc5f39aa9ee11d32b927f28937f4c07125cdfd76ca6eccef20cabed2f; target: artifact; anchor: kind=ac, ref=AC-1, tier=executable; disposition: open]

## Gate provenance

- draft-read: ran
- structural-verifier: ran
- boundary-scan: skipped — boundaryEnforcement is not "block"
- task-verify-required: ran
- build-test-must-pass: ran
- test-coverage: ran
- interactive-verdict: skipped — not requested (no --deep / --interactive, not in gate set)
- deep-verify: ran
- code-review: ran
- security-audit: skipped — not in the active tier × profile gate set

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
