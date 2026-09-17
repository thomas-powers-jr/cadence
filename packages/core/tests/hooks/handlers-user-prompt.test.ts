import { describe, it, expect, afterEach } from 'vitest';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { SimpleStateBackend } from '../../src/state/simple.js';
import { loadConfig } from '../../src/config/loader.js';
import { handleUserPrompt } from '../../src/hooks/handlers.js';
import { StateConflictError } from '../../src/errors.js';

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

// Issue #500: `settle run --deep`'s host-cli verifier spawns `claude -p` in the
// project, which fires the project's UserPromptSubmit hook mid-settle. That
// hook's telemetry bump used to go through the compare-and-swap `commit()`,
// advancing `revision` and making settle's own final commit refuse forever.
describe('handleUserPrompt tokenUtilization telemetry (phase 305 / issue #500)', () => {
  it('305-01/AC-1: bumps tokenUtilization on disk without advancing revision, so a concurrent snapshot holder still commits', async () => {
    active = await tempRepo({ initialized: true });
    const settleSide = new SimpleStateBackend(active.root);
    // The long-running command (settle) reads its snapshot first...
    const settleSnapshot = await settleSide.readState();
    const revisionN = settleSnapshot.revision;

    // ...then the child session's UserPromptSubmit hook fires.
    const hookSide = new SimpleStateBackend(active.root);
    const config = await loadConfig(active.root);
    expect(config.telemetry.tokenUtilization).toBe(true);
    const result = await handleUserPrompt(
      { event: 'user-prompt', cwd: active.root },
      await hookSide.readState(),
      config,
      hookSide,
    );
    expect(result).toEqual({ ok: true });

    const afterHook = await hookSide.readState();
    expect(afterHook.revision).toBe(revisionN);
    expect(afterHook.session.tokenUtilization).toBeCloseTo(
      settleSnapshot.session.tokenUtilization + 0.01,
      10,
    );

    // Settle's commit from its revision-N snapshot no longer refuses.
    settleSnapshot.loopPosition = 'IDLE';
    let conflict: unknown = null;
    try {
      await settleSide.commit(settleSnapshot);
    } catch (err) {
      conflict = err;
    }
    expect(conflict).not.toBeInstanceOf(StateConflictError);
    expect(conflict).toBeNull();
    const final = await settleSide.readState();
    expect(final.revision).toBe(revisionN + 1);
    expect(final.loopPosition).toBe('IDLE');
  });
});
