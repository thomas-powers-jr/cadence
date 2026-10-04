# 320-01 — independent review record (fresh-context Opus subagents)

Each review ran in a fresh-context Opus subagent that did not implement the task. Every
completion claim was re-verified in the main thread (diff read + tests re-run) before
`cadence done`. Settle's AI gates (`deep-verify`, `code-review`) are not in this phase's
standard tier × standard profile gate set, so these reviews are the independent review of record.

| Scope | Verdict | Findings acted on |
|---|---|---|
| T1 pure check | APPROVE | Minor: lastIndex-leak test could not catch a leak → added long-then-short-text test; slice heading `### Phase 23.1` pinned by a test; test title reworded to say the patterns are literal copies of doctor's. |
| T2 settle notice | APPROVE | Minor: refused-settle test now pins the refusal to the evidence-floor gate; decimal-slug limitation recorded as a T2 As-built note. |
| T4 backfill + per-phase test | CHANGES NEEDED → fixed | Important: 320's As built pre-claimed "as designed" → rewritten to name the as-built notes; 317's entry omitted the `--allow-phase-collision` bypass recorded in its merge commit body → added. Minor: 316 build-time amendment and 314's #523 detour added; As built line + MILESTONES 292 marker now asserted. |
| T3 checklists/docs | CHANGES NEEDED → fixed | Important: requiring entries for every phase directory would turn the suite red from `draft new` onward (phase-build step 5) → test now requires settled phases only (a directory holding `-SUMMARY.json`). Minor: staging-list assertion added; release-cut wording on doctor's blind spot corrected; slice wording in docs/changeset. |
| Whole branch | NOT READY → READY TO MERGE | Important: header comment, two AC-5 test titles and the MILESTONES 320 bullet still said "every phase directory"; an io.test.ts title still said the repo had no assumptions → all corrected and re-verified by the same reviewer. |

Main-thread verification before settle: `pnpm turbo run lint typecheck test build --force`
exit 0 (28/28 tasks; core 472 files passed, 1 skipped). One earlier forced run failed
`tests/intelligence/store/io.test.ts` because this phase committed the repo's first
`assumptions.json`; fixed per the T4 As-built note.
