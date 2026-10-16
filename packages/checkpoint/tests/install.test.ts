// `checkpoint statusline-install` (phase 331, task T5, AC-8): installing the
// statusline wrapper changes only the `statusLine` value of a settings file.
//
// The "only statusLine changed" proofs here deliberately do NOT reuse
// install.ts's own splice arithmetic: the excision helpers below locate the
// `statusLine` member with their own string-aware scan, so a wrong splice
// offset in the implementation cannot also be wrong in the check.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  planStatuslineInstall,
  resolveWin32Executable,
  verifyOnlyStatusLineChanged,
  wrapperPrefixFor,
} from '../src/install.js';
import type { ExecutableResolution, PlanOptions } from '../src/install.js';
import { runBash, runPowerShell } from './helpers/shells.js';

const BIN = join(__dirname, '..', 'bin', 'checkpoint.cjs');
const SETTINGS_FIXTURES = join(__dirname, 'fixtures', 'settings');
const INNER = join(__dirname, 'fixtures', 'statusline', 'inner-statusline.cjs');
const REPO_SETTINGS = join(__dirname, '..', '..', '..', '.claude', 'settings.json');
const PREFIX = "node '/opt/cadence/packages/checkpoint/bin/checkpoint.cjs'";

type Json = Record<string, unknown>;

function fixture(name: string): string {
  return readFileSync(join(SETTINGS_FIXTURES, name), 'utf8');
}

function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

/** Both line-ending forms, built here rather than trusting checked-out bytes. */
function bothEols(text: string): ReadonlyArray<readonly [string, string]> {
  const lf = text.replace(/\r\n/g, '\n');
  return [
    ['LF', lf],
    ['CRLF', toCrlf(lf)],
  ];
}

function parse(text: string): Json {
  return JSON.parse(text.replace(/^\uFEFF/, '')) as Json;
}

function withoutStatusLine(obj: Json): Json {
  const copy = { ...obj };
  delete copy['statusLine'];
  return copy;
}

/** End index (exclusive) of the JSON value starting at `start` (an object or a string). */
function valueEnd(text: string, start: number): number {
  if (text[start] === '"') {
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === '\\') i++;
      else if (text[i] === '"') return i + 1;
    }
    throw new Error('unterminated string');
  }
  if (text[start] !== '{') throw new Error(`expected an object at ${start}, got ${JSON.stringify(text[start])}`);
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('unbalanced object');
}

/** The single `"statusLine"` key's offsets: key start and value start/end. */
function locateStatusLine(text: string): { keyStart: number; valueStart: number; valueEnd: number } {
  const matches = [...text.matchAll(/"statusLine"\s*:\s*/g)];
  expect(matches, 'exactly one "statusLine" key').toHaveLength(1);
  const m = matches[0] as RegExpMatchArray;
  const keyStart = m.index as number;
  const valueStart = keyStart + m[0].length;
  return { keyStart, valueStart, valueEnd: valueEnd(text, valueStart) };
}

/** The text with the statusLine VALUE replaced by a marker (key kept). */
function exciseStatusLineValue(text: string): string {
  const { valueStart, valueEnd: end } = locateStatusLine(text);
  return `${text.slice(0, valueStart)}<EXCISED>${text.slice(end)}`;
}

/** The text with the whole statusLine MEMBER removed, including its separating comma. */
function exciseStatusLineMember(text: string): string {
  const { keyStart, valueEnd: end } = locateStatusLine(text);
  let i = keyStart - 1;
  while (i >= 0 && /\s/.test(text[i] as string)) i--;
  if (text[i] === ',') return text.slice(0, i) + text.slice(end);
  // First member of the object: drop the member and its trailing comma, if any.
  let j = end;
  while (j < text.length && /\s/.test(text[j] as string)) j++;
  return text.slice(0, i + 1) + text.slice(text[j] === ',' ? j + 1 : end);
}

function planOk(text: string, platform: NodeJS.Platform = 'linux', extra: PlanOptions = {}): string {
  const plan = planStatuslineInstall(text, PREFIX, { ...extra, platform });
  if (!plan.ok) throw new Error(`expected ok, got refusal: ${plan.reason}`);
  return plan.text;
}

function planRefused(text: string, platform: NodeJS.Platform = 'linux', extra: PlanOptions = {}): string {
  const plan = planStatuslineInstall(text, PREFIX, { ...extra, platform });
  expect(plan.ok, 'expected a refusal').toBe(false);
  if (plan.ok) throw new Error('unreachable');
  expect(plan.reason).not.toContain('\n');
  return plan.reason;
}

function settingsWithCommand(command: string): string {
  return `{\n  "hooks": {},\n  "statusLine": {\n    "type": "command",\n    "command": ${JSON.stringify(command)}\n  }\n}\n`;
}

// ---------------------------------------------------------------------------
// Pure: planStatuslineInstall
// ---------------------------------------------------------------------------

describe('planStatuslineInstall', () => {
  for (const [eol, before] of bothEols(fixture('with-hooks-and-statusline.json'))) {
    it(`331-01/AC-8: an existing simple command is wrapped and only the statusLine value changes (${eol})`, () => {
      const after = planOk(before);
      expect(exciseStatusLineValue(after)).toBe(exciseStatusLineValue(before));

      const b = parse(before);
      const a = parse(after);
      expect(a['hooks']).toEqual(b['hooks']);
      expect(withoutStatusLine(a)).toEqual(withoutStatusLine(b));
      const original = (b['statusLine'] as Json)['command'] as string;
      expect(original).toBe('node ~/.claude/statusline.js --theme "dark mode" ünï');
      expect(a['statusLine']).toEqual({
        type: 'command',
        command: `${PREFIX} statusline -- ${original}`,
        padding: 0,
      });
      if (eol === 'CRLF') expect(after.replace(/\r\n/g, '')).not.toContain('\n');
    });
  }

  for (const [eol, before] of bothEols(fixture('with-hooks-no-statusline.json'))) {
    it(`331-01/AC-8: with no statusLine a member is inserted and nothing else changes (${eol})`, () => {
      const after = planOk(before);
      expect(exciseStatusLineMember(after)).toBe(before);

      const b = parse(before);
      const a = parse(after);
      expect(a['hooks']).toEqual(b['hooks']);
      expect(withoutStatusLine(a)).toEqual(b);
      expect(a['statusLine']).toEqual({ type: 'command', command: `${PREFIX} statusline` });
      // The file's 4-space indentation and line endings are followed.
      const nl = eol === 'CRLF' ? '\r\n' : '\n';
      expect(after).toContain(`,${nl}    "statusLine": {${nl}        "type": "command",${nl}`);
      if (eol === 'CRLF') expect(after.replace(/\r\n/g, '')).not.toContain('\n');
    });
  }

  for (const [eol, before] of bothEols(fixture('with-piped-statusline.json'))) {
    it(`331-01/AC-8: a piped command is refused with a message suggesting a script wrapper (${eol})`, () => {
      const reason = planRefused(before);
      expect(reason).toMatch(/\|/);
      expect(reason).toMatch(/script/i);
    });
  }

  it('331-01/AC-8: every listed shell metacharacter is refused; a bare $VAR is not', () => {
    for (const command of [
      'a | b',
      'a; b',
      'a && b',
      'a & b',
      'a < in.txt',
      'a > out.txt',
      'echo `date`',
      'echo $(date)',
      'a\nb',
    ]) {
      const reason = planRefused(settingsWithCommand(command));
      expect(reason, command).toMatch(/script/i);
    }
    const after = planOk(settingsWithCommand('bash $HOME/.claude/statusline.sh'));
    expect((parse(after)['statusLine'] as Json)['command']).toBe(
      `${PREFIX} statusline -- bash $HOME/.claude/statusline.sh`,
    );
  });

  it('331-01/AC-8: an already-wrapped command is refused, whichever checkout installed it', () => {
    for (const name of ['with-hooks-and-statusline.json', 'with-hooks-no-statusline.json']) {
      const once = planOk(fixture(name));
      const reason = planRefused(once);
      expect(reason, name).toMatch(/already/i);
    }
    for (const command of [
      "node 'C:/other/checkout/packages/checkpoint/bin/checkpoint.cjs' statusline -- node x.js",
      'node "/elsewhere/bin/checkpoint.cjs" statusline',
      'checkpoint statusline -- node x.js',
    ]) {
      expect(planRefused(settingsWithCommand(command)), command).toMatch(/already/i);
    }
  });

  it('331-01/AC-8: a statusLine that is not a type "command" object is refused', () => {
    const cases = [
      '{"statusLine": {"type": "static", "command": "node x"}}',
      '{"statusLine": {"command": "node x"}}',
      '{"statusLine": {"type": "command"}}',
      '{"statusLine": {"type": "command", "command": 7}}',
      '{"statusLine": {"type": "command", "command": "   "}}',
      '{"statusLine": "node x"}',
      '{"statusLine": null}',
    ];
    for (const text of cases) planRefused(text);
  });

  it('331-01/AC-8: text that is not a JSON object is refused', () => {
    for (const text of ['', 'not json', '{"a": 1,}', '[]', 'null', '42']) planRefused(text);
  });

  it('331-01/AC-8: refuses when the command string literal occurs more than once', () => {
    const text =
      '{\n  "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "node x.js"}]}]},\n' +
      '  "statusLine": {"type": "command", "command": "node x.js"}\n}\n';
    expect(planRefused(text)).toMatch(/exactly once|2 times|occurrence/i);
  });

  it('331-01/AC-8: refuses rather than re-serializing when the command literal is escape-encoded differently', () => {
    // JSON.parse reads "\u006eode x.js" as "node x.js", but that literal is
    // not in the text, so there is nothing to splice in place.
    const text = '{\n  "statusLine": {"type": "command", "command": "\\u006eode x.js"}\n}\n';
    expect((parse(text)['statusLine'] as Json)['command']).toBe('node x.js');
    expect(planRefused(text)).toMatch(/locate|occurrence|exactly once/i);
  });

  it('331-01/AC-8: inserts into empty and compact objects', () => {
    for (const text of ['{}', '{\n}\n', '{ }']) {
      const after = planOk(text);
      expect(parse(after), JSON.stringify(text)).toEqual({ statusLine: { type: 'command', command: `${PREFIX} statusline` } });
    }
    const compact = planOk('{"model":"opus"}');
    expect(exciseStatusLineMember(compact)).toBe('{"model":"opus"}');
    expect(parse(compact)).toEqual({ model: 'opus', statusLine: { type: 'command', command: `${PREFIX} statusline` } });
  });

  it('331-01/AC-8: a UTF-8 BOM is preserved and does not block the install', () => {
    const before = `\uFEFF${fixture('with-hooks-and-statusline.json')}`;
    const after = planOk(before);
    expect(after.startsWith('\uFEFF')).toBe(true);
    expect(exciseStatusLineValue(after)).toBe(exciseStatusLineValue(before));
  });

  it('331-01/AC-8: on win32 a .cmd/.bat/.ps1/.sh or package-runner shim first token is refused; on linux it is wrapped', () => {
    const shims = [
      'npx -y ccstatusline@latest',
      'pnpm dlx ccstatusline',
      'yarn dlx ccstatusline',
      'bunx ccstatusline',
      'C:/tools/status.cmd --short',
      '"C:/Program Files/Status Tools/status.bat" --short',
      '~/.claude/statusline.sh',
      'C:/scripts/statusline.ps1',
    ];
    for (const command of shims) {
      const reason = planRefused(settingsWithCommand(command), 'win32');
      expect(reason, command).toMatch(/without a shell|no shell/i);
      expect(planOk(settingsWithCommand(command), 'linux'), command).toContain('statusline -- ');
    }
    for (const command of ['node C:/x/statusline.js', 'bash ~/.claude/statusline.sh', '"C:/Program Files/nodejs/node.exe" x.js']) {
      expect(planOk(settingsWithCommand(command), 'win32'), command).toContain('statusline -- ');
    }
  });

  // I2 (review): the command literal is located by whole JSON string tokens,
  // never by raw substring, and keys never count as a match.
  it('331-01/AC-8: the reviewer\'s escaped-quote input is refused, not spliced into another value', () => {
    const text = '{"hooks":{"k":"a"},"z":"q\\"a","statusLine":{"type":"command","command":"a"}}';
    expect((parse(text)['z'] as string)).toBe('q"a');
    expect(planRefused(text)).toMatch(/exactly once|occurrence/i);
  });

  it('331-01/AC-8: a value ending in an escaped-quote copy of the literal does not count as an occurrence', () => {
    const before = '{"z":"q\\"a","statusLine":{"type":"command","command":"a"}}';
    const after = planOk(before);
    expect(exciseStatusLineValue(after)).toBe(exciseStatusLineValue(before));
    expect(parse(after)['z']).toBe('q"a');
    expect((parse(after)['statusLine'] as Json)['command']).toBe(`${PREFIX} statusline -- a`);
  });

  it('331-01/AC-8: an object key equal to the literal is not a candidate occurrence', () => {
    const before = '{\n  "env": {"node x.js": "1"},\n  "statusLine": {"type": "command", "command": "node x.js"}\n}\n';
    const after = planOk(before);
    expect(exciseStatusLineValue(after)).toBe(exciseStatusLineValue(before));
    expect(parse(after)['env']).toEqual({ 'node x.js': '1' });
  });

  it('331-01/AC-8: verifyOnlyStatusLineChanged (the post-check) rejects a splice that touched anything else', () => {
    const before = '{"z":"q\\"a","statusLine":{"type":"command","command":"a","padding":1}}';
    const good = '{"z":"q\\"a","statusLine":{"type":"command","command":"W","padding":1}}';
    expect(verifyOnlyStatusLineChanged(before, good, 'W')).toBe(true);
    // The substring splice the reviewer measured: the tail of z rewritten.
    expect(verifyOnlyStatusLineChanged(before, '{"z":"q\\"W","statusLine":{"type":"command","command":"a","padding":1}}', 'W')).toBe(false);
    expect(verifyOnlyStatusLineChanged(before, '{"z":"q\\"a","statusLine":{"type":"command","command":"W","padding":2}}', 'W')).toBe(false);
    expect(verifyOnlyStatusLineChanged(before, '{"z":"q\\"a","statusLine":{"type":"command","command":"X","padding":1}}', 'W')).toBe(false);
    expect(verifyOnlyStatusLineChanged(before, 'not json', 'W')).toBe(false);
    const bare = '{"z":1}';
    expect(verifyOnlyStatusLineChanged(bare, '{"z":1,"statusLine":{"type":"command","command":"W"}}', 'W')).toBe(true);
    expect(verifyOnlyStatusLineChanged(bare, '{"z":1,"statusLine":{"type":"command","command":"W","x":0}}', 'W')).toBe(false);
  });

  // M1 (review): more shapes a no-shell spawn cannot reproduce.
  it('331-01/AC-8: parentheses, a leading NAME=value assignment, and a leading exec are refused', () => {
    for (const command of ['(node x.js)', 'node "C:/Program Files (x86)/x.js"', 'FOO=1 node x.js', 'exec node x.js', '  exec node x.js']) {
      expect(planRefused(settingsWithCommand(command)), command).toMatch(/script|shell/i);
    }
    expect(planOk(settingsWithCommand('node x.js --opt=FOO=1'))).toContain('statusline -- node x.js --opt=FOO=1');
    expect(planOk(settingsWithCommand('executor x'))).toContain('statusline -- executor x');
  });

  // I3 (whole-branch review): `source`, `.` and `eval` are shell builtins a
  // no-shell spawn fails with ENOENT, so a working statusline would be
  // replaced by a blank one. Refused on every platform, before any resolver.
  // Settle code-review HIGH (attempt 2): `command` and `builtin` are shell
  // builtins and `time` a bash keyword; a no-shell spawn of any of them fails
  // ENOENT (or runs a different program). Refusal is the fail-safe direction.
  it('331-01/AC-8: a leading source, dot, eval, command, builtin, or time is refused on linux and on win32 without a resolver', () => {
    for (const platform of ['linux', 'win32'] as const) {
      for (const command of [
        'source ~/.claude/statusline.sh',
        '. ~/x.sh',
        'eval node x.js',
        '  source x.sh',
        'source',
        'command node x.js',
        'builtin echo x',
        'time node x.js',
      ]) {
        const before = settingsWithCommand(command);
        expect(planRefused(before, platform), `${platform}: ${command}`).toMatch(/builtin.*script/i);
      }
    }
    // A path that merely starts with a dot, or a word that merely starts with
    // a builtin's name, is not a builtin.
    expect(planOk(settingsWithCommand('./statusline.sh'), 'linux')).toContain('statusline -- ./statusline.sh');
    expect(planOk(settingsWithCommand('.\\x.exe'), 'linux')).toContain('statusline -- .\\\\x.exe');
    expect(planOk(settingsWithCommand('sourcery x'), 'linux')).toContain('statusline -- sourcery x');
    expect(planOk(settingsWithCommand('evaluate x'), 'linux')).toContain('statusline -- evaluate x');
    expect(planOk(settingsWithCommand('commander x'), 'linux')).toContain('statusline -- commander x');
    expect(planOk(settingsWithCommand('timeout 5 node x.js'), 'linux')).toContain('statusline -- timeout 5 node x.js');
    expect(planOk(settingsWithCommand('builtins x'), 'linux')).toContain('statusline -- builtins x');
  });

  // I3 (review): on win32 the first token is resolved (PATH x PATHEXT) by the
  // impure shell and the plan refuses anything that is not a .exe/.com.
  it('331-01/AC-8: on win32 an injected resolver decides: .exe passes, a .cmd or script is refused naming it, not-found names PATH', () => {
    const seen: string[] = [];
    const resolver = (answer: ExecutableResolution) => (token: string): ExecutableResolution => {
      seen.push(token);
      return answer;
    };
    const exe = planOk(settingsWithCommand('"C:/Program Files/Tool/tool.exe" --x'), 'win32', {
      resolveExecutable: resolver({ kind: 'exe', path: 'C:/Program Files/Tool/tool.exe' }),
    });
    expect(exe).toContain('statusline -- ');
    expect(seen).toEqual(['C:/Program Files/Tool/tool.exe']);

    const cmd = planRefused(settingsWithCommand('cadence --version'), 'win32', {
      resolveExecutable: resolver({ kind: 'not-exe', path: 'C:/Users/me/AppData/Roaming/npm/cadence.cmd' }),
    });
    expect(cmd).toContain('C:/Users/me/AppData/Roaming/npm/cadence.cmd');
    expect(cmd).toMatch(/\.exe/);
    expect(cmd).toMatch(/node <script>\.js/);

    const missing = planRefused(settingsWithCommand('~/.claude/statusline'), 'win32', {
      resolveExecutable: resolver({ kind: 'not-found' }),
    });
    expect(missing).toMatch(/PATH/);
    expect(missing).toMatch(/absolute path/i);

    // The resolver is consulted on win32 only; without one, the fixed shim
    // list is the pure fallback (so `cadence --version` alone passes).
    seen.length = 0;
    planOk(settingsWithCommand('cadence --version'), 'linux', { resolveExecutable: resolver({ kind: 'not-found' }) });
    expect(seen).toEqual([]);
    expect(planOk(settingsWithCommand('cadence --version'), 'win32')).toContain('statusline -- cadence --version');
  });
});

describe('resolveWin32Executable', () => {
  const PATHEXT = '.COM;.EXE;.BAT;.CMD;.PS1';
  let dir: string;
  let other: string;

  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'checkpoint-resolve-')));
    other = join(dir, 'other');
    mkdirSync(other);
    for (const name of ['tool.cmd', 'real.exe', 'script', 'both.cmd']) writeFileSync(join(dir, name), '');
    writeFileSync(join(other, 'both.exe'), '');
    writeFileSync(join(other, 'late.exe'), '');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function resolveIn(token: string): ExecutableResolution {
    return resolveWin32Executable(token, { PATH: `${dir};${other}`, PATHEXT }, dir);
  }

  it('331-01/AC-8: classifies bare names by the first PATH x PATHEXT hit, in PATH order', () => {
    expect(resolveIn('tool')).toEqual({ kind: 'not-exe', path: join(dir, 'tool.cmd') });
    expect(resolveIn('real')).toEqual({ kind: 'exe', path: join(dir, 'real.exe') });
    expect(resolveIn('real.exe')).toEqual({ kind: 'exe', path: join(dir, 'real.exe') });
    // First PATH dir wins, as the shell would pick it: both.cmd shadows both.exe.
    expect(resolveIn('both')).toEqual({ kind: 'not-exe', path: join(dir, 'both.cmd') });
    expect(resolveIn('late')).toEqual({ kind: 'exe', path: join(other, 'late.exe') });
    expect(resolveIn('missing')).toEqual({ kind: 'not-found' });
    // An extensionless file on PATH is not what a shell would run by bare name.
    expect(resolveIn('script')).toEqual({ kind: 'not-found' });
  });

  it('331-01/AC-8: classifies a path token directly, with PATHEXT tried before the exact name', () => {
    expect(resolveIn(fwd(join(dir, 'real')))).toEqual({ kind: 'exe', path: join(dir, 'real.exe') });
    expect(resolveIn(fwd(join(dir, 'real.exe')))).toEqual({ kind: 'exe', path: join(dir, 'real.exe') });
    expect(resolveIn(fwd(join(dir, 'tool.cmd')))).toEqual({ kind: 'not-exe', path: join(dir, 'tool.cmd') });
    expect(resolveIn(fwd(join(dir, 'script')))).toEqual({ kind: 'not-exe', path: join(dir, 'script') });
    expect(resolveIn(fwd(join(dir, 'nope')))).toEqual({ kind: 'not-found' });
    // A leading ~ expands to the given home directory.
    expect(resolveIn('~/real.exe')).toEqual({ kind: 'exe', path: join(dir, 'real.exe') });
    // Unexpanded variables cannot be resolved here.
    expect(resolveIn('$HOME/real.exe')).toEqual({ kind: 'not-found' });
    expect(resolveIn('%USERPROFILE%/real.exe')).toEqual({ kind: 'not-found' });
  });
});

describe('wrapperPrefixFor', () => {
  it('331-01/AC-8: writes the bin path with forward slashes inside single quotes after a bare node', () => {
    expect(wrapperPrefixFor('C:\\Users\\Me Too\\cadence\\packages\\checkpoint\\bin\\checkpoint.cjs')).toEqual({
      ok: true,
      prefix: "node 'C:/Users/Me Too/cadence/packages/checkpoint/bin/checkpoint.cjs'",
    });
    expect(wrapperPrefixFor('/opt/x/checkpoint.cjs')).toEqual({ ok: true, prefix: "node '/opt/x/checkpoint.cjs'" });
  });

  it('331-01/AC-8: refuses a bin path that single quotes cannot carry', () => {
    const r = wrapperPrefixFor("/home/o'brien/checkpoint.cjs");
    expect(r.ok).toBe(false);
  });

  // Settle code-review HIGH: PowerShell also treats U+2018-U+201B as
  // single-quote delimiters, so a checkout path holding one could close the
  // quote and inject commands into statusLine.command.
  it('331-01/AC-8: refuses a bin path carrying any quote PowerShell treats as a single quote (U+2018-U+201B)', () => {
    for (const quote of ['‘', '’', '‚', '‛']) {
      const r = wrapperPrefixFor(`/home/x${quote}; Remove-Item -Recurse ~ ;${quote}/checkpoint.cjs`);
      expect(r.ok, `U+${quote.codePointAt(0)?.toString(16).toUpperCase()}`).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/quote/);
    }
    // Neighbouring typographic double quotes are not single-quote delimiters.
    expect(wrapperPrefixFor('/home/“x”/checkpoint.cjs').ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CLI-level: the built bin
// ---------------------------------------------------------------------------

interface ProcResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string, env?: NodeJS.ProcessEnv): ProcResult {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    windowsHide: true,
    encoding: 'utf8',
    ...(env !== undefined ? { env } : {}),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** PATH-like env keys are case-insensitive on win32; replace whichever spelling is present. */
function envWithPathPrepended(dir: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[key] = `${dir};${env[key] ?? ''}`;
  return env;
}

function fwd(path: string): string {
  return path.replace(/\\/g, '/');
}

let tmp: string;

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'checkpoint-install-')));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('checkpoint statusline-install (built bin)', () => {
  const builtPrefix = wrapperPrefixFor(BIN);

  it('331-01/AC-8: wraps a tmp copy of the fixture in place, matching the pure plan, leaving no temp sibling', () => {
    const settings = join(tmp, 'settings.json');
    copyFileSync(join(SETTINGS_FIXTURES, 'with-hooks-and-statusline.json'), settings);
    const before = readFileSync(settings, 'utf8');

    const r = runCli(['statusline-install', '--settings', settings], tmp);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);

    const after = readFileSync(settings, 'utf8');
    expect(builtPrefix.ok).toBe(true);
    if (!builtPrefix.ok) return;
    const plan = planStatuslineInstall(before, builtPrefix.prefix, { platform: process.platform });
    expect(plan.ok).toBe(true);
    // Raw bytes, not decoded strings: a lossy decode/re-encode would hide here.
    if (plan.ok) expect(readFileSync(settings).equals(Buffer.from(plan.text, 'utf8'))).toBe(true);
    const rawBefore = readFileSync(join(SETTINGS_FIXTURES, 'with-hooks-and-statusline.json'));
    const literal = Buffer.from(JSON.stringify((parse(before)['statusLine'] as Json)['command']), 'utf8');
    const at = rawBefore.indexOf(literal);
    expect(at).toBeGreaterThan(0);
    const rawAfter = readFileSync(settings);
    expect(rawAfter.subarray(0, at).equals(rawBefore.subarray(0, at))).toBe(true);
    const tail = rawBefore.subarray(at + literal.length);
    expect(rawAfter.subarray(rawAfter.length - tail.length).equals(tail)).toBe(true);
    expect(exciseStatusLineValue(after)).toBe(exciseStatusLineValue(before));
    expect(parse(after)['hooks']).toEqual(parse(before)['hooks']);
    expect((parse(after)['statusLine'] as Json)['command']).toBe(
      `node '${fwd(BIN)}' statusline -- node ~/.claude/statusline.js --theme "dark mode" ünï`,
    );
    expect(readdirSync(tmp)).toEqual(['settings.json']);
  });

  // Settle code-review HIGH: the atomic rename must not widen a private
  // settings file's mode (its env block can hold secrets). POSIX modes only;
  // win32 has no comparable permission bits for fs.chmod to set.
  it.runIf(process.platform !== 'win32')('331-01/AC-8: a 0600 settings file stays 0600 after the wrap', () => {
    const settings = join(tmp, 'settings.json');
    copyFileSync(join(SETTINGS_FIXTURES, 'with-hooks-and-statusline.json'), settings);
    chmodSync(settings, 0o600);
    const r = runCli(['statusline-install', '--settings', settings], tmp);
    expect(r.status).toBe(0);
    expect((parse(readFileSync(settings, 'utf8'))['statusLine'] as Json)['command']).toContain('statusline -- ');
    expect(statSync(settings).mode & 0o777).toBe(0o600);
  });

  it('331-01/AC-8: inserts a statusLine into a tmp copy of the no-statusLine fixture', () => {
    const settings = join(tmp, 'settings.json');
    copyFileSync(join(SETTINGS_FIXTURES, 'with-hooks-no-statusline.json'), settings);
    const before = readFileSync(settings, 'utf8');
    const r = runCli(['statusline-install', '--settings', settings], tmp);
    expect(r.status).toBe(0);
    const after = readFileSync(settings, 'utf8');
    expect(exciseStatusLineMember(after)).toBe(before);
    expect(parse(after)['statusLine']).toEqual({ type: 'command', command: `node '${fwd(BIN)}' statusline` });
  });

  it('331-01/AC-8: refuses the piped fixture, leaving the file byte-unchanged, and suggests a script wrapper', () => {
    const settings = join(tmp, 'settings.json');
    copyFileSync(join(SETTINGS_FIXTURES, 'with-piped-statusline.json'), settings);
    const before = readFileSync(settings);
    const mtime = statSync(settings).mtimeMs;

    const r = runCli(['statusline-install', '--settings', settings], tmp);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/^checkpoint statusline-install: /);
    expect(r.stderr).toMatch(/script/i);
    expect(r.stderr.trim().split(/\r?\n/)).toHaveLength(1);
    expect(readFileSync(settings).equals(before)).toBe(true);
    expect(statSync(settings).mtimeMs).toBe(mtime);
    expect(readdirSync(tmp)).toEqual(['settings.json']);
  });

  it('331-01/AC-8: a second install is refused and leaves the installed file byte-unchanged', () => {
    const settings = join(tmp, 'settings.json');
    copyFileSync(join(SETTINGS_FIXTURES, 'with-hooks-and-statusline.json'), settings);
    expect(runCli(['statusline-install', '--settings', settings], tmp).status).toBe(0);
    const once = readFileSync(settings);
    const again = runCli(['statusline-install', '--settings', settings], tmp);
    expect(again.status).toBe(2);
    expect(again.stderr).toMatch(/already/i);
    expect(readFileSync(settings).equals(once)).toBe(true);
  });

  it('331-01/AC-8: a missing settings file is refused and not created; a missing --settings is a usage error', () => {
    const settings = join(tmp, 'nope', 'settings.json');
    const r = runCli(['statusline-install', '--settings', settings], tmp);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(settings);
    expect(existsSync(settings)).toBe(false);

    const usage = runCli(['statusline-install'], tmp);
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain('checkpoint statusline-install --settings <path>');
    expect(usage.stderr).toContain('Usage: checkpoint validate <path>');
  });

  // I1 (review): a lossy UTF-8 decode would turn a stray 0xE9 into U+FFFD and
  // re-encode it as EF BF BD on write — a byte change outside statusLine that
  // a decoded-string comparison cannot see.
  it('331-01/AC-8: a settings file that is not valid UTF-8 is refused with one line and left byte-identical', () => {
    const settings = join(tmp, 'settings.json');
    const text = fixture('with-hooks-and-statusline.json');
    const marker = '"deja hook pre-tool-use"';
    const at = text.indexOf(marker);
    expect(at).toBeGreaterThan(0);
    const raw = Buffer.concat([
      Buffer.from(text.slice(0, at + marker.length - 1), 'utf8'),
      Buffer.from([0x20, 0x63, 0x61, 0x66, 0xe9]), // " caf" + Windows-1252 é
      Buffer.from(text.slice(at + marker.length - 1), 'utf8'),
    ]);
    writeFileSync(settings, raw);
    const mtime = statSync(settings).mtimeMs;

    const r = runCli(['statusline-install', '--settings', settings], tmp);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/UTF-8/);
    expect(r.stderr.trim().split(/\r?\n/)).toHaveLength(1);
    expect(readFileSync(settings).equals(raw)).toBe(true);
    expect(statSync(settings).mtimeMs).toBe(mtime);
    expect(readdirSync(tmp)).toEqual(['settings.json']);
  });

  it('331-01/AC-8: a UTF-8 BOM survives the CLI install byte-for-byte', () => {
    const settings = join(tmp, 'settings.json');
    const raw = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      readFileSync(join(SETTINGS_FIXTURES, 'with-hooks-no-statusline.json')),
    ]);
    writeFileSync(settings, raw);
    const r = runCli(['statusline-install', '--settings', settings], tmp);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const after = readFileSync(settings);
    expect(after.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    expect(after.subarray(3, 3 + 20).equals(raw.subarray(3, 3 + 20))).toBe(true);
    expect(Buffer.from(exciseStatusLineMember(after.toString('utf8')), 'utf8').equals(raw)).toBe(true);
  });

  it("331-01/AC-8: the reviewer's escaped-quote input is refused at the CLI and left byte-unchanged", () => {
    const settings = join(tmp, 'settings.json');
    const raw = Buffer.from('{"hooks":{"k":"a"},"z":"q\\"a","statusLine":{"type":"command","command":"a"}}', 'utf8');
    writeFileSync(settings, raw);
    const r = runCli(['statusline-install', '--settings', settings], tmp);
    expect(r.status).toBe(2);
    expect(readFileSync(settings).equals(raw)).toBe(true);
  });

  it.runIf(process.platform === 'win32')(
    '331-01/AC-8: on win32 a first token that resolves to a .cmd on PATH is refused naming the resolved file; an unresolvable one names PATH',
    () => {
      const bin = join(tmp, 'pathbin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'fakestatus.cmd'), '@echo off\r\necho hi\r\n');
      const env = envWithPathPrepended(bin);
      // Premise: a no-shell spawn really cannot start it.
      const probe = spawnSync('fakestatus', ['--x'], { env, windowsHide: true, shell: false });
      expect(probe.error).toBeDefined();

      const settings = join(tmp, 'settings.json');
      const raw = Buffer.from(settingsWithCommand('fakestatus --x'), 'utf8');
      writeFileSync(settings, raw);
      const r = runCli(['statusline-install', '--settings', settings], tmp, env);
      expect(r.status).toBe(2);
      expect(r.stderr.toLowerCase()).toContain(join(bin, 'fakestatus.cmd').toLowerCase());
      expect(readFileSync(settings).equals(raw)).toBe(true);

      const missingRaw = Buffer.from(settingsWithCommand('no-such-statusline-tool-331 --x'), 'utf8');
      writeFileSync(settings, missingRaw);
      const missing = runCli(['statusline-install', '--settings', settings], tmp, env);
      expect(missing.status).toBe(2);
      expect(missing.stderr).toMatch(/PATH/);
      expect(readFileSync(settings).equals(missingRaw)).toBe(true);
    },
  );

  // The installed command must actually run through both shells Claude Code
  // uses on Windows, with the wrapper as byte-transparent as the original.
  function installedCommandFor(project: string): { original: string; installed: string; input: Buffer } {
    const original = `node '${fwd(INNER)}'`;
    const settings = join(tmp, 'settings.json');
    writeFileSync(settings, settingsWithCommand(original));
    const r = runCli(['statusline-install', '--settings', settings], tmp);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const installed = (parse(readFileSync(settings, 'utf8'))['statusLine'] as Json)['command'] as string;
    expect(installed).toBe(`node '${fwd(BIN)}' statusline -- ${original}`);
    const payload = JSON.parse(
      readFileSync(join(__dirname, 'fixtures', 'statusline', 'payload-42.json'), 'utf8'),
    ) as Json;
    payload['cwd'] = project;
    payload['workspace'] = { current_dir: project, project_dir: project };
    return { original, installed, input: Buffer.from(JSON.stringify(payload), 'utf8') };
  }

  function makeProject(): string {
    const project = join(tmp, 'project');
    mkdirSync(join(project, '.cadence'), { recursive: true });
    return project;
  }

  it('331-01/AC-8: the installed command runs through bash byte-transparently and records the reading', () => {
    const project = makeProject();
    const { original, installed, input } = installedCommandFor(project);
    const direct = runBash(original, { input, cwd: project });
    expect(direct.status).toBe(0);
    expect(direct.stdout.length).toBeGreaterThan(0);
    const wrapped = runBash(installed, { input, cwd: project });
    expect(wrapped.stderr).toBe('');
    expect(wrapped.status).toBe(0);
    expect(wrapped.stdout.equals(direct.stdout)).toBe(true);
    const reading = JSON.parse(readFileSync(join(project, '.cadence', 'checkpoint', 'reading.json'), 'utf8')) as Json;
    expect(reading['used_percentage']).toBe(42);
  });

  it.runIf(process.platform === 'win32')(
    '331-01/AC-8: the installed command runs through powershell.exe -NoProfile -Command byte-transparently and records the reading',
    () => {
      const project = makeProject();
      const { original, installed, input } = installedCommandFor(project);
      const direct = runPowerShell(original, { input, cwd: project });
      expect(direct.status).toBe(0);
      expect(direct.stdout.length).toBeGreaterThan(0);
      const wrapped = runPowerShell(installed, { input, cwd: project });
      expect(wrapped.stderr).toBe('');
      expect(wrapped.status).toBe(0);
      expect(wrapped.stdout.equals(direct.stdout)).toBe(true);
      const reading = JSON.parse(
        readFileSync(join(project, '.cadence', 'checkpoint', 'reading.json'), 'utf8'),
      ) as Json;
      expect(reading['used_percentage']).toBe(42);
    },
  );
});

describe("the repository's own settings", () => {
  it('331-01/AC-8: the tracked .claude/settings.json carries no statusLine (this phase installs nothing into it)', () => {
    expect(existsSync(REPO_SETTINGS)).toBe(true);
    const settings = parse(readFileSync(REPO_SETTINGS, 'utf8'));
    expect(Object.prototype.hasOwnProperty.call(settings, 'statusLine')).toBe(false);
    expect(settings['hooks']).toBeDefined();
  });
});
