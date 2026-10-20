// Process-shape fixture for the checkpoint sensor tests (phase 331-02).
//
// Reads stdin to the end, writes its parent PID (process.ppid) to the side
// file named by argv[2] (never to stdout), prints a fixed short stdout text,
// and exits with optional argv[3] (default 0).
'use strict';

const { writeFileSync } = require('node:fs');

process.stdin.resume();
process.stdin.on('data', () => undefined);
process.stdin.on('end', () => {
  writeFileSync(process.argv[2], String(process.ppid));
  process.stdout.write('ppid-fixture-output');
  const code = Number.parseInt(process.argv[3] ?? '0', 10);
  process.exitCode = Number.isFinite(code) ? code : 0;
});
