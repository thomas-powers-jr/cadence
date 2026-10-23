// `checkpoint hooks-install` (phase 336, task T7, AC-12 and AC-20): the
// installer writes checkpoint's own `_managedBy: "cadence-checkpoint"` Stop
// and SessionStart entries, is idempotent, and leaves cadence's
// `_managedBy: "cadence"` entries and every user-authored entry alone.
//
// The "nothing else changed" proofs here deliberately do not reuse the
// installer's own guard: `withoutCheckpointEntries` below strips the managed
// entries with its own walk, so a wrong guard cannot also be wrong in the
// check.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE_CODE_EXPECTED_HOOKS } from '@thomas-powers-jr/cadence-host-toolkit';
import { mergeManagedHookEntries } from '@thomas-powers-jr/cadence-host-toolkit/install-merge';
import type { ManagedHookEntry } from '@thomas-powers-jr/cadence-host-toolkit/install-merge';
import {
  CHECKPOINT_MANAGED_BY,
  desiredCheckpointHooks,
  installHooks,
  parseHooksInstallArgs,
  planHooksInstall,
  verifyOnlyManagedHooksChanged,
} from '../src/install-hooks.js';
import { wrapperPrefixFor } from '../src/install.js';

const BIN = join(__dirname, '..', 'bin', 'checkpoint.cjs');
const PREFIX = "node '/opt/cadence/packages/checkpoint/bin/checkpoint.cjs'";
const BOM = String.fromCharCode(0xfeff);

type Json = Record<string, unknown>;

const CADENCE_COMMAND = 'npx @thomas-powers-jr/cadence-host-claude-code hook';

const USER_PRE = { matcher: 'Bash', hooks: [{ type: 'command', command: 'node ~/.claude/guard.js' }] };
const USER_STOP = { hooks: [{ type: 'command', command: 'bash ~/.claude/my-stop.sh --loud' }] };
const USER_SESSION = { matcher: 'startup', hooks: [{ type: 'command', command: 'echo hello' }] };
const CADENCE_PRE = {
  matcher: 'Edit|Write|MultiEdit|NotebookEdit',
  hooks: [{ type: 'command', command: CADENCE_COMMAND }],
  _managedBy: 'cadence',
};
const CADENCE_STOP = { hooks: [{ type: 'command', command: CADENCE_COMMAND }], _managedBy: 'cadence' };
const CADENCE_SESSION = { hooks: [{ type: 'command', command: CADENCE_COMMAND }], _managedBy: 'cadence' };

/** A settings object with user-authored hooks AND cadence's own managed entries, interleaved. */
function mixedSettings(): Json {
  return {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    env: { FOO: 'bar ünï' },
    permissions: { allow: ['Bash(ls:*)'], deny: [] },
    hooks: {
      PreToolUse: [USER_PRE, CADENCE_PRE],
      Stop: [USER_STOP, CADENCE_STOP],
      SessionStart: [CADENCE_SESSION, USER_SESSION],
    },
    statusLine: { type: 'command', command: 'bash ~/.claude/statusline.sh' },
  };
}

function serialize(obj: unknown): string {
  return JSON.stringify(obj, null, 2) + '\n';
}

function parse(text: string): Json {
  return JSON.parse(text.replace(/^﻿/, '')) as Json;
}

function isCheckpointEntry(entry: unknown): boolean {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    (entry as Record<string, unknown>)['_managedBy'] === 'cadence-checkpoint'
  );
}

/** Independent of the installer's guard: drops checkpoint entries (and keys only they created). */
function withoutCheckpointEntries(obj: Json, original: Json): Json {
  const copy = JSON.parse(JSON.stringify(obj)) as Json;
  const hooks = copy['hooks'] as Record<string, unknown[]> | undefined;
  if (hooks === undefined) return copy;
  const originalHooks = (original['hooks'] ?? {}) as Record<string, unknown>;
  for (const event of ['Stop', 'SessionStart']) {
    const list = hooks[event];
    if (list === undefined) continue;
    const kept = list.filter((e) => !isCheckpointEntry(e));
    if (kept.length === 0 && !(event in originalHooks)) delete hooks[event];
    else hooks[event] = kept;
  }
  if (Object.keys(hooks).length === 0 && !('hooks' in original)) delete copy['hooks'];
  return copy;
}

function checkpointEntries(obj: Json, event: string): unknown[] {
  const list = ((obj['hooks'] as Record<string, unknown[]> | undefined)?.[event] ?? []) as unknown[];
  return list.filter(isCheckpointEntry);
}

function stopCommand(prefix: string, threshold: number, ceiling: number): string {
  return `${prefix} stop-gate --threshold ${threshold} --ceiling ${ceiling}`;
}

function fwd(path: string): string {
  return path.replace(/\\/g, '/');
}

interface ProcResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): ProcResult {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, windowsHide: true, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

let tmp: string;

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'checkpoint-install-hooks-')));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Built bin
// ---------------------------------------------------------------------------

describe('checkpoint hooks-install (built bin)', () => {
  const builtPrefix = `node '${fwd(BIN)}'`;

  it('336-01/AC-12: run twice over user + cadence hooks, the second run reports "already installed" and writes nothing', () => {
    const settings = join(tmp, 'settings.json');
    const original = mixedSettings();
    writeFileSync(settings, serialize(original));

    const first = runCli(['hooks-install', '--settings', settings], tmp);
    expect(first.stderr).toBe('');
    expect(first.status).toBe(0);
    const afterFirst = readFileSync(settings);
    const parsedFirst = parse(afterFirst.toString('utf8'));
    expect(checkpointEntries(parsedFirst, 'Stop')).toEqual([
      {
        hooks: [{ type: 'command', command: stopCommand(builtPrefix, 70, 3) }],
        _managedBy: 'cadence-checkpoint',
      },
    ]);
    expect(checkpointEntries(parsedFirst, 'SessionStart')).toEqual([
      { hooks: [{ type: 'command', command: `${builtPrefix} session-start` }], _managedBy: 'cadence-checkpoint' },
    ]);
    expect(withoutCheckpointEntries(parsedFirst, original)).toEqual(original);
    expect(readdirSync(tmp)).toEqual(['settings.json']);

    // Backdate the mtime so an unwanted rewrite would be visible.
    const past = new Date(Date.now() - 3_600_000);
    utimesSync(settings, past, past);
    const mtimeBefore = statSync(settings).mtimeMs;

    const second = runCli(['hooks-install', '--settings', settings], tmp);
    expect(second.status).toBe(0);
    expect(second.stderr).toBe('');
    expect(second.stdout).toMatch(/already installed/);
    expect(readFileSync(settings).equals(afterFirst)).toBe(true);
    expect(statSync(settings).mtimeMs).toBe(mtimeBefore);
    expect(readdirSync(tmp)).toEqual(['settings.json']);
  });

  it('336-01/AC-12: re-running with a different --threshold replaces the checkpoint Stop entry instead of duplicating it', () => {
    const settings = join(tmp, 'settings.json');
    const original = mixedSettings();
    writeFileSync(settings, serialize(original));

    expect(runCli(['hooks-install', '--settings', settings], tmp).status).toBe(0);
    const r = runCli(['hooks-install', `--settings=${settings}`, '--threshold=85', '--ceiling', '5'], tmp);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/already installed/);

    const after = parse(readFileSync(settings, 'utf8'));
    expect(checkpointEntries(after, 'Stop')).toEqual([
      { hooks: [{ type: 'command', command: stopCommand(builtPrefix, 85, 5) }], _managedBy: 'cadence-checkpoint' },
    ]);
    expect(checkpointEntries(after, 'SessionStart')).toHaveLength(1);
    expect(withoutCheckpointEntries(after, original)).toEqual(original);

    // And the same flags again are a no-op.
    const bytes = readFileSync(settings);
    const again = runCli(['hooks-install', '--settings', settings, '--threshold', '85', '--ceiling=5'], tmp);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/already installed/);
    expect(readFileSync(settings).equals(bytes)).toBe(true);
  });

  it('336-01/AC-20: installing over a file holding cadence and user entries keeps both, unchanged and in order; no parsed value outside the checkpoint entries changes, and the guard refuses a planned edit that changes one', () => {
    const settings = join(tmp, 'settings.json');
    const original = mixedSettings();
    const beforeText = serialize(original);
    writeFileSync(settings, beforeText);

    expect(runCli(['hooks-install', '--settings', settings], tmp).status).toBe(0);
    const afterText = readFileSync(settings, 'utf8');
    const after = parse(afterText);
    const hooks = after['hooks'] as Record<string, unknown[]>;
    expect(hooks['PreToolUse']).toEqual([USER_PRE, CADENCE_PRE]);
    expect(hooks['Stop']?.slice(0, 2)).toEqual([USER_STOP, CADENCE_STOP]);
    expect(hooks['SessionStart']?.slice(0, 2)).toEqual([CADENCE_SESSION, USER_SESSION]);
    expect(hooks['Stop']).toHaveLength(3);
    expect(hooks['SessionStart']).toHaveLength(3);
    expect(Object.keys(after)).toEqual(Object.keys(original));

    // Semantic equality as JSON.parse sees the file (AC-20 as built): with the
    // checkpoint entries removed, the installed file parses to the original.
    expect(withoutCheckpointEntries(after, original)).toEqual(original);

    // And the installer's guard refuses a plan that changes a value outside them.
    const prefix = wrapperPrefixFor(BIN);
    expect(prefix.ok).toBe(true);
    if (!prefix.ok) return;
    const desired = desiredCheckpointHooks(prefix.prefix, { threshold: 70, ceiling: 3 });
    expect(verifyOnlyManagedHooksChanged(beforeText, afterText, desired)).toBe(true);
    const tampered = parse(afterText);
    (tampered['env'] as Json)['FOO'] = 'changed';
    expect(verifyOnlyManagedHooksChanged(beforeText, serialize(tampered), desired)).toBe(false);
  });

  it('336-01/AC-20: after install, cadence\'s own merge with its default stale rule keeps the checkpoint entries', () => {
    const settings = join(tmp, 'settings.json');
    writeFileSync(settings, serialize(mixedSettings()));
    expect(runCli(['hooks-install', '--settings', settings], tmp).status).toBe(0);
    const installed = parse(readFileSync(settings, 'utf8'));
    const before = installed['hooks'] as Record<string, ManagedHookEntry[]>;

    // The same desired map host-claude-code's installer builds.
    const desired: Record<string, ManagedHookEntry[]> = {};
    for (const { event, matcher } of CLAUDE_CODE_EXPECTED_HOOKS) {
      (desired[event] ??= []).push({
        ...(matcher === null ? {} : { matcher }),
        hooks: [{ type: 'command', command: `${CADENCE_COMMAND} --v2` }],
        _managedBy: 'cadence',
      });
    }
    const merged = mergeManagedHookEntries(before, desired) as unknown as Record<string, unknown[]>;
    const asObj: Json = { hooks: merged };
    expect(checkpointEntries(asObj, 'Stop')).toEqual(checkpointEntries(installed, 'Stop'));
    expect(checkpointEntries(asObj, 'SessionStart')).toEqual(checkpointEntries(installed, 'SessionStart'));
    expect(checkpointEntries(asObj, 'Stop')).toHaveLength(1);
    expect(checkpointEntries(asObj, 'SessionStart')).toHaveLength(1);
    // Cadence's old entries were replaced, the user's kept.
    expect(merged['Stop']).toContainEqual(USER_STOP);
    expect(merged['Stop']).not.toContainEqual(CADENCE_STOP);

    // Cadence re-appended its entries after ours; the next hooks-install is
    // still "already installed" and does not rewrite just to reorder.
    writeFileSync(settings, serialize({ ...installed, hooks: merged }));
    const bytes = readFileSync(settings);
    const again = runCli(['hooks-install', '--settings', settings], tmp);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/already installed/);
    expect(readFileSync(settings).equals(bytes)).toBe(true);
  });

  it('336-01/AC-20: a fresh file with no hooks gets exactly the two checkpoint entries and nothing else changes', () => {
    const settings = join(tmp, 'settings.json');
    const original = { env: { A: '1' }, model: 'opus' };
    writeFileSync(settings, serialize(original));
    const r = runCli(['hooks-install', '--settings', settings], tmp);
    expect(r.status).toBe(0);
    const after = parse(readFileSync(settings, 'utf8'));
    expect(Object.keys(after['hooks'] as Json)).toEqual(['Stop', 'SessionStart']);
    expect(withoutCheckpointEntries(after, original)).toEqual(original);
  });

  it('336-01/AC-20: a leading BOM is preserved and the re-run is still a byte-identical no-op', () => {
    const settings = join(tmp, 'settings.json');
    writeFileSync(settings, BOM + serialize(mixedSettings()));
    expect(runCli(['hooks-install', '--settings', settings], tmp).status).toBe(0);
    const afterFirst = readFileSync(settings);
    expect(afterFirst.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
    expect(checkpointEntries(parse(afterFirst.toString('utf8')), 'Stop')).toHaveLength(1);
    const second = runCli(['hooks-install', '--settings', settings], tmp);
    expect(second.stdout).toMatch(/already installed/);
    expect(readFileSync(settings).equals(afterFirst)).toBe(true);
  });

  it('336-01/AC-20: invalid JSON, non-object hooks, non-array Stop, non-UTF-8 bytes and a missing file are refused with exit 2, file untouched', () => {
    const cases: ReadonlyArray<readonly [string, Buffer, RegExp]> = [
      ['invalid JSON', Buffer.from('{"hooks": {', 'utf8'), /not valid JSON/],
      ['non-object root', Buffer.from('[1, 2]\n', 'utf8'), /not a JSON object/],
      ['non-object hooks', Buffer.from(serialize({ hooks: [] }), 'utf8'), /hooks is not an object/],
      ['non-array Stop', Buffer.from(serialize({ hooks: { Stop: { hooks: [] } } }), 'utf8'), /hooks\.Stop is not an array/],
      [
        'non-array SessionStart',
        Buffer.from(serialize({ hooks: { SessionStart: 'x' } }), 'utf8'),
        /hooks\.SessionStart is not an array/,
      ],
      ['non-UTF-8', Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]), /not valid UTF-8/],
    ];
    for (const [label, bytes, reason] of cases) {
      const settings = join(tmp, 'settings.json');
      writeFileSync(settings, bytes);
      const r = runCli(['hooks-install', '--settings', settings], tmp);
      expect(r.status, label).toBe(2);
      expect(r.stdout, label).toBe('');
      expect(r.stderr, label).toMatch(/^checkpoint hooks-install: /);
      expect(r.stderr, label).toMatch(reason);
      expect(r.stderr, label).toMatch(/left unchanged/);
      expect(r.stderr.trimEnd().split('\n'), label).toHaveLength(1);
      expect(readFileSync(settings).equals(bytes), label).toBe(true);
      expect(readdirSync(tmp), label).toEqual(['settings.json']);
    }

    const missing = join(tmp, 'nope', 'settings.json');
    const r = runCli(['hooks-install', '--settings', missing], tmp);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/cannot read .*ENOENT/);
    expect(readdirSync(tmp)).toEqual(['settings.json']);
  });

  it('336-01/AC-20: usage errors print USAGE and exit 2 without touching the file', () => {
    const settings = join(tmp, 'settings.json');
    const bytes = Buffer.from(serialize(mixedSettings()), 'utf8');
    writeFileSync(settings, bytes);
    const bad: string[][] = [
      ['hooks-install'],
      ['hooks-install', '--settings'],
      ['hooks-install', '--settings='],
      ['hooks-install', '--settings', settings, '--threshold', '0'],
      ['hooks-install', '--settings', settings, '--threshold', '101'],
      ['hooks-install', '--settings', settings, '--ceiling', '1'],
      ['hooks-install', '--settings', settings, '--ceiling=2.5'],
      ['hooks-install', '--settings', settings, '--max-reading-age-s', '60'],
      ['hooks-install', '--settings', settings, '--settings', settings],
      ['hooks-install', '--settings', settings, 'extra'],
    ];
    for (const args of bad) {
      const r = runCli(args, tmp);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stdout, args.join(' ')).toBe('');
      expect(r.stderr, args.join(' ')).toMatch(/checkpoint hooks-install --settings <path>/);
      expect(readFileSync(settings).equals(bytes), args.join(' ')).toBe(true);
    }
  });

  // POSIX modes only; win32 has no comparable permission bits for fs.chmod to set.
  it.runIf(process.platform !== 'win32')('336-01/AC-20: a 0600 settings file stays 0600 after the install', () => {
    const settings = join(tmp, 'settings.json');
    writeFileSync(settings, serialize(mixedSettings()));
    chmodSync(settings, 0o600);
    const r = runCli(['hooks-install', '--settings', settings], tmp);
    expect(r.status).toBe(0);
    expect(checkpointEntries(parse(readFileSync(settings, 'utf8')), 'Stop')).toHaveLength(1);
    expect(statSync(settings).mode & 0o777).toBe(0o600);
  });
});

// ---------------------------------------------------------------------------
// Pure planner, guard and arg parser
// ---------------------------------------------------------------------------

describe('planHooksInstall / verifyOnlyManagedHooksChanged (pure)', () => {
  const options = { threshold: 70, ceiling: 3 };

  it('336-01/AC-12: the plan is unchanged when the checkpoint entries already match, and reformats nothing then', () => {
    const first = planHooksInstall(serialize(mixedSettings()), PREFIX, options);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.changed).toBe(true);
    const second = planHooksInstall(first.text, PREFIX, options);
    expect(second).toEqual({ ok: true, changed: false, text: first.text });

    // Semantically installed but compactly formatted: still unchanged, text untouched.
    const compact = JSON.stringify(parse(first.text));
    expect(planHooksInstall(compact, PREFIX, options)).toEqual({ ok: true, changed: false, text: compact });
  });

  it('336-01/AC-20: desired entries carry the cadence-checkpoint marker, no matcher, and both flags explicitly', () => {
    expect(CHECKPOINT_MANAGED_BY).toBe('cadence-checkpoint');
    expect(desiredCheckpointHooks(PREFIX, { threshold: 72.5, ceiling: 4 })).toEqual({
      Stop: [
        {
          hooks: [{ type: 'command', command: `${PREFIX} stop-gate --threshold 72.5 --ceiling 4` }],
          _managedBy: 'cadence-checkpoint',
        },
      ],
      SessionStart: [{ hooks: [{ type: 'command', command: `${PREFIX} session-start` }], _managedBy: 'cadence-checkpoint' }],
    });
  });

  it('336-01/AC-20: the guard accepts the real plan and refuses a tampered one that changes a user, cadence or top-level value', () => {
    const before = serialize(mixedSettings());
    const plan = planHooksInstall(before, PREFIX, options);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const desired = desiredCheckpointHooks(PREFIX, options);
    expect(verifyOnlyManagedHooksChanged(before, plan.text, desired)).toBe(true);

    const tamper = (edit: (obj: Json) => void): string => {
      const obj = parse(plan.text);
      edit(obj);
      return serialize(obj);
    };
    const hooksOf = (obj: Json) => obj['hooks'] as Record<string, Json[]>;
    const tampered: ReadonlyArray<readonly [string, string]> = [
      ['top-level key changed', tamper((o) => (o['model'] = 'haiku'))],
      ['env changed', tamper((o) => ((o['env'] as Json)['FOO'] = 'baz'))],
      ['user Stop entry changed', tamper((o) => (hooksOf(o)['Stop']![0]!['matcher'] = 'x'))],
      ['cadence Stop entry dropped', tamper((o) => hooksOf(o)['Stop']!.splice(1, 1))],
      ['user/cadence order swapped', tamper((o) => hooksOf(o)['SessionStart']!.reverse())],
      ['unrelated event changed', tamper((o) => hooksOf(o)['PreToolUse']!.pop())],
      ['new event added', tamper((o) => (hooksOf(o)['Notification'] = []))],
      [
        'managed entry has the wrong command',
        tamper((o) => {
          const entry = hooksOf(o)['Stop']![2]!;
          (entry['hooks'] as Json[])[0]!['command'] = 'rm -rf ~';
        }),
      ],
      ['managed entry duplicated', tamper((o) => hooksOf(o)['Stop']!.push(hooksOf(o)['Stop']![2]!))],
      ['managed SessionStart entry missing', tamper((o) => hooksOf(o)['SessionStart']!.pop())],
      ['not JSON', '{'],
    ];
    for (const [label, text] of tampered) {
      expect(verifyOnlyManagedHooksChanged(before, text, desired), label).toBe(false);
    }
  });

  it('336-01/AC-20: user-authored entries in Stop that are not objects are kept, not crashed on', () => {
    const original = { hooks: { Stop: [null, 'odd', USER_STOP] } };
    const plan = planHooksInstall(serialize(original), PREFIX, options);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const after = parse(plan.text);
    expect((after['hooks'] as Json)['Stop']).toEqual([
      null,
      'odd',
      USER_STOP,
      { hooks: [{ type: 'command', command: stopCommand(PREFIX, 70, 3) }], _managedBy: 'cadence-checkpoint' },
    ]);
  });

  it('336-01/AC-20: the planner refuses invalid JSON, a non-object root or hooks, and a non-array Stop or SessionStart', () => {
    const refusals: ReadonlyArray<readonly [string, RegExp]> = [
      ['{', /not valid JSON/],
      ['"x"', /not a JSON object/],
      [serialize({ hooks: 'x' }), /hooks is not an object/],
      [serialize({ hooks: null }), /hooks is not an object/],
      [serialize({ hooks: { Stop: 1 } }), /hooks\.Stop is not an array/],
      [serialize({ hooks: { SessionStart: {} } }), /hooks\.SessionStart is not an array/],
    ];
    for (const [text, reason] of refusals) {
      const plan = planHooksInstall(text, PREFIX, options);
      expect(plan.ok, text).toBe(false);
      if (!plan.ok) expect(plan.reason, text).toMatch(reason);
    }
  });

  it('336-01/AC-20: a threshold whose String() form stop-gate would refuse is refused at install time', () => {
    const plan = planHooksInstall(serialize({}), PREFIX, { threshold: 0.0000001, ceiling: 3 });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/--threshold/);
  });

  it('336-01/AC-20: parseHooksInstallArgs takes --settings plus stop-gate\'s --threshold/--ceiling rules, in both flag forms', () => {
    expect(parseHooksInstallArgs(['--settings', 's.json'])).toEqual({
      ok: true,
      settingsPath: 's.json',
      options: { threshold: 70, ceiling: 3 },
    });
    expect(parseHooksInstallArgs(['--threshold=80', '--settings=s.json', '--ceiling', '4'])).toEqual({
      ok: true,
      settingsPath: 's.json',
      options: { threshold: 80, ceiling: 4 },
    });
    for (const args of [
      [],
      ['--settings'],
      ['--settings='],
      ['--settings', 'a', '--settings', 'b'],
      ['--settings', 'a', '--threshold', 'NaN'],
      ['--settings', 'a', '--threshold', '-5'],
      ['--settings', 'a', '--ceiling', '1'],
      ['--settings', 'a', '--max-reading-age-s=60'],
      ['--settings', 'a', 'stray'],
    ]) {
      expect(parseHooksInstallArgs(args).ok, args.join(' ')).toBe(false);
    }
  });

  it('336-01/AC-12: installHooks in-process writes once, then reports already installed and leaves the bytes alone', async () => {
    const settings = join(tmp, 'settings.json');
    writeFileSync(settings, serialize(mixedSettings()));
    const out: string[] = [];
    const err: string[] = [];
    const run = (flags = { threshold: 70, ceiling: 3 }) =>
      installHooks({
        settingsPath: settings,
        flags,
        binPath: BIN,
        stdout: { write: (c: string) => out.push(c) },
        stderr: { write: (c: string) => err.push(c) },
      });

    expect(await run()).toBe(0);
    expect(out.join('')).toContain(`Stop hook set to: ${stopCommand(`node '${fwd(BIN)}'`, 70, 3)}`);
    const afterFirst = readFileSync(settings);
    out.length = 0;
    expect(await run()).toBe(0);
    expect(out.join('')).toMatch(/already installed/);
    expect(readFileSync(settings).equals(afterFirst)).toBe(true);
    expect(err).toEqual([]);

    // A refused plan (non-array Stop) and an unusable bin path both exit 2, file untouched.
    const bad = Buffer.from(serialize({ hooks: { Stop: {} } }), 'utf8');
    writeFileSync(settings, bad);
    expect(await run()).toBe(2);
    expect(err.join('')).toMatch(/hooks\.Stop is not an array; .* left unchanged/);
    err.length = 0;
    const quoted = await installHooks({
      settingsPath: settings,
      flags: { threshold: 70, ceiling: 3 },
      binPath: "/opt/it's/checkpoint.cjs",
      stdout: { write: (c: string) => out.push(c) },
      stderr: { write: (c: string) => err.push(c) },
    });
    expect(quoted).toBe(2);
    expect(err.join('')).toMatch(/quote/);
    expect(readFileSync(settings).equals(bad)).toBe(true);
  });

  it('336-01/AC-20: the built prefix is the statusline installer\'s node-quoted form', () => {
    const prefix = wrapperPrefixFor(BIN);
    expect(prefix).toEqual({ ok: true, prefix: `node '${fwd(BIN)}'` });
  });
});
