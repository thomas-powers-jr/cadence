# 317-01 whole-branch review — Codex (independent, read-only)

- reviewer: codex exec -s read-only --ephemeral (ChatGPT login), 2026-09-26
- target: git diff b71465a9..3eaec833
- note: Codex's sandbox could not run vitest (no pnpm/esbuild access). The full pipeline (pnpm turbo run lint typecheck test build) was run in the main thread at 3eaec833's content: 28/28 tasks, core 4592 passed / 0 failed.
- per-task reviews (fresh Opus subagents) covered waves 1-3; all PASS, Minors applied or recorded in the SUMMARY.

## Prompt

You are an independent whole-branch reviewer for CADENCE phase 317-01. Read-only; do not edit anything, do not run builds or the full test suite (you may run individual vitest files with --coverage.enabled=false if needed).
Plan: `.cadence/phases/317-hook-json-block/317-01-DRAFT.md` (Objective, AC-1..AC-10, Tasks with their "as built" notes, Boundaries). SPEC `317-01-SPEC.md` passed independent review; decisions dec-20260925-001 (D-BN), dec-20260926-002 (D-BP), dec-20260926-003 (D-BO) in `.cadence/intelligence/decisions.json`.
The implementation is `git diff b71465a9..3eaec833` (commits d8249bde, bf13b1de, bdb88aa8, 0fbbcbe3, 3eaec833). Ignore the unrelated unstaged deletion of `.cadence/handoff/SESSION-2026-08-21.md`.
Review the whole change against the Objective and every AC:
- Correctness of the transport (packages/core/src/hooks/render-result.ts, packages/core/src/cli/commands/hook.ts): shapes per event, exit codes, stderr, byte-identity for non-block output, legacy path, error paths. Any event/result combination handled wrongly?
- doctor `hook-transport` (packages/core/src/doctor/run.ts, host-hooks-state.ts, host-hooks.ts): host-hooks behavior preserved exactly; every AC-7 outcome implemented verbatim.
- Tests: does each AC-N have real asserting coverage that would fail without the behavior? Any false green? Any test asserting SubagentStop is unreachable or pinning a count of reachable block sites (forbidden)? Windows-only tests correctly gated (win32 only, not Git Bash)?
- Boundaries: no handler logic change in handlers.ts; no host-*/src or host-toolkit changes; no ci.yml edit; existing tests not loosened (only the sanctioned hook.test.ts rewrite and host-checks list addition).
- Docs and comments: docs/reference/exit-codes.md, docs/host-adapters.md, docs/reference/commands.md, code comments — accurate for the final code; any other non-historical doc still describing hook blocking as exit 2? Stale comments describing the pre-change transport?
- Changeset `.changeset/hook-json-block.md`: accurate, no overclaim (not live-tested under Claude Code itself; SubagentStop real-host reachability not claimed; pwsh 7 not tested).
Output: `VERDICT: READY TO MERGE` or `VERDICT: NOT READY`, then findings tagged Critical / Important / Minor with file:line. Concise.

## Output

VERDICT: READY TO MERGE

No Critical, Important, or Minor findings.

The diff satisfies AC-1–AC-10, preserves the stated boundaries, and has no stale non-historical exit-2 hook documentation or reachability overclaim. Focused Vitest execution was blocked by the sandbox’s unavailable `pnpm` and esbuild filesystem access; no build or full suite was run.