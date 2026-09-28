# SETTLE Summary — 319-01

**Completed:** 2026-09-28T00:05:55.234Z
**Content hash (sha256):** 7e1c5ebc51bab87dfdb97bea52e147eeadcc90dc67742b5d620319d497aebdde

## Acceptance Criteria

- AC-1: PASS (ai-verified)
- AC-2: PASS (ai-verified)
- AC-3: PASS (ai-verified)
- AC-4: PASS (ai-verified)
- AC-5: PASS (ai-verified)
- AC-6: PASS (ai-verified)

## Tasks

- T1: DONE — REVISITED after operator re-approval of the AC-1 as-built amendment (2026-09-27): T2's independent review proved the PATHEXT-first first-match order regressed the default claude bin vs pre-319 libuv spawn (PATHEXT=.CMD -> not-found; earlier non-canonical claude.cmd shadowing claude.exe -> spawn-error). Resolver now native-first two-pass (.com/.exe across PATH, then .bat/.cmd by PATH x PATHEXT). Independent re-review PASS with real-machine spawnSync parity for claude/node/git/gh; orchestrator re-verified 54/54 resolver tests + real-machine probe of both regression scenarios; ENOENT wording updated for the two-pass order.
- T2: DONE — makeRealSpawn factory wires the win32 resolver into the real spawn seam (piped stdio, no shell key; family/guard/error text keyed on configured bin). Independent Opus review round 1 proved a default-claude regression in T1's search order (fixed via operator-approved AC-1 amendment + T1 revisit) and a vacuous cwd test; round 2 PASS. Orchestrator re-verified: host-cli-client + win32-command + host-cli-verifier 106/106, test diff deletions confined to T2-added code, win32 real-process test ran (not skipped).
- T3: DONE — docs/providers.md Windows resolution paragraphs (native-first two-pass, cwd never searched, npm cmd-shim via Node without shell, non-npm launchers refused, native-exe override), stale stdin text + argv prompt examples corrected; doc test providers-host-cli-windows.test.ts (319-01/AC-6); patch changeset. Orchestrator re-read the doc diff and corrected three inaccuracies (old spawn was not shell-mediated; CVE sentence; changeset 'silently'/'the way a shell would'); all 41 doc test files pass. Independent review of T3 is folded into the whole-branch review, which re-reads docs last.

## Gate provenance

- draft-read: ran
- structural-verifier: ran
- boundary-scan: ran
- task-verify-required: ran
- build-test-must-pass: skipped — bypassed via --allow-failing-build
- test-coverage: ran
- interactive-verdict: skipped — not requested (no --deep / --interactive, not in gate set)
- deep-verify: ran
- code-review: skipped — not in the active tier × profile gate set
- security-audit: skipped — not in the active tier × profile gate set

## Assurance

- overall: mixed
- evidence tally: ai-verified=6, executed=0, assertion=0, mention=0, unverified=0

## Decisions

_(none)_

## Deferred

_(none)_

## Skill audit

- phase-build: invoked

## State at settle

- loop position before settle: BUILD
- revision: 75
- session subagent spawns: 14
