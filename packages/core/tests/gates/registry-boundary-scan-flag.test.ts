import { describe, it, expect } from 'vitest';
import type { GateResult, SettleContext } from '../../src/gates/types.js';
import {
  GATE_REGISTRY,
  runSettleGates,
  type GateEntry,
  type SettleGate,
} from '../../src/gates/registry.js';

/**
 * Phase 352 (352-01, T2): the boundary-scan provenance skip reason takes the
 * flag from the gate's own `flags.boundaryScanBypass.flag` when present, so
 * the gate's stderr line, the skip reason and the gateBypasses flag share one
 * source. The opts ternary stays as the fallback when the gate set none.
 */

/** Every gate passes except `boundary-scan`, which returns `boundaryScan`. */
function stubRegistry(boundaryScan: GateResult): Record<SettleGate, GateEntry> {
  const pass: GateResult = { outcome: 'pass' };
  const entries = {} as Record<SettleGate, GateEntry>;
  for (const gate of Object.keys(GATE_REGISTRY) as SettleGate[]) {
    entries[gate] = {
      impl: async () => (gate === 'boundary-scan' ? boundaryScan : pass),
      selfGuarded: GATE_REGISTRY[gate].selfGuarded ?? false,
    };
  }
  return entries;
}

const ctx = {
  gateSet: { gates: [] },
  opts: { allowBoundaryScanFailure: true },
  config: { boundaryEnforcement: 'block' },
  draft: { tasks: [] },
} as unknown as SettleContext;

describe('registry: boundary-scan provenance flag (phase 352)', () => {
  it('352-01/AC-2: the boundary-scan skip reason takes flags.boundaryScanBypass.flag over the opts ternary', async () => {
    const { gates } = await runSettleGates(ctx, {
      registry: stubRegistry({
        outcome: 'pass',
        flags: {
          boundaryScanBypassed: true,
          boundaryScanBypass: { flag: '--force', causes: ['offenders'], offenders: ['stray.ts'] },
        },
      }),
      order: ['boundary-scan'],
    });
    expect(gates).toHaveLength(1);
    expect(gates[0]).toStrictEqual({
      gate: 'boundary-scan',
      status: 'skipped',
      skipReason: 'bypassed via --force',
    });
  });

  it('352-01/AC-2: without flags.boundaryScanBypass the skip reason keeps the options-based flag', async () => {
    const { gates } = await runSettleGates(ctx, {
      registry: stubRegistry({ outcome: 'pass', flags: { boundaryScanBypassed: true } }),
      order: ['boundary-scan'],
    });
    expect(gates).toHaveLength(1);
    expect(gates[0]).toStrictEqual({
      gate: 'boundary-scan',
      status: 'skipped',
      skipReason: 'bypassed via --allow-boundary-scan-failure',
    });
  });
});
