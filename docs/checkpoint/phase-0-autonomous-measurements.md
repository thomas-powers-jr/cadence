# Checkpoint Phase 0 — autonomous measurements (M1, M7, M8, M9)

No operator needed for any of these — recorded before any interactive pass. See
`docs/handoffs/HANDOFF-checkpoint-handoff-before-reset.md` for what M1–M10 mean.

## M1 — installed Claude Code version

```
$ claude --version
2.1.278 (Claude Code)
```

## M9 — canonical package/repo

```
$ curl -sS "https://registry.npmjs.org/@manehorizons/cadence-core" | jq '."dist-tags".latest'
"1.53.0"
$ curl -sS "https://registry.npmjs.org/@thomas-powers-jr/cadence-core" | jq '."dist-tags".latest'
"1.67.2"
```

`1.67.2` matches this repo's own `packages/core/package.json` / CLAUDE.md version line.
`@thomas-powers-jr/cadence-core` is the live, actively-published package this repo ships;
`@manehorizons/cadence-core` is stale by 14 minor versions. This also answers Open Decision 2
without spending an operator question on it — recorded as such here, not re-asked.

## M7 — existing `/cadence-handoff` output structure

```
$ git log -1 --format="%H %ad" --date=short -- .claude/commands/cadence-handoff.md .claude/commands/cadence-resume.md
ff35843b29706cd3ed394a49ffae80ec5fae7671 2026-07-03
```

Command definitions: `.claude/commands/cadence-handoff.md`, `.claude/commands/cadence-resume.md` —
both wrap `cadence handoff` / `cadence resume` directly (`allowed-tools: Bash(cadence:*), Read`),
no template text of their own.

The generated section list, from the freshest live SESSION doc (commit `3bc20d26`,
`.cadence/handoff/SESSION-2026-09-22-pr521-merged-checkpoint-proposal-dropped.md`) — this is
the exact, real header text Task 1.0's schema is built on, including the dynamic decorative
suffixes after two of them:

```
## TL;DR for the next session
## State on handoff   ·  pre-filled — verify, don't retype
## CADENCE context   ·  pre-filled from `cadence context handoff`
## What landed this session
## Carry-forward gotchas
## Next action
```

`cadence resume` is confirmed (via `resume --help`, captured under M8 below) to replay this
exact document shape — `--full` replays the whole doc, `--brief` replays "key sections only,
no context replay." Any checkpoint schema that doesn't validate *this* shape produces
documents `cadence resume` wasn't built to read.

## M8 — live Cadence CLI surface

Top-level, then the two handoff/resume subcommands — the only ones matching "handoff- or
resume-related" in the top-level list:

```
$ node packages/core/bin/cadence.cjs --help
[... full command list includes: handoff [options] [label], resume [options] ...]

$ node packages/core/bin/cadence.cjs handoff --help
Usage: cadence handoff [options] [label]
  --label <s>  context label (alternative to the positional arg)
  --force      overwrite an existing same-day SESSION doc
  --no-stamp   do not write state.session.lastHandoff (no state.json change)
  --no-git     skip read-only git facts
  --no-fetch   skip the pre-facts git fetch (offline)
  --check      verify the freshest SESSION doc has no unfilled FILL-IN sections (exit 3 if it does)
  --json       emit machine-readable JSON instead of a summary

$ node packages/core/bin/cadence.cjs resume --help
Usage: cadence resume [options]
  --json      emit machine-readable JSON instead of rendered text
  --full      force full output (whole doc + live context replay)
  --brief     force brief output (key sections only, no context replay)
  --list      list every discoverable handoff candidate (local + sibling worktrees) and resume nothing
  --pick <n>  resolve directly to the Nth candidate from `cadence resume --list` (1-based), skipping the menu
  --path <p>  resolve directly to the handoff doc at this exact path, skipping the menu
  --local     force the local-only fast path, ignoring sibling worktrees entirely
  --offline   skip the origin-freshness probe (no network)
```

AC 5 constraint: no flag appears anywhere else in the final report that is not in this output.

## Settings-file measurement (informs Task 0.3, not itself an M-item but load-bearing)

```
$ git ls-files .claude/settings.json
.claude/settings.json          # tracked
$ git check-ignore -v .claude/settings.json
(no output, exit 1)            # NOT gitignored
$ cat .claude/settings.json | jq '.statusLine // "none configured"'
"none configured"
```

`.claude/settings.json` is tracked and not ignored — probe hooks can be added additively and
Phase 0 AC 6 (remove them in a dedicated commit) is satisfiable directly against this file. No
`statusLine` is currently configured, so Task 0.6's cleanup only needs to *remove* the key, not
restore a prior value. The full current key set is `SessionStart`, `UserPromptSubmit`,
`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `SubagentStart` — all seven exist today and
all seven must still exist, unchanged, after Task 0.3's edit.

## `CLAUDE_PLUGIN_DATA` (design-premise finding, not a numbered M-item)

```
$ echo $CLAUDE_PLUGIN_DATA
(empty)
```

The design reference's state-file path (`${CLAUDE_PLUGIN_DATA}` or a configured path) has no
live value for `${CLAUDE_PLUGIN_DATA}` in this environment — this repo's cadence hooks are wired
as a project-local `.claude/settings.json` entry, not installed as a plugin. Recorded as a
Phase 0 finding: the configured-path fallback is the only branch with a real value here, so any
later phase's default must not assume `CLAUDE_PLUGIN_DATA` is set.
