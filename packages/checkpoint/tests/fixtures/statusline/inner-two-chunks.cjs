// Streaming fixture for the checkpoint sensor tests (phase 331-02).
//
// Reads stdin to the end, writes chunk 1, waits until the signal file named
// by argv[2] exists, then writes chunk 2 and exits with optional argv[3]
// (default 0).
'use strict';

const { existsSync } = require('node:fs');

process.stdin.resume();
process.stdin.on('data', () => undefined);
process.stdin.on('end', () => {
  process.stdout.write('first\n');
  const timer = setInterval(() => {
    if (!existsSync(process.argv[2])) return;
    clearInterval(timer);
    process.stdout.write('second');
    const code = Number.parseInt(process.argv[3] ?? '0', 10);
    process.exitCode = Number.isFinite(code) ? code : 0;
  }, 10);
});
