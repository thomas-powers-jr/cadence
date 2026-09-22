// scripts/checkpoint-probe/hook-probe.cjs
// TEMPORARY — checkpoint Phase 0 (M3, M4, M5, M6, M10). Removed in Task 0.6.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROBE_DIR = path.join(os.homedir(), '.cache', 'checkpoint-probe');
const LOG_PATH = path.join(PROBE_DIR, 'hooks.jsonl');

function main() {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    raw = '';
  }

  let payload;
  try {
    payload = raw.length > 0 ? JSON.parse(raw) : {};
  } catch (err) {
    payload = { hook_event_name: 'UNPARSEABLE', parse_error: String(err), raw_length: raw.length };
  }

  payload.probe_ts = Date.now();

  fs.mkdirSync(PROBE_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(payload) + os.EOL, 'utf8');

  // Never block the real event: exit 0, no stdout (stdout is a hook-response
  // channel for some events — emitting nothing keeps this a pure observer).
  process.exit(0);
}

main();
