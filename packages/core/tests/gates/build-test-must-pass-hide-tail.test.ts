import { describe, it, expect } from 'vitest';
import { runBuildTestGate, tailLines } from '../../src/gates/build-test-must-pass.js';
import { redactOutput, secretValues } from '../../src/verify/test-runner.js';
import type { GateResult, SettleContext, TestRunResult } from '../../src/gates/types.js';

/**
 * Phase 348 (348-01, T2): `verification.buildTestOutputTail`.
 *
 * AC-6 — under "hide" the gate prints one line counting the captured tail
 * lines in place of the whole tail block, on every refusal and every bypass,
 * and the bypass flags carry that count instead of the tail.
 * AC-7 — without the setting (null config, no `verification`, key absent,
 * "show") stderr and `flags.buildTestBypass` are what phase 346 pinned.
 */

type Config = SettleContext['config'];

function ctx(over: {
  run: TestRunResult;
  allowFailingBuild?: boolean;
  force?: boolean;
  errs: string[];
  config: Config;
}): SettleContext {
  const opts: Record<string, boolean> = {};
  if (over.allowFailingBuild) opts.allowFailingBuild = true;
  if (over.force) opts.force = true;
  return {
    cwd: '/x',
    state: { draftReadAt: null } as never,
    draft: { acceptanceCriteria: [], tasks: [] } as never,
    progress: { draftId: 'd', tasks: {} },
    config: over.config,
    gateSet: { gates: ['build-test-must-pass'], softCap: false } as never,
    opts,
    explicitIds: new Set<string>(),
    touchedFiles: [],
    coverage: async () => new Map(),
    draftMtimeMs: async () => null,
    verifiers: { deep: { verify: async () => ({ verdicts: {}, provider: 'mock' }) } },
    emit: { anomalies: async () => {} },
    runner: { test: async () => over.run },
    io: { err: (s: string) => over.errs.push(s) },
  } as unknown as SettleContext;
}

const TAIL_LINES = ['tail-348-a', 'tail-348-b', 'tail-348-c'] as const;
const TAIL = TAIL_LINES.join('\n');
const HEADER = 'output tail (last lines):';
const HIDDEN_3 = '  output tail: (hidden by config; 3 lines captured)\n';
const HIDDEN_1 = '  output tail: (hidden by config; 1 line captured)\n';
const NO_OUTPUT = '  output tail: (no output captured)\n';
const SHOWN = 'pnpm [arguments not shown]';
const COMMAND_LINE = `build-test-must-pass: ${SHOWN} exited 1\n`;
const UNSEALED_REASON =
  'settle run refused: the test suite must pass before settle. ' +
  'Pass --allow-failing-build to bypass, or --force to settle anyway.';
const SEALED_REASON =
  'settle run refused: the test suite must pass before settle. ' +
  'This gate is sealed (gates.sealed) and cannot be bypassed with ' +
  '--allow-failing-build or --force.';
/** The phase-346 tail block for the three-line tail: header, then each line indented by 4 spaces. */
const SHOW_BLOCK =
  '  output tail (last lines):\n' +
  '    tail-348-a\n' +
  '    tail-348-b\n' +
  '    tail-348-c\n';

function failing(outputTail?: string): TestRunResult {
  return {
    ran: true,
    ok: false,
    exitCode: 1,
    command: 'pnpm test',
    ...(outputTail === undefined ? {} : { outputTail }),
  };
}

const hide = { verification: { buildTestOutputTail: 'hide' } } as unknown as Config;
const hideSealed = {
  gates: { sealed: ['build-test-must-pass'] },
  verification: { buildTestOutputTail: 'hide' },
} as unknown as Config;

function expectNoTail(stderr: string): void {
  for (const line of TAIL_LINES) expect(stderr).not.toContain(line);
  expect(stderr).not.toContain(HEADER);
}

describe('runBuildTestGate · verification.buildTestOutputTail "hide" (phase 348)', () => {
  it('348-01/AC-6: an unsealed refusal prints the hidden notice in place of the whole tail block and none of the tail', async () => {
    const errs: string[] = [];
    const res = await runBuildTestGate(ctx({ run: failing(TAIL), errs, config: hide }));
    expect(res.outcome).toBe('refuse');
    expect(res.reason).toBe(UNSEALED_REASON);
    expect(errs).toEqual([COMMAND_LINE, `${UNSEALED_REASON}\n`, HIDDEN_3]);
    const stderr = errs.join('');
    expect(stderr.split('\n')).toContain('  output tail: (hidden by config; 3 lines captured)');
    expectNoTail(stderr);
    expect(res.flags).toBeUndefined();
  });

  it('348-01/AC-6: a sealed refusal prints the hidden notice in place of the whole tail block and none of the tail', async () => {
    const errs: string[] = [];
    const res = await runBuildTestGate(
      ctx({ run: failing(TAIL), errs, force: true, allowFailingBuild: true, config: hideSealed }),
    );
    expect(res.outcome).toBe('refuse');
    expect(res.reason).toBe(SEALED_REASON);
    expect(errs).toEqual([COMMAND_LINE, `${SEALED_REASON}\n`, HIDDEN_3]);
    const stderr = errs.join('');
    expect(stderr.split('\n')).toContain('  output tail: (hidden by config; 3 lines captured)');
    expectNoTail(stderr);
    expect(res.flags).toBeUndefined();
  });

  const bypasses = [
    { flag: '--allow-failing-build', opts: { allowFailingBuild: true } },
    { flag: '--force', opts: { force: true } },
  ] as const;

  for (const b of bypasses) {
    it(`348-01/AC-6: a ${b.flag} bypass writes one notice whose tail block is the hidden notice, and its flags carry the line count and no outputTail`, async () => {
      const errs: string[] = [];
      const res = await runBuildTestGate(ctx({ run: failing(TAIL), errs, ...b.opts, config: hide }));
      expect(res.outcome).toBe('pass');
      // Still exactly one io.err call, first line unchanged.
      expect(errs).toHaveLength(1);
      expect(errs[0]).toBe(
        `build-test-must-pass: BYPASSED via ${b.flag}: ${SHOWN} exited 1\n${HIDDEN_3}`,
      );
      expect(errs[0]!.split('\n')).toContain('  output tail: (hidden by config; 3 lines captured)');
      expectNoTail(errs[0]!);
      expect(res.flags?.buildTestBypassed).toBe(true);
      expect(res.flags?.buildTestBypass).not.toHaveProperty('outputTail');
      expect(res.flags?.buildTestBypass).toEqual({
        flag: b.flag,
        command: SHOWN,
        exitCode: 1,
        hiddenTailLines: 3,
      });
      // The tail is nowhere in the gate's result either.
      expectNoTail(JSON.stringify(res));
    });
  }

  it('348-01/AC-6: a one-line tail is written "1 line captured", on a refusal and on a bypass', async () => {
    const refusal: string[] = [];
    await runBuildTestGate(ctx({ run: failing('tail-348-a'), errs: refusal, config: hide }));
    expect(refusal).toEqual([COMMAND_LINE, `${UNSEALED_REASON}\n`, HIDDEN_1]);
    expect(refusal.join('')).not.toContain('tail-348-a');

    const bypass: string[] = [];
    const res = await runBuildTestGate(
      ctx({ run: failing('tail-348-a\n'), errs: bypass, force: true, config: hide }),
    );
    expect(bypass).toEqual([`build-test-must-pass: BYPASSED via --force: ${SHOWN} exited 1\n${HIDDEN_1}`]);
    expect(bypass.join('')).not.toContain('tail-348-a');
    expect(res.flags?.buildTestBypass).toEqual({
      flag: '--force',
      command: SHOWN,
      exitCode: 1,
      hiddenTailLines: 1,
    });
  });

  const forty = Array.from({ length: 40 }, (_, i) => `row-348-${i + 1}`).join('\n');
  const counted = [
    { name: 'a trailing newline is not a line', tail: `${TAIL}\n`, lines: 3 },
    { name: 'CRLF line ends and trailing blank lines', tail: 'tail-348-a\r\ntail-348-b\r\n\r\n', lines: 2 },
    { name: 'a 40-line tail gives 40', tail: forty, lines: 40 },
    {
      name: 'a tail holding a redacted secret',
      tail: 'tail-348-a\nAuthorization: Bearer abcdef1234567890\ntail-348-c\ntail-348-d',
      lines: 4,
    },
  ] as const;

  for (const c of counted) {
    it(`348-01/AC-6: the count is tailLines of the redacted tail, the number of lines "show" would print (${c.name})`, async () => {
      const run = failing(c.tail);
      const redacted = redactOutput(c.tail, secretValues(run.command, {}));
      expect(tailLines(redacted)).toHaveLength(c.lines);
      const notice = `  output tail: (hidden by config; ${c.lines} lines captured)\n`;

      // What "show" prints for the same run: one indented line per counted line.
      const shown: string[] = [];
      const shownRes = await runBuildTestGate(ctx({ run, errs: shown, force: true, config: null }));
      const shownTailLines = shown[0]!.split('\n').filter((l) => l.startsWith('    '));
      expect(shownTailLines).toHaveLength(c.lines);
      expect(tailLines(shownRes.flags?.buildTestBypass?.outputTail)).toHaveLength(c.lines);

      const bypass: string[] = [];
      const res = await runBuildTestGate(ctx({ run, errs: bypass, force: true, config: hide }));
      expect(bypass).toEqual([`build-test-must-pass: BYPASSED via --force: ${SHOWN} exited 1\n${notice}`]);
      expect(res.flags?.buildTestBypass).toEqual({
        flag: '--force',
        command: SHOWN,
        exitCode: 1,
        hiddenTailLines: c.lines,
      });

      const refusal: string[] = [];
      await runBuildTestGate(ctx({ run, errs: refusal, config: hide }));
      expect(refusal[2]).toBe(notice);
      expect(refusal.join('') + bypass.join('')).not.toContain('abcdef1234567890');
      expect(refusal.join('') + bypass.join('')).not.toContain('row-348-');
    });
  }

  it('348-01/AC-6: a suite that printed nothing keeps "(no output captured)" under hide, and its bypass flags carry neither a tail nor a count', async () => {
    for (const sealed of [false, true]) {
      const errs: string[] = [];
      const res = await runBuildTestGate(
        ctx({ run: failing(), errs, config: sealed ? hideSealed : hide }),
      );
      expect(res.outcome).toBe('refuse');
      expect(errs).toEqual([COMMAND_LINE, `${sealed ? SEALED_REASON : UNSEALED_REASON}\n`, NO_OUTPUT]);
      expect(errs.join('')).not.toContain('hidden by config');
    }
    for (const b of bypasses) {
      const errs: string[] = [];
      const res = await runBuildTestGate(ctx({ run: failing(), errs, ...b.opts, config: hide }));
      expect(res.outcome).toBe('pass');
      expect(errs).toEqual([`build-test-must-pass: BYPASSED via ${b.flag}: ${SHOWN} exited 1\n${NO_OUTPUT}`]);
      expect(res.flags?.buildTestBypass).toEqual({ flag: b.flag, command: SHOWN, exitCode: 1 });
      expect(Object.keys(res.flags?.buildTestBypass ?? {}).sort()).toEqual(['command', 'exitCode', 'flag']);
    }
  });

  it('348-01/AC-6: hide changes neither the pass/refuse decision nor a passing or unconfigured run', async () => {
    const passing: string[] = [];
    const ok = await runBuildTestGate(
      ctx({ run: { ran: true, ok: true, exitCode: 0, command: 'pnpm test' }, errs: passing, config: hide }),
    );
    expect(ok).toEqual({ outcome: 'pass' });
    expect(passing).toEqual([]);

    const notRun: string[] = [];
    const skipped = await runBuildTestGate(ctx({ run: { ran: false, ok: true }, errs: notRun, config: hide }));
    expect(skipped.outcome).toBe('pass');
    expect(notRun.join('')).not.toContain('output tail');
  });
});

describe('runBuildTestGate · without the setting the phase-346 output holds (phase 348)', () => {
  const showConfigs: ReadonlyArray<{ name: string; config: Config; sealedConfig: Config }> = [
    {
      name: 'a null config',
      config: null,
      sealedConfig: { gates: { sealed: ['build-test-must-pass'] } } as unknown as Config,
    },
    {
      name: 'a config with no verification object',
      config: { gates: { sealed: [] } } as unknown as Config,
      sealedConfig: { gates: { sealed: ['build-test-must-pass'] } } as unknown as Config,
    },
    {
      name: 'a config with no verification.buildTestOutputTail key',
      config: { verification: { testGlobs: ['x'] } } as unknown as Config,
      sealedConfig: {
        gates: { sealed: ['build-test-must-pass'] },
        verification: { testGlobs: ['x'] },
      } as unknown as Config,
    },
    {
      name: 'a config with "show"',
      config: { verification: { buildTestOutputTail: 'show' } } as unknown as Config,
      sealedConfig: {
        gates: { sealed: ['build-test-must-pass'] },
        verification: { buildTestOutputTail: 'show' },
      } as unknown as Config,
    },
  ];

  for (const c of showConfigs) {
    it(`348-01/AC-7: with ${c.name}, a refusal prints the full tail block, sealed or not, exactly as phase 346 pinned`, async () => {
      const errs: string[] = [];
      const res = await runBuildTestGate(ctx({ run: failing(TAIL), errs, config: c.config }));
      expect(res.outcome).toBe('refuse');
      expect(res.reason).toBe(UNSEALED_REASON);
      expect(errs).toEqual([COMMAND_LINE, `${UNSEALED_REASON}\n`, SHOW_BLOCK]);
      expect(errs.join('')).toBe(
        'build-test-must-pass: pnpm [arguments not shown] exited 1\n' +
          'settle run refused: the test suite must pass before settle. ' +
          'Pass --allow-failing-build to bypass, or --force to settle anyway.\n' +
          '  output tail (last lines):\n' +
          '    tail-348-a\n' +
          '    tail-348-b\n' +
          '    tail-348-c\n',
      );
      expect(errs.join('')).not.toContain('hidden by config');
      expect(res.flags).toBeUndefined();

      const sealedErrs: string[] = [];
      const sealed = await runBuildTestGate(
        ctx({ run: failing(TAIL), errs: sealedErrs, force: true, config: c.sealedConfig }),
      );
      expect(sealed.outcome).toBe('refuse');
      expect(sealed.reason).toBe(SEALED_REASON);
      expect(sealedErrs).toEqual([COMMAND_LINE, `${SEALED_REASON}\n`, SHOW_BLOCK]);
    });

    for (const flag of ['--allow-failing-build', '--force'] as const) {
      it(`348-01/AC-7: with ${c.name}, a ${flag} bypass prints the full tail block in one notice and its flags carry only flag, command, exitCode and outputTail`, async () => {
        const errs: string[] = [];
        const res: GateResult = await runBuildTestGate(
          ctx({
            run: failing(TAIL),
            errs,
            ...(flag === '--force' ? { force: true } : { allowFailingBuild: true }),
            config: c.config,
          }),
        );
        expect(res.outcome).toBe('pass');
        expect(errs).toEqual([
          `build-test-must-pass: BYPASSED via ${flag}: pnpm [arguments not shown] exited 1\n` +
            '  output tail (last lines):\n' +
            '    tail-348-a\n' +
            '    tail-348-b\n' +
            '    tail-348-c\n',
        ]);
        expect(errs.join('')).not.toContain('hidden by config');
        expect(res.flags?.buildTestBypassed).toBe(true);
        expect(Object.keys(res.flags?.buildTestBypass ?? {}).sort()).toEqual([
          'command',
          'exitCode',
          'flag',
          'outputTail',
        ]);
        expect(res.flags?.buildTestBypass).toEqual({
          flag,
          command: SHOWN,
          exitCode: 1,
          outputTail: TAIL,
        });
      });
    }

    it(`348-01/AC-7: with ${c.name}, a suite that printed nothing still reads "(no output captured)" and its bypass flags carry only flag, command and exitCode`, async () => {
      const refusal: string[] = [];
      await runBuildTestGate(ctx({ run: failing(), errs: refusal, config: c.config }));
      expect(refusal).toEqual([COMMAND_LINE, `${UNSEALED_REASON}\n`, NO_OUTPUT]);

      const bypass: string[] = [];
      const res = await runBuildTestGate(ctx({ run: failing(), errs: bypass, force: true, config: c.config }));
      expect(bypass).toEqual([`build-test-must-pass: BYPASSED via --force: ${SHOWN} exited 1\n${NO_OUTPUT}`]);
      expect(Object.keys(res.flags?.buildTestBypass ?? {}).sort()).toEqual(['command', 'exitCode', 'flag']);
    });
  }
});
