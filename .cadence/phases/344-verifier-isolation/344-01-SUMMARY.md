# SETTLE Summary — 344-01

**Completed:** 2026-11-22T15:08:54.204Z
**Content hash (sha256):** 39a81c6e342e4814bfa89cde430b25e383e6d2367078963267af238528130ba9

## Acceptance Criteria

- AC-1: PASS (ai-verified)
- AC-2: PASS (ai-verified)
- AC-3: PASS (ai-verified)
- AC-4: PASS (ai-verified)
- AC-5: PASS (ai-verified)
- AC-6: PASS (ai-verified)
- AC-7: PASS (ai-verified)

## Tasks

- T1: DONE — Codex is spawned with --ignore-user-config and claude with --setting-sources project --strict-mcp-config, from one exported helper; isolation 'off' restores the pre-phase argv; a nonzero exit whose stderr names a passed -- flag gets a hint; no retry. 28 new tests; nine argv pins updated in the existing client test, nothing else. Independent review PASS; full pipeline 28/28 re-verified on the main thread. Known: the hint can fire if a wrapper echoes its command line (bounded: it says 'may'); the model variants (-m / --model after the flags) were not measured by the probe.
- T2: DONE — verification.hostCliIsolation ('on'|'off', optional, absent = on), threaded through VerifierSelectOptions to all seven host-cli verifiers and read at all seven call sites; a test-only spawnImpl seam on the selectors. 90 new tests: each selector x codex/claude x off/absent/on by exact argv, each call site through its real service, AC-4's spawn-once, warn text, refused error and no-hint cases. During the implementer's red run the claude-family tests reached the real claude binary (the seam did not exist yet); every spawning test now runs under an empty-PATH guard. Independent review PASS (no path to a real CLI found); full pipeline 28/28 re-verified on the main thread.
- T3: DONE — GateProvenanceZ.hostCliIsolation (optional string array, no default, no schemaVersion bump). The three settle host-cli verifiers tag their result non-enumerably after hostCliJSON returns; the three gates copy it onto their identity flag; the registry lifts it onto the gate entry. Absent for isolation off, mock, fallback, no-spawn returns and the bypass paths, each tested. summary verify matches with the field present (mutation-checked). 46 new tests under the empty-PATH guard; no real CLI ran. Independent review PASS; full pipeline 28/28 re-verified on the main thread.
- T4: DONE — host-cli-isolation doctor check (pure, takes env, no spawn, no fixId), docs (providers.md Isolation section, config.md, commands.md, concepts.md), minor changeset for core and types, doc-content test, ROADMAP and MILESTONES. Whole-branch review: 0 Critical, 1 Important (changeset and config.md stated unmeasured claims as fact), fixed with its Minors. Literal AC pass predicted an AC-7 failure on the same sentences plus AC-4/AC-5 wording; fixed, and an end-to-end runDoctor test added for AC-6. No test can reach a real CLI (confirmed by both reviewers). Full pipeline 28/28 re-verified on the main thread.

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
- evidence tally: ai-verified=7, executed=0, assertion=0, mention=0, unverified=0
- verifier: host-cli (1 gate(s)) (configured)

## Decisions

_(none)_

## Deferred

_(none)_

## Skill audit

- phase-build: NOT INVOKED

## State at settle

- loop position before settle: BUILD
- revision: 100
- session subagent spawns: 0
