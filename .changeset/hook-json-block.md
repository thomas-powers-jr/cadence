---
"@thomas-powers-jr/cadence-core": minor
---

Hook blocks no longer depend on exit-code propagation (phase 317). `cadence hook` used to signal a block with exit code 2, which `powershell.exe -Command` collapses to a non-blocking 1: checkpoint 0.4a observed Claude Code receiving exit 1 for CADENCE's exit-2 Stop blocks when hooks ran under PowerShell, and this phase reproduces the collapse (and verifies the fix end to end) through a real `install --local` hook command spawned via `powershell.exe -NoProfile -Command`. Blocks are now delivered as a per-event JSON decision on stdout with exit 0: `hookSpecificOutput.permissionDecision: "deny"` for `pre-tool-edit` and top-level `{"decision":"block","reason":…}` for `session-stop` / `subagent-result`, the transport documented by both Claude Code and Codex. The block message is still written to stderr as a diagnostic. Non-blocking hook output is byte-identical to before. A block on an event with no documented JSON decision shape (no handler produces one today) keeps the old exit-2 path and prints a loud warning.

New `cadence doctor` check `hook-transport` (Claude Code only): reports the `shell` setting on the installed hook command — the documented default rule when none is set, the configured value when it is `"bash"` or `"powershell"`, and a warning for any other value.
