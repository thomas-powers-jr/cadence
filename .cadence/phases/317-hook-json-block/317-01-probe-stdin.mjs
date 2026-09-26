import { spawn } from 'node:child_process';

const child = spawn('powershell.exe', ['-NoProfile', '-Command', 'node -e "process.stdin.pipe(process.stdout)"'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
const chunks = [];
child.stdout.on('data', (c) => chunks.push(c));
child.on('exit', (code) => {
  const buf = Buffer.concat(chunks);
  console.log('exit code:', code);
  console.log('stdout received:', JSON.stringify(buf.toString('utf8')));
});
child.stdin.write(JSON.stringify({ hook_event_name: 'Stop', probe: true }));
child.stdin.end();
