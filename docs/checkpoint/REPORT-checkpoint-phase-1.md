# REPORT — checkpoint Phase 1 (handoff validator, corpus first)

## 1. `--force` and gate bypasses

None. Phase 1 has no interaction with any CADENCE gate — `packages/checkpoint` is a standalone package outside the `.cadence/` loop, built and tested with plain `pnpm`/`vitest`/`tsc`.

## 2. Acceptance criteria

| AC | Status | Evidence command | Raw output excerpt | Commit |
|----|--------|-------------------|---------------------|--------|
| AC 7 — fixture corpus + failing tests land before implementation | PASS | `pnpm --filter @thomas-powers-jr/cadence-checkpoint test` (run before `src/validate.ts` existed) | `Error: Cannot find module '../src/validate.js' imported from .../tests/validate.test.ts` — module-resolution error, not an assertion failure | `3c9e9a30fc766776c2231b6ffcffba443be7aef9` |
| AC 8 — every fixture maps to exactly one named diagnostic; unintended failures count as failures | PASS | `pnpm --filter @thomas-powers-jr/cadence-checkpoint test` | `Tests 22 passed (22)` — assertions use `toEqual([expect.objectContaining({ code: '<exact code>' })])`, not loose containment, so a fixture producing an extra/wrong diagnostic would fail the test, not silently pass | `14646260d6deafcf6295d7fda12c93498a682b82` |
| AC 9 — valid fixture passes, every failure fixture fails with its intended diagnostic | PASS | `pnpm --filter @thomas-powers-jr/cadence-checkpoint test` | `Test Files 1 passed (1)` / `Tests 22 passed (22)` (post-implementation, before CLI); `24 passed (24)` after Task 1.4 added the CLI tests | `14646260d6deafcf6295d7fda12c93498a682b82` |
| AC 10 — AC id parsing accepts numeric-only ids, rejects any id with a letter | PASS | `pnpm --filter @thomas-powers-jr/cadence-checkpoint test -- -t "AC"` | `Tests 4 passed \| 20 skipped (24)` — covers letter-prefixed rejection, duplicate rejection, zero-AC rejection, and bold/asterisk-bullet acceptance | `14646260d6deafcf6295d7fda12c93498a682b82` |
| AC 11 — CLI exits 0 on pass, 2 on fail, diagnostics on stderr | PASS | `pnpm --filter @thomas-powers-jr/cadence-checkpoint test -- cli` | Both CLI tests passed; live stderr from the child process printed `AC_LIST_EMPTY [Acceptance criteria touched]: No AC-N entries found under "Acceptance criteria touched".` against `ac-empty.md` (exit 2), and `valid.md` exits 0 | `d48a2a4c54de2bacfa757e47ecef9814ba42edc6` |
| AC 12 — diagnostics are paste-ready (section, line where applicable, rule stated in plain English) | PASS | Same CLI run as AC 11 | `AC_LIST_EMPTY [Acceptance criteria touched]: No AC-N entries found under "Acceptance criteria touched".` — section name in brackets, rule violated in plain English. No line number here because the fixture's AC list has zero lines to point at (expected, not a bug — there's nothing to cite a line for) | `d48a2a4c54de2bacfa757e47ecef9814ba42edc6` |
| AC 13 — no runtime dependency added beyond what's already used, or justified | PASS | `cat packages/checkpoint/package.json` | Zero runtime `dependencies`. `devDependencies`: `vitest ^4.1.10` and `@thomas-powers-jr/cadence-testkit workspace:*`, both identical to `packages/core/package.json`'s own devDependencies (confirmed via `cat packages/core/package.json \| jq '.devDependencies'`). `typescript` is deliberately omitted — `packages/core/package.json` prints `null` for it too, since it's root-hoisted only | `3dd80e961cd11a573eeb5e2c26f1788d309a97bc` |

## 3. Measurements

All Phase 1 measurements are package-internal build/test facts, not the handoff's numbered M-items (those are Phase 0's). Key ones:

- Real, currently-installed versions used instead of guessed ones: `typescript ^6.0.3`, `vitest ^4.1.10` (root `package.json`, confirmed via `jq`). The plan's first draft had guessed `^5.6.0` / `^2.1.0` before the independent review caught the drift.
- Resume-core-over-budget fixture filler: generated programmatically, measured at exactly 10,191 characters (`node -e "..."`, printed `length: 10191`) — matches the plan's own corrected note, not hand-typed or estimated.
- Full-suite coverage (both test files, untargeted `pnpm test`): 84.73% statements / 74.19% branches / 96.15% functions / 85.34% lines — clears `vitest.shared.ts`'s global thresholds (44/50/39/44%). Filtering to one file (e.g. `-- cli`) fails those same thresholds because the denominator no longer includes `validate.ts`'s covered lines — a property of filtered runs against global thresholds, not a defect.

## 4. Deviations

- **Schema now validates the real `/cadence-handoff` header text**, not an invented one — the single largest deviation from the plan's first draft, made in direct response to the independent Opus review's top finding (a document passing an invented schema would not be readable by `cadence resume`). Required sections, in order: `TL;DR for the next session`, `State on handoff`, `CADENCE context`, `Acceptance criteria touched`, `What landed this session`, `Carry-forward gotchas`, `Open decisions`, `Next action`. The middle six are the real, live template's exact headers (captured in Task 0.1's M7 evidence); `Acceptance criteria touched` and `Open decisions` are inserted, not present in the live template today. **Flag for operator review**: this insertion is an inference from the fixture corpus's requirements, not a literal answer to any of the four decisions the operator already made.
- **Resume core defined as `TL;DR for the next session` + `Next action`**, concatenated. Also flagged for operator review — still a design call beyond the four literal decisions, though narrower now that the surrounding schema is real.
- **`MEASURED_CONTEXT_MISSING_COMMAND` narrowed to bare percentages only** (`\b\d+%`), not any 2+-digit number — the first draft's broader check would have flagged ordinary years and phase numbers in every real handoff in this repo.
- **CLI ships as a `.cjs` launcher that spawns a compiled ESM `dist/cli.js`** (`packages/checkpoint/bin/checkpoint.cjs`), copying `packages/core/bin/cadence.cjs`'s exact pattern, instead of the first draft's `require()`-based loader, which would have crashed on an ESM/CJS mismatch.
- **One real typecheck fix during implementation** (not a plan defect): `exactOptionalPropertyTypes` rejected the `SECTION_OUT_OF_ORDER` diagnostic's construction because `observedOrder[i]` is `string | undefined` under `noUncheckedIndexedAccess`. Fixed with an explicit `undefined` narrow and a conditional spread for the optional `line` field — the same "omit the key" pattern CLAUDE.md documents elsewhere. Full ledger entry: `.superpowers/sdd/2026-09-22-checkpoint-phase-0-and-1/progress.md`, Task 1.3.
- **Pre-flight ruling** (ledgered before Task 0.1): the plan's Task 0.6 verification step cited commit `3bc20d26`, captured on the main checkout during planning; that commit is not reachable from this worktree's branch history (almost certainly squashed away on merge — the exact failure mode the plan's own Global Constraints section warns about). Ruled to use this worktree's actual pre-Task-0.3 HEAD (`3803113fe7720d84b82e47d4b610ed94ae9ffb51`) instead. Affects Phase 0 evidence, not Phase 1 code.

## 5. Answers needed

None outstanding for Phase 1. Decisions 1, 3, 4, 5 are answered (see Task 1.0's header in the plan); Decisions 6 (threshold unit) and 7 (scout ID) remain open per Phase 0's report but block nothing here. The two flagged inferences in §4 above (the `Acceptance criteria touched` / `Open decisions` insertion, and the `TL;DR + Next action` resume-core definition) are not blocking — Phase 1 shipped against them — but are worth an explicit operator sanity-check before this schema is treated as final.

## 6. Proposed for operator filing

None from Phase 1 itself. Phase 0's report (`REPORT-checkpoint-phase-0.md`) carries any product-gap proposals from the platform-fact measurements.
