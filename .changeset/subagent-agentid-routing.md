---
'@thomas-powers-jr/cadence-host-toolkit': patch
'@thomas-powers-jr/cadence-host-claude-code': patch
---

Fix Claude Code's subagent task-redundancy chain never receiving agent identity (phase 318). `routeHookEvent` extracted `agent_id`/`agent_type` from the hook payload but forwarded only `files`/`skill` to `cadence hook`, which reads camelCase `agentId`/`agentType` — so the SubagentStart baseline and its "do not redo" context, per-subagent touched-file tracking, and the SubagentStop safety net (both `warn` and `block` mode of `redundantWorkEnforcement`) silently never ran. Claude Code's subagent chain now receives agent identity. The Claude Code adapter's capabilities also now declare `agentIdentification: true`. The edit-time redundancy check was unaffected; Codex's agent identity is unchanged.
