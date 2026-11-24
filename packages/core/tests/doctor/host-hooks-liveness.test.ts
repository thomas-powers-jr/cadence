import { describe, it, expect, afterEach } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyState } from '@thomas-powers-jr/cadence-types';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { checkHostHooksLiveness, runDoctor } from '../../src/doctor/run.js';
import { writeCompleteManagedSettings } from './host-hooks-fixture.js';

// Phase 349 (T4, AC-4): doctor reports whether installed host hooks actually fire during BUILD.
let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

const NOW = new Date('2026-11-22T12:00:00.000Z');

async function setState(
  root: string,
  loopPosition: 'IDLE' | 'BUILD',
  lastHookEventAt?: string,
): Promise<void> {
  const state = emptyState('test');
  state.loopPosition = loopPosition;
  if (lastHookEventAt !== undefined) state.session.lastHookEventAt = lastHookEventAt;
  await writeFile(join(root, '.cadence', 'state.json'), JSON.stringify(state, null, 2));
}

describe('host-hooks-liveness doctor check (phase 349)', () => {
  it('349-01/AC-4: BUILD + hooks installed + fresh stamp is ok', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteManagedSettings(active.root);
    await setState(active.root, 'BUILD', new Date(NOW.getTime() - 60_000).toISOString());
    const check = await checkHostHooksLiveness(active.root, NOW);
    expect(check.name).toBe('host-hooks-liveness');
    expect(check.severity).toBe('ok');
  });

  it('349-01/AC-4: BUILD + hooks installed + absent stamp warns, saying none recorded', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteManagedSettings(active.root);
    await setState(active.root, 'BUILD');
    const check = await checkHostHooksLiveness(active.root, NOW);
    expect(check.severity).toBe('warning');
    expect(check.detail).toContain('none recorded');
    expect(check.remediation).toContain('repository root');
    expect(check.remediation).toContain('.claude/settings.json');
  });

  it('349-01/AC-4: BUILD + hooks installed + stale stamp warns, naming the stamp', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteManagedSettings(active.root);
    const stale = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();
    await setState(active.root, 'BUILD', stale);
    const check = await checkHostHooksLiveness(active.root, NOW);
    expect(check.severity).toBe('warning');
    expect(check.detail).toContain(stale);
    expect(check.detail).toContain('repository root');
    expect(check.detail).toContain('.claude/settings.json');
    expect(check.remediation).toContain('repository root');
  });

  it('349-01/AC-4: BUILD + no hooks installed is ok, not applicable', async () => {
    active = await tempRepo({ initialized: true });
    await setState(active.root, 'BUILD');
    const check = await checkHostHooksLiveness(active.root, NOW);
    expect(check.severity).toBe('ok');
    expect(check.detail).toContain('not applicable');
  });

  it('349-01/AC-4: IDLE is ok, not in BUILD', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteManagedSettings(active.root);
    await setState(active.root, 'IDLE');
    const check = await checkHostHooksLiveness(active.root, NOW);
    expect(check.severity).toBe('ok');
    expect(check.detail).toContain('not in BUILD');
  });

  it('349-01/AC-4: unreadable state is ok, not determinable, and never throws', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteManagedSettings(active.root);
    await writeFile(join(active.root, '.cadence', 'state.json'), '{not json');
    const check = await checkHostHooksLiveness(active.root, NOW);
    expect(check.severity).toBe('ok');
    expect(check.detail).toContain('not determinable');
  });

  it('349-01/AC-4: is registered in runDoctor and never reports error', async () => {
    active = await tempRepo({ initialized: true });
    await writeCompleteManagedSettings(active.root);
    await setState(active.root, 'BUILD');
    const report = await runDoctor(active.root, {
      nodeVersion: 'v22.11.0',
      platform: 'linux' as const,
    });
    const check = report.checks.find((c) => c.name === 'host-hooks-liveness');
    expect(check).toBeDefined();
    expect(check?.severity).not.toBe('error');
    // BUILD + hooks installed + no stamp: the registered check warns.
    expect(check?.severity).toBe('warning');
  });
});
