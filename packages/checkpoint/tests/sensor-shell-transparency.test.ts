// Byte-transparency of `checkpoint statusline` through the shells Claude
// Code actually runs statusline commands with (phase 331, task T4, AC-1).
//
// For each shell S the inner statusline fixture runs through S, then the
// wrapper wrapping the same inner runs through S with the same stdin, and the
// two stdout buffers must be byte-equal. bash runs on every platform (Git
// Bash on win32, asserted via `uname -s`); PowerShell runs on win32 only, and
// is spawned by the test itself so the path is forced regardless of what
// Claude Code would detect.
//
// Lines prefixed `[331-01/AC-1 measure]` are measurements for the phase
// report: raw-node versus through-shell inner bytes, the argv a probe
// receives through `powershell.exe -Command` with and without `--`, and exit
// code forwarding. Nothing asserts their direction.
//
// The subject here is bytes and recording, not the record deadline, so the
// shell helpers give every child a generous CHECKPOINT_RECORD_DEADLINE_MS
// (helpers/shells.ts, 331-02/AC-7).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertBashIsGitBashOnWin32,
  bashQuote,
  psQuote,
  resolveBash,
  runBash,
  runPowerShell,
} from './helpers/shells.js';
import type { ShellResult } from './helpers/shells.js';

const BIN = join(__dirname, '..', 'bin', 'checkpoint.cjs');
const FIXTURES = join(__dirname, 'fixtures', 'statusline');
const INNER = join(FIXTURES, 'inner-statusline.cjs');
const NODE = process.execPath;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MEASURE = '[331-01/AC-1 measure]';
const NOTICE = 'checkpoint statusline:';

/** Measured evidence for the phase report (stderr, not stdout), as in sensor-concurrency.test.ts. */
function measure(line: string): void {
  process.stderr.write(`${line}\n`);
}

type Json = Record<string, unknown>;

function loadPayload(): Json {
  return JSON.parse(readFileSync(join(FIXTURES, 'payload-42.json'), 'utf8')) as Json;
}

/** payload-42 with its session directories pointed at the temp project. */
function payloadFor(projectDir: string): Buffer {
  const payload = loadPayload();
  payload['cwd'] = projectDir;
  payload['workspace'] = { current_dir: projectDir, project_dir: projectDir };
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

function expectedAbsolute(): Json {
  const cw = loadPayload()['context_window'] as Json;
  return {
    total_input_tokens: cw['total_input_tokens'],
    total_output_tokens: cw['total_output_tokens'],
    context_window_size: cw['context_window_size'],
    current_usage: cw['current_usage'],
  };
}

function readingPath(projectDir: string): string {
  return join(projectDir, '.cadence', 'checkpoint', 'reading.json');
}

function expectReading42(projectDir: string): void {
  const path = readingPath(projectDir);
  expect(existsSync(path), path).toBe(true);
  const reading = JSON.parse(readFileSync(path, 'utf8')) as Json;
  expect(reading).toEqual({
    used_percentage: 42,
    unknown: false,
    absolute: expectedAbsolute(),
    exceeds_200k_tokens: false,
    current_dir: projectDir,
    project_dir: projectDir,
    ts: expect.stringMatching(ISO) as unknown as string,
  });
}

/** The inner fixture run directly by node: no shell, no wrapper. */
function runInnerRaw(input: Buffer, cwd: string): Buffer {
  const r = spawnSync(NODE, [INNER], { input, cwd, windowsHide: true });
  // A measurement must never fail the test: a failed spawn reads as no bytes.
  return Buffer.isBuffer(r.stdout) ? r.stdout : Buffer.alloc(0);
}

/** Equal/not-equal, lengths, and (if different) hex around the first differing byte. */
function describeBytes(label: string, a: Buffer, b: Buffer): string {
  if (a.equals(b)) return `${label}: equal (${a.length} bytes)`;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const start = Math.max(0, i - 8);
  const end = i + 32;
  return (
    `${label}: NOT equal (lengths ${a.length} vs ${b.length}; first difference at byte ${i}); ` +
    `hex[${start}..${end}) ${a.subarray(start, end).toString('hex')} vs ${b.subarray(start, end).toString('hex')}`
  );
}

/** Proves the through-shell inner run is not trivially empty and got its stdin. */
function expectInnerOutputReal(inner: ShellResult): void {
  expect(inner.stdout.length).toBeGreaterThan(0);
  // The fixture echoes model.display_name from stdin; "Opus" survives any
  // single-byte re-encoding, so this proves the payload reached the inner.
  expect(inner.stdout.toString('latin1')).toContain('Opus');
}

let tmp: string;
let project: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'checkpoint-shells-'));
  project = join(tmp, 'project');
  mkdirSync(join(project, '.cadence'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('checkpoint statusline byte transparency through shells', () => {
  it('331-01/AC-1: through bash -c (Git Bash on win32), the wrapper stdout is byte-identical to the inner stdout and the reading records used_percentage 42', () => {
    const bash = resolveBash();
    const uname = assertBashIsGitBashOnWin32(bash);
    measure(`${MEASURE} bash resolved to ${bash}; uname -s = ${uname}`);
    if (process.platform === 'win32') {
      expect(uname).toMatch(/MINGW|MSYS/);
    } else {
      expect(uname.length).toBeGreaterThan(0);
    }

    const input = payloadFor(project);
    const innerCmd = `${bashQuote(NODE)} ${bashQuote(INNER)}`;
    const wrapperCmd = `${bashQuote(NODE)} ${bashQuote(BIN)} statusline -- ${bashQuote(NODE)} ${bashQuote(INNER)}`;

    const inner = runBash(innerCmd, { input, cwd: tmp });
    expect(inner.status).toBe(0);
    expectInnerOutputReal(inner);
    expect(existsSync(readingPath(project))).toBe(false);

    const wrapped = runBash(wrapperCmd, { input, cwd: tmp });
    expect(wrapped.status).toBe(0);
    expect(wrapped.stderr).not.toContain(NOTICE);
    expect(wrapped.stdout.equals(inner.stdout)).toBe(true);
    expectReading42(project);

    measure(`${MEASURE} ${describeBytes('raw node inner vs bash inner', runInnerRaw(input, tmp), inner.stdout)}`);
    measure(`${MEASURE} ${describeBytes('bash inner vs bash wrapper', inner.stdout, wrapped.stdout)}`);
  });

  it.runIf(process.platform === 'win32')(
    '331-01/AC-1: through powershell.exe -NoProfile -Command, the wrapper stdout is byte-identical to the inner stdout with and without --, and the reading records used_percentage 42',
    () => {
      const input = payloadFor(project);
      const innerCmd = `& ${psQuote(NODE)} ${psQuote(INNER)}`;
      const wrapperCmd = `& ${psQuote(NODE)} ${psQuote(BIN)} statusline -- ${psQuote(NODE)} ${psQuote(INNER)}`;
      const wrapperNoDashCmd = `& ${psQuote(NODE)} ${psQuote(BIN)} statusline ${psQuote(NODE)} ${psQuote(INNER)}`;

      const inner = runPowerShell(innerCmd, { input, cwd: tmp });
      expect(inner.status).toBe(0);
      expectInnerOutputReal(inner);
      expect(existsSync(readingPath(project))).toBe(false);

      const wrapped = runPowerShell(wrapperCmd, { input, cwd: tmp });
      expect(wrapped.status).toBe(0);
      expect(wrapped.stderr).not.toContain(NOTICE);
      expect(wrapped.stdout.equals(inner.stdout)).toBe(true);
      expectReading42(project);

      // The no-`--` form: the reading must be recreated, proving the payload
      // reached the wrapper on this path too.
      rmSync(readingPath(project));
      const wrappedNoDash = runPowerShell(wrapperNoDashCmd, { input, cwd: tmp });
      expect(wrappedNoDash.status).toBe(0);
      expect(wrappedNoDash.stderr).not.toContain(NOTICE);
      expect(wrappedNoDash.stdout.equals(inner.stdout)).toBe(true);
      expectReading42(project);

      const raw = runInnerRaw(input, tmp);
      measure(`${MEASURE} ${describeBytes('raw node inner vs PowerShell inner', raw, inner.stdout)}`);
      measure(`${MEASURE} raw node inner hex: ${raw.toString('hex')}`);
      measure(`${MEASURE} PowerShell inner hex: ${inner.stdout.toString('hex')}`);
      measure(`${MEASURE} ${describeBytes('PowerShell inner vs PowerShell wrapper (--)', inner.stdout, wrapped.stdout)}`);
      measure(
        `${MEASURE} ${describeBytes('PowerShell inner vs PowerShell wrapper (no --)', inner.stdout, wrappedNoDash.stdout)}`,
      );
      measure(
        `${MEASURE} PowerShell exit status: inner ${String(inner.status)}, wrapper (--) ${String(wrapped.status)}, wrapper (no --) ${String(wrappedNoDash.status)}`,
      );
    },
  );

  it.runIf(process.platform === 'win32')(
    '331-01/AC-1: measures the argv a probe receives through powershell.exe -Command with and without --, and exit code forwarding',
    () => {
      const probe = join(tmp, 'argv-probe.cjs');
      writeFileSync(probe, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
      const none = { input: Buffer.alloc(0), cwd: tmp };

      const forms = {
        'statusline -- node x': `& ${psQuote(NODE)} ${psQuote(probe)} statusline -- node x`,
        'statusline node x': `& ${psQuote(NODE)} ${psQuote(probe)} statusline node x`,
      };
      for (const [form, cmd] of Object.entries(forms)) {
        const r = runPowerShell(cmd, none);
        const argv = JSON.parse(r.stdout.toString('utf8')) as unknown;
        expect(Array.isArray(argv)).toBe(true);
        expect((argv as unknown[])[0]).toBe('statusline');
        measure(`${MEASURE} PowerShell -Command argv for \`${form}\`: ${JSON.stringify(argv)}`);
      }

      const input = payloadFor(project);
      const exits = {
        'inner exits 3': `& ${psQuote(NODE)} ${psQuote(INNER)} 3`,
        'inner exits 3; exit $LASTEXITCODE': `& ${psQuote(NODE)} ${psQuote(INNER)} 3; exit $LASTEXITCODE`,
        'wrapper around inner exiting 3': `& ${psQuote(NODE)} ${psQuote(BIN)} statusline -- ${psQuote(NODE)} ${psQuote(INNER)} 3`,
      };
      for (const [form, cmd] of Object.entries(exits)) {
        const r = runPowerShell(cmd, { input, cwd: tmp });
        expect(typeof r.status).toBe('number');
        measure(`${MEASURE} PowerShell -Command exit status for \`${form}\`: ${String(r.status)}`);
      }
    },
  );
});
