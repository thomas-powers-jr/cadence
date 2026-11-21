import { describe, expect, it } from 'vitest';
import {
  createDryRunRecorder,
  withDryRunPorts,
} from '../../src/services/settle.js';
import type { EmitPort, SettleContext } from '../../src/gates/types.js';
import { runInteractiveGate } from '../../src/gates/interactive.js';
import { SETTLE_BYPASS_NOTICE } from '../../src/gates/interactivity.js';

/**
 * Phase 347 (347-01, T1): `withDryRunPorts` swaps a SettleContext's
 * side-effecting ports for recording ones. The fake original context's
 * side-effecting ports THROW if called, so any forwarding fails the test.
 */

const forbidden = (name: string) => () => {
  throw new Error(`original ${name} must not be called in a dry run`);
};

function fakeCtx(): { ctx: SettleContext; sidecarReads: { n: number } } {
  const sidecarReads = { n: 0 };
  const emit: EmitPort = {
    anomalies: forbidden('emit.anomalies'),
    codeReviewHigh: forbidden('emit.codeReviewHigh'),
    codeReviewUnconverged: forbidden('emit.codeReviewUnconverged'),
    skillAuditMiss: forbidden('emit.skillAuditMiss'),
  };
  const ctx = {
    cwd: '/fake',
    opts: { auto: true },
    interactivity: 'interactive',
    explicitIds: new Set<string>(),
    touchedFiles: ['a.ts'],
    emit,
    prompter: { create: forbidden('prompter.create') },
    codeReviewSidecar: {
      read: async () => {
        sidecarReads.n += 1;
        return { attemptsSoFar: 2, history: [{ attempt: 1 }, { attempt: 2 }] };
      },
      write: forbidden('codeReviewSidecar.write'),
    },
    io: { err: () => {} },
  } as unknown as SettleContext;
  return { ctx, sidecarReads };
}

/** Arguments per EmitPort member, keyed by name so a new port without an
 *  entry here is a compile error (Record over keyof EmitPort). */
const sampleArgs: { [K in keyof EmitPort]: Parameters<EmitPort[K]> } = {
  anomalies: [[{ type: 'x', severity: 'warn', message: 'm' } as never]],
  codeReviewHigh: [{ 'a.ts': [] }, { provider: 'mock', bypassed: false }],
  codeReviewUnconverged: [
    { draftId: '347-01', attempts: 3, maxAttempts: 3, findings: 1, provider: 'mock' },
  ],
  skillAuditMiss: [
    { required: ['s'], invoked: [], missing: ['s'], severity: 'error' },
  ],
};

describe('withDryRunPorts (347-01)', () => {
  it('347-01/AC-2: records every emit port call instead of forwarding it', async () => {
    const { ctx } = fakeCtx();
    const recorder = createDryRunRecorder();
    const dry = withDryRunPorts(ctx, recorder);

    // Every port of the original is covered, and nothing extra appears.
    const keys = Object.keys(dry.emit).sort();
    expect(keys).toEqual(Object.keys(ctx.emit).sort());
    expect(keys).toEqual(Object.keys(sampleArgs).sort());

    for (const key of keys as (keyof EmitPort)[]) {
      const fn = dry.emit[key] as (...a: unknown[]) => Promise<void>;
      await expect(fn(...(sampleArgs[key] as unknown[]))).resolves.toBeUndefined();
    }
    expect(recorder.emitted.map((e) => e.port)).toEqual(keys);
    for (const rec of recorder.emitted) {
      expect(rec.args).toEqual(sampleArgs[rec.port]);
    }
  });

  it('347-01/AC-2: sidecar read passes through and write records without persisting', async () => {
    const { ctx, sidecarReads } = fakeCtx();
    const recorder = createDryRunRecorder();
    const dry = withDryRunPorts(ctx, recorder);

    await expect(dry.codeReviewSidecar.read()).resolves.toEqual({
      attemptsSoFar: 2,
      history: [{ attempt: 1 }, { attempt: 2 }],
    });
    expect(sidecarReads.n).toBe(1);

    await expect(dry.codeReviewSidecar.write('{"attempts":3}')).resolves.toBeUndefined();
    await dry.codeReviewSidecar.write('{"attempts":4}');
    expect(recorder.sidecarWrites).toEqual(['{"attempts":3}', '{"attempts":4}']);
    // The original write (which throws) was never reached.
  });

  it('347-01/AC-2: the prompter takes the non-interactive path', () => {
    const { ctx } = fakeCtx();
    const dry = withDryRunPorts(ctx, createDryRunRecorder());
    // The interactive-verdict gate's non-interactive path is keyed on
    // interactivity === 'bypass' (it never calls prompter.create then).
    expect(dry.interactivity).toBe('bypass');
    // And a stray create() still never reaches the real (stdin) prompter.
    expect(() => dry.prompter.create()).toThrow(/--dry-run never prompts/);
  });

  it('347-01/AC-2: the real interactive-verdict gate skips its walker on the dry context', async () => {
    const { ctx } = fakeCtx();
    const errs: string[] = [];
    const base = {
      ...ctx,
      opts: { interactive: true },
      gateSet: { gates: ['interactive-verdict'] },
      io: { err: (s: string) => errs.push(s) },
    } as unknown as SettleContext;
    // The original prompter.create throws, so reaching it would refuse.
    const result = await runInteractiveGate(withDryRunPorts(base, createDryRunRecorder()));
    expect(result).toEqual({
      outcome: 'pass',
      summaryPatch: { interactiveVerifySkipped: 'non-tty' },
    });
    expect(errs.join('')).toContain(SETTLE_BYPASS_NOTICE);
  });

  it('347-01/AC-2: returns a new context and leaves the original untouched', async () => {
    const { ctx } = fakeCtx();
    const origEmit = ctx.emit;
    const origEmitKeys = { ...ctx.emit };
    const origSidecar = ctx.codeReviewSidecar;
    const origSidecarFns = { ...ctx.codeReviewSidecar };
    const origPrompter = ctx.prompter;
    const origCreate = ctx.prompter.create;
    const recorder = createDryRunRecorder();
    const dry = withDryRunPorts(ctx, recorder);

    expect(dry).not.toBe(ctx);
    expect(dry.emit).not.toBe(ctx.emit);
    expect(dry.codeReviewSidecar).not.toBe(ctx.codeReviewSidecar);
    expect(dry.prompter).not.toBe(ctx.prompter);

    expect(ctx.emit).toBe(origEmit);
    expect({ ...ctx.emit }).toEqual(origEmitKeys);
    expect(ctx.codeReviewSidecar).toBe(origSidecar);
    expect({ ...ctx.codeReviewSidecar }).toEqual(origSidecarFns);
    expect(ctx.prompter).toBe(origPrompter);
    expect(ctx.prompter.create).toBe(origCreate);
    expect(ctx.interactivity).toBe('interactive');

    // Non-port fields carry over unchanged.
    expect(dry.cwd).toBe(ctx.cwd);
    expect(dry.opts).toBe(ctx.opts);
    expect(dry.touchedFiles).toBe(ctx.touchedFiles);
    expect(dry.io).toBe(ctx.io);

    // Using the dry ports touches nothing on the original.
    await dry.emit.anomalies([]);
    await dry.codeReviewSidecar.write('x');
    expect(ctx.emit).toBe(origEmit);
    expect(recorder.emitted).toHaveLength(1);
  });

  it('347-01/AC-2: a fresh recorder starts empty', () => {
    const r = createDryRunRecorder();
    expect(r.emitted).toEqual([]);
    expect(r.events).toEqual([]);
    expect(r.sidecarWrites).toEqual([]);
  });

  it('347-01/AC-2: the events a real settle would send are built by settle\'s own emit helpers, never sent', async () => {
    const { ctx } = fakeCtx();
    const recorder = createDryRunRecorder();
    const dry = withDryRunPorts(ctx, recorder);
    const high = { severity: 'high', file: 'a.ts', line: 3, message: 'secret leak' } as never;
    const low = { severity: 'low', file: 'a.ts', line: 4, message: 'nit' } as never;
    // Only HIGH findings become a code-review-high event, exactly as emitCodeReviewHigh decides.
    await dry.emit.codeReviewHigh({ 'a.ts': [low] }, { provider: 'mock', bypassed: false });
    expect(recorder.events).toEqual([]);
    await dry.emit.codeReviewHigh({ 'a.ts': [high, low] }, { provider: 'host-cli', bypassed: false });
    await dry.emit.codeReviewUnconverged({ draftId: '347-01', attempts: 3, maxAttempts: 3, findings: 1, provider: 'host-cli' });
    await dry.emit.skillAuditMiss({ required: ['phase-build'], invoked: [], missing: ['phase-build'], severity: 'error' });
    expect(recorder.events.map((e) => e.type)).toEqual(['code-review-high', 'code-review-unconverged', 'skill-audit-miss']);
    for (const e of recorder.events) {
      expect(typeof e.severity).toBe('string');
      expect(e.message.length).toBeGreaterThan(0);
    }
    expect(recorder.events[0]!.message).toContain('secret leak');
    // Recorded arguments are copies: mutating the caller's objects afterwards changes nothing.
    (high as { message: string }).message = 'changed';
    expect(JSON.stringify(recorder.emitted)).not.toContain('changed');
  });
});
