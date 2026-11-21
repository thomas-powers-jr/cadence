import { NO_TEST_COMMAND_NOTICE } from '@thomas-powers-jr/cadence-types';
import { isGateSealed } from './types.js';
import { displayCommand, redactOutput, secretValues } from '../verify/test-runner.js';
import type { GateImpl, GateResult } from './types.js';

/**
 * Build/test-must-pass gate (DESIGN.md §4.1 always-fire). Wired for real in
 * Phase 39.2: runs `config.verification.testCommand` via the injected runner
 * port and refuses on a non-zero exit, unless --allow-failing-build / --force.
 * When no testCommand is configured (`ran:false`), the gate cannot enforce —
 * it still passes (Phase 139 keeps this a pass, not a refusal — a repo may
 * legitimately run tests outside cadence), but is no longer *silent*: it
 * writes the single-source-of-truth `NO_TEST_COMMAND_NOTICE` to stderr so the
 * gap is visible instead of hidden. The subprocess is reached only through
 * `ctx.runner` — the gate never imports child_process.
 *
 * Phase 141 (T6, AC-4/AC-5): when 'build-test-must-pass' is in
 * `config.gates.sealed` (`isGateSealed`), neither --allow-failing-build nor
 * --force can bypass a failing test run — the refusal message is a distinct
 * "sealed, cannot be bypassed" message naming `gates.sealed` instead of the
 * normal bypass hint. Unsealed behavior (AC-5) is byte-for-byte unchanged.
 *
 * Phase 226 (T3): when a failing run is genuinely let through (unsealed,
 * --allow-failing-build or --force set), the result now also carries
 * `flags.buildTestBypassed: true` — mirroring `test-coverage`'s
 * `coverageBypassed` — so the registry's gate-provenance collection can
 * report this as "skipped (bypassed)" instead of a misleading "ran". Not set
 * on a genuinely passing run or a sealed refusal.
 *
 * Phase 346 (346-01, AC-2): bypass honesty. A genuine bypass is no longer
 * silent: the gate writes exactly ONE stderr notice (one `ctx.io.err` call)
 * and returns `flags.buildTestBypass` ({ flag, command, exitCode,
 * outputTail? }) beside `flags.buildTestBypassed`. The flag that fired is
 * `--allow-failing-build` whenever it is set, else `--force` (the same rule
 * registry.ts uses for the gate's skip reason). Notice format (stable, ASCII):
 *
 *   build-test-must-pass: BYPASSED via <flag>: <command> exited <code>
 *     output tail (last lines):
 *       <tail line 1>
 *       <tail line N>
 *
 * The tail block (the indented lines after the first) holds the runner's
 * `outputTail`, or `output tail: (no output captured)` when there was none.
 * Every refusal, sealed or not, keeps its `reason` string and outcome
 * byte-identical; its command line names the program only (dec-20261116-001); it then
 * appends the tail block as one extra stderr write. A passing run and a
 * `ran: false` run write exactly what they wrote before.
 *
 * Phase 348 (348-01, AC-6/AC-7): `verification.buildTestOutputTail: "hide"`
 * replaces the whole tail block, header line included, with one line that
 * only counts the captured lines, on every refusal and on the bypass notice
 * (still one `ctx.io.err` call):
 *
 *     output tail: (hidden by config; <N> lines captured)   ("1 line captured" when N is 1)
 *
 * and `flags.buildTestBypass` then carries `hiddenTailLines: N` instead of
 * `outputTail`. A run that captured nothing keeps `(no output captured)` and
 * carries neither. Absent, `"show"`, a null config or a config with no
 * `verification` object all mean show: nothing above changes.
 */
export const runBuildTestGate: GateImpl = async (ctx): Promise<GateResult> => {
  const res = await ctx.runner.test();
  if (!res.ran) {
    ctx.io.err(`build-test-must-pass: ${NO_TEST_COMMAND_NOTICE.message}\n`);
    return { outcome: 'pass', summaryPatch: { buildTestRan: false } };
  }
  const sealed = isGateSealed(ctx, 'build-test-must-pass');
  // Phase 348: only an explicit "hide" hides; everything else is show.
  const hideTail = ctx.config?.verification?.buildTestOutputTail === 'hide';
  if (!res.ok && (sealed || (!ctx.opts.allowFailingBuild && !ctx.opts.force))) {
    // The command is shown by its program only (dec-20261116-001). The gate stays pure:
    // environment-sourced literals were already removed from the tail by the
    // runner, so only the command's own count here.
    const secrets = secretValues(res.command, {});
    const shown = res.command === undefined ? res.command : displayCommand(res.command);
    ctx.io.err(`build-test-must-pass: ${shown} exited ${res.exitCode}\n`);
    const reason = sealed
      ? 'settle run refused: the test suite must pass before settle. ' +
          'This gate is sealed (gates.sealed) and cannot be bypassed with ' +
          '--allow-failing-build or --force.'
      : 'settle run refused: the test suite must pass before settle. ' +
          'Pass --allow-failing-build to bypass, or --force to settle anyway.';
    ctx.io.err(`${reason}\n`);
    // The refusal's reason and outcome stay byte-identical to pre-346 (DRAFT Boundary); its command line names
    // the program only (dec-20261116-001). Unlike the bypass notice it keeps
    // printing a missing command or exit code as-is rather than with the bypass branch's explicit fallbacks.
    // Every refusal names the tail, a silent run's included ("no output captured").
    ctx.io.err(
      formatTailBlock(res.outputTail === undefined ? undefined : redactOutput(res.outputTail, secrets), hideTail),
    );
    return { outcome: 'refuse', reason };
  }
  if (!res.ok) {
    // Reaching here with a failing run means the refusal above did NOT fire —
    // by that branch's condition, that only happens when unsealed AND a
    // bypass flag was set. A genuine bypass, not a passing run.
    const flag = ctx.opts.allowFailingBuild === true ? '--allow-failing-build' : '--force';
    // The command is recorded (anomaly event, SUMMARY reason), so it is shown
    // by its program only, its arguments never (dec-20261116-001): no list of secret
    // shapes can be complete, and the full command is in config.json.
    // The runner is injected, so its tail is redacted again here (safe twice);
    // the real runner already removed environment-sourced literals.
    const secrets = secretValues(res.command, {});
    const command = displayCommand(res.command ?? '<unknown command>');
    const exitCode = res.exitCode ?? 1;
    const outputTail = res.outputTail === undefined ? undefined : redactOutput(res.outputTail, secrets);
    ctx.io.err(
      `build-test-must-pass: BYPASSED via ${flag}: ${command} exited ${exitCode}\n` +
        formatTailBlock(outputTail, hideTail),
    );
    // Under hide the tail leaves the gate nowhere: the flags carry the count
    // of the lines the notice named instead (settle's detail text reads it).
    const tailFact = !outputTail
      ? {}
      : hideTail
        ? { hiddenTailLines: tailLines(outputTail).length }
        : { outputTail };
    return {
      outcome: 'pass',
      flags: {
        buildTestBypassed: true,
        buildTestBypass: { flag, command, exitCode, ...tailFact },
      },
    };
  }
  return { outcome: 'pass' };
};

/** Phase 346: the delimited output-tail block shared by the bypass notice and
 *  every refusal — a header line, then each tail line indented by 4 spaces.
 *  Phase 348: with `hide`, one line counting those lines stands in for the
 *  whole block; a run with no tail reads the same either way. */
function formatTailBlock(tail: string | undefined, hide: boolean): string {
  if (!tail) return '  output tail: (no output captured)\n';
  if (hide) {
    const n = tailLines(tail).length;
    return `  output tail: (hidden by config; ${n} line${n === 1 ? '' : 's'} captured)\n`;
  }
  return `  output tail (last lines):\n${tailLines(tail).map((l) => `    ${l}\n`).join('')}`;
}

/** The tail's lines exactly as the notice prints them; settle counts these for
 *  the gateBypasses detail note, so the number always matches the notice. */
export function tailLines(tail: string | undefined): string[] {
  if (!tail) return [];
  return tail.replace(/(\r?\n)+$/, '').split(/\r?\n/);
}
