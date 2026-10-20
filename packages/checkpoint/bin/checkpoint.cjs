#!/usr/bin/env node
var nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (Number.isFinite(nodeMajor) && nodeMajor < 22) {
  process.stderr.write(
    'checkpoint requires Node >=22 (you have ' + process.versions.node + '). Upgrade Node and retry.\n',
  );
  process.exit(1);
}
// Load the ESM entry in-process (no second Node process): process.argv stays
// [node, bin/checkpoint.cjs, ...args], so dist/cli.js's argv.slice(2) is unchanged.
import(
  require('node:url').pathToFileURL(require('node:path').join(__dirname, '..', 'dist', 'cli.js')).href
).catch(function (err) {
  // Reached by a missing or unresolvable dist/cli.js and by any error thrown
  // while it runs its top-level main(); keep the stack, as the old spawned
  // process printed it.
  process.stderr.write('checkpoint: dist/cli.js failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});
