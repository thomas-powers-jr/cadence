// Phase 344 (344-01, T2) - `verification.hostCliIsolation`, from the config
// key down to the argv each host-cli review agent is spawned with.
//
// Every selector test drives the REAL selector (`select…Verifier`), the real
// host-cli verifier class and the real `hostCliJSON`; only the process spawn is
// replaced, through the test-only `spawnImpl` select option. No real
// `claude`/`codex` binary runs and nothing touches the network.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig, type Draft, type Spec, type UiSpec } from '@thomas-powers-jr/cadence-types';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { loadConfig } from '../../src/config/loader.js';
import { ConfigInvalidError } from '../../src/errors.js';
import type { SpawnFn, SpawnedProcessLike } from '../../src/verify/host-cli-client.js';
import {
  VerifierFallbackRefusedError,
  type VerifierSelectOptions,
} from '../../src/verify/verifier-factory.js';
import { selectVerifier } from '../../src/verify/factory.js';
import { selectPerTaskVerifier } from '../../src/verify/per-task-factory.js';
import { selectCodeReviewVerifier } from '../../src/verify/code-review-factory.js';
import { selectSecurityAuditVerifier } from '../../src/verify/security-audit-factory.js';
import { selectPlanReviewVerifier } from '../../src/verify/plan-review-factory.js';
import { selectSpecReviewVerifier } from '../../src/verify/spec-review-factory.js';
import { selectUiSpecReviewVerifier } from '../../src/verify/ui-spec-review-factory.js';

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
 *  `host-cli-client-isolation.test.ts`'s `fakeSpawn`). */
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

/** A successful headless reply carrying `payload` as the model's final text, in the family's own output shape. */
function okResponse(bin: Bin, payload: unknown): FakeResponse {
  const text = JSON.stringify(payload);
  return bin === 'codex'
    ? { stdout: JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }) }
    : { stdout: JSON.stringify({ is_error: false, result: text }) };
}

const PRE_PHASE_ARGV: Record<Bin, string[]> = {
  codex: ['exec', '--json', '--skip-git-repo-check', '-'],
  claude: ['-p', '--output-format', 'json'],
};
const ISOLATED_ARGV: Record<Bin, string[]> = {
  codex: ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '-'],
  claude: ['-p', '--output-format', 'json', '--setting-sources', 'project', '--strict-mcp-config'],
};

const draft: Draft = {
  schemaVersion: 1,
  id: '44-01',
  phase: '44-isolation',
  tier: 'complex',
  title: 'demo',
  objective: 'do the thing',
  acceptanceCriteria: [{ id: 'AC-1', name: '', given: 'g', when: 'w', then: 't' }],
  tasks: [{ id: 'T1', name: 'task', files: ['src/foo.ts'], action: 'do', verify: 'check', done: 'AC-1' }],
  boundaries: ['DO NOT widen scope'],
  status: 'PENDING',
};

const spec: Spec = {
  schemaVersion: 1,
  id: '44-00',
  phase: '44-isolation',
  objective: 'Ship the thing',
  acceptanceCriteria: [{ id: 'AC-1', name: '', given: 'a state', when: 'an action', then: 'an outcome' }],
  constraints: ['stay in scope'],
  openQuestions: [],
  status: 'PENDING',
};

const uiSpec: UiSpec = {
  schemaVersion: 1,
  id: '44-00',
  phase: '44-isolation',
  components: [{ name: 'Panel', detail: ['a panel'], layoutTokens: ['8px gap'], precedent: [] }],
  responsiveInteraction: ['stacks below 600px'],
  status: 'PENDING',
};

interface SelectorCase {
  /** The selector's export name, as AC-3 lists it. */
  name: string;
  /** A minimal reply that satisfies this verifier's response schema. */
  payload: unknown;
  /** Selects the host-cli provider through the real selector and makes ONE call that reaches the spawn. */
  call(opts: VerifierSelectOptions): Promise<{ provider: string }>;
}

const hostCli = { override: 'host-cli' } as const;

// Each input is one that reaches the spawn: deep-verify has an AC, and
// code-review / security-audit have a touched file (both return early, without
// spawning, on no files and an empty diff).
const SELECTORS: SelectorCase[] = [
  {
    name: 'selectVerifier',
    payload: { verdicts: [{ id: 'AC-1', pass: true, reason: 'ok' }] },
    call: (opts) =>
      selectVerifier(null, { ...hostCli, ...opts }).verify({
        acs: [{ id: 'AC-1', given: 'g', when: 'w', then: 't' }],
        tests: {},
        diff: '',
        files: ['src/foo.ts'],
      }),
  },
  {
    name: 'selectPerTaskVerifier',
    payload: { verdict: 'pass', reason: 'ok' },
    call: (opts) =>
      selectPerTaskVerifier(null, { ...hostCli, ...opts }).verify({ taskId: 'T1', files: ['src/foo.ts'], diff: '' }),
  },
  {
    name: 'selectCodeReviewVerifier',
    payload: { findings: [] },
    call: (opts) =>
      selectCodeReviewVerifier(null, { ...hostCli, ...opts }).verify({ files: ['src/foo.ts'], diff: '' }),
  },
  {
    name: 'selectSecurityAuditVerifier',
    payload: { findings: [] },
    call: (opts) =>
      selectSecurityAuditVerifier(null, { ...hostCli, ...opts }).verify({ files: ['src/foo.ts'], diff: '' }),
  },
  {
    name: 'selectPlanReviewVerifier',
    payload: { pass: true, findings: [] },
    call: (opts) => selectPlanReviewVerifier(null, { ...hostCli, ...opts }).verify({ draft }),
  },
  {
    name: 'selectSpecReviewVerifier',
    payload: { pass: true, findings: [] },
    call: (opts) => selectSpecReviewVerifier(null, { ...hostCli, ...opts }).verify({ spec }),
  },
  {
    name: 'selectUiSpecReviewVerifier',
    payload: { pass: true, findings: [] },
    call: (opts) => selectUiSpecReviewVerifier(null, { ...hostCli, ...opts }).verify({ uiSpec }),
  },
];

const dirs: string[] = [];
/** An empty directory: `.env` discovery there finds no binary name, key or timeout. */
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cadence-isolation-optout-'));
  dirs.push(dir);
  return dir;
}

let fx: Fixture | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  if (fx) {
    await fx.cleanup();
    fx = undefined;
  }
});

/**
 * Env stubs every spawning test here needs (undone by `afterEach`).
 * - `CLAUDECODE`: the self-invocation guard reads `process.env`, and a Claude
 *   Code session running this suite exports `CLAUDECODE=1`, which would
 *   refuse the claude-family spawn before the fake is reached.
 * - `PATH`: an empty directory, so that if the `spawnImpl` seam ever stopped
 *   being forwarded the real spawn could not find an installed
 *   `claude`/`codex` and the test would fail fast instead of running one.
 */
function guardEnv(): void {
  vi.stubEnv('CLAUDECODE', '');
  vi.stubEnv('PATH', makeTmpDir());
}

/**
 * Runs one call of `sel` against binary `bin` on a fake spawn that answers
 * with a valid reply, and returns what the spawn recorded. `isolation` absent
 * leaves `hostCliIsolation` out of the select options entirely.
 */
async function spawnedArgv(
  sel: SelectorCase,
  bin: Bin,
  isolation: 'on' | 'off' | undefined,
): Promise<{ calls: FakeCall[]; warns: string[]; provider: string }> {
  guardEnv();
  const calls: FakeCall[] = [];
  const warns: string[] = [];
  const result = await sel.call({
    env: { CADENCE_HOST_CLI_BIN: bin },
    cwd: makeTmpDir(),
    warn: (m) => warns.push(m),
    spawnImpl: fakeSpawn(okResponse(bin, sel.payload), calls),
    ...(isolation !== undefined ? { hostCliIsolation: isolation } : {}),
  });
  return { calls, warns, provider: result.provider };
}

describe.each(SELECTORS)('host-cli isolation opt-out through $name (344-01 AC-3)', (sel) => {
  describe.each(['codex', 'claude'] as const)('binary %s', (bin) => {
    it(`344-01/AC-3: ${sel.name} with hostCliIsolation "off" spawns ${bin} with the pre-phase argv`, async () => {
      const { calls, warns, provider } = await spawnedArgv(sel, bin, 'off');
      expect(calls).toHaveLength(1);
      expect(calls[0]?.bin).toBe(bin);
      expect(calls[0]?.args).toEqual(PRE_PHASE_ARGV[bin]);
      // The reply came from the host-cli verifier, not a mock fallback.
      expect(provider).toBe('host-cli');
      expect(warns).toEqual([]);
    });

    it(`344-01/AC-3: ${sel.name} with the option absent spawns ${bin} with the isolation flags`, async () => {
      const { calls, warns, provider } = await spawnedArgv(sel, bin, undefined);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.bin).toBe(bin);
      expect(calls[0]?.args).toEqual(ISOLATED_ARGV[bin]);
      expect(provider).toBe('host-cli');
      expect(warns).toEqual([]);
    });

    it(`344-01/AC-3: ${sel.name} with hostCliIsolation "on" spawns ${bin} with the isolation flags`, async () => {
      const { calls, warns, provider } = await spawnedArgv(sel, bin, 'on');
      expect(calls).toHaveLength(1);
      expect(calls[0]?.bin).toBe(bin);
      expect(calls[0]?.args).toEqual(ISOLATED_ARGV[bin]);
      expect(provider).toBe('host-cli');
      expect(warns).toEqual([]);
    });
  });
});

describe('the argv tables are the literal AC-3 values (344-01 AC-3)', () => {
  it('344-01/AC-3: off is the pre-phase argv and on is the AC-1 / AC-2 no-model argv', () => {
    expect(PRE_PHASE_ARGV.codex).toEqual(['exec', '--json', '--skip-git-repo-check', '-']);
    expect(PRE_PHASE_ARGV.claude).toEqual(['-p', '--output-format', 'json']);
    expect(ISOLATED_ARGV.codex).toEqual(['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '-']);
    expect(ISOLATED_ARGV.claude).toEqual([
      '-p',
      '--output-format',
      'json',
      '--setting-sources',
      'project',
      '--strict-mcp-config',
    ]);
    expect(SELECTORS.map((s) => s.name)).toEqual([
      'selectVerifier',
      'selectPerTaskVerifier',
      'selectCodeReviewVerifier',
      'selectSecurityAuditVerifier',
      'selectPlanReviewVerifier',
      'selectSpecReviewVerifier',
      'selectUiSpecReviewVerifier',
    ]);
  });
});

/** A repo root whose `.cadence/config.json` holds exactly `raw`. */
function repoWithConfig(raw: string): string {
  const root = makeTmpDir();
  mkdirSync(join(root, '.cadence'), { recursive: true });
  writeFileSync(join(root, '.cadence', 'config.json'), raw, 'utf8');
  return root;
}

describe('verification.hostCliIsolation through loadConfig (344-01 AC-3)', () => {
  it('344-01/AC-3: a config.json holding {} loads with the key absent', async () => {
    const cfg = await loadConfig(repoWithConfig('{}'));
    expect('hostCliIsolation' in cfg.verification).toBe(false);
    expect(cfg.verification.hostCliIsolation).toBeUndefined();
  });

  it.each(['off', 'on'] as const)('344-01/AC-3: %j loads with that value', async (value) => {
    const cfg = await loadConfig(repoWithConfig(JSON.stringify({ verification: { hostCliIsolation: value } })));
    expect(cfg.verification.hostCliIsolation).toBe(value);
    // The rest of the verification block still comes from defaultConfig.
    expect(cfg.verification.testGlobs).toEqual(defaultConfig.verification.testGlobs);
  });

  it.each([['"Off"', '"Off"'], ['true', 'true'], ['null', 'null']])(
    '344-01/AC-3: %s is rejected by loadConfig',
    async (_label, json) => {
      const root = repoWithConfig(`{"verification":{"hostCliIsolation":${json}}}`);
      const err = await loadConfig(root).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ConfigInvalidError);
      expect((err as Error).message).toContain('config.json failed schema validation');
      expect((err as Error).message).toContain('hostCliIsolation');
    },
  );

  it('344-01/AC-3: defaultConfig, the base loadConfig merges over, has no hostCliIsolation key', () => {
    expect('hostCliIsolation' in defaultConfig.verification).toBe(false);
  });
});

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

describe('cadence init and verification.hostCliIsolation (344-01 AC-3)', () => {
  it('344-01/AC-3: a fresh init does not write verification.hostCliIsolation, and the written config loads with it absent', async () => {
    fx = await tempRepo();
    const r = await runCli(['init', '--name=demo'], fx.root);
    expect(r.code).toBe(0);
    const cfg = JSON.parse(readFileSync(join(fx.root, '.cadence/config.json'), 'utf8')) as {
      verification?: Record<string, unknown>;
    };
    expect(cfg.verification).toBeDefined();
    expect(cfg.verification).not.toHaveProperty('hostCliIsolation');
    const loaded = await loadConfig(fx.root);
    expect('hostCliIsolation' in loaded.verification).toBe(false);
  });
});

const HINT = (flag: string): string =>
  `this CLI may not accept the isolation flag "${flag}"; update it, or set verification.hostCliIsolation to "off"`;
const FALLING_BACK = 'falling back to mock provider for this call';

/**
 * One code-review call through `selectCodeReviewVerifier` on a fake spawn that
 * fails with `resp`. Returns the settled outcome plus everything observable.
 */
async function failingCodeReview(
  bin: Bin,
  resp: FakeResponse,
  opts: { fallback?: 'refuse'; hostCliIsolation?: 'on' | 'off' } = {},
): Promise<{ calls: FakeCall[]; warns: string[]; result: unknown; error: unknown }> {
  guardEnv();
  const calls: FakeCall[] = [];
  const warns: string[] = [];
  const verifier = selectCodeReviewVerifier(null, {
    ...hostCli,
    env: { CADENCE_HOST_CLI_BIN: bin },
    cwd: makeTmpDir(),
    warn: (m) => warns.push(m),
    spawnImpl: fakeSpawn(resp, calls),
    ...opts,
  });
  let result: unknown;
  let error: unknown;
  try {
    result = await verifier.verify({ files: ['src/foo.ts'], diff: '' });
  } catch (e) {
    error = e;
  }
  return { calls, warns, result, error };
}

const REJECTIONS = [
  {
    bin: 'codex' as const,
    flag: '--ignore-user-config',
    resp: { code: 2, stderr: "error: unexpected argument '--ignore-user-config' found" },
  },
  {
    bin: 'claude' as const,
    flag: '--setting-sources',
    resp: { code: 1, stderr: "error: unknown option '--setting-sources'" },
  },
];

describe.each(REJECTIONS)('a $bin CLI that rejects $flag (344-01 AC-4)', ({ bin, flag, resp }) => {
  it(`344-01/AC-4: under the default fallback ${bin} is spawned once, the warning carries the fallback text and the hint naming "${flag}", and the call resolves with the mock result`, async () => {
    const { calls, warns, result, error } = await failingCodeReview(bin, resp);
    expect(error).toBeUndefined();
    // Not retried, with or without the flag.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(ISOLATED_ARGV[bin]);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain(FALLING_BACK);
    expect(warns[0]).toContain(HINT(flag));
    expect(warns[0]).toContain('nonzero-exit');
    expect(warns[0]).toContain(`exited with code ${resp.code}`);
    // The mock code-review verifier's result for an empty diff.
    expect(result).toEqual({ findings: {}, provider: 'mock' });
  });

  it(`344-01/AC-4: under fallback "refuse" ${bin} is spawned once and the VerifierFallbackRefusedError message carries the hint naming "${flag}"`, async () => {
    const { calls, warns, result, error } = await failingCodeReview(bin, resp, { fallback: 'refuse' });
    expect(result).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(ISOLATED_ARGV[bin]);
    expect(error).toBeInstanceOf(VerifierFallbackRefusedError);
    const refused = error as VerifierFallbackRefusedError;
    expect(refused.label).toBe('code-review');
    expect(refused.message).toContain(HINT(flag));
    expect(refused.message).toContain('verification.fallback is refuse (nonzero-exit)');
    expect(refused.message).not.toContain(FALLING_BACK);
    expect(warns).toEqual([]);
  });

  it.each(['not authenticated', 'no project found'])(
    `344-01/AC-4: a ${bin} nonzero-exit whose stderr is %j carries no hint, in the warning or in the refusal`,
    async (stderr) => {
      const plain = { code: resp.code, stderr };

      const byDefault = await failingCodeReview(bin, plain);
      expect(byDefault.calls).toHaveLength(1);
      expect(byDefault.warns).toHaveLength(1);
      expect(byDefault.warns[0]).toContain(FALLING_BACK);
      expect(byDefault.warns[0]).toContain(stderr);
      expect(byDefault.warns[0]).not.toContain('isolation flag');
      expect(byDefault.warns[0]).not.toContain('hostCliIsolation');
      expect(byDefault.result).toEqual({ findings: {}, provider: 'mock' });

      const refused = await failingCodeReview(bin, plain, { fallback: 'refuse' });
      expect(refused.calls).toHaveLength(1);
      expect(refused.error).toBeInstanceOf(VerifierFallbackRefusedError);
      expect((refused.error as Error).message).toContain(stderr);
      expect((refused.error as Error).message).not.toContain('isolation flag');
      expect((refused.error as Error).message).not.toContain('hostCliIsolation');
    },
  );

  it(`344-01/AC-4: with hostCliIsolation "off" a ${bin} stderr naming "${flag}" adds no hint, and the call is still made once`, async () => {
    const byDefault = await failingCodeReview(bin, resp, { hostCliIsolation: 'off' });
    expect(byDefault.calls).toHaveLength(1);
    expect(byDefault.calls[0]?.args).toEqual(PRE_PHASE_ARGV[bin]);
    expect(byDefault.warns).toHaveLength(1);
    expect(byDefault.warns[0]).toContain(FALLING_BACK);
    expect(byDefault.warns[0]).toContain(flag);
    expect(byDefault.warns[0]).not.toContain('isolation flag');
    expect(byDefault.result).toEqual({ findings: {}, provider: 'mock' });

    const refused = await failingCodeReview(bin, resp, { fallback: 'refuse', hostCliIsolation: 'off' });
    expect(refused.calls).toHaveLength(1);
    expect(refused.calls[0]?.args).toEqual(PRE_PHASE_ARGV[bin]);
    expect(refused.error).toBeInstanceOf(VerifierFallbackRefusedError);
    expect((refused.error as Error).message).toContain(flag);
    expect((refused.error as Error).message).not.toContain('isolation flag');
  });
});
