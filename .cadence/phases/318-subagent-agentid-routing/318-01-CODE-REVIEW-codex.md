# 318-01 whole-branch code review — Codex (independent, read-only)

- reviewer: codex exec -s read-only --ephemeral (ChatGPT login), 2026-09-26
- target: uncommitted working tree on worktree-subagent-agentid-routing after T1-T5, before settle
- note: settle ran no AI gate (code-review not in the standard tier x standard profile gate set; deep-verify not requested), so this manual review and the Opus per-task review in 318-01-TASK-REVIEW-opus.md are the independent review of record.
- after this review: the AC-3 assertion in shim-integration.test.ts was tightened from toContain('T1') to toContain('belongs to T1, already DONE') (Opus review Minor) and re-run: 9/9 pass.

## Prompt

You are an independent whole-branch reviewer for CADENCE phase 318-01. Read-only; do not edit anything.
Repo: this worktree. The plan is `.cadence/phases/318-subagent-agentid-routing/318-01-DRAFT.md` (read Objective, AC-1..AC-4, Boundaries). The implementation is the UNCOMMITTED working tree: run `git diff` and `git status --short` (new file `.changeset/subagent-agentid-routing.md`).
Review the whole change against the DRAFT's Objective and ACs:
- Is the routing.ts fix correct and complete for Claude Code? Any other path where agent identity is lost between the Claude Code hook payload and core's HookContext (packages/host-claude-code/src/{cli.ts,shim.ts}, packages/core/src/cli/commands/hook.ts)?
- Could the new tests pass without the fix (false green)? Do they actually exercise baseline creation, touched-file tracking and the SubagentStop check through the real built shim?
- Any behavior regression: e.g. main-thread events now carrying agentId; the pre-tool-edit path; anything that now keys state on agentId that previously didn't; `agentIdentification: true` effects on packages/core/src/hooks/handlers.ts noticeIfAgentIdentificationUnsupported or doctor.
- Stale comments/docs: any comment or doc (docs/, packages/*/src comments, e.g. host-codex/src/capabilities.ts's comment that contrasts with host-claude-code) now describing pre-fix behavior. Note: host-codex is out of scope by Boundaries; flag stale text there as Minor only.
- Changeset accuracy.
Output: `VERDICT: READY TO MERGE` or `VERDICT: NOT READY`, then findings tagged Critical / Important / Minor with file:line evidence. Be concise.

## Output

VERDICT: READY TO MERGE

- Critical: none.
- Important: none.
- Minor: none.

`routing.ts:181-189` preserves camelCase identity through the Claude shim (`shim.ts:1-6`, `cli.ts:100,134-140`) to core’s `HookContext` (`hook.ts:22-30`). Current Claude docs confirm these fields on subagent start/stop and subagent tool calls. [Hooks reference](https://code.claude.com/docs/en/hooks)

The E2E test uses built shim/core artifacts (`shim-integration.test.ts:8-10`) and its PostToolUse-only lifecycle proves baseline creation, agent-scoped touched-file tracking, and the SubagentStop warn/block paths. Turbo builds before tests (`turbo.json:7-10`), avoiding stale-dist false greens in the full pipeline.

No main-thread or PreToolUse regression: identity is absent unless supplied, and `handlePreToolEdit` does not key state on it (`handlers.ts:133-260`). `agentIdentification: true` does not affect the false-only unsupported-host notice; doctor does not consume it. Changeset is accurate and does not claim Claude visibly delivers the start nudge.