// Phase 344 (344-01, T3) - the isolation flags a host-cli review agent was
// spawned with, recorded on the settle gate entry.
//
// Every test drives the REAL `runSettleGates` driver over the REAL gate impls
// (deep-verify, code-review, security-audit) and REAL host-cli verifiers; only
// the process spawn is replaced, by an injected fake. No real `claude`/`codex`
// binary runs and nothing touches the network: every test that can reach a
// spawn injects `spawnImpl` AND runs under `guardEnv()`'s empty PATH.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SummaryZ, type GateProvenance, type Summary } from '@thomas-powers-jr/cadence-types';
import type { SettleContext, VerifierPorts } from '../../src/gates/types.js';
import { runSettleGates, type SettleGate } from '../../src/gates/registry.js';
import {
  hostCliIsolationFlags,
  inferFamily,
  type SpawnFn,
  type SpawnedProcessLike,
} from '../../src/verify/host-cli-client.js';
import { HostCliVerifier, readHostCliIsolation } from '../../src/verify/verifier.js';
import { HostCliCodeReviewVerifier } from '../../src/verify/code-review.js';
import { HostCliSecurityAuditVerifier } from '../../src/verify/security-audit.js';
import type { VerifierSelectOptions } from '../../src/verify/verifier-factory.js';
import { selectVerifier } from '../../src/verify/factory.js';
import { selectCodeReviewVerifier } from '../../src/verify/code-review-factory.js';
import { selectSecurityAuditVerifier } from '../../src/verify/security-audit-factory.js';
import { computeSummaryContentHash } from '../../src/services/summary-hash.js';
import { verifySummaryContentHash } from '../../src/services/summary-verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CADENCE_CLI = join(__dirname, '../../dist/cli/index.js');

interface FakeCall {
  bin: string;
  args: string[];
  stdin: string;
}

interface FakeResponse {
  stdout?: string;
  stderr?: string;
  code?: number;
}

/** Records each spawn call and answers every one with `resp` (same shape as
 *  `tests/verify/host-cli-isolation-optout.test.ts`'s `fakeSpawn`). */
function fakeSpawn(resp: FakeResponse, calls: FakeCall[]): SpawnFn {
  return (bin, args) => {
    const call: FakeCall = { bin, args, stdin: '' };
    calls.push(call);

    const stdoutListeners: Array<(chunk: Buffer) => void> = [];
    const stderrListeners: Array<(chunk: Buffer) => void> = [];
    let closeListener: ((code: number | null) => void) | undefined;

    const proc: SpawnedProcessLike = {
      stdin: {
        write: (chunk: string | Buffer) => {
          call.stdin += chunk.toString();
          return true;
        },
        end: () => undefined,
        on: () => proc.stdin as NodeJS.WritableStream,
      } as unknown as NodeJS.WritableStream,
      stdout: {
        on: (event: string, cb: (chunk: Buffer) => void) => {
          if (event === 'data') stdoutListeners.push(cb);
          return proc.stdout as NodeJS.ReadableStream;
        },
      } as unknown as NodeJS.ReadableStream,
      stderr: {
        on: (event: string, cb: (chunk: Buffer) => void) => {
          if (event === 'data') stderrListeners.push(cb);
          return proc.stderr as NodeJS.ReadableStream;
        },
      } as unknown as NodeJS.ReadableStream,
      on: (event: 'error' | 'close', cb: ((err: NodeJS.ErrnoException) => void) | ((code: number | null) => void)) => {
        if (event === 'close') closeListener = cb as (code: number | null) => void;
        return proc;
      },
      kill: () => true,
    };

    queueMicrotask(() => {
      if (resp.stdout !== undefined) stdoutListeners.forEach((l) => l(Buffer.from(resp.stdout as string)));
      if (resp.stderr !== undefined) stderrListeners.forEach((l) => l(Buffer.from(resp.stderr as string)));
      closeListener?.(resp.code ?? 0);
    });

    return proc;
  };
}

type Bin = 'codex' | 'claude';
const BINS = ['claude', 'codex'] as const;

/** A successful headless reply carrying `payload` as the model's final text, in the family's own output shape. */
function okResponse(bin: Bin, payload: unknown): FakeResponse {
  const text = JSON.stringify(payload);
  return bin === 'codex'
    ? { stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) }
    : { stdout: JSON.stringify({ is_error: false, result: text }) };
}

/** A child that exits non-zero: a `HostCliError` (`nonzero-exit`) for the caller. */
const FAILING: FakeResponse = { code: 1, stderr: 'not authenticated' };

/** The literal AC-5 values. */
const AC5_FLAGS: Record<Bin, string[]> = {
  claude: ['--setting-sources', 'project', '--strict-mcp-config'],
  codex: ['--ignore-user-config'],
};
/** The argv each family was spawned with before phase 344 (no model). */
const PRE_PHASE_ARGV: Record<Bin, string[]> = {
  codex: ['exec', '--json', '--skip-git-repo-check', '-'],
  claude: ['-p', '--output-format', 'json'],
};

/**
 * The isolation tokens actually present in a recorded argv: what is left of
 * it, in order, once each pre-phase token has been removed once. Derived from
 * the argv alone, never from `hostCliIsolationFlags`.
 */
function isolationTokensIn(bin: Bin, args: string[]): string[] {
  const left = [...args];
  for (const token of PRE_PHASE_ARGV[bin]) {
    const at = left.indexOf(token);
    if (at !== -1) left.splice(at, 1);
  }
  return left;
}

const DEEP_OK = { verdicts: [{ id: 'AC-1', pass: true, reason: 'ok' }] };
const REVIEW_OK = { findings: [] };

const dirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cadence-isolation-provenance-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Env stubs every spawning test here needs (undone by `afterEach`).
 * - `CLAUDECODE`: the self-invocation guard reads `process.env`, and a Claude
 *   Code session running this suite exports `CLAUDECODE=1`, which would
 *   refuse the claude-family spawn before the fake is reached.
 * - `PATH`: an empty directory, so that if a `spawnImpl` ever stopped being
 *   forwarded the real spawn could not find an installed `claude`/`codex` and
 *   the test would fail fast instead of running one.
 */
function guardEnv(): void {
  vi.stubEnv('CLAUDECODE', '');
  vi.stubEnv('PATH', makeTmpDir());
}

interface Spawns {
  deep: FakeCall[];
  codeReview: FakeCall[];
  securityAudit: FakeCall[];
}

interface Scenario {
  bin: Bin;
  /** `VerifierSelectOptions.hostCliIsolation`; absent leaves the option out. */
  isolation?: 'on' | 'off';
  /** `host-cli` (default) selects through the real selectors with `override: 'host-cli'`; `mock` selects with no override. */
  provider?: 'host-cli' | 'mock';
  /** Per-verifier reply from the fake child. Default: a valid passing reply. */
  responses?: { deep?: FakeResponse; codeReview?: FakeResponse; securityAudit?: FakeResponse };
  /** Use these verifier ports instead of selecting through the factories. */
  verifiers?: (spawns: Spawns) => VerifierPorts;
  acs?: Array<{ id: string; name: string; given: string; when: string; then: string }>;
  touchedFiles?: string[];
  diff?: string;
  opts?: SettleContext['opts'];
  /** Gates to run through `runSettleGates`, in this order. Default: all three. */
  order?: SettleGate[];
  /** Coverage refs handed to deep-verify (the mock verifier passes an AC iff it has one). */
  coverage?: Map<string, unknown>;
}

interface Run {
  gates: GateProvenance[];
  refused: boolean;
  spawns: Spawns;
  warns: string[];
  errs: string[];
}

const REVIEW_GATES: SettleGate[] = ['deep-verify', 'code-review', 'security-audit'];

/**
 * Runs the real settle gate driver over the real deep-verify / code-review /
 * security-audit gates, with verifiers on an injected fake spawn. Always
 * under `guardEnv()`.
 */
async function runGates(s: Scenario): Promise<Run> {
  guardEnv();
  const spawns: Spawns = { deep: [], codeReview: [], securityAudit: [] };
  const warns: string[] = [];
  const errs: string[] = [];
  const cwd = makeTmpDir();

  const selectOpts = (resp: FakeResponse, calls: FakeCall[]): VerifierSelectOptions => ({
    ...(s.provider === 'mock' ? {} : { override: 'host-cli' as const }),
    env: { CADENCE_HOST_CLI_BIN: s.bin },
    cwd,
    warn: (m) => warns.push(m),
    spawnImpl: fakeSpawn(resp, calls),
    ...(s.isolation !== undefined ? { hostCliIsolation: s.isolation } : {}),
  });

  const verifiers: VerifierPorts = s.verifiers
    ? s.verifiers(spawns)
    : {
        deep: selectVerifier(null, selectOpts(s.responses?.deep ?? okResponse(s.bin, DEEP_OK), spawns.deep)),
        codeReview: selectCodeReviewVerifier(
          null,
          selectOpts(s.responses?.codeReview ?? okResponse(s.bin, REVIEW_OK), spawns.codeReview),
        ),
        securityAudit: selectSecurityAuditVerifier(
          null,
          selectOpts(s.responses?.securityAudit ?? okResponse(s.bin, REVIEW_OK), spawns.securityAudit),
        ),
      };

  const ctx = {
    cwd,
    state: { draftReadAt: null, activePhase: '44-isolation', activeDraft: '44-01' },
    draft: {
      acceptanceCriteria: s.acs ?? [{ id: 'AC-1', name: 'works', given: 'g', when: 'w', then: 't' }],
      tasks: [{ id: 'T1', name: 'task', files: ['src/x.ts'], action: 'do', verify: 'check', done: 'AC-1' }],
      boundaries: [],
    },
    progress: { draftId: '44-01', tasks: {} },
    config: {
      convergence: { maxAttempts: 3 },
      verifier: { provider: 'host-cli' },
      codeReview: { provider: 'host-cli' },
      securityAudit: { provider: 'host-cli' },
    },
    gateSet: { gates: ['code-review', 'security-audit'], softCap: false },
    opts: s.opts ?? { deep: true },
    explicitIds: new Set<string>(),
    touchedFiles: s.touchedFiles ?? ['src/x.ts'],
    coverage: async () => s.coverage ?? new Map(),
    draftMtimeMs: async () => null,
    draftContentHash: async () => null,
    diff: () => s.diff ?? 'DIFF',
    verifiers,
    emit: { anomalies: async () => {}, codeReviewHigh: async () => {}, codeReviewUnconverged: async () => {} },
    runner: { test: async () => ({ ran: false, ok: true }) },
    prompter: { create: () => ({ ask: async () => '' }) },
    codeReviewSidecar: { read: async () => ({ attemptsSoFar: 0, history: [] }), write: async () => {} },
    io: { err: (m: string) => errs.push(m) },
  } as unknown as SettleContext;

  const { gates, refused } = await runSettleGates(ctx, { order: s.order ?? REVIEW_GATES });
  return { gates, refused, spawns, warns, errs };
}

function entryFor(run: Run, gate: SettleGate): GateProvenance {
  const entry = run.gates.find((g) => g.gate === gate);
  if (!entry) throw new Error(`no ${gate} entry in ${JSON.stringify(run.gates)}`);
  return entry;
}

describe.each(BINS)('the gate entry records the isolation flags, binary %s (344-01 AC-5)', (bin) => {
  it(`344-01/AC-5: with isolation on the deep-verify and code-review entries each carry the ${bin} isolation flags`, async () => {
    const run = await runGates({ bin });
    expect(run.refused).toBe(false);
    expect(run.warns).toEqual([]);

    const deep = entryFor(run, 'deep-verify');
    expect(deep.status).toBe('ran');
    expect(deep.observedProvider).toBe('host-cli');
    expect(deep.hostCliIsolation).toEqual(AC5_FLAGS[bin]);

    const review = entryFor(run, 'code-review');
    expect(review.status).toBe('ran');
    expect(review.provider).toBe('host-cli');
    expect(review.providerSelection).toBe('configured');
    expect(review.hostCliIsolation).toEqual(AC5_FLAGS[bin]);

    // The host-cli path really ran: one child per gate, the configured binary.
    expect(run.spawns.deep).toHaveLength(1);
    expect(run.spawns.codeReview).toHaveLength(1);
    expect(run.spawns.deep[0]?.bin).toBe(bin);
    expect(run.spawns.codeReview[0]?.bin).toBe(bin);
  });

  it(`344-01/AC-5: a security-audit entry produced by a host-cli security-audit verifier carries the ${bin} isolation flags`, async () => {
    const run = await runGates({ bin });
    const audit = entryFor(run, 'security-audit');
    expect(audit.status).toBe('ran');
    expect(audit.provider).toBe('host-cli');
    expect(audit.providerSelection).toBe('configured');
    expect(audit.hostCliIsolation).toEqual(AC5_FLAGS[bin]);
    expect(run.spawns.securityAudit).toHaveLength(1);
    expect(run.spawns.securityAudit[0]?.bin).toBe(bin);
  });

  it(`344-01/AC-5: the recorded list is hostCliIsolationFlags(inferFamily("${bin}")) and equals the isolation tokens in the argv the child was spawned with`, async () => {
    const run = await runGates({ bin });
    const fromHelper = hostCliIsolationFlags(inferFamily(bin));
    expect(fromHelper).toEqual(AC5_FLAGS[bin]);
    for (const [gate, calls] of [
      ['deep-verify', run.spawns.deep],
      ['code-review', run.spawns.codeReview],
      ['security-audit', run.spawns.securityAudit],
    ] as const) {
      const recorded = entryFor(run, gate).hostCliIsolation;
      expect(recorded).toEqual(fromHelper);
      expect(calls).toHaveLength(1);
      const args = calls[0]?.args ?? [];
      // The argv is the pre-phase argv plus exactly the recorded tokens.
      expect(isolationTokensIn(bin, args)).toEqual(recorded);
      expect(args).toHaveLength(PRE_PHASE_ARGV[bin].length + (recorded?.length ?? 0));
    }
  });

  it(`344-01/AC-5: with isolation off the field is absent from all three ${bin} entries, though the host-cli agents ran`, async () => {
    const run = await runGates({ bin, isolation: 'off' });
    expect(run.refused).toBe(false);
    for (const [gate, calls] of [
      ['deep-verify', run.spawns.deep],
      ['code-review', run.spawns.codeReview],
      ['security-audit', run.spawns.securityAudit],
    ] as const) {
      const entry = entryFor(run, gate);
      expect(entry.status).toBe('ran');
      expect(entry).not.toHaveProperty('hostCliIsolation');
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args).toEqual(PRE_PHASE_ARGV[bin]);
    }
    expect(entryFor(run, 'deep-verify').observedProvider).toBe('host-cli');
    expect(entryFor(run, 'code-review').provider).toBe('host-cli');
    expect(entryFor(run, 'security-audit').provider).toBe('host-cli');
  });

  it(`344-01/AC-5: when the ${bin} call fell back to mock the field is absent from all three entries`, async () => {
    const run = await runGates({
      bin,
      responses: { deep: FAILING, codeReview: FAILING, securityAudit: FAILING },
      // The mock verifier passes an AC iff it has a linked test.
      coverage: new Map([['AC-1', [{ file: 'tests/x.test.ts', line: 1, snippet: 'AC-1' }]]]),
    });
    expect(run.refused).toBe(false);
    // Each child was spawned (with the flags) and failed; each call fell back, loudly.
    expect(run.spawns.deep).toHaveLength(1);
    expect(run.spawns.codeReview).toHaveLength(1);
    expect(run.spawns.securityAudit).toHaveLength(1);
    expect(isolationTokensIn(bin, run.spawns.codeReview[0]?.args ?? [])).toEqual(AC5_FLAGS[bin]);
    expect(run.warns).toHaveLength(3);
    for (const w of run.warns) expect(w).toContain('falling back to mock provider for this call');

    const deep = entryFor(run, 'deep-verify');
    expect(deep.observedProvider).toBe('mock');
    expect(deep).not.toHaveProperty('hostCliIsolation');
    for (const gate of ['code-review', 'security-audit'] as const) {
      const entry = entryFor(run, gate);
      expect(entry.provider).toBe('mock');
      expect(entry.providerSelection).toBe('fallback');
      expect(entry).not.toHaveProperty('hostCliIsolation');
    }
  });

  it(`344-01/AC-5: a ${bin} host-cli deep verifier that returned without spawning (no ACs) leaves the field absent`, async () => {
    const run = await runGates({ bin, acs: [], order: ['deep-verify'] });
    const deep = entryFor(run, 'deep-verify');
    expect(deep.status).toBe('ran');
    expect(deep.observedProvider).toBe('host-cli');
    expect(deep).not.toHaveProperty('hostCliIsolation');
    expect(run.spawns.deep).toHaveLength(0);
  });

  it(`344-01/AC-5: ${bin} host-cli code-review and security-audit verifiers that returned without spawning (no files, empty diff) leave the field absent`, async () => {
    const run = await runGates({ bin, touchedFiles: [], diff: '', order: ['code-review', 'security-audit'] });
    for (const gate of ['code-review', 'security-audit'] as const) {
      const entry = entryFor(run, gate);
      expect(entry.status).toBe('ran');
      expect(entry.provider).toBe('host-cli');
      expect(entry).not.toHaveProperty('hostCliIsolation');
    }
    expect(run.spawns.codeReview).toHaveLength(0);
    expect(run.spawns.securityAudit).toHaveLength(0);
  });

  it(`344-01/AC-5: a deep-verify entry recorded under --allow-verifier-failure after the ${bin} verifier threw has no field`, async () => {
    const run = await runGates({
      bin,
      order: ['deep-verify'],
      opts: { deep: true, allowVerifierFailure: true },
      // The class itself, not the selector: no fallback wrapper, so the
      // child's failure reaches the gate as a throw.
      verifiers: (spawns) => ({
        deep: new HostCliVerifier({ bin, spawnImpl: fakeSpawn(FAILING, spawns.deep) }),
        codeReview: { verify: async () => ({ findings: {}, provider: 'mock' }) },
        securityAudit: { verify: async () => ({ findings: [], provider: 'mock' }) },
      }),
    });
    expect(run.refused).toBe(false);
    expect(run.spawns.deep).toHaveLength(1);
    expect(run.errs.join('')).toContain('--allow-verifier-failure set');
    const deep = entryFor(run, 'deep-verify');
    expect(deep.status).toBe('ran');
    // Built from config (`verifier.provider`), not from a verifier result.
    expect(deep.observedProvider).toBe('host-cli');
    expect(deep).not.toHaveProperty('hostCliIsolation');
  });

  it(`344-01/AC-5: a code-review entry whose ${bin} verifier threw and was bypassed has no field`, async () => {
    const run = await runGates({
      bin,
      order: ['code-review'],
      opts: { allowCodeReviewFailure: true },
      verifiers: (spawns) => ({
        deep: { verify: async () => ({ verdicts: {}, provider: 'mock' }) },
        codeReview: new HostCliCodeReviewVerifier({ bin, spawnImpl: fakeSpawn(FAILING, spawns.codeReview) }),
        securityAudit: { verify: async () => ({ findings: [], provider: 'mock' }) },
      }),
    });
    expect(run.refused).toBe(false);
    expect(run.spawns.codeReview).toHaveLength(1);
    const entry = entryFor(run, 'code-review');
    expect(entry.status).toBe('skipped');
    expect(entry.skipReason).toContain('bypassed via --allow-code-review-failure');
    expect(entry.skipReason).toContain('configured provider: host-cli');
    expect(entry).not.toHaveProperty('hostCliIsolation');
  });

  it(`344-01/AC-5: a security-audit entry whose ${bin} verifier threw and was bypassed has no field`, async () => {
    const run = await runGates({
      bin,
      order: ['security-audit'],
      opts: { allowSecurityAuditFailure: true },
      verifiers: (spawns) => ({
        deep: { verify: async () => ({ verdicts: {}, provider: 'mock' }) },
        codeReview: { verify: async () => ({ findings: {}, provider: 'mock' }) },
        securityAudit: new HostCliSecurityAuditVerifier({ bin, spawnImpl: fakeSpawn(FAILING, spawns.securityAudit) }),
      }),
    });
    expect(run.refused).toBe(false);
    expect(run.spawns.securityAudit).toHaveLength(1);
    const entry = entryFor(run, 'security-audit');
    expect(entry.status).toBe('skipped');
    expect(entry.skipReason).toContain('bypassed via --allow-security-audit-failure');
    expect(entry.skipReason).toContain('configured provider: host-cli');
    expect(entry).not.toHaveProperty('hostCliIsolation');
  });
});

describe('the mock provider records no isolation flags (344-01 AC-5)', () => {
  it('344-01/AC-5: when the provider is mock the field is absent from all three entries and nothing is spawned', async () => {
    const run = await runGates({
      bin: 'claude',
      provider: 'mock',
      coverage: new Map([['AC-1', [{ file: 'tests/x.test.ts', line: 1, snippet: 'AC-1' }]]]),
    });
    expect(run.refused).toBe(false);
    expect(run.spawns).toEqual({ deep: [], codeReview: [], securityAudit: [] });
    expect(entryFor(run, 'deep-verify').observedProvider).toBe('mock');
    expect(entryFor(run, 'code-review').provider).toBe('mock');
    expect(entryFor(run, 'security-audit').provider).toBe('mock');
    for (const gate of REVIEW_GATES) {
      expect(entryFor(run, gate)).not.toHaveProperty('hostCliIsolation');
    }
  });
});

describe('the flags ride on the verifier result as a non-enumerable property (344-01 AC-5)', () => {
  const CASES = [
    {
      name: 'HostCliVerifier',
      payload: DEEP_OK,
      visible: { verdicts: { 'AC-1': { pass: true, reason: 'ok' } }, provider: 'host-cli' },
      call: (o: { bin: string; spawnImpl: SpawnFn; isolation?: 'on' | 'off' }, spawning: boolean) =>
        new HostCliVerifier(o).verify({
          acs: spawning ? [{ id: 'AC-1', given: 'g', when: 'w', then: 't' }] : [],
          tests: {},
          diff: '',
          files: [],
        }),
    },
    {
      name: 'HostCliCodeReviewVerifier',
      payload: REVIEW_OK,
      visible: { findings: {}, provider: 'host-cli' },
      call: (o: { bin: string; spawnImpl: SpawnFn; isolation?: 'on' | 'off' }, spawning: boolean) =>
        new HostCliCodeReviewVerifier(o).verify({ files: spawning ? ['src/x.ts'] : [], diff: '' }),
    },
    {
      name: 'HostCliSecurityAuditVerifier',
      payload: REVIEW_OK,
      visible: { findings: [], provider: 'host-cli' },
      call: (o: { bin: string; spawnImpl: SpawnFn; isolation?: 'on' | 'off' }, spawning: boolean) =>
        new HostCliSecurityAuditVerifier(o).verify({ files: spawning ? ['src/x.ts'] : [], diff: '' }),
    },
  ];

  describe.each(CASES)('$name', (c) => {
    it.each(BINS)(
      `344-01/AC-5: a ${c.name} result for %s hides hostCliIsolation from Object.keys, JSON and toEqual while the reader returns the flags`,
      async (bin) => {
        guardEnv();
        const calls: FakeCall[] = [];
        const result = await c.call({ bin, spawnImpl: fakeSpawn(okResponse(bin, c.payload), calls) }, true);
        expect(calls).toHaveLength(1);
        expect(Object.keys(result)).not.toContain('hostCliIsolation');
        expect(JSON.stringify(result)).not.toContain('hostCliIsolation');
        expect({ ...result }).not.toHaveProperty('hostCliIsolation');
        // Whole-result structural equality is what it was before the phase.
        expect(result).toEqual(c.visible);
        expect(Object.getOwnPropertyDescriptor(result, 'hostCliIsolation')?.enumerable).toBe(false);
        expect(readHostCliIsolation(result)).toEqual(AC5_FLAGS[bin]);
        expect(readHostCliIsolation(result)).toEqual(isolationTokensIn(bin, calls[0]?.args ?? []));
      },
    );

    it(`344-01/AC-5: a ${c.name} result carries nothing with isolation off, and nothing when it returned without spawning`, async () => {
      guardEnv();
      const offCalls: FakeCall[] = [];
      const off = await c.call(
        { bin: 'codex', spawnImpl: fakeSpawn(okResponse('codex', c.payload), offCalls), isolation: 'off' },
        true,
      );
      expect(offCalls).toHaveLength(1);
      expect(readHostCliIsolation(off)).toBeUndefined();
      expect(Object.getOwnPropertyNames(off)).not.toContain('hostCliIsolation');

      const idleCalls: FakeCall[] = [];
      const idle = await c.call({ bin: 'codex', spawnImpl: fakeSpawn(okResponse('codex', c.payload), idleCalls) }, false);
      expect(idleCalls).toHaveLength(0);
      expect(readHostCliIsolation(idle)).toBeUndefined();
      expect(Object.getOwnPropertyNames(idle)).not.toContain('hostCliIsolation');
    });
  });

  it('344-01/AC-5: the reader returns nothing for a mock result and a fresh copy each time for a host-cli one', async () => {
    guardEnv();
    expect(readHostCliIsolation({ provider: 'mock' })).toBeUndefined();
    const calls: FakeCall[] = [];
    const result = await new HostCliCodeReviewVerifier({
      bin: 'codex',
      spawnImpl: fakeSpawn(okResponse('codex', REVIEW_OK), calls),
    }).verify({ files: ['src/x.ts'], diff: '' });
    const first = readHostCliIsolation(result);
    first?.push('--tampered');
    expect(readHostCliIsolation(result)).toEqual(['--ignore-user-config']);
  });
});

/** A settled SUMMARY built around `gates`, hashed the way settle hashes it. */
function settledSummary(gates: GateProvenance[]): Summary {
  const body = {
    schemaVersion: 2,
    draftId: '44-01',
    completedAt: '2026-11-22T00:00:00.000Z',
    acResults: [{ id: 'AC-1', pass: true }],
    taskResults: [{ id: 'T1', status: 'DONE', notes: '' }],
    decisions: [],
    deferred: [],
    skillAudit: { required: [], invoked: [] },
    gates,
  } as unknown as Summary;
  return { ...body, contentHash: computeSummaryContentHash(body) };
}

function runCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], { cwd, env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

describe('a SUMMARY whose gate entries carry the field (344-01 AC-5)', () => {
  it.each(BINS)(
    '344-01/AC-5: the content hash of a SUMMARY built from the %s gate entries still matches after it is written and re-parsed',
    async (bin) => {
      const run = await runGates({ bin });
      const summary = settledSummary(run.gates);
      expect(summary.gates?.filter((g) => g.hostCliIsolation !== undefined)).toHaveLength(3);

      // Write, read back, validate - what `cadence summary verify` does.
      const reparsed = SummaryZ.parse(JSON.parse(JSON.stringify(summary, null, 2)));
      // The schema kept the field (a schema without it would strip it here).
      for (const gate of REVIEW_GATES) {
        expect(reparsed.gates?.find((g) => g.gate === gate)?.hostCliIsolation).toEqual(AC5_FLAGS[bin]);
      }
      expect(computeSummaryContentHash(reparsed).value).toBe(summary.contentHash?.value);
      expect(verifySummaryContentHash(reparsed)).toBe('MATCH');

      // The field is hashed content: editing it after settle is detected.
      const edited = JSON.parse(JSON.stringify(summary)) as { gates: Array<{ gate: string; hostCliIsolation?: string[] }> };
      for (const g of edited.gates) delete g.hostCliIsolation;
      expect(verifySummaryContentHash(SummaryZ.parse(edited))).toBe('MISMATCH');
    },
  );

  it('344-01/AC-5: `cadence summary verify` reports MATCH for a SUMMARY whose gate entries carry the field', async () => {
    const run = await runGates({ bin: 'claude' });
    const summary = settledSummary(run.gates);
    const root = makeTmpDir();
    const phaseDir = join(root, '.cadence', 'phases', '44-isolation');
    mkdirSync(phaseDir, { recursive: true });
    const text = JSON.stringify(summary, null, 2);
    expect(text).toContain('"hostCliIsolation"');
    writeFileSync(join(phaseDir, '44-01-SUMMARY.json'), text);

    const r = await runCli(['summary', 'verify', '44-isolation', '01'], root);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^MATCH: SUMMARY\.json content hash verified \(sha256\)/);
  });
});
