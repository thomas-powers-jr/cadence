# Raw hooks-doc excerpts cited by 317-01-SPEC.md

Committed verbatim so the SPEC's citations survive past the session's scratchpad
(which is ephemeral). Fetched via `curl`, never a summarizer, per this repo's own
rule (a summarizing fetch mis-stated the Claude Code page during checkpoint 0.4a).

## Claude Code — `https://code.claude.com/docs/en/hooks.md`, fetched 2026-09-25

### PreToolUse deny shape
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Destructive command blocked by hook"
  }
}
```

### PreToolUse decision-control field table (relevant row)
| `additionalContext` | String added to Claude's context alongside the tool result. Ignored when `permissionDecision` is `"defer"`. |

### PreToolUse combined example (allow + additionalContext, shown; deny not shown but not excluded by the field table)
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "My reason here",
    "updatedInput": { "field_to_modify": "new value" },
    "additionalContext": "Current environment: production. Proceed with caution."
  }
}
```

### Decision-control summary table (top-level `decision` row)
> `UserPromptSubmit, UserPromptExpansion, PostToolUse, PostToolUseFailure, PostToolBatch, Stop, SubagentStop, ConfigChange, PreCompact` — Top-level `decision`: `decision: "block"`, `reason`. Stop and SubagentStop also accept `hookSpecificOutput.additionalContext` for non-error feedback that continues the conversation.

### Stop decision control
```json
{ "decision": "block", "reason": "Test suite must pass before proceeding" }
```
> Use `additionalContext` when the hook is working as designed and giving Claude guidance... unlike `decision: "block"` it is shown in the transcript as hook feedback rather than a hook error:
```json
{ "hookSpecificOutput": { "hookEventName": "Stop", "additionalContext": "Please run the test suite before finishing" } }
```

### SubagentStop decision control
> SubagentStop hooks use the same decision control format as Stop hooks, including `hookSpecificOutput.additionalContext` with `hookEventName` set to `"SubagentStop"`, for non-error feedback that keeps the subagent running. Returning `decision: "block"` with a `reason` keeps the subagent running and delivers `reason` to the subagent as its next instruction.

### UserPromptSubmit combined example (block + additionalContext together — genuinely combined)
```json
{
  "decision": "block",
  "reason": "Explanation for decision",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "My additional context here",
    "sessionTitle": "My session title"
  }
}
```

### `shell` field
| `shell` | no | Shell to use for this hook. Accepts `"bash"` or `"powershell"`. Defaults to `"bash"`, or to `"powershell"` on Windows when Git Bash isn't installed. Setting `"powershell"` runs the command via PowerShell on Windows. Does not require `CLAUDE_CODE_USE_POWERSHELL_TOOL` since hooks spawn PowerShell directly. Ignored when `args` is set |

### Windows PowerShell tool
> On Windows, you can run individual hooks in PowerShell by setting `"shell": "powershell"` on a command hook. Claude Code auto-detects `pwsh.exe`, the PowerShell 7 and later executable, and falls back to `powershell.exe` for Windows PowerShell 5.1.

### Windows without Git Bash
> On Windows without Git Bash, the tool is enabled automatically and Claude Code doesn't register the Bash tool at all.

## Codex — `https://developers.openai.com/codex/hooks.md`, fetched 2026-09-26

### PreToolUse
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Destructive command blocked by hook."
  }
}
```
> Codex also accepts this older block shape:
```json
{ "decision": "block", "reason": "Destructive command blocked by hook." }
```
> You can also use exit code `2` and write the blocking reason to `stderr`.
>
> To add model-visible context without blocking, return `hookSpecificOutput.additionalContext`:
```json
{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": "The pending command touches generated files." } }
```
(Note: this `additionalContext` example is shown *without* a decision — Codex's docs do not show `permissionDecision` and `additionalContext` combined the way Claude Code's docs do. AC-6's combined shape is therefore unverified for Codex.)

### Stop
```json
{ "decision": "block", "reason": "Run one more pass over the failing tests." }
```
> You can also use exit code `2` and write the continuation reason to `stderr`.
>
> For this event, `decision: "block"` doesn't reject the turn. Instead, it tells Codex to continue and automatically creates a new continuation prompt that acts as a new user prompt, using your `reason` as that prompt text.
>
> `Stop` expects JSON on `stdout` when it exits `0`. Plain text output is invalid for this event.

### SubagentStop
```json
{ "decision": "block", "reason": "Run one more focused pass inside the subagent." }
```
> You can also use exit code `2` and write the continuation reason to `stderr`.
>
> `SubagentStop` expects JSON on `stdout` when it exits `0`. Plain text output is invalid for this event.

Input fields (in addition to Common input fields):
| Field | Type | Meaning |
|---|---|---|
| `turn_id` | `string` | Codex-specific extension. Active Codex turn id |
| `agent_id` | `string` | Identifier for the subagent |
| `agent_type` | `string` | Subagent type or profile |
| `agent_transcript_path` | `string \| null` | Path to the subagent transcript file, if any |
| `stop_hook_active` | `boolean` | Whether this subagent was already continued |
| `last_assistant_message` | `string \| null` | Latest subagent assistant message, if available |

`matcher` is applied to `agent_type` for this event.

**This directly contradicts `packages/host-codex/src/capabilities.ts:29-32`'s comment** ("undocumented whether SubagentStop even carries [an agent identifier]") — Codex's current docs do document `agent_id`/`agent_type`. See `rec-20260926-003`.
