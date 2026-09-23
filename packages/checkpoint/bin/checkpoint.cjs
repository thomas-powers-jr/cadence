#!/usr/bin/env node
var nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (Number.isFinite(nodeMajor) && nodeMajor < 22) {
  process.stderr.write(
    'checkpoint requires Node >=22 (you have ' + process.versions.node + '). Upgrade Node and retry.\n',
  );
  process.exit(1);
}
require('node:child_process')
  .spawn(process.execPath, [require('node:path').join(__dirname, '..', 'dist', 'cli.js'), ...process.argv.slice(2)], { stdio: 'inherit' })
  .on('exit', (code) => process.exit(code ?? 0));
