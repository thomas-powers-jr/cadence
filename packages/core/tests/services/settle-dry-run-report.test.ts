import { describe, expect, it } from 'vitest';
import type { AnomalyEvent, GateProvenance } from '@thomas-powers-jr/cadence-types';
import {
  renderSettleDryRunReport,
  type DryRunReportInput,
} from '../../src/services/settle-dry-run-report.js';

/**
 * Phase 347 (347-01, T2): the pure `settle run --dry-run` report renderer.
 * Every input is a plain value; nothing here touches disk or a notifier.
 */

function base(patch: Partial<DryRunReportInput> = {}): DryRunReportInput {
  return {
    draftId: '347-01',
    gates: [],
    findingsBypasses: [],
    refusal: null,
    sidecarWrites: [],
    maxAttempts: 3,
    events: [],
    wouldPrompt: false,
    ...patch,
  };
}

function sidecar(args: {
  attempts: number;
  verdict: string;
  pass?: boolean;
  bypassed?: boolean;
  maxAttempts?: number;
}): string {
  const entry = {
    at: '2026-11-18T00:00:00.000Z',
    pass: args.pass ?? false,
    findingsCount: 1,
    provider: 'mock',
    verdict: args.verdict,
    ...(args.bypassed ? { bypassed: true } : {}),
  };
  return (
    JSON.stringify(
      {
        draftId: '347-01',
        converged: args.pass ?? false,
        attempts: args.attempts,
        maxAttempts: args.maxAttempts ?? 3,
        history: [entry],
        pass: args.pass ?? false,
        provider: 'mock',
        findings: 1,
        at: entry.at,
      },
      null,
      2,
    ) + '\n'
  );
}

const lines = (text: string): string[] => text.split('\n');

describe('renderSettleDryRunReport (347-01, T2)', () => {
  it('347-01/AC-3: names each gate with its outcome — ran, skipped with reason, refused with reason, bypassed with the flag — and its provider', () => {
    const gates: GateProvenance[] = [
      { gate: 'draft-read', status: 'ran' },
      { gate: 'boundary-scan', status: 'skipped', skipReason: 'not requested' },
      { gate: 'build-test-must-pass', status: 'skipped', skipReason: 'bypassed via --allow-failing-build' },
      { gate: 'deep-verify', status: 'ran', observedProvider: 'mock' },
      { gate: 'code-review', status: 'refused', reason: 'attempt 1/3 did not pass', provider: 'anthropic', model: 'm-1' },
    ];
    const { text, data } = renderSettleDryRunReport(
      base({ gates, refusal: { at: 'code-review', reason: 'attempt 1/3 did not pass' } }),
    );
    const l = lines(text);
    expect(l).toContain('  draft-read: ran');
    expect(l).toContain('  boundary-scan: skipped — not requested');
    expect(l).toContain('  build-test-must-pass: bypassed via --allow-failing-build');
    expect(l).toContain('  deep-verify: ran [provider mock]');
    expect(l).toContain('  code-review: refused — attempt 1/3 did not pass [provider anthropic, model m-1]');
    expect(data.gates).toEqual(gates);
  });

  it('347-01/AC-3: a gate that passed only by waving findings through is reported as bypassed with the flag', () => {
    const { text } = renderSettleDryRunReport(
      base({
        gates: [{ gate: 'code-review', status: 'ran', provider: 'mock' }],
        findingsBypasses: [
          { gate: 'code-review', flag: '--allow-code-review-failure', reason: 'bypassed 1 finding(s), highest severity high', severity: 'error' },
        ],
      }),
    );
    expect(lines(text)).toContain(
      '  code-review: ran, findings bypassed via --allow-code-review-failure (bypassed 1 finding(s), highest severity high) [provider mock]',
    );
  });

  it('347-01/AC-3: lists each deep-verify AC verdict with its reason and provider', () => {
    const { text, data } = renderSettleDryRunReport(
      base({
        deepVerify: {
          'AC-1': { pass: true, reason: 'mock: 1 linked test', provider: 'mock' },
          'AC-2': { pass: false, reason: 'no linked test found', provider: 'mock', model: 'x' },
        },
      }),
    );
    expect(lines(text)).toContain('  AC-1: pass — mock: 1 linked test [provider mock]');
    expect(lines(text)).toContain('  AC-2: fail — no linked test found [provider mock, model x]');
    expect(data.deepVerify).toEqual([
      { id: 'AC-1', pass: true, reason: 'mock: 1 linked test', provider: 'mock' },
      { id: 'AC-2', pass: false, reason: 'no linked test found', provider: 'mock', model: 'x' },
    ]);
  });

  it('347-01/AC-3: lists code-review findings (severity file:line message) with provider and model, and the would-be attempt and reloop verdict', () => {
    const { text, data } = renderSettleDryRunReport(
      base({
        gates: [{ gate: 'code-review', status: 'refused', reason: 'r', provider: 'mock' }],
        codeReview: {
          'src/foo.ts': [
            { severity: 'high', message: 'console.log left in source', line: 1 },
            { severity: 'low', message: 'nit' },
          ],
        },
        sidecarWrites: [sidecar({ attempts: 2, verdict: 'reloop' })],
      }),
    );
    const l = lines(text);
    expect(l).toContain('code-review findings [provider mock]:');
    expect(l).toContain('  high src/foo.ts:1 console.log left in source');
    expect(l).toContain('  low src/foo.ts nit');
    expect(l).toContain('  convergence: would be attempt 2 of 3 — verdict reloop');
    expect(data.codeReview).toMatchObject({
      provider: 'mock',
      findings: [
        { severity: 'high', file: 'src/foo.ts', line: 1, message: 'console.log left in source' },
        { severity: 'low', file: 'src/foo.ts', message: 'nit' },
      ],
      convergence: { attempt: 2, maxAttempts: 3, verdict: 'reloop', consumesAttempt: true },
    });
  });

  it('347-01/AC-3: reports escalate and bypassed convergence verdicts as consuming an attempt', () => {
    const esc = renderSettleDryRunReport(
      base({ codeReview: {}, sidecarWrites: [sidecar({ attempts: 3, verdict: 'escalate' })] }),
    );
    expect(esc.data.codeReview?.convergence).toEqual({
      attempt: 3, maxAttempts: 3, verdict: 'escalate', consumesAttempt: true,
    });
    expect(lines(esc.text)).toContain('  convergence: would be attempt 3 of 3 — verdict escalate');

    const byp = renderSettleDryRunReport(
      base({ codeReview: {}, sidecarWrites: [sidecar({ attempts: 1, verdict: 'reloop', bypassed: true })] }),
    );
    expect(byp.data.codeReview?.convergence).toEqual({
      attempt: 1, maxAttempts: 3, verdict: 'bypassed', consumesAttempt: true,
    });
    expect(lines(byp.text)).toContain('  convergence: would be attempt 1 of 3 — verdict bypassed');
  });

  it('347-01/AC-3: a passing or abstained review is reported as consuming no attempt', () => {
    for (const verdict of ['pass', 'abstained'] as const) {
      const { text, data } = renderSettleDryRunReport(
        base({ codeReview: {}, sidecarWrites: [sidecar({ attempts: 1, verdict, pass: verdict === 'pass' })] }),
      );
      expect(data.codeReview?.convergence).toEqual({
        attempt: 1, maxAttempts: 3, verdict, consumesAttempt: false,
      });
      expect(lines(text)).toContain(
        `  convergence: verdict ${verdict} — consumes no attempt (attempts stay at 1 of 3)`,
      );
    }
  });

  it('347-01/AC-3: uses the LAST would-be sidecar write and falls back to config maxAttempts when the sidecar omits it', () => {
    const noMax = JSON.stringify({ attempts: 1, history: [{ verdict: 'reloop', pass: false }] });
    const { data } = renderSettleDryRunReport(
      base({ codeReview: {}, maxAttempts: 5, sidecarWrites: [sidecar({ attempts: 9, verdict: 'escalate' }), noMax] }),
    );
    expect(data.codeReview?.convergence).toEqual({
      attempt: 1, maxAttempts: 5, verdict: 'reloop', consumesAttempt: true,
    });
  });

  it('347-01/AC-3: lists security-audit findings with provider and model', () => {
    const { text, data } = renderSettleDryRunReport(
      base({
        gates: [{ gate: 'security-audit', status: 'refused', reason: 'r', provider: 'anthropic', model: 'm' }],
        securityAudit: [{ severity: 'critical', message: 'hardcoded JWT-shaped credential', line: 4 }],
      }),
    );
    expect(lines(text)).toContain('security-audit findings [provider anthropic, model m]:');
    expect(lines(text)).toContain('  critical -:4 hardcoded JWT-shaped credential');
    expect(data.securityAudit).toEqual({
      provider: 'anthropic',
      model: 'm',
      findings: [{ severity: 'critical', line: 4, message: 'hardcoded JWT-shaped credential' }],
    });
  });

  it('347-01/AC-3: lists every recorded anomaly event under `would notify:`', () => {
    const events: AnomalyEvent[] = [
      { type: 'code-review-high', severity: 'error', message: 'HIGH finding in src/foo.ts', context: {}, ts: 't' },
      { type: 'loop-violation', severity: 'error', message: 'settle run requires BUILD', context: {}, ts: 't' },
    ] as AnomalyEvent[];
    const { text, data } = renderSettleDryRunReport(base({ events }));
    const l = lines(text);
    const at = l.indexOf('would notify:');
    expect(at).toBeGreaterThan(-1);
    expect(l[at + 1]).toBe('  code-review-high [error] HIGH finding in src/foo.ts');
    expect(l[at + 2]).toBe('  loop-violation [error] settle run requires BUILD');
    expect(data.wouldNotify).toEqual([
      { type: 'code-review-high', severity: 'error', message: 'HIGH finding in src/foo.ts', context: {} },
      { type: 'loop-violation', severity: 'error', message: 'settle run requires BUILD', context: {} },
    ]);
  });

  it('347-01/AC-3: with no events, says nothing would be notified', () => {
    const { text, data } = renderSettleDryRunReport(base());
    expect(lines(text)).toContain('would notify: nothing');
    expect(data.wouldNotify).toEqual([]);
  });

  it('347-01/AC-3: ends with `settle would pass` when nothing refused, and exposes verdict pass', () => {
    const { text, data } = renderSettleDryRunReport(base());
    const l = lines(text.trimEnd());
    expect(l[l.length - 1]).toBe('settle would pass');
    expect(data.verdict).toBe('pass');
    expect(data.refusal).toBeNull();
  });

  it('347-01/AC-3: ends with `settle would refuse at <gate or check>: <reason>`, without settle\'s own "settle run refused:" prefix', () => {
    const { text, data } = renderSettleDryRunReport(
      base({ refusal: { at: 'evidence-floor', reason: 'settle run refused: evidence-floor requires at least \'assertion\'\nsecond line' } }),
    );
    const l = lines(text.trimEnd());
    expect(l[l.length - 1]).toBe(
      "settle would refuse at evidence-floor: evidence-floor requires at least 'assertion' second line",
    );
    expect(data.verdict).toBe('refuse');
    expect(data.refusal).toEqual({
      at: 'evidence-floor',
      reason: "settle run refused: evidence-floor requires at least 'assertion'\nsecond line",
    });
  });

  it('347-01/AC-4: when settle would prompt, says so on its own line, assumes every AC is confirmed, and leaves the final line as the bare verdict', () => {
    const { text, data } = renderSettleDryRunReport(base({ wouldPrompt: true }));
    const l = lines(text.trimEnd());
    expect(l).toContain(
      'interactive-verdict: settle would prompt for AC verdicts; the dry run took the non-interactive path and this verdict assumes every AC is confirmed',
    );
    expect(l[l.length - 1]).toBe('settle would pass');
    expect(data.wouldPrompt).toBe(true);
  });

  it('347-01/AC-3: omits the code-review and security-audit sections when those gates produced nothing', () => {
    const { text, data } = renderSettleDryRunReport(base());
    expect(text).not.toContain('code-review findings');
    expect(text).not.toContain('security-audit findings');
    expect(data.codeReview).toBeNull();
    expect(data.securityAudit).toBeNull();
    expect(data.deepVerify).toEqual([]);
  });
});
