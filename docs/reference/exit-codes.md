# Exit Code Reference

The `cadence` CLI (`packages/core/src`) uses a small, closed set of numeric
process exit codes. This page documents each one in use today. A test
(`packages/core/tests/docs/exit-codes.test.ts`) greps the source tree for
every distinct exit-code integer literal and fails if this page and the
source ever disagree in either direction — no undocumented code, and no
documented code that source no longer uses.

| Code | Meaning |
|---|---|
| `0` | Success. The default exit code when a command completes without error; some commands (e.g. `cadence doctor`) also set it explicitly. |
| `1` | General failure or refusal. By far the most common non-zero code — gate refusals, generic command failures, and most error paths across the CLI return or set this. |
| `2` | Invalid input or usage error — the caller supplied something the command can't act on: an unknown hook event (`cadence hook <event>`), an invalid `context` scope argument, an unknown or invalid key/value for `cadence config get`/`cadence config set`, or a conflicting `cadence handoff` invocation (e.g. an existing same-day doc without `--force`). |
| `3` | Narrow, single-purpose signal used only by `cadence handoff --check`: the freshest SESSION handoff doc exists but still has unfilled `FILL-IN` sections. This is distinct from exit code `1`, which `--check` uses when no SESSION doc exists at all — letting calling scripts tell "doc exists but incomplete" apart from "no doc found". |

## Notes

- Hook dispatch (`cadence hook <event>`) does **not** signal a block with an
  exit code for `pre-tool-edit`, `session-stop`, or `subagent-result`: it
  exits `0` and prints a per-event JSON decision on stdout
  (`hookSpecificOutput.permissionDecision: "deny"` for `pre-tool-edit`,
  top-level `{"decision":"block","reason":…}` for `session-stop` /
  `subagent-result`), because exit `2` collapses to a non-blocking `1` when a
  hook runs under Windows PowerShell (phase 317, `dec-20260925-001`). Hook
  dispatch still exits `2` for an unknown event name, and for a block on an
  event with no documented JSON decision shape (no handler produces one
  today), which also prints a loud stderr warning that the block may not
  hold under PowerShell.
- This table only covers `packages/core/src`. Host adapter packages
  (`cadence-host-claude-code`, `cadence-host-codex`) and any process spawned
  by `cadence settle`'s configured `verification.testCommand` have their own
  exit codes, which are out of scope for this page.
- `cadence start` is a narrower exception to "closed set, bounded to this
  page": some of its interactive menu options shell out to a host adapter
  package via `npx` (`packages/core/src/start/menu.ts`) and pass that child
  process's real exit code straight through as `cadence start`'s own exit
  code (`packages/core/src/cli/commands/start.ts`). A real invocation can
  therefore exit with a code outside `{0, 1, 2, 3}` if the spawned installer
  itself does. This is a pre-existing architectural property of `start`, not
  something this page's drift guard can detect or enforce.
- The drift-guard test is a static grep, not a full evaluator: it reliably
  catches exit codes expressed as literal integers (including both branches
  of a `cond ? A : B` ternary directly on the `exitCode`/`process.exit(...)`
  line), but cannot see a code that only ever reaches `process.exitCode`
  through a variable or a value returned from another function/subprocess
  (see the `cadence start` note above). Treat this page as accurate for
  everything the guard actually checks, not as a runtime-verified guarantee
  covering every possible code path.
