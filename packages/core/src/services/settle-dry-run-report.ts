import type {
  AnomalyEvent,
  DeepVerdict,
  Finding,
  GateBypass,
  GateProvenance,
} from '@thomas-powers-jr/cadence-types';

/**
 * Phase 347 (347-01, T2): the pure `settle run --dry-run` report. Takes what
 * the dry run observed — the per-gate provenance list settle would record,
 * the first refusal (or none), the verifier outputs off the gate accumulator,
 * the anomaly events the dry-run ports recorded and the would-be code-review
 * sidecar text — and returns the stdout text plus the same facts as data.
 * No I/O. The input types live here (not in settle.ts) so settle.ts imports
 * this module one way and there is no runtime cycle.
 */

/** Where settle would stop: a gate name, or a named non-gate check
 *  (`loop-position`, `phase-collision`, `auto-complex-soft-cap`,
 *  `ac-derivation`, `pack-resolution`, `skill-audit`, `evidence-floor`,
 *  `error`), with settle's own reason. */
export interface DryRunRefusal {
  readonly at: string;
  readonly reason: string;
}

export interface DryRunReportInput {
  readonly draftId: string | null;
  /** Exactly the `gates` array settle would write into SUMMARY (or the
   *  refused SUMMARY); empty when settle stops before the gate loop. */
  readonly gates: readonly GateProvenance[];
  /** Code-review / security-audit findings bypasses (`runSettleGates`). */
  readonly findingsBypasses: readonly GateBypass[];
  readonly refusal: DryRunRefusal | null;
  readonly deepVerify?: Readonly<Record<string, DeepVerdict>>;
  readonly codeReview?: Readonly<Record<string, readonly Finding[]>>;
  readonly securityAudit?: readonly Finding[];
  /** Every would-be `*-CODE-REVIEW.json` text, in order; the last one is what
   *  settle would leave on disk. */
  readonly sidecarWrites: readonly string[];
  /** `config.convergence.maxAttempts ?? 3`, used when the sidecar lacks it. */
  readonly maxAttempts: number;
  readonly events: readonly AnomalyEvent[];
  /** Settle (without --dry-run) would walk ACs interactively. */
  readonly wouldPrompt: boolean;
}

export type DryRunConvergenceVerdict = 'pass' | 'abstained' | 'reloop' | 'escalate' | 'bypassed';

export interface DryRunConvergence {
  /** For a failing review, the attempt this would have been; for a passing
   *  (or abstained) one, the failing-attempt count that stays unchanged. */
  attempt: number;
  maxAttempts: number;
  verdict: DryRunConvergenceVerdict;
  consumesAttempt: boolean;
}

export interface DryRunFindingRow {
  severity: Finding['severity'];
  file?: string;
  line?: number;
  message: string;
}

export interface DryRunReportData {
  verdict: 'pass' | 'refuse';
  refusal: DryRunRefusal | null;
  gates: GateProvenance[];
  deepVerify: Array<{ id: string; pass: boolean; reason: string; provider: string; model?: string }>;
  codeReview: {
    provider?: string;
    model?: string;
    findings: DryRunFindingRow[];
    convergence?: DryRunConvergence;
  } | null;
  securityAudit: { provider?: string; model?: string; findings: DryRunFindingRow[] } | null;
  wouldNotify: Array<{ type: string; severity: string; message: string; context: Record<string, unknown> }>;
  wouldPrompt: boolean;
}

const BYPASSED_VIA = 'bypassed via ';
const SETTLE_REFUSED_PREFIX = 'settle run refused: ';

function identity(provider: string | undefined, model: string | undefined): string {
  if (provider === undefined) return '';
  return ` [provider ${provider}${model !== undefined ? `, model ${model}` : ''}]`;
}

function gateLine(g: GateProvenance, bypasses: readonly GateBypass[]): string {
  const id = identity(g.provider ?? g.observedProvider, g.model ?? g.observedModel);
  const task = g.taskId !== undefined ? ` (${g.taskId})` : '';
  let outcome: string;
  if (g.status === 'refused') {
    outcome = g.reason !== undefined ? `refused — ${g.reason}` : 'refused';
  } else if (g.status === 'skipped') {
    const why = g.skipReason ?? '';
    outcome = why.startsWith(BYPASSED_VIA) ? why : why ? `skipped — ${why}` : 'skipped';
  } else {
    const bypass = bypasses.find((b) => b.gate === g.gate);
    outcome = bypass ? `ran, findings bypassed via ${bypass.flag} (${bypass.reason})` : 'ran';
  }
  return `  ${g.gate}${task}: ${outcome}${id}`;
}

function findingLine(f: DryRunFindingRow): string {
  const loc = `${f.file ?? '-'}${f.line !== undefined ? `:${f.line}` : ''}`;
  return `  ${f.severity} ${loc} ${f.message}`;
}

/** Reads the would-be sidecar text the code-review gate built through the
 *  shared `runConvergentReview` primitive (`verify/converge.ts`): `attempts`
 *  is the failing-attempt count after this attempt, the last history entry's
 *  `verdict` is `pass | abstained | reloop | escalate`, and `bypassed: true`
 *  marks a failing review waved through. Unparseable text → none. */
function readConvergence(text: string | undefined, fallbackMax: number): DryRunConvergence | undefined {
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const sc = parsed as { attempts?: unknown; maxAttempts?: unknown; history?: unknown };
  const history = Array.isArray(sc.history) ? sc.history : [];
  const last = history[history.length - 1] as { verdict?: unknown; bypassed?: unknown } | undefined;
  const raw = typeof last?.verdict === 'string' ? last.verdict : undefined;
  if (raw !== 'pass' && raw !== 'abstained' && raw !== 'reloop' && raw !== 'escalate') return undefined;
  const verdict: DryRunConvergenceVerdict = last?.bypassed === true ? 'bypassed' : raw;
  return {
    attempt: typeof sc.attempts === 'number' ? sc.attempts : 0,
    maxAttempts: typeof sc.maxAttempts === 'number' ? sc.maxAttempts : fallbackMax,
    verdict,
    consumesAttempt: verdict !== 'pass' && verdict !== 'abstained',
  };
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function renderSettleDryRunReport(input: DryRunReportInput): { text: string; data: DryRunReportData } {
  const out: string[] = [];
  out.push(`settle --dry-run${input.draftId ? ` ${input.draftId}` : ''} (nothing written, nothing notified, no attempt spent)`);

  out.push(input.gates.length > 0 ? 'gates:' : 'gates: none ran');
  for (const g of input.gates) out.push(gateLine(g, input.findingsBypasses));

  const deepVerify: DryRunReportData['deepVerify'] = Object.entries(input.deepVerify ?? {}).map(
    ([id, v]) => ({
      id,
      pass: v.pass,
      reason: v.reason,
      provider: v.provider,
      ...(v.model !== undefined ? { model: v.model } : {}),
    }),
  );
  if (deepVerify.length > 0) {
    out.push('deep-verify:');
    for (const v of deepVerify) {
      out.push(`  ${v.id}: ${v.pass ? 'pass' : 'fail'} — ${v.reason}${identity(v.provider, v.model)}`);
    }
  }

  let codeReview: DryRunReportData['codeReview'] = null;
  const convergence = readConvergence(input.sidecarWrites[input.sidecarWrites.length - 1], input.maxAttempts);
  if (input.codeReview !== undefined || convergence !== undefined) {
    const g = input.gates.find((x) => x.gate === 'code-review');
    const findings: DryRunFindingRow[] = [];
    for (const [file, list] of Object.entries(input.codeReview ?? {})) {
      for (const f of list) {
        findings.push({ severity: f.severity, file, ...(f.line !== undefined ? { line: f.line } : {}), message: f.message });
      }
    }
    codeReview = {
      ...(g?.provider !== undefined ? { provider: g.provider } : {}),
      ...(g?.model !== undefined ? { model: g.model } : {}),
      findings,
      ...(convergence ? { convergence } : {}),
    };
    out.push(`code-review findings${identity(g?.provider, g?.model)}:`);
    if (findings.length === 0) out.push('  (none)');
    for (const f of findings) out.push(findingLine(f));
    if (convergence) {
      out.push(
        convergence.consumesAttempt
          ? `  convergence: would be attempt ${convergence.attempt} of ${convergence.maxAttempts} — verdict ${convergence.verdict}`
          : `  convergence: verdict ${convergence.verdict} — consumes no attempt (attempts stay at ${convergence.attempt} of ${convergence.maxAttempts})`,
      );
    }
  }

  let securityAudit: DryRunReportData['securityAudit'] = null;
  if (input.securityAudit !== undefined) {
    const g = input.gates.find((x) => x.gate === 'security-audit');
    const findings: DryRunFindingRow[] = input.securityAudit.map((f) => ({
      severity: f.severity,
      ...(f.line !== undefined ? { line: f.line } : {}),
      message: f.message,
    }));
    securityAudit = {
      ...(g?.provider !== undefined ? { provider: g.provider } : {}),
      ...(g?.model !== undefined ? { model: g.model } : {}),
      findings,
    };
    out.push(`security-audit findings${identity(g?.provider, g?.model)}:`);
    if (findings.length === 0) out.push('  (none)');
    for (const f of findings) out.push(findingLine(f));
  }

  const wouldNotify = input.events.map((e) => ({
    type: e.type,
    severity: e.severity,
    message: e.message,
    context: { ...e.context },
  }));
  if (wouldNotify.length === 0) {
    out.push('would notify: nothing');
  } else {
    out.push('would notify:');
    for (const e of wouldNotify) out.push(`  ${e.type} [${e.severity}] ${oneLine(e.message)}`);
  }

  if (input.wouldPrompt) {
    out.push('interactive-verdict: settle would prompt for AC verdicts; the dry run took the non-interactive path');
  }

  const promptNote = input.wouldPrompt ? ' (settle would prompt for AC verdicts first)' : '';
  if (input.refusal) {
    const reason = oneLine(input.refusal.reason);
    const shown = reason.startsWith(SETTLE_REFUSED_PREFIX) ? reason.slice(SETTLE_REFUSED_PREFIX.length) : reason;
    out.push(`settle would refuse at ${input.refusal.at}: ${shown}${promptNote}`);
  } else {
    out.push(`settle would pass${promptNote}`);
  }

  return {
    text: out.join('\n') + '\n',
    data: {
      verdict: input.refusal ? 'refuse' : 'pass',
      refusal: input.refusal ? { at: input.refusal.at, reason: input.refusal.reason } : null,
      gates: input.gates.map((g) => ({ ...g })),
      deepVerify,
      codeReview,
      securityAudit,
      wouldNotify,
      wouldPrompt: input.wouldPrompt,
    },
  };
}
