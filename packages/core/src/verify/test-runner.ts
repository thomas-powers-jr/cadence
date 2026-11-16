import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { TestRunResult } from '../gates/types.js';
import { redactSecrets } from '../security/redact.js';

/** Most lines a failing run's `outputTail` keeps. */
export const OUTPUT_TAIL_MAX_LINES = 40;
/** Most UTF-8 bytes a failing run's `outputTail` keeps. */
export const OUTPUT_TAIL_MAX_BYTES = 8 * 1024;

/**
 * Characters the capture ring retains. Escape sequences are filtered out
 * before text reaches the ring, so this is plain text; eight times the byte
 * cap leaves room for control characters and the redaction step while memory
 * stays bounded no matter how much the command prints.
 */
const RING_CHARS = OUTPUT_TAIL_MAX_BYTES * 8;

/**
 * How long, after the shell exits, the pipes may still drain before they are
 * destroyed. A grandchild the command backgrounded (`server &`, a stray
 * worker, a daemon) can inherit the pipes and hold them open for its whole
 * life; `close` would wait on it, while the old `execSync` (stdio ignored,
 * no pipes) returned the moment the shell exited. The verdict is the shell's
 * exit code either way; this only bounds how long its last output may lag.
 */
const PIPE_DRAIN_MS = 500;
// The drain is not a timeout: the command itself is never killed, and the
// grandchild is left running once its pipes are destroyed, exactly as it was
// under execSync.

// Every Unicode control (Cc) and format (Cf) character except TAB and LF,
// plus the line and paragraph separators, by category rather than by list
// (dec-20261116-001): a lone CR progress redraw, BEL, BS, the C1 range, zero-width and
// bidi controls (U+061C, U+200E, U+202E, U+2066…) alike. Applied after the
// escape filter, so it only removes stray controls.
const CONTROL_RE = /(?![\t\n])[\p{Cc}\p{Cf}\u2028\u2029]/gu;

/**
 * `scheme://userinfo@` — a URL's userinfo is a credential. Found by a linear
 * scan rather than a regex, so no length cap is needed: for each `://`, the
 * scheme before it is at most 32 characters, starts with a letter and does
 * not continue a word; the token after it ends at whitespace, a quote or
 * `<`/`>`; the user part holds no `/`, `@` or `:`, and a password after `:`
 * runs to the last `@` in the token, so an `@` or `/` inside a password, of
 * any length, is covered, while `file:///…/@vitest/runner` stack frames and
 * `https://registry.npmjs.org/@types/node` are left alone. Returns the
 * [start, end) spans of each userinfo.
 */
function userinfoSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const isSchemeChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9+.-]/.test(c);
  const isTokenEnd = (c: string | undefined): boolean => c === undefined || /[\s"'<>]/.test(c);
  let from = 0;
  for (;;) {
    const sep = text.indexOf('://', from);
    if (sep === -1) break;
    from = sep + 3;
    let s = sep;
    while (s > 0 && sep - s < 32 && isSchemeChar(text[s - 1])) s--;
    if (s === sep || isSchemeChar(text[s - 1]) || !/[A-Za-z]/.test(text[s] ?? '')) continue;
    const start = sep + 3;
    if (text[start] === '/') continue;
    let end = start;
    while (!isTokenEnd(text[end])) end++;
    from = Math.max(from, end);
    let i = start;
    while (i < end && text[i] !== '/' && text[i] !== '@' && text[i] !== ':') i++;
    let at = -1;
    if (text[i] === '@') at = i;
    else if (text[i] === ':') {
      const last = text.lastIndexOf('@', end - 1);
      if (last > i) at = last;
    }
    if (at > start) spans.push([start, at]);
  }
  return spans;
}

/** Replaces each URL userinfo with `[REDACTED]`, keeping the scheme and the `@host…`. */
function redactUrlUserinfo(text: string): string {
  const spans = userinfoSpans(text);
  if (spans.length === 0) return text;
  let out = '';
  let pos = 0;
  for (const [a, b] of spans) {
    out += text.slice(pos, a) + '[REDACTED]';
    pos = b;
  }
  return out + text.slice(pos);
}
/** An upper-case shell assignment anywhere in output: env dumps, npm's `sh -c` footer, `set -x` traces. */
const OUTPUT_ASSIGNMENT_RE = /(^|[\s;&|(>+"'])([A-Z_][A-Z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gm;
/** A quoted credential-named key, as JSON and assertion diffs print objects: `"password": "x"`. */
const QUOTED_KEY_RE =
  /(["'][\w-]{0,64}(?:pass(?:word)?|pwd|secret|token|api[_-]?key|credentials?)["']\s*:\s*)("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[^\s,}\]]+)/gi;
/** Any inline assignment in a command, whatever the name, optionally quoted (`set "X=y"`, `cross-env "X=y"`). */
/**
 * A whole quoted assignment, `"NAME=value with spaces"` or `'NAME=…'`
 * (Windows `set "X=y"`, `cross-env "X=y"`, `env -S "X=y cmd"`): the value
 * runs to the matching closing quote, spaces included.
 */
const QUOTED_ASSIGNMENT_RE = /(^|[\s;&|(])(["'])([A-Za-z_][A-Za-z0-9_]*)=((?:(?!\2)[^\n])*)\2/g;
const COMMAND_ASSIGNMENT_RE =
  /(^|[\s;&|(])(["']?)([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s"']+)(["']?)/g;
/** A credential-named flag, matched on whole dash-separated segments so `--passWithNoTests` is left alone. */
const SECRET_FLAG_RE =
  /(\s--?(?:[A-Za-z0-9]+-)*(?:pass(?:word)?|pwd|token|secret|key|apikey|auth|credentials?)(?:-[A-Za-z0-9]+)*)(?:(=)("[^"]*"|'[^']*'|\S+)|(\s+)("[^"]*"|'[^']*'|[^\s-]\S*))/gi;
/** `curl -u user:password`. */
const BASIC_AUTH_FLAG_RE = /(\s-u\s+)[^\s:]+:\S+/g;
/** Values never treated as literal secrets: booleans, common words, plain numbers. */
const COMMON_VALUE_RE = /^(?:true|false|yes|no|on|off|null|undefined|test|development|production|\d+)$/i;
/** A variable or key name that holds a credential. */
const SECRET_NAME_RE = /pass|pwd|token|secret|key|auth|credential|private|cookie|session/i;

/**
 * Literal secret values to remove wherever they appear, whatever shape
 * surrounds them, because patterns always miss a shape: the value of every
 * credential-named variable in `env` (the environment the suite inherits,
 * which is where its secrets usually come from) and in the command's inline
 * assignments, and the userinfo of any URL in either. A value must be at
 * least 8 characters and not a common word, number or (from the environment)
 * a path, so `DISABLE_AUTH=true`, `GIT_ASKPASS=echo` or `SSH_AUTH_SOCK=/tmp/…`
 * cannot erase ordinary text. Shorter values are still caught by the
 * pattern passes wherever they sit in an assignment.
 */
export function secretValues(command: string | undefined, env: NodeJS.ProcessEnv): string[] {
  const values = new Set<string>();
  const add = (v: string | undefined): void => {
    if (v && v.length >= 8 && !COMMON_VALUE_RE.test(v)) values.add(v);
  };
  const addUserinfo = (text: string): void => {
    for (const [a, b] of userinfoSpans(text)) {
      const info = text.slice(a, b);
      add(info);
      // The password alone too: a suite may print it without the user part.
      const colon = info.indexOf(':');
      if (colon !== -1) add(info.slice(colon + 1));
    }
  };
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    // From the environment: at least 8 characters and not a path, so a
    // helper such as GIT_ASKPASS=echo or SSH_AUTH_SOCK=/tmp/... is left alone.
    if (SECRET_NAME_RE.test(name) && !/^(?:[/~.]|[A-Za-z]:[\\/])/.test(value)) add(value);
    if (value.includes('://')) addUserinfo(value);
  }
  if (command) {
    for (const m of command.matchAll(QUOTED_ASSIGNMENT_RE)) {
      if (SECRET_NAME_RE.test(m[3] ?? '')) add(m[4]);
    }
    for (const m of command.matchAll(COMMAND_ASSIGNMENT_RE)) {
      const name = m[3] ?? '';
      const value = (m[4] ?? '').replace(/^["']|["']$/g, '');
      if (SECRET_NAME_RE.test(name)) add(value);
    }
    for (const m of command.matchAll(SECRET_FLAG_RE)) {
      add((m[3] ?? m[5] ?? '').replace(/^["']|["']$/g, ''));
    }
    addUserinfo(command);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

/** Replacer for SECRET_FLAG_RE: keep the flag and its `=` or spacing, redact the value. */
function redactFlagValue(
  _m: string,
  flag: string,
  eq: string | undefined,
  _v1: string | undefined,
  sp: string | undefined,
): string {
  return `${flag}${eq ?? sp ?? ''}[REDACTED]`;
}

/** Removes a trailing fragment of any known secret from the start of `text`. */
function stripLeadingFragment(text: string, literals: readonly string[]): string {
  for (const v of literals) {
    for (let k = v.length - 1; k >= 1; k--) {
      if (text.startsWith(v.slice(-k))) return text.slice(k);
    }
  }
  return text;
}

function replaceLiterals(text: string, literals: readonly string[]): string {
  let out = text;
  for (const v of literals) if (out.includes(v)) out = out.split(v).join('[REDACTED]');
  return out;
}

/**
 * Redaction for a failing run's captured output, before any of it is kept:
 * the literal secret values (see `secretValues`) first, then the shared
 * `redactSecrets` patterns, URL userinfo, upper-case assignments anywhere in
 * a line, quoted credential-named keys (escaped quotes inside the value
 * included), credential-named flag values and `-u user:pw`. Safe to apply
 * twice.
 */
export function redactOutput(text: string, literals: readonly string[] = []): string {
  // Patterns first: a literal that is itself a key word (MYSQL_PWD=password)
  // would otherwise rewrite the key `"password"` before the quoted-key pattern
  // could redact its value. Then the literals, plus the words of any literal
  // holding whitespace, in case a pattern redacted only its first word.
  const patterned = redactUrlUserinfo(redactSecrets(text))
    .replace(OUTPUT_ASSIGNMENT_RE, '$1$2=[REDACTED]')
    .replace(QUOTED_KEY_RE, '$1"[REDACTED]"')
    .replace(SECRET_FLAG_RE, redactFlagValue)
    .replace(BASIC_AUTH_FLAG_RE, '$1[REDACTED]');
  return replaceLiterals(patterned, withWordPieces(literals));
}

/** The literals, plus each 4+-character word of a literal that holds whitespace (longest first). */
function withWordPieces(literals: readonly string[]): string[] {
  const out = new Set(literals);
  for (const v of literals) {
    if (!/\s/.test(v)) continue;
    for (const w of v.split(/\s+/)) if (w.length >= 4 && !COMMON_VALUE_RE.test(w)) out.add(w);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** A program word shown as-is: letters, digits and path characters, an optional drive prefix. */
const PROGRAM_WORD_RE = /^(?:[A-Za-z]:[\\/])?[A-Za-z0-9_.\/\\+-]+$/;

/**
 * The configured test command as every notice, refusal, anomaly and SUMMARY
 * names it (dec-20261116-001): the program alone, its arguments never shown,
 * e.g. `pnpm [arguments not shown]`. Fail-closed by construction: no list of
 * secret shapes can be complete, so nothing after the program is printed or
 * recorded, and a program word that is not plain letters, digits and path
 * characters is not shown either (`[command not shown]`). Only the first
 * word is ever considered: a command that starts with an assignment
 * (`NAME=… pnpm test`) shows as `[command not shown]`, because skipping
 * words needs shell parsing, and a quoted or escaped value would then leak
 * a fragment as the "program". The full command stays where the operator wrote it,
 * `verification.testCommand` in `.cadence/config.json`. Idempotent;
 * `<unknown command>` (a runner that reported none) passes through.
 */
export function displayCommand(command: string): string {
  if (command === '<unknown command>') return command;
  const words = command.trim().split(/\s+/).filter((w) => w !== '');
  const program = words[0];
  if (program === undefined || !PROGRAM_WORD_RE.test(program)) return '[command not shown]';
  return words.length > 1 ? `${program} [arguments not shown]` : program;
}

const ESC = 0x1b;
const BEL = 0x07;
/** Bytes after ESC that open a string sequence: P (DCS), X (SOS), ] (OSC), ^ (PM), _ (APC). */
const STRING_FINALS = new Set([0x50, 0x58, 0x5d, 0x5e, 0x5f]);
/** C1 code points that open a string sequence: DCS, SOS, OSC, PM, APC. */
const STRING_C1 = new Set([0x90, 0x98, 0x9d, 0x9e, 0x9f]);

/**
 * Removes ANSI escape sequences from one pipe's decoded text as it streams,
 * before anything reaches the ring, so the ring's cut can never land inside a
 * sequence and leave its payload behind as text. One filter per pipe, so a
 * sequence split across two chunks of the same pipe is still recognised when
 * the other pipe's chunk arrives in between. Recognised and dropped:
 * - string sequences: OSC `ESC ]`, DCS `ESC P`, SOS `ESC X`, PM `ESC ^`, APC
 *   `ESC _` (or their C1 code points U+009D, U+0090, U+0098, U+009E, U+009F)
 *   ... up to BEL, ST (`ESC \` or U+009C) — e.g. the `ESC ]8;;url BEL`
 *   hyperlinks vitest prints; the payload may be any length. An LF, CAN or
 *   SUB also ends one, so a stray unterminated `ESC ]` cannot swallow the
 *   rest of the output (real payloads carry no LF); the LF is kept as text;
 * - CSI: `ESC [` (or the C1 code point U+009B), parameter and intermediate
 *   bytes, one final byte — SGR colours, erase-line, cursor moves;
 * - any other escape: `ESC`, optional intermediate bytes, one final byte —
 *   `ESC c`, `ESC 7`, `ESC M`, and charset selection such as `ESC ( B`.
 * A sequence still open when the output ends is dropped whole. A byte that
 * cannot continue a sequence ends it and is read again as text.
 */
class AnsiFilter {
  private state: 'text' | 'esc' | 'escInter' | 'csi' | 'osc' | 'oscEsc' = 'text';

  write(text: string): string {
    let out = '';
    let i = 0;
    while (i < text.length) {
      if (this.state === 'text') {
        // Fast path: copy plain text up to the next sequence introducer.
        let j = i;
        while (j < text.length) {
          const c = text.charCodeAt(j);
          if (c === ESC || (c >= 0x90 && c <= 0x9f && STRING_C1.has(c)) || c === 0x9b) break;
          j++;
        }
        out += text.slice(i, j);
        if (j >= text.length) break;
        const c = text.charCodeAt(j);
        this.state = c === ESC ? 'esc' : c === 0x9b ? 'csi' : 'osc';
        // (every other C1 introducer here is a string sequence)
        i = j + 1;
        continue;
      }
      const c = text.charCodeAt(i);
      switch (this.state) {
        case 'esc':
          if (STRING_FINALS.has(c)) this.state = 'osc';
          else if (c === 0x5b) this.state = 'csi';
          else if (c >= 0x20 && c <= 0x2f) this.state = 'escInter';
          else if (c >= 0x30 && c <= 0x7e) this.state = 'text';
          else {
            this.state = 'text';
            continue; // not a sequence: read this character again as text
          }
          break;
        case 'escInter':
          if (c >= 0x20 && c <= 0x2f) break;
          this.state = 'text';
          if (c >= 0x30 && c <= 0x7e) break;
          continue;
        case 'csi':
          if (c >= 0x20 && c <= 0x3f) break;
          this.state = 'text';
          if (c >= 0x40 && c <= 0x7e) break;
          continue;
        case 'osc':
          if (c === BEL || c === 0x9c || c === 0x18 || c === 0x1a) this.state = 'text';
          else if (c === ESC) this.state = 'oscEsc';
          else if (c === 0x0a) {
            this.state = 'text';
            continue; // keep the LF as text
          }
          break;
        case 'oscEsc':
          if (c === 0x5c) {
            this.state = 'text';
            break;
          }
          // ESC not followed by `\` ends the OSC and starts a new escape.
          this.state = 'esc';
          continue;
      }
      i++;
    }
    return out;
  }
}

/**
 * Bounded streaming capture of a child's combined output. Appended text is
 * kept in a ring of at most ~2×RING_CHARS characters (trimmed back to
 * RING_CHARS whenever it overflows), so neither total output size nor a
 * single enormous newline-free line can grow memory without bound.
 */
class TailRing {
  private buf = '';
  private cut = false;

  append(text: string): void {
    if (text.length === 0) return;
    this.buf += text;
    if (this.buf.length > RING_CHARS * 2) {
      this.buf = this.buf.slice(-RING_CHARS);
      this.cut = true;
    }
  }

  /**
   * The final tail of the already escape-filtered text: other control
   * characters removed except TAB and LF (a CR before an LF first folds into
   * the LF), secrets redacted with the same `redactSecrets` the SUMMARY's
   * findings use (before the caps, because redaction can lengthen text), split
   * on LF (a trailing LF ends the last line, a final unterminated line counts),
   * cut to the last OUTPUT_TAIL_MAX_LINES lines, blank lines at the end of
   * that window dropped, then cut to the last OUTPUT_TAIL_MAX_BYTES bytes
   * (when the byte cap cuts a line, its tail end is kept). `undefined` when
   * nothing but whitespace was captured — never an empty string.
   */
  finish(literals: readonly string[] = []): string | undefined {
    let window = this.buf;
    if (this.cut || window.length > RING_CHARS) {
      window = window.slice(-RING_CHARS);
      // The cut can land inside a known secret: strip the trailing fragment
      // of any such secret the window starts with, so it cannot survive the
      // literal pass. The rest of a cut line is kept; its tail end may be
      // part of the tail when the lines after it are short.
      window = stripLeadingFragment(window, literals);
    }
    const text = redactOutput(window.replace(/\r\n/g, '\n').replace(CONTROL_RE, ''), literals);
    const all = text.split('\n');
    // A trailing LF terminates the last line; it does not start a new one.
    if (all.length > 0 && all[all.length - 1] === '') all.pop();
    // The window is the last OUTPUT_TAIL_MAX_LINES lines the command printed;
    // blank lines at its end are trimmed inside it, never refilled from
    // older output.
    const lines = all.slice(-OUTPUT_TAIL_MAX_LINES);
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
    let tail = lines.join('\n');
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
      const outputTail = ring.finish(secretValues(command, process.env));
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
    // One escape filter per pipe, too, for the same reason.
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    const outFilter = new AnsiFilter();
    const errFilter = new AnsiFilter();
    child.stdout.on('data', (chunk: Buffer) => ring.append(outFilter.write(outDecoder.write(chunk))));
    child.stderr.on('data', (chunk: Buffer) => ring.append(errFilter.write(errDecoder.write(chunk))));
    // A read-side pipe error must not become an unhandled 'error' that takes
    // settle down; the exit code still decides the verdict.
    child.stdout.on('error', () => {});
    child.stderr.on('error', () => {});

    const flushDecoders = (): void => {
      ring.append(outFilter.write(outDecoder.end()));
      ring.append(errFilter.write(errDecoder.end()));
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
