#!/usr/bin/env bash
# Phase 344 probe, round 3 (no product code, no login copies): does a Codex
# config override alone keep the global AGENTS.md out of the child?
# Run from a plain terminal (git bash on Windows), not inside a Claude Code
# or Codex session:
#
#   bash .cadence/phases/344-verifier-isolation/probe/run-probe-3.sh
#
# It appends one marker line to ~/.codex/AGENTS.md, runs Codex three ways
# twice each (6 short calls), saves the raw output, and restores the file
# exactly. It does not touch Claude's files and copies no credentials.
set -u
CANARY="ZORBLAX-344"
PROMPT='First reply PROBE-OK. Then, on a second line: if any instruction or memory you were given contains a word beginning with ZORB, write FOUND followed by that whole word; otherwise write NOT-FOUND. Do not use any tools.'
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/results-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
CODEX_AGENTS="$CODEX_DIR/AGENTS.md"
LINE="Probe marker for cadence phase 344 (safe to delete): the marker word is $CANARY."

restore() {
  if [ -f "$CODEX_AGENTS.probe344.bak" ]; then mv -f "$CODEX_AGENTS.probe344.bak" "$CODEX_AGENTS"
  elif [ -f "$CODEX_AGENTS.probe344.absent" ]; then rm -f "$CODEX_AGENTS" "$CODEX_AGENTS.probe344.absent"; fi
}
trap restore EXIT
mkdir -p "$CODEX_DIR"
if [ -f "$CODEX_AGENTS" ]; then cp -p "$CODEX_AGENTS" "$CODEX_AGENTS.probe344.bak"; else : > "$CODEX_AGENTS.probe344.absent"; fi
printf '\n%s\n' "$LINE" >> "$CODEX_AGENTS"

{
  echo "date: $(date -u +%FT%TZ)"
  echo "codex: $(codex --version 2>&1 | head -1)"
} > "$OUT/versions.txt" 2>&1

SUMMARY="$OUT/summary.tsv"
printf 'cell\tvariant\texit\tmarker_reached_child\treplied_PROBE-OK\tsaid_NOT-FOUND\tinput_tokens\n' > "$SUMMARY"

run() { # id variant -- command...
  local id="$1" variant="$2"; shift 3
  local f="$OUT/$id.txt"
  printf '%s' "$PROMPT" | "$@" > "$f" 2>&1
  local code=$?
  local marker=no ok=no nf=no tokens
  grep -q "$CANARY" "$f" && marker=yes
  grep -q "PROBE-OK" "$f" && ok=yes
  grep -q "NOT-FOUND" "$f" && nf=yes
  tokens="$(grep -o '"input_tokens":[0-9]*' "$f" | head -1 | cut -d: -f2)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$variant" "$code" "$marker" "$ok" "$nf" "${tokens:-?}" >> "$SUMMARY"
  echo "$id ($variant): exit $code, marker $marker, replied $ok, said NOT-FOUND $nf, input tokens ${tokens:-?}"
}

CX="exec --json --skip-git-repo-check"
for r in a b; do
  run "1$r"  "as shipped (control)"                                  -- codex $CX -
  run "9$r"  "--ignore-user-config -c project_doc_max_bytes=0"       -- codex $CX --ignore-user-config -c project_doc_max_bytes=0 -
  run "10$r" "-c project_doc_max_bytes=0 alone"                      -- codex $CX -c project_doc_max_bytes=0 -
done

restore; trap - EXIT
echo
echo "~/.codex/AGENTS.md restored. Results: $OUT"
echo
cat "$SUMMARY"
echo
echo "--- raw replies"
grep -h -o '"type":"agent_message","text":"[^"]*"' "$OUT"/*.txt
