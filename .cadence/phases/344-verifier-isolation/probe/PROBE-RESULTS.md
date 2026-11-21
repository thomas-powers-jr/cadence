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

## Round 3

Pending: `run-probe-3.sh` (Codex config override, no login copies).
