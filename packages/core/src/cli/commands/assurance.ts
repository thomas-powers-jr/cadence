import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { processIO, type CommandIO, type CommandResult } from '../../services/io.js';
import { computeAssuranceReport, loadAssuranceCorpus } from '../../services/assurance-report.js';
import { renderAssuranceReport } from '../../parse/render-assurance-report.js';

export interface AssuranceReportArgs {
  cwd: string;
  json?: boolean;
  /** Raw `--since` value; must be a non-negative integer phase number. */
  since?: string;
}

/**
 * Phase 327 (T3, rec-20261010-002): `cadence assurance report` — the
 * corpus-wide assurance rollup. Read-only: it loads every
 * `.cadence/phases/**\/*-SUMMARY.json`, computes the report, and prints it
 * (text by default, the report object as JSON with `--json`). Unreadable
 * records are part of the report, not a failure; only a bad `--since` or an
 * unexpected error exits 1.
 */
export async function runAssuranceReport(args: AssuranceReportArgs, io: CommandIO): Promise<CommandResult> {
  let since: number | undefined;
  if (args.since !== undefined) {
    if (!/^\d+$/.test(args.since) || !Number.isSafeInteger(Number(args.since))) {
      io.err(
        `assurance report failed: --since must be a non-negative integer phase number, got "${args.since}"\n`,
      );
      return { exitCode: 1 };
    }
    since = Number(args.since);
  }
  try {
    // No quiet fallback: an empty report from a directory with no
    // `.cadence/phases` (e.g. run from a package subdirectory) looks exactly
    // like "nothing settled yet", so say why on stderr.
    if (!existsSync(join(args.cwd, '.cadence', 'phases'))) {
      io.err(
        `note: no .cadence/phases directory under ${args.cwd}; the report is empty. Run it from the repository root.\n`,
      );
    }
    const corpus = loadAssuranceCorpus(args.cwd);
    const report = computeAssuranceReport(corpus.records, corpus.unreadable, since === undefined ? {} : { since });
    io.out(args.json ? JSON.stringify(report, null, 2) + '\n' : renderAssuranceReport(report));
    return { exitCode: 0, data: report };
  } catch (err) {
    io.err(`assurance report failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return { exitCode: 1 };
  }
}

export function registerAssuranceCommand(program: Command): void {
  const cmd = program
    .command('assurance')
    .description('Corpus-wide view of how strongly settled slices were verified (read-only)');

  cmd
    .command('report')
    .description(
      'Roll up every SUMMARY.json: record categories, stored vs re-derived grades, gate firing counts, provider mix, bypasses and evidence tally',
    )
    .option('--json', 'emit the report object as JSON instead of rendered text')
    .option('--since <phase>', 'only count records whose phase number is at least <phase>')
    .action(async (opts: { json?: boolean; since?: string }) => {
      const res = await runAssuranceReport(
        {
          cwd: process.cwd(),
          ...(opts.json !== undefined ? { json: opts.json } : {}),
          ...(opts.since !== undefined ? { since: opts.since } : {}),
        },
        processIO(),
      );
      process.exitCode = res.exitCode;
    });
}
