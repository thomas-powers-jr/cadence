// Inner statusline fixture for the checkpoint sensor tests (phase 331).
//
// Its stdout deliberately carries everything a lossy pass-through would
// mangle: UTF-8 non-ASCII text, ANSI SGR escape sequences, LF-only line
// endings, and no trailing newline. It echoes `model.display_name` from the
// stdin payload so the tests prove the wrapper forwards stdin. Optional
// argv[2] is the exit code to finish with (default 0).
'use strict';

const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  let name = '?';
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (payload && payload.model && typeof payload.model.display_name === 'string') {
      name = payload.model.display_name;
    }
  } catch {
    // Not JSON: still print the statusline, with a placeholder name.
  }
  const text =
    '\u001b[32m✓ Ünïcødé — 日本\u001b[0m\n' +
    '\u001b[1;34mmodel:\u001b[0m ' +
    name +
    '\nctx';
  process.stdout.write(Buffer.from(text, 'utf8'));
  const code = Number.parseInt(process.argv[2] ?? '0', 10);
  process.exitCode = Number.isFinite(code) ? code : 0;
});
