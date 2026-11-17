# SETTLE Summary — 346-01

**Completed:** 2026-11-13T23:53:08.776Z
**Content hash (sha256):** 7dad90803ff64fbf1d39f001075c26f1992be2ca38829427fc17d0a133310b72

## Acceptance Criteria


## Tasks

- T1: DONE — Additive schemas: GateBypassZ.detail, build-test-bypassed anomaly type, TestRunResult.outputTail, GateFlags.buildTestBypass. Independent review FIX REQUIRED on one test (detail round-trip proved nothing because GateBypassZ strips unknown keys); fixed and mutation-checked (dropping detail from the schema fails it). outputTail doc clarified (absent, never empty). Re-verified in main thread: types 400/400, full turbo pipeline 28/28.
- T2: DONE — runTestCommand now streams combined stdout+stderr through a bounded ring (40 lines / 8 KiB, ANSI stripped, CRLF handled), stdin ignored, verdict from the exit code alone. Independent review FIX REQUIRED (C1: a backgrounded grandchild holding the pipes made 'close' wait its whole life; reproduced 6 s vs execSync's 5 ms): fixed in the main thread by resolving on exit with a 500 ms unref'd drain, failing-first test (10 s -> under 3 s) and a mutation check; I1 stream error listeners; ANSI regex widened to match its doc; trailing blank lines no longer use the line budget (new test). Full turbo pipeline 28/28.
- T3: DONE — Bypass branch writes exactly one stderr notice (gate, flag that fired with --allow-failing-build winning, command, exit code, indented output tail) and returns flags.buildTestBypass; every refusal, sealed or not, appends the tail with its reason and outcome byte-identical. One phase-141 assertion (silent bypass) superseded by AC-2 and its misleading title renamed per the independent review (PASS); both-flags test made exact; refusal-vs-bypass fallback difference commented. Full turbo pipeline 28/28.
- T4: DONE — A bypassed failing suite becomes one error-severity build-test-must-pass gateBypasses entry (flag that fired, command exited N, detail = output tail); assurance capped at mixed, shown live (strong -> mixed) and by re-derivation. Main-thread fixes after the independent review (PASS): the output tail never enters the anomaly event (the webhook notifier POSTs events whole), settle attaches it as detail from the gate's facts; one shared renderGateBypassLines in parse/summary-writer.ts so the settle-written SUMMARY.md shows the tail (DRAFT amended in BUILD, dec-20261112-001); 6-space indent; a record with detail passes hash verification; '<unknown flag>' instead of a silent '--force'. Full turbo pipeline 28/28.
- T5: DONE — In assertion mode, an unsealed bare --force pass over real coverage gaps (absent, weak or skipped-only, exactly the refusal's buckets) now sets coverageBypassed; registry skip reason, anomaly message and the warn gateBypasses entry name --force; --allow-missing-coverage stays byte-identical and wins when both are set; registry's build-test skip reason reads the gate's own flag. settle-retro.test.ts's clean-run fixture relied on the old loophole and now has real AC-1 coverage (no assertion loosened; T5 declares it, decision 2026-11-12). Independent review PASS; added a skipped-only gate case and aligned the flag helper's truthiness with the gate. Full turbo pipeline 28/28 (core 5407 passed).
- T6: DONE — docs/concepts.md (two notes), DESIGN.md anomaly table (build-test-bypassed row; coverage-bypassed row covers bare --force), commands.md and settle --help for --allow-failing-build, docs/cli.md's row (declared in BUILD, dec-20261112-003), minor changeset for core and types with upgrade notes (grade cap, the committed tail may hold secrets, bare --force), doc test reading the tail bounds from the runner's constants. Independent review FIX REQUIRED: the changeset assertion would go red once the release consumes it; fixed with the phase 325/341 CHANGELOG fallback. Also: settle's own bypass line and 'when it printed any' in the concepts note; anomaly-row helper scoped to §3.3. Full turbo pipeline 28/28.

## Findings

### Code review

#### packages/core/src/verify/test-runner.ts

- HIGH: Redaction misses curl's long `--user alice:password` form. Such a testCommand is copied into the bypass notice, webhook anomaly, and SUMMARY. (line 160) [id: bb5fe99155e5ed831b71626e03c6bbaac3d0f91e26822bfa3dcde4763ee51dbb; target: artifact; anchor: kind=ac, ref=AC-1, tier=executable; disposition: open]
- HIGH: TailRing truncates raw text before redaction. A known secret crossing the ring cut leaves its retained suffix unmatched and printed on stderr. (line 271) [id: cef95e632e8f3c7528718af258d4c2e5abe956386a09f76a5bc93670b8da6aa9; target: artifact; anchor: kind=ac, ref=AC-1, tier=executable; disposition: open]

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

- phase-build: NOT INVOKED
