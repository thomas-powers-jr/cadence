import { InvalidArgumentError, type Command } from 'commander';
import { settleService, type SettleArgs } from '../../services/settle.js';
import { processIO } from '../../services/io.js';
import type { VerifierProvider } from '../../verify/verifier-factory.js';

/** Commander arg-parser for `--verifier`: reject anything outside the four
 *  providers rather than silently downgrading (Phase 73 AC-3; 'host-cli'
 *  added Phase 165). */
function parseVerifier(value: string): VerifierProvider {
  if (value === 'mock' || value === 'anthropic' || value === 'local' || value === 'host-cli') {
    return value;
  }
  throw new InvalidArgumentError(
    `invalid --verifier "${value}" — expected one of: mock | anthropic | local | host-cli`,
  );
}

/** Commander arg-parser for `--ship-ref`: reject an empty/whitespace-only
 *  value rather than silently recording a blank ref (Phase 148). */
function parseShipRef(value: string): string {
  if (value.trim().length === 0) {
    throw new InvalidArgumentError('--ship-ref requires a non-empty value');
  }
  return value;
}

/** Phase 347 (347-01, T3): the `--dry-run` usage rules, checked in the CLI
 *  before `settleService` is called (the service re-checks them for direct
 *  callers). Only an explicit `--interactive` is refused: `--no-interactive`
 *  (`interactive: false`) and the unset default (`undefined`) are fine.
 *  Returns the stderr message, or null when the flags are compatible. */
export function dryRunCliUsageError(opts: SettleArgs): string | null {
  if (opts.dryRun !== true) return null;
  const lines: string[] = [];
  if (opts.interactive === true) {
    lines.push(
      'settle run --dry-run: --interactive cannot be combined with --dry-run — an interactive AC walk ' +
        'needs a human to record verdicts, and a dry run records nothing.\n',
    );
  }
  if (opts.shipRef !== undefined) {
    lines.push(
      'settle run --dry-run: --ship-ref cannot be combined with --dry-run — --ship-ref only affects ' +
        "settle's finalize step (recommendation promotion), which a dry run never reaches.\n",
    );
  }
  return lines.length > 0 ? lines.join('') : null;
}

export function registerSettleCommand(program: Command): void {
  const cmd = program.command('settle').description('Close the loop');

  cmd
    .command('run')
    .description('Generate SUMMARY.md + JSON and return to IDLE')
    .option('--ac <pair...>', 'AC verdicts: AC-1=pass  or  AC-1=fail:reason')
    .option('--ac-pass <id...>', 'Mark one or more AC ids as pass, e.g. --ac-pass AC-1 AC-2')
    .option('--pass-all', 'Mark every AC in the active draft as pass')
    .option('--auto', 'derive AC verdicts from task statuses (blocks on incomplete ACs)')
    .option('--force', 'settle even when --auto detects blocked or pending ACs')
    .option(
      '--allow-missing-coverage',
      "skip the test-coverage gate even if the active profile would enforce it",
    )
    .option(
      '--deep',
      'run the independent verifier agent against each AC (provider from config.verifier)',
    )
    .option(
      '--verifier <provider>',
      'override config.verifier.provider for the deep-verify gate (mock | anthropic | local | host-cli); precedence flag > config > default mock',
      parseVerifier,
    )
    .option(
      '--allow-verifier-failure',
      'do not refuse on verifier transport failures; record failure into SUMMARY and treat as pass=false',
    )
    .option(
      '--interactive',
      'walk each AC and prompt the user for a pass/fail/skip verdict (Phase 16)',
    )
    .option(
      '--no-interactive',
      'bypass the interactive-verdict gate even if the active profile would enforce it',
    )
    .option(
      '--allow-auto-complex',
      "override DESIGN.md §4 M2 soft cap: settle an auto × complex draft anyway",
    )
    .option(
      '--allow-stale-draft',
      "skip the draft-read gate even if DRAFT.md's content changed after approve",
    )
    .option(
      '--allow-open-tasks',
      'skip the structural-verifier gate even if a task is still PENDING / IN_PROGRESS (Phase 39.2)',
    )
    .option(
      '--allow-failing-build',
      "do not refuse on a non-zero verification.testCommand exit; settle anyway. The bypass (by this flag or --force) prints one stderr notice with the run's output tail and is recorded as an error-severity SUMMARY.json.gateBypasses entry (the tail itself is never recorded), which caps assurance.overall at mixed, never strong (Phase 39.2; recorded since Phase 346)",
    )
    .option(
      '--allow-code-review-failure',
      'do not refuse on HIGH-severity code-review findings; record them in SUMMARY and emit anomalies anyway. The bypass (by this flag or --force) is recorded as an error-severity SUMMARY.json.gateBypasses entry, which caps assurance.overall at mixed, never strong (Phase 24.3; recorded since Phase 332)',
    )
    .option(
      '--allow-security-audit-failure',
      'do not refuse on CRITICAL security-audit findings; record them in SUMMARY and settle anyway. The bypass (by this flag or --force) is recorded as an error-severity SUMMARY.json.gateBypasses entry, which caps assurance.overall at mixed, never strong (Phase 25.2; recorded since Phase 332)',
    )
    .option(
      '--allow-skill-audit-miss',
      'do not refuse when required skills were not invoked; emit a warn anomaly (bypassed:true), record the bypass in SUMMARY.gateBypasses and settle anyway (Phase 34.1; recorded since Phase 311)',
    )
    .option(
      '--allow-boundary-scan-failure',
      'do not refuse on a boundary-scan violation (files touched outside the declared boundary); record them in SUMMARY and settle anyway (Phase 156)',
    )
    .option(
      '--allow-unresolvable-pack',
      'do not refuse when an id in config.packs.enabled fails to resolve (missing/invalid pack manifest); record the bypass in SUMMARY.gateBypasses and settle anyway (Phase 291)',
    )
    .option(
      '--allow-phase-collision',
      'bypass the worktree phase-collision backstop (Phase 83): settle even if a sibling worktree or upstream claims this phase number',
    )
    .option(
      '--evidence-floor-bypass <ACid:reason...>',
      'exempt exactly one AC id from the gates.evidenceFloor refusal (Phase 214), with a required reason; repeatable, never a blanket bypass',
    )
    .option(
      '--ship-ref <text>',
      "when the settling phase has a `converted` recommendation pointed at it, promote it straight to `shipped` with this text as the ref (e.g. \"PR #NNN\") instead of the default settle-pending advance (Phase 148)",
      parseShipRef,
    )
    .option(
      '--dry-run',
      "run settle's preconditions, gates and post-gate checks (same gate set, providers and bypass flags; never prompts; stops before finalize) and print what settle would decide and why; cadence writes and notifies nothing (the test command and review agents still run) and spends no convergence attempt; exit 0 if settle would pass, 1 if it would refuse, 2 when combined with --interactive or --ship-ref (Phase 347)",
    )
    .action(async (opts: SettleArgs) => {
      const usageError = dryRunCliUsageError(opts);
      if (usageError !== null) {
        processIO().err(usageError);
        process.exitCode = 2;
        return;
      }
      const { exitCode } = await settleService(process.cwd(), opts, processIO());
      if (exitCode) process.exitCode = exitCode;
    });
}
