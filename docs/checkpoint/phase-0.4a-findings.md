# checkpoint Phase 0.4a — raw evidence

Companion to `REPORT-checkpoint-phase-0.4a.md`. The probe kit itself lives
at `C:\Users\softw\checkpoint-probe\` (throwaway, never committed, may be
deleted at any time) — this file preserves everything from that run that the
report cites, so the evidence survives the probe folder's deletion. Phase
0's original raw log was lost this way and left D-BJ open for a full extra
phase; this file exists so that doesn't happen again.

Session: `2392cd01-5948-4e1f-9d18-9e9ca882322d`, Claude Code `2.1.282`,
Windows 11, run 2026-09-24 ~22:06–22:16 UTC.

## Probe `.claude/settings.json`

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"C:/Users/softw/checkpoint-probe/statusline-capture.cjs\""
  },
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node \"C:/Users/softw/checkpoint-probe/block-probe.cjs\" Stop", "timeout": 10 }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "manual",
        "hooks": [
          { "type": "command", "command": "node \"C:/Users/softw/checkpoint-probe/block-probe.cjs\" PreCompact", "timeout": 10 }
        ]
      }
    ]
  }
}
```

## `logs/hooks.jsonl` — the probe script's own log (all 10 entries, `payload` trimmed to the fields cited elsewhere in this doc)

Logged by `block-probe.cjs` itself, before calling `process.exit()`. Note
this reflects what the script *sent*, not necessarily what Claude Code
*received* (see the report's §5). Two representative lines are reproduced
fully untrimmed below the table, in case the full payload shape matters
once the probe folder is gone.

```
{"ts":"2026-09-24T22:08:14.622Z","event":"Stop","mode":"inert","exitCode":0,"stdout":"","stderr":"","autoReleased":false,"payload":{"last_assistant_message":"Hey! What are we working on today?","stop_hook_active":false}}
{"ts":"2026-09-24T22:09:26.711Z","event":"Stop","mode":"exit2","exitCode":2,"stdout":"","stderr":"checkpoint-probe: Stop blocked by sentinel (block 1/3). Reply with one short sentence, then stop.","autoReleased":false,"payload":{"last_assistant_message":"Hi there! What can I help you with?","stop_hook_active":false}}
{"ts":"2026-09-24T22:11:49.387Z","event":"Stop","mode":"exit2","exitCode":2,"stdout":"","stderr":"checkpoint-probe: Stop blocked by sentinel (block 2/3). Reply with one short sentence, then stop.","autoReleased":false,"payload":{"last_assistant_message":"Hi!","stop_hook_active":false}}
{"ts":"2026-09-24T22:12:22.469Z","event":"Stop","mode":"exit2","exitCode":2,"stdout":"","stderr":"checkpoint-probe: Stop blocked by sentinel (block 3/3). Reply with one short sentence, then stop.","autoReleased":true,"payload":{"last_assistant_message":"I'm doing well, thanks for asking! Ready to help whenever you've got something to work on — what's up?","stop_hook_active":false}}
{"ts":"2026-09-24T22:13:15.304Z","event":"Stop","mode":"json","exitCode":0,"stdout":"{\"decision\":\"block\",\"reason\":\"checkpoint-probe: Stop blocked by sentinel (block 1/3). Reply with one short sentence, then stop.\"}","stderr":"","autoReleased":false,"payload":{"last_assistant_message":"Glad to hear it! What are we digging into today?","stop_hook_active":false}}
{"ts":"2026-09-24T22:13:17.586Z","event":"Stop","mode":"json","exitCode":0,"stdout":"{\"decision\":\"block\",\"reason\":\"checkpoint-probe: Stop blocked by sentinel (block 2/3). Reply with one short sentence, then stop.\"}","stderr":"","autoReleased":false,"payload":{"last_assistant_message":"Got it — replying with one short sentence, as instructed.","stop_hook_active":true}}
{"ts":"2026-09-24T22:13:19.750Z","event":"Stop","mode":"json","exitCode":0,"stdout":"{\"decision\":\"block\",\"reason\":\"checkpoint-probe: Stop blocked by sentinel (block 3/3). Reply with one short sentence, then stop.\"}","stderr":"","autoReleased":true,"payload":{"last_assistant_message":"Understood — one short sentence, and stopping here.","stop_hook_active":true}}
{"ts":"2026-09-24T22:13:22.224Z","event":"Stop","mode":"inert","exitCode":0,"stdout":"","stderr":"","autoReleased":false,"payload":{"last_assistant_message":"Acknowledged — final short reply, stopping now.","stop_hook_active":true}}
{"ts":"2026-09-24T22:14:16.554Z","event":"PreCompact","mode":"exit2","exitCode":2,"stdout":"","stderr":"checkpoint-probe: PreCompact blocked by sentinel (block 1/3). Reply with one short sentence, then stop.","autoReleased":false,"payload":{"trigger":"manual"}}
{"ts":"2026-09-24T22:15:17.848Z","event":"PreCompact","mode":"inert","exitCode":0,"stdout":"","stderr":"","autoReleased":false,"payload":{"trigger":"manual"}}
```

Two lines, fully untrimmed (full `payload`, exactly as the probe script
wrote them):

```
{"ts":"2026-09-24T22:09:26.711Z","event":"Stop","mode":"exit2","exitCode":2,"stdout":"","stderr":"checkpoint-probe: Stop blocked by sentinel (block 1/3). Reply with one short sentence, then stop.","autoReleased":false,"payload":{"session_id":"2392cd01-5948-4e1f-9d18-9e9ca882322d","transcript_path":"C:\\Users\\softw\\.claude\\projects\\C--Users-softw-checkpoint-probe\\2392cd01-5948-4e1f-9d18-9e9ca882322d.jsonl","cwd":"C:\\Users\\softw\\checkpoint-probe","scratchpad_dir":"C:\\Users\\softw\\AppData\\Local\\Temp\\claude\\C--Users-softw-checkpoint-probe\\2392cd01-5948-4e1f-9d18-9e9ca882322d\\scratchpad","prompt_id":"221c722f-9c5e-47ad-9acc-4d65775bb186","permission_mode":"auto","effort":{"level":"high"},"hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"Hi there! What can I help you with?","background_tasks":[],"session_crons":[]}}
{"ts":"2026-09-24T22:14:16.554Z","event":"PreCompact","mode":"exit2","exitCode":2,"stdout":"","stderr":"checkpoint-probe: PreCompact blocked by sentinel (block 1/3). Reply with one short sentence, then stop.","autoReleased":false,"payload":{"session_id":"2392cd01-5948-4e1f-9d18-9e9ca882322d","transcript_path":"C:\\Users\\softw\\.claude\\projects\\C--Users-softw-checkpoint-probe\\2392cd01-5948-4e1f-9d18-9e9ca882322d.jsonl","cwd":"C:\\Users\\softw\\checkpoint-probe","scratchpad_dir":"C:\\Users\\softw\\AppData\\Local\\Temp\\claude\\C--Users-softw-checkpoint-probe\\2392cd01-5948-4e1f-9d18-9e9ca882322d\\scratchpad","prompt_id":"ab4367c2-d278-40ce-aecd-97ef33a80d17","hook_event_name":"PreCompact","trigger":"manual","custom_instructions":null}}
```

Note the `PreCompact` payload has no `stop_hook_active`/`last_assistant_message`
fields at all — it's a structurally different payload shape than `Stop`'s,
confirming these are genuinely different hook events, not the same call
logged twice.

## Claude Code's own record of what it received (transcript attachments)

From the session transcript
(`~/.claude/projects/C--Users-softw-checkpoint-probe/2392cd01-….jsonl`),
`type: "attachment"`, `attachment.type: "hook_non_blocking_error"` — this is
Claude Code's own instrumentation, independent of the probe script's log
above:

```
22:09:26.737Z  Stop  exitCode:1  stderr: Failed with non-blocking status code: checkpoint-probe: Stop blocked by sentinel (block 1/3). Reply with one short sentence, then stop.
22:11:49.418Z  Stop  exitCode:1  stderr: Failed with non-blocking status code: checkpoint-probe: Stop blocked by sentinel (block 2/3). Reply with one short sentence, then stop.
22:12:22.496Z  Stop  exitCode:1  stderr: Failed with non-blocking status code: checkpoint-probe: Stop blocked by sentinel (block 3/3). Reply with one short sentence, then stop.
```

Compare to the script's own log above, which recorded sending `exitCode: 2`
for these same three calls. Claude Code received `1`.

Unrelated third-party hook (`understand-anything` plugin), same session,
proving hooks ran through PowerShell rather than bash:

```
22:06:53.527Z  SessionStart:startup  exitCode:1
  Failed to run: Hook ""${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start"
  requires bash but Git Bash was not found. Install Git for Windows
  (https://git-scm.com/downloads/win), or add "shell": "powershell" to this
  hook's config.

22:06:54.405Z  SessionStart:startup  exitCode:1
  Failed with non-blocking status code: At line:1 char:31
  + UA_DIR=.understand-anything; [ -d "$UA_DIR" ] || UA_DIR=.ua; [ -f $UA ...
  +                               ~
  Missing type name after '['.
  ... (PowerShell parser errors continue, same shape, through char:212) ...
  FullyQualifiedErrorId : MissingTypename
```

(Two more instances of the identical PowerShell-parse-error block recur at
`22:14:28.535Z` and `22:15:34.997Z`, both `SessionStart:compact` — same
plugin hook firing again around each `/compact`.)

## `local-command-stdout` — both `/compact` invocations, verbatim

From the transcript, `type: "user"`, content containing
`<local-command-stdout>`:

**First `/compact`, sentinel armed (22:14:16 → 22:14:28):**
```
<local-command-stdout>Compacted (ctrl+o to see full summary)
PreCompact [node "C:/Users/softw/checkpoint-probe/block-probe.cjs" PreCompact] failed: checkpoint-probe: PreCompact blocked by sentinel (block 1/3). Reply with one short sentence, then stop.</local-command-stdout>
```
Note "Compacted" appears *before* the "failed" line — compaction completed
despite the block signal.

**Second `/compact`, sentinel removed (22:15:17 → 22:15:35):**
```
<local-command-stdout>Compacted (ctrl+o to see full summary)
PreCompact [node "C:/Users/softw/checkpoint-probe/block-probe.cjs" PreCompact] completed successfully</local-command-stdout>
```

## Statusline — one full payload, and the `used_percentage` timeline

Full `context_window` object from one representative line
(`logs/statusline.jsonl`, mid-session, `total_input_tokens: 65933`):

```json
{
  "total_input_tokens": 65933,
  "total_output_tokens": 13,
  "context_window_size": 1000000,
  "current_usage": {
    "input_tokens": 2,
    "output_tokens": 13,
    "cache_creation_input_tokens": 65931,
    "cache_read_input_tokens": 0
  },
  "used_percentage": 7,
  "remaining_percentage": 93
}
```

Sibling fields on the same statusline payload, for reference:
`exceeds_200k_tokens: false`, `session_id`, `model.id`, `version`,
`cost.total_cost_usd`, `prompt_cache.{warm,hit_ratio,ttl}`,
`rate_limits.{five_hour,seven_day}.used_percentage`.

`used_percentage` value transitions across the full 413-line log
(only the ticks where the value actually changed):

| Timestamp | `used_percentage` | `remaining_percentage` | `total_input_tokens` | Context |
|---|---|---|---|---|
| 21:09:23.783Z | `null` | `null` | `0` | **different `session_id` (`19409eb4-…`), an earlier unrelated launch** — not this test session (`2392cd01-…`); included only because it's the first line in the log file |
| 22:08:14.926Z | `7` | `93` | `65933` | this session, after its first exchange |
| 22:14:29.159Z | `0` | `100` | `0` | immediately after **first** `/compact` |
| 22:15:35.610Z | `null` | `null` | `0` | immediately after **second** `/compact` |

Same session, same kind of reset event (a `/compact`), two different
"just reset" values (`0` vs. `null`) — corroborates Phase 0's original M2
finding that a post-reset render is not reliably one specific sentinel
value.
