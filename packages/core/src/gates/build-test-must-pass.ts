import { NO_TEST_COMMAND_NOTICE } from '@thomas-powers-jr/cadence-types';
import { isGateSealed } from './types.js';
import { redactCommand, redactOutput, secretValues } from '../verify/test-runner.js';
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
 * The tail block (the indented lines after the first) appears only when the
 * runner captured an `outputTail`. Every refusal, sealed or not, keeps its
 * stderr lines, `reason` string and outcome byte-identical and, when a tail
 * was captured, appends that same tail block as one extra stderr write after
 * them. A refusal with no captured tail, a passing run and a `ran: false` run
 * write exactly what they wrote before.
 */
export const runBuildTestGate: GateImpl = async (ctx): Promise<GateResult> => {
  const res = await ctx.runner.test();
  if (!res.ran) {
    ctx.io.err(`build-test-must-pass: ${NO_TEST_COMMAND_NOTICE.message}\n`);
    return { outcome: 'pass', summaryPatch: { buildTestRan: false } };
  }
  const sealed = isGateSealed(ctx, 'build-test-must-pass');
  if (!res.ok && (sealed || (!ctx.opts.allowFailingBuild && !ctx.opts.force))) {
    // The command is redacted here too; a command holding no credentials prints
    // unchanged. The gate stays pure: environment-sourced literals were already
    // removed from the tail by the runner, so only the command's own count here.
    const secrets = secretValues(res.command, {});
    const shown = res.command === undefined ? res.command : redactCommand(res.command, secrets);
    ctx.io.err(`build-test-must-pass: ${shown} exited ${res.exitCode}\n`);
    const reason = sealed
      ? 'settle run refused: the test suite must pass before settle. ' +
          'This gate is sealed (gates.sealed) and cannot be bypassed with ' +
          '--allow-failing-build or --force.'
      : 'settle run refused: the test suite must pass before settle. ' +
          'Pass --allow-failing-build to bypass, or --force to settle anyway.';
    ctx.io.err(`${reason}\n`);
    // The refusal's reason and outcome stay byte-identical to pre-346 (DRAFT Boundary), and its command line is
    // unchanged unless the command holds a credential (dec-20261113-001). Unlike the bypass notice it keeps
    // printing a missing command or exit code as-is rather than with the bypass branch's explicit fallbacks.
    // Every refusal names the tail, a silent run's included ("no output captured").
    ctx.io.err(formatTailBlock(res.outputTail === undefined ? undefined : redactOutput(res.outputTail, secrets)));
    return { outcome: 'refuse', reason };
  }
  if (!res.ok) {
    // Reaching here with a failing run means the refusal above did NOT fire —
    // by that branch's condition, that only happens when unsealed AND a
    // bypass flag was set. A genuine bypass, not a passing run.
    const flag = ctx.opts.allowFailingBuild === true ? '--allow-failing-build' : '--force';
    // The command is recorded (anomaly event, SUMMARY reason), so an inline
    // credential such as `API_KEY=... pnpm test` or a URL's `user:pw@` is
    // redacted here, once, for every record and the notice alike.
    // The runner is injected, so its tail is redacted again here (safe twice);
    // the real runner already removed environment-sourced literals.
    const secrets = secretValues(res.command, {});
    const command = redactCommand(res.command ?? '<unknown command>', secrets);
    const exitCode = res.exitCode ?? 1;
    const outputTail = res.outputTail === undefined ? undefined : redactOutput(res.outputTail, secrets);
    ctx.io.err(
      `build-test-must-pass: BYPASSED via ${flag}: ${command} exited ${exitCode}\n` +
        formatTailBlock(outputTail),
    );
    return {
      outcome: 'pass',
      flags: {
        buildTestBypassed: true,
        buildTestBypass: { flag, command, exitCode, ...(outputTail ? { outputTail } : {}) },
      },
    };
  }
  return { outcome: 'pass' };
};

/** Phase 346: the delimited output-tail block shared by the bypass notice and
 *  every refusal — a header line, then each tail line indented by 4 spaces. */
function formatTailBlock(tail: string | undefined): string {
  if (!tail) return '  output tail: (no output captured)\n';
  return `  output tail (last lines):\n${tailLines(tail).map((l) => `    ${l}\n`).join('')}`;
}

/** The tail's lines exactly as the notice prints them; settle counts these for
 *  the gateBypasses detail note, so the number always matches the notice. */
export function tailLines(tail: string | undefined): string[] {
  if (!tail) return [];
  return tail.replace(/(\r?\n)+$/, '').split(/\r?\n/);
}
