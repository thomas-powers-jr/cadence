# SETTLE Summary — 345-01

**Completed:** 2026-11-04T03:04:42.224Z
**Content hash (sha256):** 0f5f28c889f6a4cdff7a6b895ab39a3b45e0b8144d0b9ebd465fd05646fbceb6

## Acceptance Criteria

- AC-1: PASS (ai-verified)
- AC-2: PASS (ai-verified)
- AC-3: PASS (ai-verified)
- AC-4: PASS (ai-verified)
- AC-5: PASS (ai-verified)
- AC-6: PASS (ai-verified)
- AC-7: PASS (ai-verified)
- AC-8: PASS (ai-verified)

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

- MEDIUM: Git collection can run seven serial 5s calls before writing. A slow repo can hold PreCompact for ~35s and miss its hook timeout, leaving no record. (line 245) [id: 6fb7b629db43bc0702cf89325ed856638cb26bc6dbea0e670475f24b424471cf; target: artifact; anchor: kind=ac, ref=AC-3, tier=executable; disposition: open]

#### packages/core/src/handoff/run-resume.ts

- MEDIUM: `--path` may select a sibling handoff, but this still attaches a record from the current root. It can claim that local record is newer than the selected newer sibling SESSION doc. (line 332) [id: f1b9f40179b1ca029470a55bb05fd5de405930e1e5117c2cfba8e5a0f65f6372; target: artifact; anchor: kind=ac, ref=AC-7, tier=executable; disposition: open]

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

## Gate bypasses

- WARN skill-audit via --allow-skill-audit-miss: required skill(s) not invoked: phase-build

## Assurance

- overall: strong
- bypassed: 1 gate(s) (severity: warn)
- evidence tally: ai-verified=8, executed=0, assertion=0, mention=0, unverified=0
- verifier: host-cli (1 gate(s)) (configured)

## Decisions

_(none)_

## Deferred

_(none)_

## Skill audit

- phase-build: NOT INVOKED

## State at settle

- loop position before settle: BUILD
- revision: 63
- session subagent spawns: 0
