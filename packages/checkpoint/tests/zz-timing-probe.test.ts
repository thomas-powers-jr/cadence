import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// THROWAWAY PROBE for slice 331-02 (branch probe/331-02-timing; never merged).
// Runs the timing probe from inside the test suite, so it measures under the
// same parallel turbo/vitest load the failing CI tests saw. The numbers go to
// stderr for the CI log; the only assertions are that the probe ran.
//
// Split into four 15-run batches (two per scenario, 30 samples each) so each
// test fits the shared vitest budget: one 60-run test took 106 s on
// windows-latest and 39-42 s on ubuntu/macos (run 39448948337).
const PROBE = join(__dirname, '..', 'probe', 'timing-probe.mjs');

describe('331-02 timing probe (under suite load)', () => {
  for (const scenario of ['wrapper', 'instr']) {
    for (const batch of ['a', 'b']) {
      it(`collects ${scenario} timings, batch ${batch}`, () => {
        const r = spawnSync(process.execPath, [PROBE, `under-load-${batch}`, '15', scenario], {
          encoding: 'utf8',
          windowsHide: true,
        });
        process.stderr.write(r.stdout);
        if (r.stderr) process.stderr.write(r.stderr);
        expect(r.status).toBe(0);
        expect(r.stdout.match(/^\[probe-331-02-summary\]/gm)?.length).toBe(1);
      });
    }
  }
});
