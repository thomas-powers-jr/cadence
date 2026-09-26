// Reproduces 317-01-red-state-capture.md's full-chain result. Requires:
//   1. A scratch project with `cadence init` run in it.
//   2. `cadence-host-claude-code install --local --cwd <scratch>` run against it,
//      and CAPTURED_COMMAND below replaced with the real command read back out
//      of <scratch>/.claude/settings.json (paths are machine-absolute and will
//      differ on another checkout).
//   3. <scratch>/.cadence/config.json's `hooks.preToolUseBuildGate` set to `true`.
import { spawn } from 'node:child_process';

const CAPTURED_COMMAND =
  'node C:\\Users\\softw\\projects\\cadence\\.claude\\worktrees\\hook-json-block\\packages\\host-claude-code\\dist\\cli.js hook --cadence "node C:\\Users\\softw\\projects\\cadence\\.claude\\worktrees\\hook-json-block\\packages\\core\\dist\\cli\\index.js"';

const cwd = process.argv[2];
if (!cwd) {
  console.error('usage: node 317-01-probe-ac4-redstate.mjs <path-to-scratch-project>');
  process.exit(1);
}

const stdinPayload = JSON.stringify({
  hook_event_name: 'PreToolUse',
  tool_name: 'Write',
  tool_input: { file_path: `${cwd}\\some-file.ts`, content: 'x' },
  cwd,
  session_id: 'probe-session',
});

const child = spawn('powershell.exe', ['-NoProfile', '-Command', CAPTURED_COMMAND], {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdout = Buffer.alloc(0);
let stderr = '';
child.stdout.on('data', (c) => { stdout = Buffer.concat([stdout, c]); });
child.stderr.on('data', (c) => { stderr += c.toString(); });
child.on('exit', (code) => {
  console.log('=== AC-4 red-state probe (today\'s unmodified exit-code transport) ===');
  console.log('observed exit code:', code);
  console.log('stdout (should be empty on old transport):', JSON.stringify(stdout.toString('utf8')));
  console.log('stderr (blockMessage expected here):', JSON.stringify(stderr));
});
child.stdin.write(stdinPayload);
child.stdin.end();
