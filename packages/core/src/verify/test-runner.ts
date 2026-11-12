import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { TestRunResult } from '../gates/types.js';

/** Most lines a failing run's `outputTail` keeps. */
export const OUTPUT_TAIL_MAX_LINES = 40;
/** Most UTF-8 bytes a failing run's `outputTail` keeps. */
export const OUTPUT_TAIL_MAX_BYTES = 8 * 1024;

/**
 * Raw (pre-ANSI-strip) characters the capture ring retains. Eight times the
 * byte cap, so escape-heavy output (colour codes around every word) still
 * leaves a full 8 KiB / 40-line tail once the sequences are stripped, while
 * memory stays bounded no matter how much the command prints.
 */
const RAW_RING_CHARS = OUTPUT_TAIL_MAX_BYTES * 8;

/**
 * How long, after the shell exits, the pipes may still drain before they are
 * destroyed. A grandchild the command backgrounded (`server &`, a stray
 * worker, a daemon) can inherit the pipes and hold them open for its whole
 * life; `close` would wait on it, while the old `execSync` (stdio ignored,
 * no pipes) returned the moment the shell exited. The verdict is the shell's
 * exit code either way; this only bounds how long its last output may lag.
 */
const PIPE_DRAIN_MS = 500;

/**
 * ANSI escape sequences removed from the tail:
 * - OSC: `ESC ]` ... terminated by BEL or ST (`ESC \`) — e.g. the
 *   `ESC ]8;;url BEL` hyperlinks vitest and friends print;
 * - CSI: `ESC [` parameter bytes, intermediate bytes, one final byte — SGR
 *   colours (`ESC [31m`), erase-line (`ESC [2K`), cursor moves (`ESC [1G`);
 * - any other escape: `ESC`, optional intermediate bytes, one final byte —
 *   `ESC c`, `ESC 7`, `ESC M`, and charset selection such as `ESC ( B`.
 * Not covered: 8-bit C1 controls (0x9B CSI etc.), and a sequence or a UTF-16
 * surrogate pair cut in half at the very start of the retained ring, which
 * can leave a fragment such as `31m` or a U+FFFD on the tail's first line.
 */
const ANSI_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[ -/]*[0-~]/g;

/**
 * Bounded streaming capture of a child's combined output. Appended text is
 * kept in a ring of at most ~2×RAW_RING_CHARS characters (trimmed back to
 * RAW_RING_CHARS whenever it overflows), so neither total output size nor a
 * single enormous newline-free line can grow memory without bound.
 */
class TailRing {
  private buf = '';

  append(text: string): void {
    if (text.length === 0) return;
    this.buf += text;
    if (this.buf.length > RAW_RING_CHARS * 2) {
      this.buf = this.buf.slice(-RAW_RING_CHARS);
    }
  }

  /**
   * The final tail: ANSI stripped, split on LF with a CR before each LF
   * dropped, a trailing unterminated line kept, then cut to the last
   * OUTPUT_TAIL_MAX_LINES lines and the last OUTPUT_TAIL_MAX_BYTES bytes
   * (when the byte cap cuts a line, its tail end is kept). `undefined` when
   * nothing but whitespace was captured — never an empty string.
   */
  finish(): string | undefined {
    const text = this.buf.slice(-RAW_RING_CHARS).replace(ANSI_RE, '');
    const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
    // A trailing LF terminates the last line; it does not start a new one, and
    // trailing blank lines are not worth any of the line budget.
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
    let tail = lines.slice(-OUTPUT_TAIL_MAX_LINES).join('\n');
    const bytes = Buffer.from(tail, 'utf8');
    if (bytes.length > OUTPUT_TAIL_MAX_BYTES) {
      let start = bytes.length - OUTPUT_TAIL_MAX_BYTES;
      // Never start mid code point: skip UTF-8 continuation bytes.
      while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
      tail = bytes.subarray(start).toString('utf8');
    }
    return tail.trim() === '' ? undefined : tail;
  }
}

/**
 * Runs the configured `verification.testCommand` and reports the outcome as
 * a `TestRunResult`. Extracted from settle.ts's formerly-inline
 * `runner.test` collaborator (Phase 39.2's build-test-must-pass gate) so
 * `cadence verify phase` can reuse the same subprocess-spawn logic without
 * duplicating it.
 *
 * Phase 346 (T2): the command is spawned through a shell (`shell: true`) in
 * `cwd` with `process.env`, no timeout, stdin ignored (an inherited TTY can
 * put a runner such as vitest into watch mode and hang settle), and stdout
 * and stderr piped — never inherited, so nothing the command prints reaches
 * cadence's own stdout (the `--json` / MCP contract). Both pipes feed one
 * bounded ring in chunk-arrival order; the relative interleaving of the two
 * pipes is whatever order their chunks arrive in, not guaranteed to match
 * the order the child wrote them. Decoding is UTF-8, safe across chunk
 * boundaries.
 *
 * The run resolves when every pipe has closed, or PIPE_DRAIN_MS after the
 * shell exits if a backgrounded grandchild still holds one, so a daemon the
 * command started cannot hold settle open. The exit code alone decides `ok`:
 * 0 is `ok: true` with no `outputTail`; a
 * non-zero code is `ok: false` with that `exitCode`; a signal kill (no exit
 * code) or a spawn `error` event is `ok: false` with `exitCode: 1`. Only a
 * failing run carries `outputTail` (see `TailRing.finish` for its bounds),
 * and only when something was captured.
 */
export async function runTestCommand(
  cwd: string,
  command: string | undefined,
): Promise<TestRunResult> {
  if (!command) return { ran: false, ok: true };
  return new Promise<TestRunResult>((resolve) => {
    const ring = new TailRing();
    let settled = false;
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      if (exitCode === 0) {
        resolve({ ran: true, ok: true, exitCode: 0, command });
        return;
      }
      const outputTail = ring.finish();
      resolve({
        ran: true,
        ok: false,
        exitCode,
        command,
        ...(outputTail !== undefined ? { outputTail } : {}),
      });
    };

    let child;
    try {
      child = spawn(command, {
        cwd,
        env: process.env,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      finish(1);
      return;
    }

    // One decoder per pipe: a multi-byte character split across two chunks
    // of the same pipe is reassembled before it reaches the ring.
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    child.stdout.on('data', (chunk: Buffer) => ring.append(outDecoder.write(chunk)));
    child.stderr.on('data', (chunk: Buffer) => ring.append(errDecoder.write(chunk)));
    // A read-side pipe error must not become an unhandled 'error' that takes
    // settle down; the exit code still decides the verdict.
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});

    const flushDecoders = (): void => {
      ring.append(outDecoder.end());
      ring.append(errDecoder.end());
    };
    let drainTimer: NodeJS.Timeout | undefined;
    child.on('error', () => finish(1));
    // The shell's exit decides the verdict. Normally 'close' follows at once
    // (every pipe has ended); if a backgrounded grandchild still holds a pipe,
    // give it PIPE_DRAIN_MS, then stop reading and resolve anyway.
    child.on('exit', (code: number | null) => {
      const exitCode = typeof code === 'number' ? code : 1;
      drainTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        flushDecoders();
        finish(exitCode);
      }, PIPE_DRAIN_MS);
      drainTimer.unref();
    });
    child.on('close', (code: number | null) => {
      if (drainTimer !== undefined) clearTimeout(drainTimer);
      flushDecoders();
      finish(typeof code === 'number' ? code : 1);
    });
  });
}
