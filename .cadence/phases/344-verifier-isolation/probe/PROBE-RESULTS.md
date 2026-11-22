# Phase 344 probe results

Operator's PC (Windows, git bash), 2026-11-21. codex-cli 0.156.1; Claude Code
2.1.330. Raw output stays on that machine (`results-*/` is gitignored).

Method: one marker line appended to the global `~/.codex/AGENTS.md` and
`~/.claude/CLAUDE.md`; each CLI run with a fixed prompt on stdin, as cadence
sends it, asking the child to report any word beginning with ZORB. Each cell
ran twice and both runs agreed. Round 1 used a prompt that contradicted the
marker line and is discarded.

## Round 2 (results-20261121T230927Z)

| Cell | Family | Variant | Global instructions reached the child? | Login works? |
|---|---|---|---|---|
| 1 | codex | as shipped | yes (`FOUND ZORBLAX-344`) | yes |
| 2 | codex | `--ignore-user-config` | yes (`FOUND ZORBLAX-344`) | yes |
| 3 | codex | `CODEX_HOME=<empty dir>` | n/a | no (exit 1) |
| 4 | codex | both | n/a | no (exit 1) |
| 8 | codex | `CODEX_HOME=<dir with auth.json only>` (extra cell) | no (`FOUND ZORB`: echoed the prompt's letters, could not give the word) | yes |
| 5 | claude | as shipped | yes | yes |
| 6 | claude | `--setting-sources project` | yes (`FOUND ZORBLAX-344`, `num_turns: 1`) | yes |
| 7 | claude | `--setting-sources project --strict-mcp-config` | yes (`num_turns: 1`) | yes |

Notes:
- Cell 8 used about 3,100 fewer input tokens than cell 1 (15,878 against
  18,999), consistent with the user config and AGENTS.md not loading.
- Cell 8 printed: `WARNING: proceeding, even though we could not create PATH
  aliases: Refusing to create helper binaries under temporary dir`. A scratch
  CODEX_HOME must not live under the OS temp directory.
- Cell 8 copies `auth.json`. If the CLI refreshed its token during a run the
  new token would be written to the copy, so a shipped variant that copies
  the login carries a stale-login risk on every settle.
- `--ignore-user-config` is present in codex-cli 0.156.1 `--help` ("Do not
  load `$CODEX_HOME/config.toml`; auth still uses `CODEX_HOME`"); the
  operator's handoff expected 0.162.1 or later.
- Whether `--strict-mcp-config` keeps the operator's MCP servers out of the
  claude child was not measured: the marker only tests instruction files.

## Round 3 (results-20261121T235913Z)

Codex only, no login copies. Each cell ran twice; both runs agreed, and all
six replies were `PROBE-OK` / `FOUND ZORBLAX-344`.

| Cell | Variant | Global AGENTS.md reached the child? | Login works? | Input tokens (a / b) |
|---|---|---|---|---|
| 1 | as shipped (control) | yes | yes | 20,762 / 20,110 |
| 9 | `--ignore-user-config -c project_doc_max_bytes=0` | yes | yes | 18,832 / 18,832 |
| 10 | `-c project_doc_max_bytes=0` alone | yes | yes | 19,943 / 19,943 |

A config override does not keep the global `AGENTS.md` out. `--ignore-user-config`
still does something: about 1,300 to 1,900 fewer input tokens than the
control, consistent with `config.toml` (MCP servers, plugins) not loading.

## Round 4 (results-20261122T002306Z)

Claude only, three calls, no login copies. MCP servers, tools and plugins are
read from the CLI's own init record (`--output-format stream-json --verbose`),
not from a model reply. The hook column is a temporary user-level
`SessionStart` hook in `~/.claude/settings.json` that creates a marker file.
Server and plugin names stay on the operator's machine; counts only here.

| Cell | Variant | Login works? | User-level hook fired? | MCP servers | Tools | Plugins |
|---|---|---|---|---|---|---|
| 5 | as shipped | yes | yes | 24 (19 from plugins, 5 claude.ai connectors) | 119 | 14 |
| 6 | `--setting-sources project` | yes | no | 5 (the claude.ai connectors) | 92 | 4 |
| 7 | `--setting-sources project --strict-mcp-config` | yes | no | 0 | 25 | 4 |

`--setting-sources project` stops the user-level hook, the user's installed
plugins (14 to 4; the 4 left are built in) and the MCP servers those plugins
bring. `--strict-mcp-config` on top removes the remaining account-level
connectors, leaving no MCP server and 25 tools. Neither keeps the global
`CLAUDE.md` out (round 2).

## Conclusions

- **codex.** Only a `CODEX_HOME` that holds nothing but the login keeps the
  global `AGENTS.md` out, and it means copying `auth.json`. An empty
  `CODEX_HOME` breaks the login. `--ignore-user-config` keeps `config.toml`
  out and leaves the global `AGENTS.md` in.
- **claude.** `--setting-sources project --strict-mcp-config` keeps the
  login, stops user-level hooks, drops the user's plugins and every MCP
  server (24 to 0), and cuts the tool list from 119 to 25. It does not keep
  the global `CLAUDE.md` out.
- **Operator decisions, 2026-11-21/22.** codex ships `--ignore-user-config`
  alone with the `AGENTS.md` residual documented (the handoff's stated
  fallback; no login copying). claude ships both flags with the `CLAUDE.md`
  residual documented.
- The verifier child runs in the project directory, so project-level
  instruction files and hooks still apply to it (rec-20260916-004); out of
  scope for phase 344.
