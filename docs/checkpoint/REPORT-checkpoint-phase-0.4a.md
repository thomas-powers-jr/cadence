# REPORT — checkpoint Phase 0.4a (active block-probe)

Raw evidence (full `hooks.jsonl`, transcript attachments, both `/compact`
stdout blocks, statusline payloads) is preserved in
`docs/checkpoint/phase-0.4a-findings.md`, independent of the throwaway probe
folder at `C:\Users\softw\checkpoint-probe\`, which may be deleted at any
time.

**Revision note:** this report was corrected mid-write-up after an initial
pass wrongly concluded `PreCompact` isn't a documented blocking event. That
conclusion came from an AI web-fetch tool that silently truncates long pages
— re-checking against the raw doc source (`curl`, not a summarizer) showed
the opposite: `PreCompact` blocks on exit 2 and via JSON decision, same as
`Stop`. §5a below is the corrected, source-verified version.

## 1. `--force` and gate bypasses

None. This is measurement only — a throwaway probe run outside the repo
(`C:\Users\softw\checkpoint-probe\`, never committed), plus this write-up.
No CADENCE gate was touched.

## 2. Mission recap

Per `docs/handoffs/HANDOFF-checkpoint-arc-phase-3.md` §1 and the worktree
handoff `SESSION-2026-09-24-checkpoint-probe-instructions.md`: Phase 0
(passive probe) recorded `Stop`/`PreCompact` blocking-on-exit-2 as **NOT
TESTED** by deliberate choice, to avoid wedging a session. This task ran the
active probe the operator built (`block-probe.cjs`, self-releasing after 3
blocks, 10s hook timeout) interactively, by hand, per the arc's own D-BK
rule that an AI session must not drive this itself.

Claude Code version under test: **`2.1.282`** (`logs-version.txt`), on
Windows 11. Per the docs (§5a), the default hook shell is `bash`, falling
back to `powershell` **only when Git Bash isn't detected**. Direct evidence
from this same probe session (§5b) shows Git Bash was *not* detected in this
session's environment, so hooks in it ran through `powershell.exe`.

## 3. Verdict table

| Claim | Verdict | Evidence |
|---|---|---|
| `Stop` blocks via `{"decision":"block","reason":...}` (JSON, exit 0) | **PASS** | `hooks.jsonl` mode=`json`; harness auto-injected a synthetic `Stop hook feedback: <reason>` user turn ~0.3–0.4s after each assistant reply, looped through block 1/3→3/3, self-released on 3/3. `stop_hook_active: true` on the looped entries. No human input between blocks — see §4. |
| `Stop` blocks via plain exit code 2 | **NOT TESTED — the signal never arrived as a 2.** Not "did not block." | Turn ended normally after each exit-2 attempt; the human had to type the next message by hand (2m20s and 33s gaps between blocks, vs. sub-second gaps in JSON mode — §4). Claude Code's own transcript records receiving `exitCode: 1` for all three calls (§5c), not the `2` our script actually sent (§3 of the findings file). Root-caused in §5: a Windows PowerShell exit-code-collapse bug in how this session's hooks were spawned, reproduced independently outside the probe. `Stop`'s documented contract (exit 2 blocks) was never actually exercised here. |
| `PreCompact` blocks via exit code 2 | **NOT TESTED — same likely cause as `Stop`, not independently confirmed with an exit-code readout** | `local-command-stdout` for the sentinel-armed `/compact` literally reads `Compacted (ctrl+o to see full summary)` together with `PreCompact [...] failed: ... blocked by sentinel (block 1/3)...` — compaction completed despite the hook's intended block. Per the live docs, source-verified (§5a): **`PreCompact` is documented to block on exit 2**, same as `Stop` — the arc's Phase-0 assumption was correct, and this session's earlier draft of this report was wrong to question it. `PreCompact` used the identical hook shape (`"command": "node ... block-probe.cjs PreCompact"`, no `shell` field, same settings.json, same session) as `Stop`, whose exit code is independently confirmed to have collapsed 2→1 (§5c). The most likely explanation is the same bug hit `PreCompact` too — but unlike `Stop`, Claude Code's transcript never logged a `hook_non_blocking_error` attachment with an explicit `exitCode` for the `PreCompact` calls, so this isn't independently instrumented the way `Stop` is. Treat as unconfirmed, not as a documented non-capability. |
| `PreCompact` blocks via JSON decision | **NOT TESTED** | The probe kit's `block-probe.cjs` only implements `exit2`/`json` modes for `Stop`; for `PreCompact` it only ever emits `exit2` or is `inert`. Per the live docs (§5a), `PreCompact` **does** support `{"decision":"block","reason":...}` — it's listed in the same decision-control table row as `Stop`. A retest with a `PreCompact`-JSON mode added to the probe script is a viable, low-risk follow-up. |

**Bottom line: the arc's "Phases 3–5 not authorizable as designed" fallback
does *not* apply.** `Stop` blocking is proven to work, via the documented
JSON decision mechanism, cleanly reproduced end to end (§4). Both `Stop`'s
and `PreCompact`'s exit-code-2 paths are real, documented, blocking
mechanisms (§5a) — this test simply never got a real `2` to either of them,
because of a Windows-specific hook-spawning bug (§5), not because either
event is non-blocking. **A clean re-probe is needed to actually test the
exit-2 path** (for either event), forcing `"shell": "bash"` or wrapping the
command with `; exit $LASTEXITCODE` — that re-probe is the operator's call,
same as this one was. Until then, the arc's safest default for any gate is
the JSON decision mechanism, which is proven working for `Stop` and
documented (though untested here) for `PreCompact`.

## 4. `Stop` — JSON mode vs. exit-2 mode, side by side (from the live transcript)

Transcript: `C:\Users\softw\.claude\projects\C--Users-softw-checkpoint-probe\2392cd01-5948-4e1f-9d18-9e9ca882322d.jsonl`.

**Exit-2 mode** — every block required a fresh, human-typed message; no
synthetic turn ever appeared:

```
22:09:24  user (human-typed)   "say hi"
22:09:26  assistant            "Hi there! What can I help you with?"
22:09:26.711  [Stop hook: exit2, block 1/3 — turn ends here, nothing auto-continues]
22:11:46  user (human-typed, 2m20s later)  "say hi"
22:11:49  assistant            "Hi!"
22:11:49.387  [Stop hook: exit2, block 2/3 — turn ends here again]
22:12:19  user (human-typed, 33s later)    "how are you?"
22:12:22  assistant            "I'm doing well, thanks for asking! ..."
22:12:22.469  [Stop hook: exit2, block 3/3, autoReleased: true]
```

**JSON mode** — the harness itself injected the block reason as a new user
turn, sub-second turnaround, no human involved, self-released after 3:

```
22:13:12  user (human-typed)   "happy to be here"
22:13:14.988  assistant        "Glad to hear it! What are we digging into today?"
22:13:15.304  [Stop hook: json, block 1/3]
22:13:15.335  user (SYNTHETIC, +0.35s) "Stop hook feedback:\ncheckpoint-probe: Stop blocked by sentinel (block 1/3). Reply with one short sentence, then stop."
22:13:17.256  assistant        "Got it — replying with one short sentence, as instructed."
22:13:17.586  [Stop hook: json, block 2/3, stop_hook_active: true]
22:13:17.611  user (SYNTHETIC, +0.35s) "Stop hook feedback:\n...block 2/3..."
22:13:19.432  assistant        "Understood — one short sentence, and stopping here."
22:13:19.750  [Stop hook: json, block 3/3, autoReleased: true, stop_hook_active: true]
22:13:19.777  user (SYNTHETIC, +0.35s) "Stop hook feedback:\n...block 3/3..."
22:13:21.910  assistant        "Acknowledged — final short reply, stopping now."
22:13:22.224  [Stop hook: inert — sentinel gone, turn ends normally]
```

## 5. Root cause of the exit-2 non-arrival, reproduced independently

### 5a. What the official docs actually say (verified from raw source, not a summarizer)

An AI-summarizing web-fetch tool silently truncated this page mid-table on
three separate attempts, and its own commentary on the truncated output
wrongly asserted `PreCompact` wasn't in the blocking table. Re-fetched with
`curl` directly against the raw doc source
(`https://code.claude.com/docs/en/hooks.md`) to get the untruncated text:

- **"Exit code 2 behavior per event" table, verbatim rows:**
  `Stop | Yes | Prevents Claude from stopping, continues the conversation`
  and **`PreCompact | Yes | Blocks compaction`** — both documented as
  blocking, on equal footing.
- **`PreCompact` section, verbatim:** *"Exit with code 2 to block
  compaction. For a manual `/compact`, the stderr message is shown to the
  user. You can also block by returning JSON with `"decision": "block"`."*
- **Decision-control table, verbatim row:** `UserPromptSubmit,
  UserPromptExpansion, PostToolUse, PostToolUseFailure, PostToolBatch,
  Stop, SubagentStop, ConfigChange, PreCompact | Top-level decision |
  decision: "block", reason. ...` — `PreCompact` accepts the same JSON
  decision mechanism as `Stop`.
- **The "non-blocking" UI phrase**, verbatim: *"With stdout that Claude Code
  treats as plain text, or with empty stdout, it's a non-blocking error for
  most hook events: the action proceeds, and the transcript shows a
  `<hook name> hook error` notice followed by the first line of stderr,
  prefixed with `Failed with non-blocking status code:`"* Seeing this phrase
  is itself evidence Claude Code did not treat the exit as a `2`.
- **Shell selection, verbatim** (`shell` field of a command hook): *"Accepts
  `"bash"` or `"powershell"`. Defaults to `"bash"`, or to `"powershell"` on
  Windows when Git Bash isn't installed."* No caveat about exit-code
  propagation differences between the two shells is documented.

**Correction to this report's own earlier draft:** an initial pass of this
section, based on the truncated web-fetch summaries, concluded `PreCompact`
might not be a blocking-capable event at all. That was wrong — confirmed
directly against the raw doc source above. `PreCompact` blocks on exit 2 and
via JSON decision, exactly like `Stop`. The arc's original Phase 0 premise
("PreCompact blocks on exit 2") stands.

### 5b. Direct evidence this session ran hooks through PowerShell, not bash

Not inferred — quoted from this exact probe session's own hook-error
attachments (`~/.claude/projects/C--Users-softw-checkpoint-probe/2392cd01-….jsonl`,
`type: "attachment", attachment.type: "hook_non_blocking_error"`), from an
unrelated third-party plugin hook (`understand-anything`) that happened to
fire in the same session:

- **22:06:53.527Z**, `SessionStart:startup`: *`Failed to run: Hook
  "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" session-start" requires bash
  but Git Bash was not found. Install Git for Windows..., or add "shell":
  "powershell" to this hook's config.`* — Claude Code's own diagnostic,
  in this session, that Git Bash was undetected.
- **22:06:54.405Z** and again at **22:14:28.535Z** (`SessionStart:compact`),
  a *different* hook (a bash conditional, `[ -d "$UA_DIR" ] || ...`) failed
  with a PowerShell parser error: *`At line:1 char:31 ... Missing type name
  after '['.`* — `Missing type name after '['` is PowerShell trying to parse
  bash's `[ -d ... ]` test syntax as a PowerShell type-cast expression. That
  is direct proof a bash script was executed by `powershell.exe` in this
  same session, not by bash.

Together, 5a and 5b establish: this session's hooks — including our own
probe's `Stop`/`PreCompact` hook, which used the same plain `"command":
"node ..."` form with no explicit `shell` field — ran via PowerShell because
Git Bash wasn't detected, per Claude Code's own documented fallback rule.

### 5c. Reproducing the PowerShell exit-code collapse independently

Reproduced outside the probe (scratch copy of `block-probe.cjs` in
`$TEMP/probe-repro/`, deleted after the test, no probe logs touched):

| Invocation | Exit code observed by the caller |
|---|---|
| `node block-probe.cjs Stop` directly in Git Bash | `2` (correct) |
| `node block-probe.cjs Stop` directly inside an interactive PowerShell session | `2` (correct — `$LASTEXITCODE`) |
| `powershell.exe -NoProfile -Command "node block-probe.cjs Stop"` (a **new** PowerShell process running the command as a `-Command` string — the shape of a spawned hook) | **`1`** |
| Same, with the wrapper fixed to `-Command "node block-probe.cjs Stop; exit $LASTEXITCODE"` | `2` (correct again) |

This is the exact, reproducible mechanism: `powershell.exe -Command
"<command>"` does **not** propagate a wrapped native command's real exit
code as its own process exit code unless the command string ends with an
explicit `exit $LASTEXITCODE`. Combined with 5b (this session's hooks ran
via PowerShell), this explains why `Stop`'s exit-2 signal was lost.

**And this is not just plausible inference for `Stop` — Claude Code's own
transcript directly confirms it received `1`, not `2`.** The transcript's
`hook_non_blocking_error` attachments (distinct from our script's own
`hooks.jsonl`) record Claude Code's own view of each `Stop` hook call, e.g.
at `22:09:26.737Z`: `{"hookName":"Stop","stderr":"Failed with non-blocking
status code: checkpoint-probe: Stop blocked by sentinel (block
1/3)...","exitCode":1}` — identical entries at `22:11:49.418Z` (block 2/3)
and `22:12:22.496Z` (block 3/3), all `exitCode: 1`. That field is Claude
Code's own record of what it received from the hook subprocess, not our
script's self-report (our script's own `hooks.jsonl` correctly logged
`exitCode: 2` for the same three calls — it's what the script sent that
differs from what Claude Code received). The chain for `Stop` is fully
closed: our script sent `2` → PowerShell's `-Command` wrapper collapsed it
→ Claude Code's transcript recorded receiving `1` → Claude Code correctly
treated `1` as non-blocking per its own documented contract (5a).

**`PreCompact` is the same shape of call but not independently
instrumented this way** — no `hook_non_blocking_error`-style attachment
with an explicit `exitCode` was found anywhere in the transcript for the
`PreCompact` calls (searched for every transcript entry mentioning
`PreCompact`, all types, not just `attachment`). The `local-command-stdout`
text ("`PreCompact [...] failed: ...`") shows a different rendering path
than `Stop`'s, and doesn't carry a numeric exit code. Given `PreCompact` and
`Stop` used identical hook configuration and ran in the same session, the
same PowerShell collapse is the most likely explanation — but it is
inferred from the `Stop` evidence, not independently measured for
`PreCompact` itself.

**Implication for gate design:** do not depend on exit code 2 for a
Windows-spawned hook `command` unless the command is wrapped to force
`exit $LASTEXITCODE`, or Git Bash is confirmed detected for the session (or
explicitly forced via `"shell": "bash"`). The JSON decision path
(`{"decision":"block","reason":...}`, exit 0) sidesteps this entirely, is
documented for both `Stop` and `PreCompact` (5a), and is proven working end
to end for `Stop` (§4) — the safer default for any gate this arc builds,
until a clean re-probe actually exercises the exit-2 path for real.

## 6. D-BJ — statusline threshold unit (recommendation, not a decision)

Raw log: `C:\Users\softw\checkpoint-probe\logs\statusline.jsonl` (413 lines,
one session, plus one earlier stray line from a prior, unrelated launch —
see the findings file). `context_window` shape observed:

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

- **Both units are present simultaneously** — an integer `used_percentage`/
  `remaining_percentage` (0–100), and absolute counts (`current_usage.*`,
  `total_input_tokens`, `total_output_tokens`) against a fixed
  `context_window_size` (`1000000` this session — a model constant, not
  itself a live signal).
- `exceeds_200k_tokens` (boolean) is also present alongside `context_window`.
- **`used_percentage` is coarse**: it's a whole-number percentage of a
  1,000,000-token window, i.e. ~10k-token resolution. A sensor wanting
  finer granularity should read `current_usage`/`total_input_tokens`
  directly rather than the percentage field.
- **Confirms Phase 0's M2 finding, with a new wrinkle**: `used_percentage`
  was `null` before the first real turn, became `7` after the first
  exchange, and on reset **went to two different values across the two
  `/compact` calls in this same session** — `0` after the first compact,
  then `null` after the second. A sensor must treat both `null` and a
  post-reset `0` as "unknown/just reset," not as a real reading, and can't
  assume resets are consistent within even a single session.

**Recommendation** (D-BJ is the operator's call, not this session's):
percentage is enough for a threshold-crossing sensor (the gate only needs
"below X%"), but the sensor should read `used_percentage` when non-null and
fall back to computing from `current_usage`/`context_window_size` when it
isn't — rather than trusting either field alone.

## 7. What's still open after this task

- **A clean exit-2 re-probe is the real next step**, for both `Stop` and
  `PreCompact`, with the shell issue actually fixed (force `"shell":
  "bash"`, or wrap the command with `; exit $LASTEXITCODE`, or confirm Git
  Bash detection first). This task tested the JSON decision path for `Stop`
  only; the exit-2 path — for either event — has still never been genuinely
  exercised. Operator's call, per D-BK, same as this probe run was.
- **`PreCompact` via JSON decision — not tested**, but documented as
  supported (§5a). Cheap to add to the probe script's next run alongside
  the exit-2 retest.
- **Shipped-product check (not a CADENCE ledger item — operator's call
  whether to act on it):** grepped `packages/host-claude-code/src`,
  `packages/host-toolkit/src`, and `packages/core/bin` for `exitCode`,
  `permissionDecision`, and `"decision"` usage, and separately for any
  `Stop`-event hook registration in `host-claude-code/src`. Found generic
  CLI `process.exitCode` assignments unrelated to hook blocking, and no
  `Stop` hook registered in that package's source. This is a grep, not a
  full audit — it doesn't rule out a blocking hook installed by a template
  file or a different package. No known product impact today, but the
  scope of this check is narrow; say so if this matters enough to verify
  properly.
- **The PowerShell exit-code bug itself is not filed anywhere** (checked:
  no existing CADENCE rec, no upstream Claude Code issue opened by this
  session — filing one is out of scope for this write-up; flagging for the
  operator to decide whether to file upstream. Root question for that
  report, if filed: why didn't this session's Claude Code process detect
  Git Bash, given it's installed on this machine and used by other tools in
  the same environment?).
- Per the arc's standing rule, **this task does not touch the Cadence
  ledger.** Recommendations, if any, are filed by the operator.
- Phase 2 (sensor + state store) and any Phase 3 authorization are
  deliberately **not** drafted here — the handoff scoped this task to the
  probe write-up and D-BJ answer only.
