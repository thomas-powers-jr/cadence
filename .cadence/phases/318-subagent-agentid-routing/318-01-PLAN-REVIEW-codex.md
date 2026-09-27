# 318-01 DRAFT review — Codex (independent, read-only)

- reviewer: codex exec -s read-only --ephemeral (ChatGPT login), 2026-09-26
- target: commit c209374a
- note: config planReview is mock; this manual review is the real plan review of record. Finding 5 applied after review.

## Prompt

You are an adversarial, independent reviewer of a CADENCE DRAFT (plan) before it is approved for build. Read-only. Do not edit files.

Target: `.cadence/phases/318-subagent-agentid-routing/318-01-DRAFT.md` in this repo (commit c209374a; `git show c209374a` shows it plus ledger updates). It fixes recommendation rec-20260926-001 (see `.cadence/intelligence/recommendations.json` and `evidence.json`, entries ev-20260926-006/007/008).

Verify every factual claim in the DRAFT against the actual code, citing file:line:
- packages/host-toolkit/src/routing.ts (routeHookEvent, extractPayload)
- packages/core/src/cli/commands/hook.ts (what stdin keys become ctx.agentId/agentType)
- packages/core/src/hooks/handlers.ts (handlePreToolEdit, post-tool-edit touchedFiles, handleSubagentStart, handleSubagentResult)
- packages/core/src/checks/task-redundancy.ts (path normalization)
- packages/host-claude-code/src/{shim.ts,cli.ts,capabilities.ts} and tests/shim-integration.test.ts (does the real shim spawn core the way AC-2/AC-3 assume? how does it forward stdout/stderr/exit code?)
- packages/host-codex/src/capabilities.ts

Then judge:
1. Is the root cause correct and is the proposed one-step fix in routing.ts sufficient for AC-2 and AC-3 to pass through the real shim? Name any other place the agent identity or the chain can be lost (e.g. does SubagentStart through the shim actually reach handleSubagentStart; is PROGRESS.json the status source; does post-tool-edit record touchedFiles for the baseline when no activeTask exists; does the notify file transport work as the test assumes).
2. Are AC-2/AC-3 achievable and honestly testable as written? Could the edit-time check or any other path satisfy the assertions without the fix (a false green)? Will the tests genuinely fail before the fix?
3. Are the Boundaries consistent with the tasks (will any task need to touch a forbidden file)?
4. Coverage: this repo uses assertion-mode, phase-qualified tokens (`318-01/AC-N` inside asserting it() blocks). Is every AC coverable?
5. Anything missing or overclaimed.

Output: a verdict line `VERDICT: APPROVE` or `VERDICT: REJECT`, then numbered findings, each tagged BLOCKING or NON-BLOCKING with file:line evidence. Be concise.

## Output

VERDICT: APPROVE

1. **NON-BLOCKING** — Root cause is correct. `extractPayload` derives camelCase identity, but translation copies only `files`/`skill`; core reads only camelCase. The one-line copy restores the whole Claude Code sequence. [routing.ts:100](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/host-toolkit/src/routing.ts:100) [routing.ts:181](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/host-toolkit/src/routing.ts:181) [hook.ts:23](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/core/src/cli/commands/hook.ts:23)

2. **NON-BLOCKING** — AC-2/AC-3 are achievable through the real shim. `SubagentStart`/`Stop` are mapped and installed; the shim pipes translated stdin to core, inherits core stdout/stderr, and relays its exit status. Start snapshots `PROGRESS.json`; post-edit tracks the baseline independently of `activeTask`; stop checks and prunes it. [routing.ts:75](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/host-toolkit/src/routing.ts:75) [install.ts:100](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/host-claude-code/src/install.ts:100) [cli.ts:134](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/host-claude-code/src/cli.ts:134) [handlers.ts:419](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/core/src/hooks/handlers.ts:419) [handlers.ts:278](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/core/src/hooks/handlers.ts:278) [handlers.ts:351](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/core/src/hooks/handlers.ts:351)

3. **NON-BLOCKING** — The E2E tests genuinely go red pre-fix. They use only `PostToolUse`, so the independent pre-edit redundancy check cannot create the anomaly/block. Without camelCase identity, start returns before baseline creation and stop returns `ok: true`; no nudge, anomaly, or block message can occur. Absolute paths normalize to the DRAFT’s relative paths, and file notification is awaited under the child’s payload cwd. [handlers.ts:405](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/core/src/hooks/handlers.ts:405) [handlers.ts:310](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/core/src/hooks/handlers.ts:310) [task-redundancy.ts:50](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/core/src/checks/task-redundancy.ts:50) [file.ts:14](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/core/src/notify/file.ts:14)

4. **NON-BLOCKING** — Boundaries and coverage are consistent. T1/T2/T4 each require phase-qualified tokens inside asserting `it()` blocks, covering AC-1 through AC-4 under this repo’s assertion/qualified configuration. No task needs a forbidden source file. [config.json:70](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/.cadence/config.json:70) [coverage.ts:142](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/core/src/verify/coverage.ts:142) [DRAFT:40](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/.cadence/phases/318-subagent-agentid-routing/318-01-DRAFT.md:40)

5. **NON-BLOCKING** — Tighten T5’s release-note wording to say “Claude Code’s subagent chain,” since Codex deliberately remains unsupported for identity. The plan itself scopes this correctly. [DRAFT:70](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/.cadence/phases/318-subagent-agentid-routing/318-01-DRAFT.md:70) [capabilities.ts:27](/C:/Users/softw/projects/cadence/.claude/worktrees/subagent-agentid-routing/packages/host-codex/src/capabilities.ts:27)

Claude Code’s current hooks reference also confirms `agent_id`/`agent_type` for subagent tool events, SubagentStart, and SubagentStop. [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)