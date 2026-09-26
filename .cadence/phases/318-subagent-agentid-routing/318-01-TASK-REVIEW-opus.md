# 318-01 per-task review — fresh-context Opus subagent (independent, read-only)

- reviewer: fresh-context Claude Opus subagent, no shared transcript, read-only, 2026-09-26
- target: uncommitted working tree after T1-T5, before settle
- verdict: all five tasks PASS; no Critical or Important findings

## Findings (condensed from the reviewer's report)

- T1 PASS — four `318-01/AC-1` it() blocks with real assertions; the three agent cases fail pre-fix on exactly the missing camelCase keys; main-thread negative case uses `not.toHaveProperty`.
- T2 PASS — the e2e tests cannot pass without the routing fix: core `hook.ts:22-30` reads camelCase only; `handleSubagentStart` returns early (`handlers.ts:405`) so no nudge; `handleSubagentResult` takes the `!agentId` path (`handlers.ts:312`). The edit-time check cannot substitute: the test sends PostToolUse only, `handlePostToolEdit` runs no redundancy check, and `handlePreToolEdit` is never invoked. AC-2 soundly (indirectly) proves baseline creation, touched-file tracking, and pruning. Absolute `file_path` matched via `runRedundancyCheck`'s root relativization.
  - Minor: AC-3's `toContain('T1')` could match unrelated text (e.g. an ISO timestamp). **Applied** — tightened to `toContain('belongs to T1, already DONE')`, re-run 9/9 pass.
  - Minor (not applied): AC-2 does not assert `context.source === 'hook.subagentStop'`; AC-3 asserts no exit codes (deliberate — transport-neutral w.r.t. phase 317).
- T3 PASS — two guarded assignments mirroring `files`/`skill`; safe under `exactOptionalPropertyTypes`; Codex unaffected (its `shim.ts` has its own `routeHookEvent`).
- T4 PASS — `agentIdentification: true` with a cited comment; the flag has no runtime effect today because the Claude Code shim never sends `hostCapabilities` to core (declaration only). host-codex stays `false`.
- T5 PASS — patch bumps for host-toolkit and host-claude-code only; changeset makes no claim that subagents see the nudge.
- Process Minor: the DRAFT's per-package `verify:` commands (`pnpm --filter ... test -- <file>`) exit 1 on vitest's global coverage thresholds even when every test passes; judge those runs by pass counts, or rely on the full pipeline.
- Boundary check: `git diff HEAD -- packages/core packages/host-codex .cadence/phases/317-hook-json-block` empty.
