---
"@thomas-powers-jr/cadence-core": patch
---

Fix: `cadence demo` and `cadence tutorial` no longer print `(no test files found)` on Node 24 for a `node --test` run that found and ran the test.

Both walkthroughs echo a one-line count summary of the sandbox's real `node --test` run, but only recognised TAP count lines (`# tests 1`). Node 24 prints its spec reporter even when stdout is piped (`ℹ tests 1`), so the summary fell through to a fallback that wrongly claimed no test files existed. Enforcement was never affected: settle's `build-test-must-pass` gate runs the same command and judges its exit code. Both walkthroughs now share one parser that reads both formats (including color-coded output when `FORCE_COLOR` is set), and when no count line is recognised it says the summary could not be read instead of guessing.
