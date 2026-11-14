import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { redactCommand, runTestCommand } from '../../src/verify/test-runner.js';

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

  it('346-01/AC-1: two-byte and charset escapes are stripped, and the tail is the last 40 lines printed, with blank lines at its end trimmed inside that window', async () => {
    const cmd = script(
      `const lines = [];
       for (let i = 1; i <= 40; i++) lines.push('row-' + i);
       lines[39] = '\\x1bc\\x1b7\\x1b(B' + lines[39];
       process.stdout.write(lines.join('\\n') + '\\n\\n\\n\\n');
       process.exitCode = 1;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.ok).toBe(false);
    expect(result.outputTail).not.toContain('\x1b');
    // 40 rows then 3 blank lines: the last 40 lines are row-4..row-40 and the
    // blanks; the blanks are trimmed, never replaced by older rows.
    expect(result.outputTail?.split('\n')).toHaveLength(37);
    expect(result.outputTail?.startsWith('row-4\n')).toBe(true);
    expect(result.outputTail?.endsWith('\nrow-40')).toBe(true);
  });

  it('346-01/AC-1: ST-terminated OSC, an ESC inside an OSC that opens a new sequence, and DCS/APC payloads are all stripped', async () => {
    const cmd = script(
      `process.stdout.write('\\x1b]8;;u\\x1b\\\\link\\x1b]0;t\\x1b[31mred\\n');
       process.stdout.write('\\x1bPtmux;payload\\x1b\\\\dcs\\x1b_Gkitty=1\\x1b\\\\apc\\n');
       process.exitCode = 1;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.outputTail).toBe('linkred\ndcsapc');
  });

  it('346-01/AC-1: a stray unterminated OSC ends at the next line, so later output survives', async () => {
    const cmd = script(
      `process.stdout.write('a\\n\\x1b]8;;x\\nlater\\n'); process.exitCode = 1;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.outputTail).toBe('a\n\nlater');
  });

  it('346-01/AC-1: an OSC payload longer than the capture ring never leaks into the tail', async () => {
    const cmd = script(
      `process.stdout.write('before\\n');
       process.stdout.write('\\x1b]8;;https://example.invalid/' + 'P'.repeat(200000) + '\\x07after\\n');
       process.exitCode = 1;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.outputTail).toBe('before\nafter');
  });

  it('346-01/AC-1: a sequence left open when the output ends is dropped whole', async () => {
    const cmd = script(
      `process.stdout.write('visible\\n\\x1b]8;;https://example.invalid/open-payload'); process.exitCode = 1;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.outputTail).toBe('visible');
  });

  it('346-01/AC-1: a sequence split across chunks of one pipe is stripped even when the other pipe writes in between, and 8-bit CSI is stripped', async () => {
    const cmd = script(
      `const w = (ms) => new Promise((r) => setTimeout(r, ms));
       (async () => {
         process.stdout.write('\\x1b[3'); await w(150);
         process.stderr.write('between\\n'); await w(150);
         process.stdout.write('1mred\\x1b[0m\\n\\u009b32mgreen\\n'); process.exitCode = 1;
       })();`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.outputTail).toBe('between\nred\ngreen');
  });

  it('346-01/AC-1: blank lines at the end of long output do not pull older lines into the 40-line window', async () => {
    const cmd = script(
      `const lines = [];
       for (let i = 1; i <= 50; i++) lines.push('row-' + i);
       process.stdout.write(lines.join('\\n') + '\\n\\n\\n\\n\\n\\n');
       process.exitCode = 1;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    const tail = result.outputTail?.split('\n') ?? [];
    expect(tail[0]).toBe('row-16');
    expect(tail).toHaveLength(35);
    expect(tail[tail.length - 1]).toBe('row-50');
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

describe('redactCommand (phase 346)', () => {
  const cases: Array<[string, string, string]> = [
    ['a URL with userinfo', 'DATABASE_URL=postgres://user:secret@host/db pnpm test', 'secret'],
    ['a bare URL with userinfo', 'pnpm test --db postgres://admin:pw123@db.internal/x', 'pw123'],
    ['an assignment whose name looks like no secret', 'PGPASSWORD=hunter22 pnpm test', 'hunter22'],
    ['a short value', 'MYSQL_PWD=abc make test', 'abc'],
    ['a quoted value', 'API_KEY="s3cr3t value" pnpm test', 's3cr3t'],
    ['an npm auth token', 'npm_config__authToken=abcdef123 pnpm t', 'abcdef123'],
    ['a chained assignment', 'cd app && TOKEN=zzz9 pnpm test', 'zzz9'],
    ['a space-separated password flag', 'pnpm test --password hunter22', 'hunter22'],
    ['an equals password flag', 'pnpm test --db-password=hunter22', 'hunter22'],
    ['a token flag', 'jest --auth-token abcd', 'abcd'],
    ['a GitHub token anywhere', 'pnpm test ghp_' + 'a'.repeat(36), 'ghp_'],
  ];
  for (const [name, command, secret] of cases) {
    it(`346-01/AC-3: redacts ${name}`, () => {
      const out = redactCommand(command);
      expect(out).not.toContain(secret);
      expect(out).toContain('[REDACTED]');
    });
  }

  it('346-01/AC-3: keeps a command with no credentials unchanged, so the reason still names it', () => {
    for (const cmd of ['pnpm test', 'pnpm turbo run test --filter=core', 'node "C:\\x\\run.js" --reporter verbose', 'make -j4 test']) {
      expect(redactCommand(cmd)).toBe(cmd);
    }
  });

  it('346-01/AC-3: keeps the variable name and the program visible, and is idempotent', () => {
    const once = redactCommand('DATABASE_URL=postgres://u:p@h/db NODE_ENV=test pnpm test');
    expect(once).toBe('DATABASE_URL=[REDACTED] NODE_ENV=[REDACTED] pnpm test');
    expect(redactCommand(once)).toBe(once);
  });
});

describe('runTestCommand output redaction (phase 346)', () => {
  it('346-01/AC-1: URL userinfo and env-dump lines in the output are redacted in the tail', async () => {
    const cmd = script(
      `process.stderr.write('connect failed: postgres://admin:pw-in-url-9@db.internal:5432/app\\n');
       process.stdout.write('PGPASSWORD=env-dump-secret\\nexpected 3 to be 4\\n');
       process.exitCode = 1;`,
    );
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.outputTail).not.toContain('pw-in-url-9');
    expect(result.outputTail).not.toContain('env-dump-secret');
    expect(result.outputTail).toContain('postgres://[REDACTED]@db.internal:5432/app');
    expect(result.outputTail).toContain('PGPASSWORD=[REDACTED]');
    expect(result.outputTail).toContain('expected 3 to be 4');
  });
});


describe('phase 346 redaction hardening', () => {
  it('346-01/AC-3: quoted assignments (Windows set, cross-env, env -S) are redacted in the command', async () => {
    const { redactCommand: rc } = await import('../../src/verify/test-runner.js');
    for (const cmd of ['set "PGPASSWORD=hunter2" && pnpm test', 'cross-env "PGPASSWORD=hunter2" vitest', 'env -S "PGPASSWORD=hunter2 vitest"']) {
      expect(rc(cmd)).not.toContain('hunter2');
    }
    expect(rc('set "PGPASSWORD=hunter2" && pnpm test')).toBe('set "PGPASSWORD=[REDACTED]" && pnpm test');
  });

  it('346-01/AC-3: ordinary flags are left alone, credential flags and curl -u are redacted', async () => {
    const { redactCommand: rc } = await import('../../src/verify/test-runner.js');
    for (const cmd of ['vitest run --passWithNoTests src/foo', 'tool --keyword foo --monkey bar --author me --bypass x', 'node --max-old-space-size=4096 run.js']) {
      expect(rc(cmd)).toBe(cmd);
    }
    expect(rc('pnpm test --api-key abcd1234')).toBe('pnpm test --api-key [REDACTED]');
    expect(rc('curl -u admin:hunter2 http://x')).toBe('curl -u [REDACTED] [REDACTED]');
    expect(rc('pnpm test --db postgres://u:p@ss@host/db')).toBe('pnpm test --db postgres://[REDACTED]@host/db');
  });

  it('346-01/AC-1: secrets echoed mid-line, in JSON keys, or from the inherited environment are redacted in the output', async () => {
    const { redactOutput: ro, secretValues: sv } = await import('../../src/verify/test-runner.js');
    const literals = sv('MYSQL_PWD=cmd-secret-1 vitest', { MY_SERVICE_TOKEN: 'env-secret-value-42', GIT_ASKPASS: 'echo', SSH_AUTH_SOCK: '/tmp/agent.sock' });
    const out = ro(
      [
        'npm error command sh -c PGPASSWORD=hunter2 vitest run',
        '> MYSQL_PWD=cmd-secret-1 vitest',
        '  { "password": "hunter2xyz", "user": "me" }',
        'got header x-svc: env-secret-value-42 from echo /tmp/agent.sock',
      ].join('\n'),
      literals,
    );
    for (const secret of ['hunter2', 'cmd-secret-1', 'hunter2xyz', 'env-secret-value-42']) expect(out).not.toContain(secret);
    expect(out).toContain('"user": "me"');
    expect(out).toContain('from echo /tmp/agent.sock');
    expect(ro(out, literals)).toBe(out);
  });

  it('346-01/AC-1: a URL-userinfo scan over a long dotted single line stays fast', async () => {
    const { redactOutput: ro, redactCommand: rc } = await import('../../src/verify/test-runner.js');
    const started = Date.now();
    // 4x the ring size: linear scans take tens of ms, a quadratic one tens of
    // seconds (7 s measured for the uncapped URL pattern), so a 3 s bound separates
    // them on any machine under load.
    ro('a.'.repeat(131072));
    ro('a-'.repeat(131072));
    rc(' -' + 'key'.repeat(80000));
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('346-01/AC-1: bidi and zero-width format characters are stripped from the tail', async () => {
    const cmd = script(`process.stdout.write('safe\\u202Eevil\\u200Bx\\n'); process.exitCode = 1;`);
    const result = await runTestCommand(process.cwd(), cmd);
    expect(result.outputTail).toBe('safeevilx');
  });
});

describe('phase 346 redaction does not over-redact', () => {
  it('346-01/AC-3: a short or common assignment value is never erased from the rest of the command or the output', async () => {
    const { redactCommand: rc, redactOutput: ro, secretValues: sv } = await import('../../src/verify/test-runner.js');
    const literals = sv('DISABLE_AUTH=true TOKEN=test pnpm test', {});
    expect(literals).toEqual([]);
    expect(rc('TOKEN=test pnpm test', literals)).toBe('TOKEN=[REDACTED] pnpm test');
    expect(ro('AssertionError: expected true to be false', literals)).toBe('AssertionError: expected true to be false');
  });

  it('346-01/AC-1: ESM stack frames and scoped-package URLs keep their paths, while a password with a slash is still redacted', async () => {
    const { redactOutput: ro } = await import('../../src/verify/test-runner.js');
    const frame = 'at file:///home/u/p/node_modules/.pnpm/@vitest+runner@2.1.8/node_modules/@vitest/runner/dist/index.js:146:14';
    expect(ro(frame)).toBe(frame);
    expect(ro('GET https://registry.npmjs.org/@types/node 404')).toBe('GET https://registry.npmjs.org/@types/node 404');
    expect(ro('postgres://u:pa/ss@host/db')).toBe('postgres://[REDACTED]@host/db');
    const started = Date.now();
    // 4x the ring size (see the test above for why the bound is 3 s).
    ro(':a://'.repeat(52428));
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe('phase 346 redaction: shapes from the third Codex review', () => {
  it('346-01/AC-1: a credential flag echoed in the output is redacted, by pattern and as a literal from the command', async () => {
    const { redactOutput: ro, secretValues: sv } = await import('../../src/verify/test-runner.js');
    const literals = sv('pnpm test --password hunter222', {});
    expect(literals).toContain('hunter222');
    const out = ro('> vitest run --password hunter222\nconnecting with hunter222\ncurl -u admin:pw-curl-9 http://x', literals);
    expect(out).not.toContain('hunter222');
    expect(out).not.toContain('pw-curl-9');
    expect(out).toContain('--password [REDACTED]');
  });

  it('346-01/AC-1: a credential flag the suite prints itself (not from the command) is redacted by pattern', async () => {
    const { redactOutput: ro } = await import('../../src/verify/test-runner.js');
    const out = ro('spawning: db-cli --auth-token zzz-secret-77 --verbose', []);
    expect(out).not.toContain('zzz-secret-77');
    expect(out).toBe('spawning: db-cli --auth-token [REDACTED] --verbose');
  });

  it('346-01/AC-1: an escaped quote inside a quoted JSON password does not leave its suffix visible', async () => {
    const { redactOutput: ro } = await import('../../src/verify/test-runner.js');
    const out = ro('{ "password": "abc\\"def-suffix-9", "user": "me" }');
    expect(out).not.toContain('def-suffix-9');
    expect(out).not.toContain('abc');
    expect(out).toContain('"user": "me"');
  });
});

describe('phase 346 redaction: shapes from the fourth Codex review', () => {
  it('346-01/AC-3: a credential in any argument holding : or @ is redacted whatever flag precedes it', async () => {
    const { redactCommand: rc } = await import('../../src/verify/test-runner.js');
    for (const [cmd, secret] of [
      ['curl --user alice:password http://x', 'password'],
      ['curl --proxy-user bob:pw-proxy-1 http://x', 'pw-proxy-1'],
      ['curl -U bob http://x', 'bob'],
      ['tool --creds=alice:pw-eq-2', 'pw-eq-2'],
      ['curl -H "Authorization: Bearer tok-hdr-3" http://x', 'tok-hdr-3'],
      ['ssh deploy@host-4 run-tests', 'deploy@host-4'],
    ] as const) {
      expect(rc(cmd)).not.toContain(secret);
    }
    expect(rc('curl --user alice:password http://x')).toBe('curl --user [REDACTED] [REDACTED]');
    expect(rc('tool --creds=alice:pw-eq-2')).toBe('tool --creds=[REDACTED]');
  });

  it('346-01/AC-1: a known secret cut in half by the capture ring leaves no fragment in the tail', async () => {
    const secret = 'S3CRET-' + 'x'.repeat(40) + '-TAIL';
    // The 64 KiB window boundary falls inside the secret, and the 64 KiB after it is BEL
    // characters that control stripping removes, so the cut fragment would reach the tail.
    const cmd = script(
      `const s = ${JSON.stringify(secret)};
       process.stdout.write('a'.repeat(200000) + s + '\\n' + '\\u0007'.repeat(65536 - 20) + '\\nlast line\\n');
       process.exitCode = 1;`,
    );
    const prev = process.env['MY_SERVICE_TOKEN'];
    process.env['MY_SERVICE_TOKEN'] = secret;
    try {
      const result = await runTestCommand(process.cwd(), cmd);
      expect(result.outputTail).not.toContain('-TAIL');
      expect(result.outputTail).toContain('last line');
    } finally {
      if (prev === undefined) delete process.env['MY_SERVICE_TOKEN'];
      else process.env['MY_SERVICE_TOKEN'] = prev;
    }
  });
});

