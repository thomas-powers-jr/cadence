const { spawn } = require('node:child_process');
const path = require('node:path');
const emitPath = path.join(__dirname, '317-01-probe-emit.js');
const child = spawn('powershell.exe', ['-NoProfile', '-Command', `node "${emitPath}"`], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
const chunks = [];
child.stdout.on('data', (c) => chunks.push(c));
child.on('exit', (code) => {
  const buf = Buffer.concat(chunks);
  console.log('exit code:', code);
  console.log('hex:', buf.toString('hex'));
  console.log('utf8:', buf.toString('utf8'));
  try {
    const parsed = JSON.parse(buf.toString('utf8'));
    console.log('parsed.reason:', parsed.reason, '=== original:', parsed.reason === 'a—b→c');
  } catch (e) {
    console.log('JSON.parse FAILED:', e.message);
  }
});
