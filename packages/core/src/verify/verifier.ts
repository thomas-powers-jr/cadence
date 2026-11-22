/**
 * Abstract interface for the `--deep` independent verifier. Implementations
 * read AC text + relevant code + tests and return a per-AC pass/fail verdict
 * with reasoning. Selection is config-driven (see `selectVerifier`).
 */
import { hostCliIsolationFlags, hostCliJSON, inferFamily, type SpawnFn } from './host-cli-client.js';
import { localChatJSON } from './local-client.js';
import {
  SYSTEM_PROMPT,
  VerifierResponseSchema,
  formatUserMessage,
} from './anthropic-verifier.js';

export interface VerifyAc {
  /** Stable AC id, e.g. "AC-1". */
  id: string;
  /** Human-readable Given clause from the DRAFT. */
  given: string;
  /** Human-readable When clause. */
  when: string;
  /** Human-readable Then clause — the actual outcome to verify. */
  then: string;
}

export interface VerifyTestRef {
  /** Path relative to repoRoot, forward-slashed. */
  file: string;
  /** 1-based line where the AC token appeared. */
  line: number;
  /** Trimmed snippet of the matching test line. */
  snippet: string;
  /** Assertion mode only: true when the ref is inside a qualifying span. */
  qualifying?: boolean;
  /** Assertion mode only: true when the ref falls inside a skip/todo/failing span. */
  skipped?: boolean;
}

export interface VerifyInput {
  /** ACs to verify. */
  acs: VerifyAc[];
  /** Map of AC id → linked test refs (from `scanTestCoverage`). */
  tests: Record<string, VerifyTestRef[]>;
  /** Optional unified diff of code changes for the phase. May be empty. */
  diff: string;
  /** Optional list of touched source files (for context). May be empty. */
  files: string[];
}

export interface AcVerdict {
  pass: boolean;
  /** Short, human-readable reason (≤ 200 chars). */
  reason: string;
}

/**
 * Phase 73: token usage from a real LLM provider, when it reports one. Cost in
 * dollars is intentionally NOT derived here — no price table to rot (v1.15
 * scope guard). The `mock` provider never sets this.
 */
export interface VerifyUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface VerifyResult {
  /** Per-AC verdicts keyed by AC id. */
  verdicts: Record<string, AcVerdict>;
  /** Provider name (e.g. "mock", "anthropic"). Stamped into SUMMARY. */
  provider: string;
  /** Optional model name when the provider is an LLM. */
  model?: string;
  /** Phase 73: token usage when the provider reports it. Omitted otherwise. */
  usage?: VerifyUsage;
}

/**
 * Verifiers must be safe to call without I/O setup beyond what the
 * constructor accepts. Implementations should *not* throw on per-AC verdict
 * failures — failed verdicts go in `result.verdicts[id].pass = false`.
 * Throwing is reserved for transport errors (network, malformed response).
 */
export interface Verifier {
  readonly name: string;
  verify(
    input: VerifyInput,
    opts?: { signal?: AbortSignal; traceId?: string },
  ): Promise<VerifyResult>;
}

export interface LocalVerifierOptions {
  baseURL: string;
  model: string;
  transport?: typeof fetch;
  /** Phase 72: extra HTTP headers (e.g. an Authorization bearer). Never logged. */
  headers?: Record<string, string>;
}

export class LocalVerifier implements Verifier {
  readonly name = 'local';
  constructor(private readonly o: LocalVerifierOptions) {}

  async verify(
    input: VerifyInput,
    opts?: { signal?: AbortSignal; traceId?: string },
  ): Promise<VerifyResult> {
    if (input.acs.length === 0) {
      return { verdicts: {}, provider: this.name, model: this.o.model };
    }
    let usage: VerifyUsage | undefined;
    const parsed = await localChatJSON({
      baseURL: this.o.baseURL,
      model: this.o.model,
      system: SYSTEM_PROMPT,
      user: formatUserMessage(input),
      schema: VerifierResponseSchema,
      onUsage: (u) => {
        usage = u;
      },
      ...(this.o.transport ? { transport: this.o.transport } : {}),
      ...(this.o.headers ? { headers: this.o.headers } : {}),
      ...(opts?.signal ? { signal: opts.signal } : {}),
      ...(opts?.traceId ? { traceId: opts.traceId } : {}),
    });
    const verdicts: Record<string, AcVerdict> = {};
    for (const v of parsed.verdicts) verdicts[v.id] = { pass: v.pass, reason: v.reason };
    return {
      verdicts,
      provider: this.name,
      model: this.o.model,
      ...(usage ? { usage } : {}),
    };
  }
}

export interface HostCliVerifierOptions {
  /** Host CLI binary name or path, e.g. `"claude"` or `"codex"`. */
  bin: string;
  model?: string;
  /** Inject a spawn implementation for tests; production callers should omit this. */
  spawnImpl?: SpawnFn;
  /** Phase 344: the effective `verification.hostCliIsolation`, handed to
   *  `hostCliJSON` unchanged. Absent leaves the client's default (`on`). */
  isolation?: 'on' | 'off';
}

/**
 * Phase 344 (344-01, T3): records, on a host-cli verifier's result, the
 * isolation flags its child was spawned with. Called by the three settle
 * host-cli verifiers (`HostCliVerifier` below, `HostCliCodeReviewVerifier`,
 * `HostCliSecurityAuditVerifier`) only AFTER `hostCliJSON` has returned - never
 * on a no-spawn early return, and a call that threw has no result to tag.
 *
 * The list is `hostCliIsolationFlags(inferFamily(bin))`: the helper
 * `buildInvocation` inserts into the argv, with the family `hostCliJSON`
 * infers from the same `bin` (none of the three passes a `family` override),
 * so the record and the argv cannot diverge. With `isolation: 'off'` no flag
 * was passed and nothing is recorded; absent means on, as in `hostCliJSON`.
 *
 * NON-ENUMERABLE, like `providerSelection` (`tagProviderSelection` in
 * `verifier-factory.ts`): `toEqual`, `JSON.stringify` and object spread skip
 * it, so whole-result assertions and anything that serializes a result are
 * unaffected, while `readHostCliIsolation` (`gates/types.ts`) still reads it
 * by name - the gates may not import this module (the phase 234 lint zone).
 * `wrapWithFallback` tags and returns this same object, so the property
 * survives the factory's Proxy; a call-time fallback returns the mock's
 * result instead, which carries none. Best-effort: a result that cannot take
 * a new property simply records nothing.
 */
export function tagHostCliIsolation<T>(result: T, bin: string, isolation: 'on' | 'off' | undefined): T {
  if (isolation === 'off') return result;
  if (result !== null && typeof result === 'object') {
    try {
      Object.defineProperty(result, 'hostCliIsolation', {
        value: hostCliIsolationFlags(inferFamily(bin)),
        enumerable: false,
        configurable: true,
      });
    } catch {
      /* best-effort - a frozen/non-extensible result simply keeps no record */
    }
  }
  return result;
}

/**
 * Phase 191 — spawns the user's already-installed, already-authenticated
 * host CLI (`claude`/`codex`) in headless mode via `hostCliJSON` instead of
 * calling an HTTP endpoint. Structurally mirrors `LocalVerifier` — same
 * empty-ACs early return, `{signal, traceId}` opts threading,
 * `SYSTEM_PROMPT`/`formatUserMessage`/`VerifierResponseSchema` (imported from
 * `anthropic-verifier.ts`, same as `LocalVerifier`). `hostCliJSON` does not
 * report token usage, so `usage` is correctly never set here — unlike
 * `LocalVerifier`, this is not a gap, just an honest omission matching what
 * the transport actually reports.
 */
export class HostCliVerifier implements Verifier {
  readonly name = 'host-cli';
  constructor(private readonly o: HostCliVerifierOptions) {}

  async verify(
    input: VerifyInput,
    opts?: { signal?: AbortSignal; traceId?: string },
  ): Promise<VerifyResult> {
    if (input.acs.length === 0) {
      return { verdicts: {}, provider: this.name, ...(this.o.model ? { model: this.o.model } : {}) };
    }
    const parsed = await hostCliJSON({
      bin: this.o.bin,
      ...(this.o.model ? { model: this.o.model } : {}),
      system: SYSTEM_PROMPT,
      user: formatUserMessage(input),
      schema: VerifierResponseSchema,
      ...(this.o.spawnImpl ? { spawnImpl: this.o.spawnImpl } : {}),
      ...(this.o.isolation !== undefined ? { isolation: this.o.isolation } : {}),
      ...(opts?.signal ? { signal: opts.signal } : {}),
      ...(opts?.traceId ? { traceId: opts.traceId } : {}),
    });
    const verdicts: Record<string, AcVerdict> = {};
    for (const v of parsed.verdicts) verdicts[v.id] = { pass: v.pass, reason: v.reason };
    const result: VerifyResult = {
      verdicts,
      provider: this.name,
      ...(this.o.model ? { model: this.o.model } : {}),
    };
    return tagHostCliIsolation(result, this.o.bin, this.o.isolation);
  }
}
