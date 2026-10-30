import type { Command } from 'commander';
import {
  stateListService,
  stateLoadService,
  stateSaveService,
  type StateListArgs,
  type StateLoadArgs,
  type StateSaveArgs,
} from '../../services/state-snapshot.js';
import { processIO } from '../../services/io.js';

/**
 * `cadence state save | load | list` (phase 341) — carry the loop position
 * between machines through committed snapshots in `.cadence/snapshots/`.
 * Thin wiring only: the services own every check, message and exit code.
 * `cadence resume` stays read-only (D10); restoring is this explicit command.
 */
export function registerStateCommand(program: Command): void {
  const cmd = program
    .command('state')
    .description('Save, list and load committed loop-state snapshots (.cadence/snapshots/)');

  cmd
    .command('save')
    .description('Write .cadence/state.json to a committed snapshot, keeping the newest 3')
    .option('--json', 'emit machine-readable JSON instead of rendered text')
    .action(async (opts: { json?: boolean }) => {
      const args: StateSaveArgs = {};
      if (opts.json) args.json = true;
      const { exitCode } = await stateSaveService(process.cwd(), args, processIO());
      if (exitCode) process.exitCode = exitCode;
    });

  cmd
    .command('list')
    .description('List snapshots in .cadence/snapshots/, newest first')
    .option('--json', 'emit machine-readable JSON instead of rendered text')
    .action(async (opts: { json?: boolean }) => {
      const args: StateListArgs = {};
      if (opts.json) args.json = true;
      const { exitCode } = await stateListService(process.cwd(), args, processIO());
      if (exitCode) process.exitCode = exitCode;
    });

  cmd
    .command('load')
    .description(
      'Restore .cadence/state.json from a snapshot (the newest by default); refuses when it does not fit',
    )
    .argument('[snapshot]', 'a file name inside .cadence/snapshots/, or a path to a snapshot file')
    .option('--force', 'skip only the unknown-keys and local-work-since-last-sync checks')
    .option('--json', 'emit machine-readable JSON instead of rendered text')
    .action(async (snapshot: string | undefined, opts: { force?: boolean; json?: boolean }) => {
      const args: StateLoadArgs = {};
      if (snapshot !== undefined) args.snapshot = snapshot;
      if (opts.force) args.force = true;
      if (opts.json) args.json = true;
      const { exitCode } = await stateLoadService(process.cwd(), args, processIO());
      if (exitCode) process.exitCode = exitCode;
    });
}
