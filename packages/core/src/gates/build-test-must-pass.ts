import { NO_TEST_COMMAND_NOTICE } from '@thomas-powers-jr/cadence-types';
import { isGateSealed } from './types.js';
import { redactSecrets } from '../security/redact.js';
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
    ctx.io.err(`build-test-must-pass: ${res.command} exited ${res.exitCode}\n`);
    const reason = sealed
      ? 'settle run refused: the test suite must pass before settle. ' +
          'This gate is sealed (gates.sealed) and cannot be bypassed with ' +
          '--allow-failing-build or --force.'
      : 'settle run refused: the test suite must pass before settle. ' +
          'Pass --allow-failing-build to bypass, or --force to settle anyway.';
    ctx.io.err(`${reason}\n`);
    // The refusal's lines above stay byte-identical to pre-346 (DRAFT Boundary), so unlike the bypass notice they
    // keep printing a missing command or exit code as-is rather than with the bypass branch's explicit fallbacks.
    if (res.outputTail) ctx.io.err(formatTailBlock(res.outputTail));
    return { outcome: 'refuse', reason };
  }
  if (!res.ok) {
    // Reaching here with a failing run means the refusal above did NOT fire —
    // by that branch's condition, that only happens when unsealed AND a
    // bypass flag was set. A genuine bypass, not a passing run.
    const flag = ctx.opts.allowFailingBuild === true ? '--allow-failing-build' : '--force';
    // The command is recorded (anomaly event, SUMMARY reason), so an inline
    // credential such as `API_KEY=... pnpm test` is redacted here, once, for
    // every record and the notice alike.
    const command = redactSecrets(res.command ?? '<unknown command>');
    const exitCode = res.exitCode ?? 1;
    const outputTail = res.outputTail;
    ctx.io.err(
      `build-test-must-pass: BYPASSED via ${flag}: ${command} exited ${exitCode}\n` +
        (outputTail ? formatTailBlock(outputTail) : ''),
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
function formatTailBlock(tail: string): string {
  const lines = tail.replace(/(\r?\n)+$/, '').split(/\r?\n/);
  return `  output tail (last lines):\n${lines.map((l) => `    ${l}\n`).join('')}`;
}
