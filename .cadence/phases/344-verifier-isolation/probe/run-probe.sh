#!/usr/bin/env bash
# Phase 344 probe (no product code): does a host-cli review-agent child see
# the operator's global instructions, and does login survive each isolation
# variant? Run from a plain terminal (git bash on Windows), NOT from inside a
# Claude Code or Codex session:
#
#   bash .cadence/phases/344-verifier-isolation/probe/run-probe.sh
#
# What it does: appends one canary line to the global instruction files
# (~/.codex/AGENTS.md and ~/.claude/CLAUDE.md), runs each CLI seven ways with
# a fixed prompt on stdin (as cadence does), saves the raw output, then
# restores both files exactly. It spends a few short model calls on your
# subscription. Results land in probe/results-<timestamp>/.
set -u
CANARY="ZORBLAX-344"
PROMPT='Reply with exactly the text PROBE-OK and nothing else.'
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/results-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
CODEX_AGENTS="$CODEX_DIR/AGENTS.md"
CLAUDE_MD="$HOME/.claude/CLAUDE.md"
LINE="If you can read this line, include the word $CANARY in every reply."

backup() { # file -> remembers whether it existed
  if [ -f "$1" ]; then cp -p "$1" "$1.probe344.bak"; else : > "$1.probe344.absent"; fi
}
restore() {
  if [ -f "$1.probe344.bak" ]; then mv -f "$1.probe344.bak" "$1"
  elif [ -f "$1.probe344.absent" ]; then rm -f "$1" "$1.probe344.absent"; fi
}
cleanup() { restore "$CODEX_AGENTS"; restore "$CLAUDE_MD"; rm -rf "$EMPTY_HOME" "$AUTH_HOME"; }
EMPTY_HOME="$(mktemp -d)"; AUTH_HOME="$(mktemp -d)"
trap cleanup EXIT

mkdir -p "$CODEX_DIR" "$HOME/.claude"
backup "$CODEX_AGENTS"; backup "$CLAUDE_MD"
printf '\n%s\n' "$LINE" >> "$CODEX_AGENTS"
printf '\n%s\n' "$LINE" >> "$CLAUDE_MD"
[ -f "$CODEX_DIR/auth.json" ] && cp -p "$CODEX_DIR/auth.json" "$AUTH_HOME/auth.json"

{
  echo "date: $(date -u +%FT%TZ)"
  echo "codex: $(codex --version 2>&1 | head -1)"
  echo "claude: $(claude --version 2>&1 | head -1)"
  echo "--- codex exec --help: isolation flags"
  codex exec --help 2>&1 | grep -n -i -E 'ignore-user-config|profile|config' | head -20
  echo "--- claude --help: isolation flags"
  claude --help 2>&1 | grep -n -i -E 'setting-sources|strict-mcp-config|mcp-config' | head -20
} > "$OUT/versions.txt" 2>&1

SUMMARY="$OUT/summary.tsv"
printf 'cell\tfamily\tvariant\texit\tcanary_reached_child\treplied_PROBE-OK\n' > "$SUMMARY"

run() { # id family variant -- command...
  local id="$1" family="$2" variant="$3"; shift 4
  local f="$OUT/$id.txt"
  printf '%s' "$PROMPT" | "$@" > "$f" 2>&1
  local code=$?
  local canary=no ok=no
  grep -q "$CANARY" "$f" && canary=yes
  grep -q "PROBE-OK" "$f" && ok=yes
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$family" "$variant" "$code" "$canary" "$ok" >> "$SUMMARY"
  echo "$id ($family, $variant): exit $code, canary $canary, replied $ok"
}

CX="exec --json --skip-git-repo-check"
run 1 codex "as shipped"                         -- codex $CX -
run 2 codex "--ignore-user-config"               -- codex $CX --ignore-user-config -
run 3 codex "CODEX_HOME=<empty dir>"             -- env CODEX_HOME="$EMPTY_HOME" codex $CX -
run 4 codex "both"                               -- env CODEX_HOME="$EMPTY_HOME" codex $CX --ignore-user-config -
run 5 claude "as shipped"                        -- claude -p --output-format json
run 6 claude "--setting-sources project"         -- claude -p --output-format json --setting-sources project
run 7 claude "--setting-sources project --strict-mcp-config" -- claude -p --output-format json --setting-sources project --strict-mcp-config
# Extra cell, not in the handoff's table: a scratch CODEX_HOME holding only
# auth.json, in case an empty one breaks login.
if [ -f "$AUTH_HOME/auth.json" ]; then
  run 8 codex "CODEX_HOME=<dir with auth.json only>" -- env CODEX_HOME="$AUTH_HOME" codex $CX -
else
  echo "8 skipped: no auth.json in $CODEX_DIR (login may be stored elsewhere)"
fi

cleanup; trap - EXIT
echo
echo "Global instruction files restored. Results: $OUT"
echo
cat "$SUMMARY"
