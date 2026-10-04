# CADENCE Assumptions

> Generated from `.cadence/intelligence/assumptions.json`.

## Open

_(none)_

## Validated

### as-20261004-001 — No code on the draft/build/settle path reads or writes ROADMAP.md or MILESTONES.md; the only writer is cadence init's one-time stub. Rejected if any settle/build/draft source file references either file.

- recommendation: rec-20261004-001
- recorded: 2026-10-04T14:53:18.110Z

### as-20261004-002 — settle resets the loop to IDLE without clearing state.activePhase, so the settled phase stays 'active' in that checkout. Rejected if any code path on or after settle sets activePhase to null, or a test asserts it is cleared post-settle.

- recommendation: rec-20261004-002
- recorded: 2026-10-04T14:53:43.928Z

### as-20261004-003 — The primary checkout's state.json is never updated by settles that run in a worktree (state.json is per-checkout, gitignored), so its activePhase stays at the last phase settled locally. Rejected if main's state.json references any phase newer than 311 while SUMMARY.json files for 312-319 exist on main.

- recommendation: rec-20261004-002
- recorded: 2026-10-04T14:54:04.821Z

## Rejected

_(none)_
