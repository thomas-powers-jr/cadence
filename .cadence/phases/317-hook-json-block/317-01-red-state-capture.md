# 317-01 — full-chain red-state capture (today's unmodified transport)

Captured 2026-09-26, on this box, using the **real** production chain — not a synthetic
simulation. This is the "prove the collapse red first" evidence the originating handoff
required (report-back #6).

## Setup

1. A scratch project (`git init`, `cadence init`) with `.cadence/config.json`'s
   `hooks.preToolUseBuildGate` set to `true` and `loopPosition: IDLE` (not `BUILD`) —
   this puts `handlePreToolEdit` (`handlers.ts:254-259`) on its build-gate `ok:false`
   branch for any `PreToolUse` edit.
2. A **real** `cadence-host-claude-code install --local` run against that scratch
   project, and the resulting installed command read directly out of
   `.claude/settings.json` (not hand-written):
   ```
   node C:\Users\softw\projects\cadence\.claude\worktrees\hook-json-block\packages\host-claude-code\dist\cli.js hook --cadence "node C:\Users\softw\projects\cadence\.claude\worktrees\hook-json-block\packages\core\dist\cli\index.js"
   ```
   (Absolute paths, confirming AC-4's `resolveLocalPaths()` claim — not the relative
   `packages/...` form an earlier draft of this SPEC assumed.)
3. That exact command spawned via `powershell.exe -NoProfile -Command "<command>"`
   (Node's `spawn`, `stdio: ['pipe','pipe','pipe']`, `cwd` set to the scratch project),
   with a realistic `PreToolUse`/`Write` stdin payload piped in. Reproducible with
   `317-01-probe-ac4-redstate.mjs` (committed alongside this file) — edit its
   `CAPTURED_COMMAND` constant to match your own `install --local` output (paths
   are machine-absolute) and run `node 317-01-probe-ac4-redstate.mjs <scratch-project-path>`
   against a scratch project set up per step 1.

## Result

```
observed exit code: 1
stdout: "" (empty)
stderr: "preToolUseBuildGate is enabled and loopPosition=IDLE. Run 'cadence draft approve' to enter BUILD phase before editing."
```

**The real chain — Claude Code's exact installed command, real config, real handler,
through `powershell.exe` — collapses `handlePreToolEdit`'s intended exit code `2` to an
observed `1`.** This is not inferred from checkpoint 0.4a's `Stop`-only reproduction; it
is this phase's own independent, full-chain confirmation of the same collapse on the
`PreToolUse` path, using the tool's real install output.

## Companion probe: stdin does forward through the chain

Before running the above, a narrower probe confirmed piped stdin actually survives
`powershell.exe -NoProfile -Command "node ..."` (a real risk the encoding probe didn't
cover, since that one only tested stdout):

Full script: `317-01-probe-stdin.mjs`, committed alongside this file. Run with
`node 317-01-probe-stdin.mjs`. Result:
```
exit code: 0
stdout received: '{"hook_event_name":"Stop","probe":true}'
```
(An earlier version of this file's snippet omitted the script's `.stdin.end()` call —
a documentation-simplification bug, not an error in what was actually executed; the
committed script has always called it.)

Confirms the shim's `hook_event_name`-from-stdin read (`cli.ts:96-100`) is not at risk
of receiving empty/truncated input through this spawn form.

## What AC-4's real fixture must reproduce, post-fix

Same setup, same real command, same spawn form — after the transport fix, expect
`stdout` to carry the JSON deny document and exit code `0`, not the current empty
stdout / exit `1`.
