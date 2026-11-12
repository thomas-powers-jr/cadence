import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runTestCommand } from '../../src/verify/test-runner.js';

// Child commands are small node scripts written to a temp dir and run as
// `node "<file>"`, so no test depends on per-shell quoting rules (sh vs
// cmd.exe) for the script body.
const scriptDir = mkdtempSync(path.join(tmpdir(), 'cadence-test-runner-'));
let scriptSeq = 0;
function script(body: string): string {
  const file = path.join(scriptDir, `s${scriptSeq++}.cjs`);
  writeFileSync(file, body, 'utf8');
  return `node "${file}"`;
}

afterAll(() => {
  rmSync(scriptDir, { recursive: true, force: true });
});

const MAX_TAIL_BYTES = 8 * 1024;
const MAX_TAIL_LINES = 40;

function assertBounded(tail: string): void {
  expect(Buffer.byteLength(tail, 'utf8')).toBeLessThanOrEqual(MAX_TAIL_BYTES);
  expect(tail.split('\n').length).toBeLessThanOrEqual(MAX_TAIL_LINES);
}

describe('runTestCommand', () => {
  it('reports ran:false, ok:true when no command is configured', async () => {
    const result = await runTestCommand(process.cwd(), undefined);
    expect(result).toEqual({ ran: false, ok: true });
  });

  it('reports ran:true, ok:true, exitCode:0 for a passing command', async () => {
    const result = await runTestCommand(process.cwd(), 'node -e "process.exit(0)"');
    expect(result.ran).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe('node -e "process.exit(0)"');
  });

  it('reports ran:true, ok:false, and the real exit code for a failing command', async () => {
    const result = await runTestCommand(process.cwd(), 'node -e "process.exit(7)"');
    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(7);
  });
});

describe('runTestCommand output tail (phase 346)', () => {
  it('346-01/AC-1: a failing run with output carries outputTail and keeps its exit code', async () => {
    const cmd = script(
      `process.stdout.write('one\\ntwo\\n'); process.stderr.write('FAIL three\\n'); process.exitCode = 3;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.command).toBe(cmd);
    expect(result.outputTail).toBeDefined();
    expect(result.outputTail).toContain('one');
    expect(result.outputTail).toContain('two');
    expect(result.outputTail).toContain('FAIL three');
  });

  it('346-01/AC-1: a passing run with output is ok:true and has no outputTail key', async () => {
    const cmd = script(`process.stdout.write('all good\\n'); process.stderr.write('warn\\n');`);
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result).toEqual({ ran: true, ok: true, exitCode: 0, command: cmd });
    expect('outputTail' in result).toBe(false);
  });

  it('346-01/AC-1: a failing run with well over 1 MiB of output stays ok:false and keeps a bounded tail ending in the last line', async () => {
    const cmd = script(
      `const line = 'x'.repeat(100);
       let s = '';
       for (let i = 0; i < 25000; i++) s += 'line ' + i + ' ' + line + '\\n';
       s += 'END-MARKER\\n';
       process.stdout.write(s);
       process.exitCode = 4;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(4);
    const tail = result.outputTail ?? '';
    assertBounded(tail);
    expect(tail.endsWith('END-MARKER')).toBe(true);
    expect(tail).toContain('line 24999 ');
    expect(tail).not.toContain('line 0 ');
  });

  it('346-01/AC-1: a passing run with well over 1 MiB of output stays ok:true with no outputTail', async () => {
    const cmd = script(
      `const line = 'y'.repeat(100);
       let s = '';
       for (let i = 0; i < 25000; i++) s += 'line ' + i + ' ' + line + '\\n';
       process.stdout.write(s);
       process.stderr.write(s);`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result).toEqual({ ran: true, ok: true, exitCode: 0, command: cmd });
  });

  it('346-01/AC-1: the tail keeps at most the last 40 lines', async () => {
    const cmd = script(
      `for (let i = 0; i < 100; i++) process.stdout.write('row ' + i + '\\n'); process.exitCode = 2;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.ok).toBe(false);
    const lines = (result.outputTail ?? '').split('\n');
    expect(lines).toHaveLength(40);
    expect(lines[0]).toBe('row 60');
    expect(lines[39]).toBe('row 99');
  });

  it('346-01/AC-1: one huge single line without a newline is bounded to its last 8 KiB', async () => {
    const cmd = script(
      `process.stdout.write('A'.repeat(5 * 1024 * 1024 - 3) + 'END'); process.exitCode = 1;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    const tail = result.outputTail ?? '';
    expect(Buffer.byteLength(tail, 'utf8')).toBe(MAX_TAIL_BYTES);
    expect(tail.endsWith('END')).toBe(true);
    expect(tail).not.toContain('\n');
  });

  it('346-01/AC-1: one huge single line on a passing run is still ok:true with no outputTail', async () => {
    const cmd = script(`process.stdout.write('B'.repeat(5 * 1024 * 1024));`);
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result).toEqual({ ran: true, ok: true, exitCode: 0, command: cmd });
  });

  it('346-01/AC-1: CRLF output leaves no carriage return in the tail', async () => {
    const cmd = script(`process.stdout.write('alpha\\r\\nbeta\\r\\ngamma\\r\\n'); process.exitCode = 5;`);
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.exitCode).toBe(5);
    expect(result.outputTail).toBe('alpha\nbeta\ngamma');
  });

  it('346-01/AC-1: a final unterminated line is kept as a line', async () => {
    const cmd = script(`process.stdout.write('first\\nlast-no-newline'); process.exitCode = 1;`);
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.outputTail).toBe('first\nlast-no-newline');
  });

  it('346-01/AC-1: ANSI CSI and OSC hyperlink sequences are stripped', async () => {
    const cmd = script(
      `process.stdout.write('\\u001b[31mred\\u001b[39m\\n');
       process.stdout.write('\\u001b[2K\\u001b[1G  \\u001b[1;32mok\\u001b[0m\\n');
       process.stdout.write('\\u001b]8;;https://example.invalid\\u0007link\\u001b]8;;\\u0007\\n');
       process.exitCode = 1;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.outputTail).toBe('red\n  ok\nlink');
    expect(result.outputTail).not.toContain('\u001b');
  });

  it('346-01/AC-1: stderr-only output is captured', async () => {
    const cmd = script(`process.stderr.write('only on stderr\\n'); process.exitCode = 6;`);
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.exitCode).toBe(6);
    expect(result.outputTail).toBe('only on stderr');
  });

  it('346-01/AC-1: a failing run with no output has no outputTail key (never an empty string)', async () => {
    const result = await runTestCommand(process.cwd(), 'node -e "process.exit(9)"');
    expect(result).toEqual({
      ran: true,
      ok: false,
      exitCode: 9,
      command: 'node -e "process.exit(9)"',
    });
    expect('outputTail' in result).toBe(false);
  });

  // `kill -9 $$` is POSIX-shell syntax; cmd.exe (the win32 shell) has no
  // equivalent self-signal, and Windows has no POSIX signal exit for the
  // shell process to report — the close event always carries a numeric code.
  it.skipIf(process.platform === 'win32')(
    '346-01/AC-1: a run killed by a signal is ok:false with exitCode 1',
    async () => {
      const result = await runTestCommand(process.cwd(), 'echo before-kill; kill -9 $$');
      expect(result.ran).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.outputTail).toBe('before-kill');
    },
  );

  it('346-01/AC-1: a command that does not exist resolves ok:false rather than hanging or rejecting', async () => {
    const result = await runTestCommand(process.cwd(), 'definitely-not-a-command-346');
    expect(result.ran).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it('346-01/AC-1: a spawn error event (missing cwd) resolves ok:false with exitCode 1', async () => {
    const missing = path.join(scriptDir, 'does-not-exist-346');
    const result = await runTestCommand(missing, 'node -e "process.exit(0)"');
    expect(result).toEqual({
      ran: true,
      ok: false,
      exitCode: 1,
      command: 'node -e "process.exit(0)"',
    });
  });

  it('346-01/AC-1: a spawn that throws synchronously (NUL byte in the command) resolves ok:false with exitCode 1', async () => {
    const result = await runTestCommand(process.cwd(), 'node -e "0"\u0000');
    expect(result).toEqual({ ran: true, ok: false, exitCode: 1, command: 'node -e "0"\u0000' });
  });

  it('346-01/AC-1: two-byte and charset escapes are stripped, and trailing blank lines do not use up the line budget', async () => {
    const cmd = script(
      `const lines = [];
       for (let i = 1; i <= 40; i++) lines.push('row-' + i);
       process.stdout.write('\\x1bc\\x1b7\\x1b(B' + lines.join('\\n') + '\\n\\n\\n\\n');
       process.exitCode = 1;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.ok).toBe(false);
    expect(result.outputTail).not.toContain('\x1b');
    expect(result.outputTail?.split('\n')).toHaveLength(40);
    expect(result.outputTail?.startsWith('row-1')).toBe(true);
    expect(result.outputTail?.endsWith('row-40')).toBe(true);
  });

  it('346-01/AC-1: stdout and stderr chunks are kept in arrival order in one tail', async () => {
    const cmd = script(
      `const w = (ms) => new Promise((r) => setTimeout(r, ms));
       (async () => {
         process.stdout.write('A\\n'); await w(150);
         process.stderr.write('B\\n'); await w(150);
         process.stdout.write('C\\n'); process.exitCode = 1;
       })();`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.outputTail).toBe('A\nB\nC');
  });

  it('346-01/AC-1: secrets in the output are redacted before the tail is kept', async () => {
    const token = 'ghp_' + 'a'.repeat(36);
    const cmd = script(
      `process.stdout.write('token ${'$'}{${JSON.stringify(token)}}\\n'); process.stderr.write('API_KEY=supersecretvalue123\\n'); process.exitCode = 1;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.outputTail).toContain('[REDACTED]');
    expect(result.outputTail).not.toContain(token);
    expect(result.outputTail).not.toContain('supersecretvalue123');
    expect(result.outputTail).toContain('API_KEY=');
  });

  it('346-01/AC-1: a lone CR progress redraw and other control characters are removed from the tail', async () => {
    const cmd = script(
      `process.stdout.write('progress 1%\\rprogress 99%\\x07\\n'); process.exitCode = 1;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.outputTail).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
    expect(result.outputTail).toContain('progress 99%');
  });

  it('346-01/AC-1: a backgrounded grandchild still holding the output pipes does not hold the verdict: the run resolves on the shell\'s exit', async () => {
    const pidFile = path.join(scriptDir, `grandchild-${scriptSeq}.pid`);
    const cmd = script(
      `const { spawn } = require('node:child_process');
       const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { detached: true, stdio: 'inherit' });
       require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
       g.unref();
       process.stdout.write('parent-out-346\\n');
       process.exit(3);`,
    );
    const started = Date.now();
    try {
      const result = await runTestCommand(process.cwd(), cmd);
      // Far below the grandchild's 30 s life, with room for cold node starts on slow CI legs.
      expect(Date.now() - started).toBeLessThan(7000);
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(3);
      expect(result.outputTail).toContain('parent-out-346');
    } finally {
      try {
        process.kill(Number(readFileSync(pidFile, 'utf8')));
      } catch {
        // already gone
      }
    }
  });

  it('346-01/AC-1: stdin is not inherited — a child waiting for stdin end sees EOF at once', async () => {
    const cmd = script(
      `process.stdin.resume();
       process.stdin.on('end', () => { process.exit(0); });
       setTimeout(() => { process.exit(42); }, 4000);`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('346-01/AC-1: nothing the child prints reaches cadence\'s own stdout', async () => {
    const cmd = script(
      `process.stdout.write('CHILD-STDOUT-346\\n'); process.stderr.write('CHILD-STDERR-346\\n'); process.exitCode = 1;`,
    );
    const spy = vi.spyOn(process.stdout, 'write');
    try {
      const result = await runTestCommand(process.cwd(), cmd);
      expect(result.ok).toBe(false);
      expect(result.outputTail).toContain('CHILD-STDOUT-346');
      const written = spy.mock.calls.map((c) => String(c[0])).join('');
      expect(written).not.toContain('CHILD-STDOUT-346');
      expect(written).not.toContain('CHILD-STDERR-346');
    } finally {
      spy.mockRestore();
    }
  });

  it('346-01/AC-1: the command runs through a shell in the given cwd with the inherited env', async () => {
    const marker = `cadence-346-env-${process.pid}`;
    process.env['CADENCE_346_ENV_PROBE'] = marker;
    try {
      const cmd = script(
        `process.stdout.write(process.cwd() + '\\n' + process.env.CADENCE_346_ENV_PROBE + '\\n'); process.exitCode = 1;`,
      );
      const result = await runTestCommand(scriptDir, cmd);
      const [cwdLine, envLine] = (result.outputTail ?? '').split('\n');
      expect(realpathSync(cwdLine ?? '')).toBe(realpathSync(scriptDir));
      expect(envLine).toBe(marker);
    } finally {
      delete process.env['CADENCE_346_ENV_PROBE'];
    }
  });
});
