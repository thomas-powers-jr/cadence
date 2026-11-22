#!/usr/bin/env bash
# Phase 344 probe, round 4 (no product code, no login copies): what do
# Claude's isolation flags actually drop? Measures three things per variant:
#   - the MCP servers, tools and plugins the child starts with (read from the
#     CLI's own init record, not from a model reply),
#   - whether a user-level SessionStart hook fires in the child,
#   - whether login still works.
# Run from a plain terminal (git bash on Windows), not inside a Claude Code
# or Codex session:
#
#   bash .cadence/phases/344-verifier-isolation/probe/run-probe-4.sh
#
# It adds one temporary SessionStart hook to ~/.claude/settings.json (the
# hook only creates an empty marker file in the results folder), makes three
# short Claude calls, and restores settings.json exactly. Needs node on PATH.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/results-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT"
SETTINGS="$HOME/.claude/settings.json"
MARK="$OUT/hook-fired"
# The hook runs under node, which on Windows needs a C:/ path, not git bash's /c/ form.
MARK_NODE="$MARK"; command -v cygpath >/dev/null 2>&1 && MARK_NODE="$(cygpath -m "$MARK")"

restore() {
  if [ -f "$SETTINGS.probe344.bak" ]; then mv -f "$SETTINGS.probe344.bak" "$SETTINGS"
  elif [ -f "$SETTINGS.probe344.absent" ]; then rm -f "$SETTINGS" "$SETTINGS.probe344.absent"; fi
}
trap restore EXIT
mkdir -p "$HOME/.claude"
if [ -f "$SETTINGS" ]; then cp -p "$SETTINGS" "$SETTINGS.probe344.bak"; else : > "$SETTINGS.probe344.absent"; fi

# Add the hook with node so the JSON stays valid; on any error leave the file as it was.
SETTINGS_PATH="$SETTINGS" MARK_PATH="$MARK_NODE" node -e '
const fs = require("fs");
const p = process.env.SETTINGS_PATH;
let j = {};
try { const t = fs.readFileSync(p, "utf8"); if (t.trim()) j = JSON.parse(t); } catch (e) {
  if (e.code !== "ENOENT") { console.error("probe: could not parse settings.json; not adding the hook: " + e.message); process.exit(3); }
}
const mark = process.env.MARK_PATH.replace(/\\/g, "/");
const cmd = "node -e \"require(\x27fs\x27).writeFileSync(\x27" + mark + "\x27,\x27\x27)\"";
j.hooks = j.hooks || {};
j.hooks.SessionStart = (j.hooks.SessionStart || []).concat([{ hooks: [{ type: "command", command: cmd }] }]);
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
'
HOOK_ADDED=$?
[ "$HOOK_ADDED" -ne 0 ] && echo "note: the temporary hook was not added (see above); the hook column will read n/a"

echo "claude: $(claude --version 2>&1 | head -1)" > "$OUT/versions.txt"
SUMMARY="$OUT/summary.tsv"
printf 'cell\tvariant\texit\tlogin_ok\tuser_hook_fired\tmcp_servers\ttools\tplugins\n' > "$SUMMARY"

run() { # id variant -- extra claude flags...
  local id="$1" variant="$2"; shift 3
  local f="$OUT/$id.jsonl"
  rm -f "$MARK"
  printf '%s' 'Reply with the text PROBE-OK.' | claude -p --output-format stream-json --verbose "$@" > "$f" 2>"$OUT/$id.stderr.txt"
  local code=$?
  local hook=no login=no
  if [ "$HOOK_ADDED" -ne 0 ]; then hook="n/a"; elif [ -f "$MARK" ]; then hook=yes; fi
  grep -q 'PROBE-OK' "$f" && login=yes
  local facts
  facts="$(FILE="$f" node -e '
const fs = require("fs");
let init = null;
for (const line of fs.readFileSync(process.env.FILE, "utf8").split(/\r?\n/)) {
  try { const o = JSON.parse(line); if (o.type === "system" && o.subtype === "init") { init = o; break; } } catch {}
}
if (!init) { console.log("?\t?\t?"); process.exit(0); }
const names = (a) => Array.isArray(a) ? a.map((x) => typeof x === "string" ? x : (x.name ?? "?") + (x.status ? "(" + x.status + ")" : "")) : [];
const mcp = names(init.mcp_servers), plugins = names(init.plugins);
const tools = Array.isArray(init.tools) ? init.tools.length : "?";
console.log([mcp.length + (mcp.length ? ": " + mcp.join(", ") : ""), tools, plugins.length + (plugins.length ? ": " + plugins.join(", ") : "")].join("\t"));
' 2>/dev/null)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$variant" "$code" "$login" "$hook" "${facts:-?	?	?}" >> "$SUMMARY"
}

run 5 "as shipped"                                         --
run 6 "--setting-sources project"                          -- --setting-sources project
run 7 "--setting-sources project --strict-mcp-config"      -- --setting-sources project --strict-mcp-config

restore; trap - EXIT
rm -f "$MARK"
echo
echo "~/.claude/settings.json restored. Results: $OUT"
echo
cat "$SUMMARY"
