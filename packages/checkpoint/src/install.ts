import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { atomicWriteText } from '@thomas-powers-jr/cadence-core';

/**
 * `checkpoint statusline-install --settings <path>` (phase 331, AC-8): points
 * a Claude Code settings file's `statusLine.command` at the checkpoint
 * statusline wrapper, changing nothing else in the file.
 *
 * The file is never re-serialized. It is read as bytes and decoded as strict
 * UTF-8 (anything else is refused, so no lossy decode/re-encode can change a
 * byte outside statusLine). JSON.parse is used only to find the existing
 * command; its exact JSON string literal is then located among the file's
 * whole JSON string-value tokens (exactly one match required; keys never
 * count) and the new literal is spliced in its place. With no `statusLine`,
 * one member is inserted before the top-level closing brace. Either way the
 * result is re-parsed and refused unless `statusLine` is the only thing that
 * changed (`verifyOnlyStatusLineChanged`, kept as defense in depth).
 *
 * Shell and quoting facts the wrapped form rests on:
 *
 * - Claude Code runs the statusline command through Git Bash on Windows when
 *   installed, otherwise PowerShell (and a POSIX shell elsewhere). The
 *   wrapper prefix is `node '<bin path>'`: a bare `node` first (a command
 *   starting with a quoted string is an expression, not an invocation, in
 *   PowerShell), and the path in SINGLE quotes with forward slashes. Single
 *   quotes are literal in bash and in PowerShell (no `$`/backtick expansion
 *   in either), need no JSON escaping, and keep `"` out of the command —
 *   which Node's win32 argv builder would re-escape as `\"` when a host
 *   spawns `powershell.exe -Command`. Git Bash consumes unquoted
 *   backslashes, hence forward slashes. A path containing `'`, or any of
 *   U+2018-U+201B (PowerShell single-quote delimiters too), is refused.
 * - The rewritten file keeps the original's permission bits, so a private
 *   (0600) settings file is not widened by the rename.
 * - The wrapper spawns the inner command from the argv the shell hands it,
 *   with NO shell. The installer therefore refuses commands it can see need
 *   a shell: pipes, lists, redirections, substitutions, parentheses,
 *   newlines, a leading `NAME=value` assignment, and a leading `exec`,
 *   `source`, `.`, `eval`, `command` or `builtin` builtin, or a leading
 *   `time` keyword.
 * - On win32 a no-shell spawn cannot start a `.cmd`/`.bat` shim or a
 *   `.ps1`/`.sh`/extensionless script (measured: `spawn('npx')` with no shell
 *   fails ENOENT). The CLI resolves the first word against THIS process's
 *   PATH x PATHEXT and refuses unless it finds a `.exe`/`.com`; a pure caller
 *   without a resolver gets only a fixed shim/extension list. What is
 *   guaranteed is that check against the installer's own PATH — Claude
 *   Code's PATH can differ, which is why an absolute `.exe` path is the
 *   suggested remedy when resolution fails. Tokens with unexpanded `$VAR` /
 *   `%VAR%` are treated as unresolvable.
 */

const BOM = String.fromCharCode(0xfeff);

export type InstallPlan = { ok: true; text: string; command: string } | { ok: false; reason: string };

/** How a win32 first word resolves against PATH x PATHEXT. */
export type ExecutableResolution =
  | { kind: 'exe'; path: string }
  | { kind: 'not-exe'; path: string }
  | { kind: 'not-found' };

export interface PlanOptions {
  /**
   * Platform the wrapper will run on; only `win32` changes the plan (shim
   * refusal). Defaults to a non-win32 plan — the CLI always passes
   * `process.platform`.
   */
  platform?: NodeJS.Platform;
  /**
   * win32 only: classifies the command's first word (quotes stripped). When
   * omitted, the fixed shim/extension list is the only win32 check. The CLI
   * injects `resolveWin32Executable` over its own environment.
   */
  resolveExecutable?: (token: string) => ExecutableResolution;
}

/** Shell metacharacters a no-shell wrapper cannot reproduce. Newlines separate commands too. */
const METACHARACTERS: readonly string[] = ['|', ';', '&', '<', '>', '`', '$(', '(', ')', '\n', '\r'];

/** Package-runner shims that are `.cmd` files on win32. */
const WIN32_SHIMS: ReadonlySet<string> = new Set(['npx', 'npm', 'pnpm', 'pnpx', 'yarn', 'bunx']);
const WIN32_SHELL_ONLY_EXTENSIONS = /\.(cmd|bat|ps1|sh)$/i;

/** Matches a command already pointing at a checkpoint statusline wrapper, from any checkout. */
const ALREADY_WRAPPED = /checkpoint(?:\.cjs)?['"]?\s+statusline(?:\s|$)/;

const SCRIPT_REMEDY =
  'move the command into a script and set statusLine.command to run that script ' +
  '(e.g. bash ~/.claude/statusline.sh), then re-run statusline-install';

function describeChar(ch: string): string {
  if (ch === '\n') return 'a newline';
  if (ch === '\r') return 'a carriage return';
  return `"${ch}"`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/** The first shell word, with a surrounding quote pair stripped. */
function firstToken(command: string): string {
  const s = command.trimStart();
  const quote = s[0];
  if (quote === '"' || quote === "'") {
    const end = s.indexOf(quote, 1);
    return end === -1 ? s.slice(1) : s.slice(1, end);
  }
  return /^\S*/.exec(s)?.[0] ?? '';
}

function isJsonWhitespace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * Start offsets of every JSON string token in `text` that equals `literal`
 * and is a VALUE (not followed by `:`). `text` must already parse as JSON, so
 * every `"` outside a string opens a string token.
 */
function valueTokenOffsets(text: string, literal: string): number[] {
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    const start = i;
    for (i++; i < text.length && text[i] !== '"'; i++) {
      if (text[i] === '\\') i++;
    }
    const end = i + 1;
    let next = end;
    while (next < text.length && isJsonWhitespace(text[next])) next++;
    if (text[next] !== ':' && end - start === literal.length && text.slice(start, end) === literal) {
      offsets.push(start);
    }
  }
  return offsets;
}

/** Refusal reason for an existing command that cannot be wrapped, or null. */
function unwrappableReason(command: string, opts: PlanOptions): string | null {
  if (command.trim().length === 0) return 'statusLine.command is empty';
  if (ALREADY_WRAPPED.test(command)) {
    return 'statusLine.command already runs the checkpoint statusline wrapper; not wrapping it twice';
  }
  const found = METACHARACTERS.filter((m) => command.includes(m));
  if (found.length > 0) {
    return (
      `statusLine.command contains shell metacharacter(s) ${found.map(describeChar).join(', ')}, ` +
      'which the wrapper cannot reproduce because it runs the inner command without a shell; ' +
      SCRIPT_REMEDY
    );
  }
  if (/^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(command)) {
    return (
      'statusLine.command starts with an environment assignment, which a shell applies but the ' +
      'wrapper (no shell) would try to run as a program; set the variable in the settings "env" ' +
      `block, or ${SCRIPT_REMEDY}`
    );
  }
  // Builtins/keywords a shell runs itself; a no-shell spawn of these fails
  // ENOENT or runs a different program (e.g. /usr/bin/time), so refuse.
  const builtin = /^\s*(exec|source|eval|command|builtin|time|\.)(?:\s|$)/.exec(command);
  if (builtin !== null) {
    return `statusLine.command starts with the shell builtin "${builtin[1] ?? ''}", which the wrapper (no shell) cannot run; ${SCRIPT_REMEDY}`;
  }
  if (opts.platform === 'win32') {
    const token = firstToken(command);
    const base = token.split(/[\\/]/).pop() ?? token;
    if (WIN32_SHIMS.has(base.toLowerCase()) || WIN32_SHELL_ONLY_EXTENSIONS.test(base)) {
      return (
        `statusLine.command starts with "${token}", which on Windows is a shim or script that ` +
        'cannot be started without a shell, and the wrapper runs the inner command with no shell; ' +
        'point statusLine.command at a real executable (e.g. bash ~/.claude/statusline.sh or ' +
        'node <script>.js), then re-run statusline-install'
      );
    }
    if (opts.resolveExecutable !== undefined) {
      const resolved = opts.resolveExecutable(token);
      if (resolved.kind === 'not-exe') {
        return (
          `statusLine.command's first word "${token}" resolves to ${resolved.path}, which is not a .exe/.com ` +
          'and cannot be started without a shell (the wrapper runs the inner command with no shell); ' +
          'point statusLine.command at a .exe instead (e.g. node <script>.js), then re-run statusline-install'
        );
      }
      if (resolved.kind === 'not-found') {
        return (
          `cannot find statusLine.command's first word "${token}" as a .exe/.com on this PATH (PATH x PATHEXT); ` +
          "Claude Code's PATH may differ from this shell's, so use an absolute path to a .exe " +
          '(e.g. "C:/Program Files/nodejs/node.exe" <script>.js), then re-run statusline-install'
        );
      }
    }
  }
  return null;
}

/** Splices a new `statusLine` member in before the top-level closing brace. */
function insertMember(text: string, literal: string): string | null {
  let close = text.length - 1;
  while (close >= 0 && isJsonWhitespace(text[close])) close--;
  if (text[close] !== '}') return null;
  let last = close - 1;
  while (last >= 0 && isJsonWhitespace(text[last])) last--;
  if (last < 0) return null;
  const empty = text[last] === '{';
  const comma = empty ? '' : ',';

  const multiline = /[\r\n]/.test(text.slice(0, close));
  if (!multiline) {
    const member = `"statusLine": {"type": "command", "command": ${literal}}`;
    return `${text.slice(0, last + 1)}${comma}${member}${text.slice(last + 1)}`;
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '  ';
  const member =
    `${eol}${indent}"statusLine": {` +
    `${eol}${indent}${indent}"type": "command",` +
    `${eol}${indent}${indent}"command": ${literal}` +
    `${eol}${indent}}`;
  // An empty multi-line object `{\n}` keeps its closing line break.
  return `${text.slice(0, last + 1)}${comma}${member}${text.slice(last + 1)}`;
}

/**
 * Pure: true only when `afterText` parses to `beforeText`'s object with
 * nothing changed except `statusLine.command`, now `command` (or, when
 * `beforeText` had no `statusLine`, with exactly `{type: "command", command}`
 * added).
 */
export function verifyOnlyStatusLineChanged(beforeText: string, afterText: string, command: string): boolean {
  let before: Record<string, unknown> | null;
  let after: Record<string, unknown> | null;
  try {
    before = asRecord(JSON.parse(stripBom(beforeText)));
    after = asRecord(JSON.parse(stripBom(afterText)));
  } catch {
    return false;
  }
  if (before === null || after === null) return false;
  const { statusLine: newStatusLine, ...restAfter } = after;
  const { statusLine: oldStatusLine, ...restBefore } = before;
  if (!isDeepStrictEqual(restAfter, restBefore)) return false;
  const hadStatusLine = Object.prototype.hasOwnProperty.call(before, 'statusLine');
  const expected = hadStatusLine ? { ...asRecord(oldStatusLine), command } : { type: 'command', command };
  return isDeepStrictEqual(newStatusLine, expected);
}

/**
 * Pure: plans the install of `<wrapperPrefix> statusline -- <original>` (or
 * `<wrapperPrefix> statusline` when there is no statusLine) into the raw
 * settings text. Returns the full new text, or a one-line refusal.
 */
export function planStatuslineInstall(settingsText: string, wrapperPrefix: string, opts: PlanOptions = {}): InstallPlan {
  let before: unknown;
  try {
    before = JSON.parse(stripBom(settingsText));
  } catch (err) {
    return { ok: false, reason: `settings file is not valid JSON (${(err as Error).message.replace(/\s+/g, ' ')})` };
  }
  const root = asRecord(before);
  if (root === null) return { ok: false, reason: 'settings file is not a JSON object' };

  let command: string;
  let next: string;
  if (Object.prototype.hasOwnProperty.call(root, 'statusLine')) {
    const statusLine = asRecord(root['statusLine']);
    if (statusLine === null) return { ok: false, reason: 'statusLine is not an object' };
    if (statusLine['type'] !== 'command') {
      return { ok: false, reason: `statusLine.type is ${JSON.stringify(statusLine['type'])}, not "command"` };
    }
    const original = statusLine['command'];
    if (typeof original !== 'string') return { ok: false, reason: 'statusLine.command is not a string' };
    const refusal = unwrappableReason(original, opts);
    if (refusal !== null) return { ok: false, reason: refusal };

    command = `${wrapperPrefix} statusline -- ${original}`;
    const oldLiteral = JSON.stringify(original);
    const offsets = valueTokenOffsets(settingsText, oldLiteral);
    const at = offsets[0];
    if (offsets.length !== 1 || at === undefined) {
      return {
        ok: false,
        reason:
          `cannot locate statusLine.command's string literal exactly once among the file's string values ` +
          `(found ${offsets.length} occurrence(s)); edit statusLine.command by hand`,
      };
    }
    next = settingsText.slice(0, at) + JSON.stringify(command) + settingsText.slice(at + oldLiteral.length);
  } else {
    command = `${wrapperPrefix} statusline`;
    const inserted = insertMember(settingsText, JSON.stringify(command));
    if (inserted === null) return { ok: false, reason: "cannot find the settings object's closing brace" };
    next = inserted;
  }

  if (!verifyOnlyStatusLineChanged(settingsText, next, command)) {
    return { ok: false, reason: 'refusing: the planned edit would change more than statusLine' };
  }
  return { ok: true, text: next, command };
}

export type WrapperPrefix = { ok: true; prefix: string } | { ok: false; reason: string };

/** Pure: `node '<binPath with forward slashes>'`, refusing a path single quotes cannot carry. */
export function wrapperPrefixFor(binPath: string): WrapperPrefix {
  const path = binPath.replace(/\\/g, '/');
  // PowerShell treats U+2018-U+201B as single-quote delimiters too, so any of
  // them in the path could close the quote and inject commands.
  if (/['‘-‛\r\n]/.test(path)) {
    return { ok: false, reason: `the checkpoint bin path ${JSON.stringify(path)} contains a quote or newline` };
  }
  return { ok: true, prefix: `node '${path}'` };
}

/** Absolute path of this package's `bin/checkpoint.cjs` (from `dist/` or `src/` alike). */
export function checkpointBinPath(): string {
  return fileURLToPath(new URL('../bin/checkpoint.cjs', import.meta.url));
}

// ---------------------------------------------------------------------------
// Impure shell
// ---------------------------------------------------------------------------

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Case-insensitive env lookup (win32 spells it `Path`). */
function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

/**
 * Best-effort win32 resolution of a command's first word, the way a shell
 * would find it: a word with a path separator (or `~/`, expanded to `home`)
 * is checked as `<path><ext>` for each PATHEXT entry, then as-is; a bare word
 * is searched in PATH order (`;`-separated), trying the exact name first only
 * when it already has an extension, then `<word><ext>` per PATHEXT. The first
 * existing file decides: `.exe`/`.com` is `exe`, anything else `not-exe`.
 * Unexpanded `$VAR`/`%VAR%` words, and any failure, are `not-found`.
 */
export function resolveWin32Executable(
  token: string,
  env: Record<string, string | undefined>,
  home: string,
): ExecutableResolution {
  try {
    if (token.length === 0 || /[$%]/.test(token)) return { kind: 'not-found' };
    const exts = (envValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
      .split(';')
      .filter((e) => e.length > 0)
      .map((e) => e.toLowerCase());
    const classify = (path: string): ExecutableResolution =>
      /\.(exe|com)$/i.test(path) ? { kind: 'exe', path } : { kind: 'not-exe', path };
    const word = /^~(?=$|[\\/])/.test(token) ? `${home}${token.slice(1)}` : token;

    if (/[\\/]/.test(word) || /^[A-Za-z]:/.test(word)) {
      const base = resolve(word);
      for (const candidate of [...exts.map((e) => `${base}${e}`), base]) {
        if (isFile(candidate)) return classify(candidate);
      }
      return { kind: 'not-found' };
    }

    const hasExt = /\.[^.]+$/.test(word);
    const names = [...(hasExt ? [word] : []), ...exts.map((e) => `${word}${e}`)];
    for (const dir of (envValue(env, 'PATH') ?? '').split(';')) {
      if (dir.length === 0) continue;
      for (const name of names) {
        const candidate = resolve(dir, name);
        if (isFile(candidate)) return classify(candidate);
      }
    }
    return { kind: 'not-found' };
  } catch {
    return { kind: 'not-found' };
  }
}

export interface InstallOptions {
  settingsPath: string;
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  binPath?: string;
  platform?: NodeJS.Platform;
}

const NOTICE_PREFIX = 'checkpoint statusline-install: ';

/** Reads, plans, and (only on ok) atomically rewrites the settings file. Resolves 0, or 2 on refusal. */
export async function installStatusline(opts: InstallOptions): Promise<number> {
  const refuse = (reason: string): number => {
    opts.stderr.write(`${NOTICE_PREFIX}${reason}; ${opts.settingsPath} left unchanged\n`);
    return 2;
  };
  const prefix = wrapperPrefixFor(opts.binPath ?? checkpointBinPath());
  if (!prefix.ok) return refuse(prefix.reason);

  let raw: Buffer;
  // The target's permission bits, carried onto the replacement: the rename
  // must not widen a private (e.g. 0600) settings file whose env block can
  // hold secrets. atomicWriteText applies the mode at create time.
  let mode: number;
  try {
    raw = await readFile(opts.settingsPath);
    mode = statSync(opts.settingsPath).mode & 0o7777;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return refuse(`cannot read ${opts.settingsPath} (${e.code ?? e.message})`);
  }
  // Strict decode, BOM kept as text: a lossy decode would rewrite invalid
  // bytes as U+FFFD (EF BF BD) on write, outside statusLine.
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    return refuse('settings file is not valid UTF-8');
  }
  if (!Buffer.from(text, 'utf8').equals(raw)) return refuse('settings file does not round-trip as UTF-8');

  const platform = opts.platform ?? process.platform;
  const plan = planStatuslineInstall(text, prefix.prefix, {
    platform,
    ...(platform === 'win32'
      ? { resolveExecutable: (token: string) => resolveWin32Executable(token, process.env, homedir()) }
      : {}),
  });
  if (!plan.ok) return refuse(plan.reason);

  try {
    await atomicWriteText(opts.settingsPath, plan.text, { mode });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return refuse(`cannot write ${opts.settingsPath} (${e.code ?? e.message})`);
  }
  opts.stdout.write(`statusLine.command set to: ${plan.command}\n`);
  return 0;
}
