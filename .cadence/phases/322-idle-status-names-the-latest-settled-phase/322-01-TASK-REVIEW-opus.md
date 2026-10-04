# 322-01 whole-branch review (independent, Opus)

Reviewer: fresh-context Opus subagent (no shared transcript), dispatched 2026-10-04 after
the four wording minors from the previous session's whole-branch review were applied.
Scope: `git diff HEAD` + untracked files in `.claude/worktrees/322-idle-last-settled`
(base `afdb0916`) against `322-01-DRAFT.md` and `CLAUDE.md`.

Reviewer ran (read-only): the 8 phase test files (98 tests pass); `tests/docs`, `tests/mcp`,
`tests/render`, `tests/hooks` (69 files, 438 pass / 7 skipped); host-claude-code and
host-codex `shim-integration.test.ts` (9 + 10 pass); core `tsc --noEmit` (exit 0); eslint on
new/changed files (exit 0).

## CRITICAL

None.

## IMPORTANT

None.

## MINOR

1. **"Committed" wording contradicts the AC-5 As-built correction** in
   `.cadence/MILESTONES.md:1193`, `.cadence/ROADMAP.md:3298`, `src/hooks/handlers.ts:109`,
   `src/status.ts:84`, `src/phases/latest-settled.ts:5`, and test comments in
   `tests/hooks/session-start-idle.test.ts:8`, `tests/hooks/dispatcher.test.ts:22`,
   `tests/status.test.ts:531`. The finder reads the working tree, so an uncommitted settled
   SUMMARY counts and a committed-but-deleted one does not. Fix: say "working-tree".
2. **"Not yet relabelled" lists omit `cadence inspect`** (`render-inspection.ts:40`) in
   `docs/reference/commands.md:1028-1031`, `.changeset/idle-status-last-settled.md:7`,
   `.cadence/ROADMAP.md:3303-3305`, though the DRAFT's own correction names it. Fix: add it;
   optionally note the MCP `cadence_handoff`/`cadence_resume` tools follow their CLI
   counterparts.
3. **`selectLatestSettledPhase` has no production caller** (`src/phases/latest-settled.ts:51`);
   the finder sorts via the shared comparator, and no finder test has two settled dirs with
   the same phase number. Fix (optional): add a finder tie-break test.
4. **Unbounded scan when no SUMMARY carries `stateAtSettle`** (`src/phases/latest-settled.ts:104-118`):
   correct but O(all phase dirs) I/O on every status / SessionStart / `next` in pre-1.48
   consumer histories. Fix: none required now.

Checked clean: selection ordering, refused-SUMMARY exclusion, snapshot exclusion,
best-effort error handling, stop-early (pinned by a test that would fail under lexicographic
order); non-IDLE output paths unchanged (BUILD golden `session-start.txt` passes); `--json`
keeps `activePhase` and adds `lastSettledPhase`; STATE.md renderer pure; SessionStart lookup
in try/catch; no src consumer parses STATE.md or banner text; changeset name double-quoted,
`patch`, no version stamps; ROADMAP/MILESTONES 322 entries present; all changed files inside
T1–T3 file lists; `docs/quickstart.md:465` is the only IDLE transcript and is updated.

## Per-AC table

| AC | Implemented? | Test that asserts it | Verdict |
|---|---|---|---|
| AC-1 | Yes (`src/phases/latest-settled.ts`) | `tests/phases/latest-settled.test.ts` (selector, `isSettledSummary`, finder cases incl. stop-early spy, unreadable dir skipped) | PASS (finder tie-break untested → MINOR 3) |
| AC-2 | Yes (`status.ts`) | `tests/status.test.ts` IDLE block; `tests/cli/status.test.ts` text + `--json` + BUILD unchanged | PASS |
| AC-3 | Yes (`render/state-md.ts`, pure) | `tests/render/state-md.test.ts` IDLE + non-IDLE unchanged | PASS |
| AC-4 | Yes (`hooks/handlers.ts`, `hooks/dispatcher.ts`) | `tests/hooks/session-start-idle.test.ts`; `tests/hooks/dispatcher.test.ts`; BUILD golden unchanged | PASS |
| AC-5 | Yes (`docs/reference/commands.md`, `docs/quickstart.md`) | `tests/docs/status-idle-display.test.ts` (5 anchored asserting `it()`s) | PASS (list incomplete → MINOR 2) |

VERDICT: READY TO MERGE

## Disposition (main session, 2026-10-04)

- MINOR 1: fixed — all eight sites now say "working-tree" / "on disk".
- MINOR 2: fixed — `cadence inspect` added to the commands.md, changeset and ROADMAP lists;
  commands.md also notes the MCP `cadence_handoff`/`cadence_resume` tools follow their CLI
  counterparts.
- MINOR 3: fixed — added finder test "breaks a phase-number tie between settled dirs by the
  greatest name" (`7-alpha` vs `7-zeta` → `7-zeta`).
- MINOR 4: not changed, per the reviewer's "none required"; already in scope of a future
  look if pre-1.48 consumer histories report slowness.

After the fixes: phase test set + `tests/hooks` + `tests/docs` re-run (61 files, 430 pass /
7 skipped), core `tsc --noEmit` exit 0, eslint on touched files exit 0. Full forced pipeline
(`pnpm turbo run lint typecheck test build --force`, 28/28, 0 cached) ran green on the
pre-minor-fix tree; it is re-run before commit.
