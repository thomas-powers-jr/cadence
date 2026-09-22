// scripts/checkpoint-probe/statusline-probe.cjs
// TEMPORARY — checkpoint Phase 0 (M2, M10). Removed in Task 0.6.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROBE_DIR = path.join(os.homedir(), '.cache', 'checkpoint-probe');
const LOG_PATH = path.join(PROBE_DIR, 'statusline.jsonl');

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
    payload = { parse_error: String(err), raw_length: raw.length };
  }
  payload.probe_ts = Date.now();

  fs.mkdirSync(PROBE_DIR, { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(payload) + os.EOL, 'utf8');

  // Keep rendering *something* in the statusline so the probe doesn't
  // blank out the operator's terminal for the whole interactive pass.
  process.stdout.write('checkpoint-probe active');
}

main();
