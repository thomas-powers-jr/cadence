import { readFileSync } from 'node:fs';
import { installHooks, parseHooksInstallArgs } from './install-hooks.js';
import { installStatusline } from './install.js';
import { exitAfterFlush, recordDeadlineFromEnv, runStatusline } from './sensor.js';
import { runSessionStart } from './session-start.js';
import { runStopGate } from './stop-gate.js';
import { validate } from './validate.js';

const USAGE =
  'Usage: checkpoint validate <path>\n' +
  '       checkpoint statusline [--] <command> [args...]\n' +
  '       checkpoint statusline-install --settings <path>\n' +
  '       checkpoint hooks-install --settings <path> [--threshold <pct>] [--ceiling <n>]\n' +
  '       checkpoint stop-gate [--threshold <pct>] [--ceiling <n>] [--max-reading-age-s <s>]\n' +
  '       checkpoint session-start\n';

/** `--settings <path>` or `--settings=<path>`, and nothing else; null on anything unexpected. */
function parseSettingsFlag(args: string[]): string | null {
  if (args.length === 2 && args[0] === '--settings' && args[1] !== undefined && args[1].length > 0) return args[1];
  if (args.length === 1 && args[0] !== undefined && args[0].startsWith('--settings=')) {
    const value = args[0].slice('--settings='.length);
    return value.length > 0 ? value : null;
  }
  return null;
}

function statuslineInstall(args: string[]): void {
  const settingsPath = parseSettingsFlag(args);
  if (settingsPath === null) {
    process.stderr.write(USAGE);
    process.exit(2);
  }
  void installStatusline({ settingsPath, stdout: process.stdout, stderr: process.stderr }).then((code) => {
    process.exitCode = code;
  });
}

/**
 * `checkpoint hooks-install` (an operator command, not a hook): a usage error
 * is one reason line plus USAGE on stderr and exit 2, like statusline-install.
 */
function hooksInstall(args: string[]): void {
  const parsed = parseHooksInstallArgs(args);
  if (!parsed.ok) {
    process.stderr.write(`checkpoint hooks-install: ${parsed.reason}\n${USAGE}`);
    process.exit(2);
  }
  void installHooks({
    settingsPath: parsed.settingsPath,
    flags: parsed.options,
    stdout: process.stdout,
    stderr: process.stderr,
  }).then((code) => {
    process.exitCode = code;
  });
}

interface GuardedStream {
  write(chunk: string | Uint8Array): boolean;
}

interface GuardedFlushable {
  write(chunk: string, cb: () => void): boolean;
}

/**
 * A process stream that becomes a silent no-op once it has emitted any
 * 'error' (in practice EPIPE, when the statusline reader closes its end of
 * the pipe mid-run; a file-redirected stdout's ENOSPC is silenced too, since
 * a statusline has nowhere useful to report a broken stdout). The
 * error arrives as a stream event, not a throw, so without this listener it
 * would crash the wrapper and lose the reading and the inner's exit code.
 * `flushable` invokes its callback at once after an error, so exitAfterFlush
 * always reaches exit; before one, Node calls a write callback even when the
 * write fails.
 */
function guardStream(stream: NodeJS.WriteStream): { sink: GuardedStream; flushable: GuardedFlushable } {
  let broken = false;
  stream.on('error', () => {
    broken = true;
  });
  return {
    sink: { write: (chunk) => (broken ? true : stream.write(chunk)) },
    flushable: {
      write: (chunk, cb) => {
        if (broken) {
          cb();
          return true;
        }
        return stream.write(chunk, () => cb());
      },
    },
  };
}

function statusline(args: string[]): void {
  const stdout = guardStream(process.stdout);
  const stderr = guardStream(process.stderr);
  // CHECKPOINT_RECORD_DEADLINE_MS (diagnostics and tests); unset or invalid keeps RECORD_DEADLINE_MS.
  const recordDeadlineMs = recordDeadlineFromEnv(process.env);
  void runStatusline({
    argv: args,
    // A terminal stdin would block forever; Claude Code always pipes.
    stdin: process.stdin.isTTY ? [] : process.stdin,
    stdout: stdout.sink,
    stderr: stderr.sink,
    cwdFallback: process.cwd(),
    ...(recordDeadlineMs !== undefined ? { recordDeadlineMs } : {}),
  }).then((code) => {
    // Drain piped stdout/stderr, then exit: an abandoned reading write must
    // not keep the process (and so the statusline) alive.
    exitAfterFlush(code, { stdout: stdout.flushable, stderr: stderr.flushable }, (c) => process.exit(c));
  });
}

/**
 * `checkpoint stop-gate` (a Claude Code `Stop` hook). Always exits 0:
 * `runStopGate` never rejects, and a rejection that somehow escaped it would
 * still be one notice line and exit 0, never the bin's exit-1 crash path.
 */
function stopGate(args: string[]): void {
  const stdout = guardStream(process.stdout);
  const stderr = guardStream(process.stderr);
  void runStopGate({
    argv: args,
    // A terminal stdin would block forever; Claude Code always pipes. A
    // terminal run reads as an empty payload (one notice, exit 0).
    stdin: process.stdin.isTTY ? [] : process.stdin,
    stdout: stdout.sink,
    stderr: stderr.sink,
  })
    .catch((err: unknown) => {
      stderr.sink.write(`checkpoint stop-gate: ${String(err).replace(/\s+/g, ' ').trim()}\n`);
      return 0;
    })
    .then((code) => {
      exitAfterFlush(code, { stdout: stdout.flushable, stderr: stderr.flushable }, (c) => process.exit(c));
    });
}

/**
 * `checkpoint session-start` (a Claude Code `SessionStart` hook). Always
 * exits 0 and never writes stdout: `runSessionStart` never rejects, and a
 * rejection that somehow escaped it would still be one notice line and exit
 * 0. An argument is refused inside the handler (one line, exit 0), never with
 * the USAGE exit 2.
 */
function sessionStart(args: string[]): void {
  const stdout = guardStream(process.stdout);
  const stderr = guardStream(process.stderr);
  void runSessionStart({
    argv: args,
    // A terminal stdin would block forever; Claude Code always pipes. A
    // terminal run reads as an empty payload (one notice, exit 0).
    stdin: process.stdin.isTTY ? [] : process.stdin,
    stderr: stderr.sink,
  })
    .catch((err: unknown) => {
      stderr.sink.write(`checkpoint session-start: ${String(err).replace(/\s+/g, ' ').trim()}\n`);
      return 0;
    })
    .then((code) => {
      exitAfterFlush(code, { stdout: stdout.flushable, stderr: stderr.flushable }, (c) => process.exit(c));
    });
}

function main(argv: string[]): void {
  const [command, filePath] = argv;

  if (command === 'statusline') {
    statusline(argv.slice(1));
    return;
  }

  if (command === 'stop-gate') {
    stopGate(argv.slice(1));
    return;
  }

  if (command === 'session-start') {
    sessionStart(argv.slice(1));
    return;
  }

  if (command === 'statusline-install') {
    statuslineInstall(argv.slice(1));
    return;
  }

  if (command === 'hooks-install') {
    hooksInstall(argv.slice(1));
    return;
  }

  if (command !== 'validate' || !filePath) {
    process.stderr.write(USAGE);
    process.exit(2);
  }

  let content: Buffer;
  try {
    content = readFileSync(filePath);
  } catch (err) {
    process.stderr.write(`Cannot read ${filePath}: ${(err as Error).message}\n`);
    process.exit(2);
  }

  const result = validate(content);

  if (result.ok) {
    process.exit(0);
  }

  for (const diag of result.diagnostics) {
    const loc = diag.line ? `:${diag.line}` : '';
    const section = diag.section ? ` [${diag.section}]` : '';
    process.stderr.write(`${diag.code}${section}${loc}: ${diag.message}\n`);
  }
  process.exit(2);
}

main(process.argv.slice(2));
