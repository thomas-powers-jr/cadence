import { z } from 'zod';
import { CadenceStateZ } from './state.js';

/** A committed loop-state snapshot written by `cadence state save` under
 *  `.cadence/snapshots/` and restored by `cadence state load` (phase 341).
 *  A snapshot can arrive from anyone through a branch, so load treats it as
 *  untrusted input: this schema is the shape check, not the safety check. */
export const StateSnapshotZ = z.object({
  snapshotVersion: z.literal(1),
  savedAt: z.string().datetime({ offset: true }),
  host: z.string().min(1),
  cadenceVersion: z.string().min(1),
  state: CadenceStateZ,
});
export type StateSnapshot = z.infer<typeof StateSnapshotZ>;
