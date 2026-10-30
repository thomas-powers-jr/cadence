import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { MOCK_VERIFIER_NOTICE, MOCK_VERIFIER_CAPABILITY } from '@thomas-powers-jr/cadence-types';
import {
  createVerifierFactory,
  VerifierFallbackRefusedError,
  type VerifierProvider,
} from '../../src/verify/verifier-factory.js';
import { HostCliError } from '../../src/verify/host-cli-client.js';
import { selectCodeReviewVerifier } from '../../src/verify/code-review-factory.js';
import { selectVerifier } from '../../src/verify/factory.js';
import { MockVerifier } from '../../src/verify/mock-verifier.js';

// Phase 343 (T2) — `verification.fallback: "refuse"` on the call-time host-cli
// path. A fake `hostCli` builder stands in for the real host-cli client so no
// process is ever spawned; the real self-invocation message text (ending with
// "Falling back to mock for this call.") is reproduced verbatim.

interface FakeResult {
  result: string;
}
interface FakeVerifier {
  readonly name: string;
  verify(input: string): Promise<FakeResult>;
}
interface FakeConfig {
  fake?: { provider?: VerifierProvider; model?: string };
}

const SELF_INVOCATION_MESSAGE =
  'host-cli provider: refusing to spawn "claude" — cadence is already running inside a ' +
  'headless "claude" session (detected via CLAUDECODE=1). ' +
  'Spawning another headless call here risks an unbounded nested self-invocation of the ' +
  'same host CLI. Falling back to mock for this call.';

function makeSpec(hostCliVerify: (input: string) => Promise<FakeResult>) {
  const mockVerify = vi.fn(async (input: string) => ({ result: `mock:${input}` }));
  const select = createVerifierFactory<FakeConfig, FakeVerifier>({
    label: 'fake-seam',
    read: (c) => c?.fake,
    mock: () => ({ name: 'mock', verify: mockVerify }),
    anthropic: () => {
      throw new Error('not exercised');
    },
    local: () => {
      throw new Error('not exercised');
    },
    hostCli: () => ({ name: 'host-cli', verify: hostCliVerify }),
  });
  return { select, mockVerify };
}

const hostCli: FakeConfig = { fake: { provider: 'host-cli' } };

const dirs: string[] = [];
/** An empty cwd so `.env` discovery can never find a real key/endpoint. */
const makeTmpDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cadence-fallback-refuse-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  vi.unstubAllEnvs();
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('verification.fallback "refuse" — call-time host-cli refusal (343-01)', () => {
  it('343-01/AC-2: a self-invocation HostCliError throws the typed refusal naming the seam and cause, with no mock call, no warning and no fallback text', async () => {
    const warns: string[] = [];
    const { select, mockVerify } = makeSpec(async () => {
      throw new HostCliError(SELF_INVOCATION_MESSAGE, 'self-invocation');
    });
    const v = select(hostCli, { env: {}, warn: (m) => warns.push(m), fallback: 'refuse' });

    const err = await v.verify('x').then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(VerifierFallbackRefusedError);
    const refused = err as VerifierFallbackRefusedError;
    expect(refused.name).toBe('VerifierFallbackRefusedError');
    expect(refused.label).toBe('fake-seam');
    expect(refused.cause).toBeInstanceOf(HostCliError);
    expect(refused.message).toContain('fake-seam');
    expect(refused.message).toContain('verification.fallback is refuse');
    expect(refused.message).toContain('self-invocation');
    expect(refused.message).toContain('refusing to spawn "claude"');
    expect(refused.message).toBe(
      'fake-seam: host-cli unavailable and verification.fallback is refuse (self-invocation): ' +
        SELF_INVOCATION_MESSAGE.replace(' Falling back to mock for this call.', ''),
    );
    expect(refused.message).not.toMatch(/falling back to mock/i);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(warns).toEqual([]);
  });

  it('343-01/AC-2: a not-found HostCliError refuses too', async () => {
    const warns: string[] = [];
    const { select, mockVerify } = makeSpec(async () => {
      throw new HostCliError('binary "/nope/claude" not found on PATH', 'not-found');
    });
    const v = select(hostCli, { env: {}, warn: (m) => warns.push(m), fallback: 'refuse' });

    await expect(v.verify('x')).rejects.toThrow(VerifierFallbackRefusedError);
    await expect(v.verify('x')).rejects.toThrow(
      'fake-seam: host-cli unavailable and verification.fallback is refuse (not-found): binary "/nope/claude" not found on PATH',
    );
    expect(mockVerify).not.toHaveBeenCalled();
    expect(warns).toEqual([]);
  });

  it('343-01/AC-2: a synchronous HostCliError throw refuses synchronously', () => {
    const warns: string[] = [];
    const { select, mockVerify } = makeSpec(((): Promise<FakeResult> => {
      throw new HostCliError('spawn failed', 'spawn-error');
    }) as (input: string) => Promise<FakeResult>);
    const v = select(hostCli, { env: {}, warn: (m) => warns.push(m), fallback: 'refuse' });

    expect(() => v.verify('x')).toThrow(VerifierFallbackRefusedError);
    expect(() => v.verify('x')).toThrow(/spawn-error/);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(warns).toEqual([]);
  });

  it('343-01/AC-2: a non-HostCliError failure propagates unchanged under refuse', async () => {
    const warns: string[] = [];
    const original = new Error('repair retries exhausted');
    const { select, mockVerify } = makeSpec(async () => {
      throw original;
    });
    const v = select(hostCli, { env: {}, warn: (m) => warns.push(m), fallback: 'refuse' });

    await expect(v.verify('x')).rejects.toBe(original);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(warns).toEqual([]);
  });

  it('343-01/AC-3: fallback absent and "mock" keep the 1.73.0 warning text, mock delegate and fallback tag', async () => {
    for (const fallback of [undefined, 'mock'] as const) {
      const warns: string[] = [];
      const { select, mockVerify } = makeSpec(async () => {
        throw new HostCliError(SELF_INVOCATION_MESSAGE, 'self-invocation');
      });
      const v = select(hostCli, {
        env: {},
        warn: (m) => warns.push(m),
        ...(fallback !== undefined ? { fallback } : {}),
      });
      const result = await v.verify('x');
      expect(result).toEqual({ result: 'mock:x' });
      expect((result as unknown as { providerSelection?: string }).providerSelection).toBe('fallback');
      expect(mockVerify).toHaveBeenCalledTimes(1);
      expect(warns).toEqual([
        `fake-seam: host-cli provider failed (self-invocation: ${SELF_INVOCATION_MESSAGE}) — falling back to mock provider for this call.`,
      ]);
    }
  });

  it('343-01/AC-4: a host-cli primary that resolves under refuse is returned, tagged configured, with no warning', async () => {
    const warns: string[] = [];
    const { select, mockVerify } = makeSpec(async (input) => ({ result: `host-cli:${input}` }));
    const v = select(hostCli, { env: {}, warn: (m) => warns.push(m), fallback: 'refuse' });

    const result = await v.verify('ok');
    expect(result).toEqual({ result: 'host-cli:ok' });
    expect((result as unknown as { providerSelection?: string }).providerSelection).toBe('configured');
    expect(mockVerify).not.toHaveBeenCalled();
    expect(warns).toEqual([]);
  });

  it('343-01/AC-4: an explicitly configured mock provider under refuse is the mock, not a refusal', async () => {
    const warns: string[] = [];
    const { select, mockVerify } = makeSpec(async () => {
      throw new HostCliError('never called', 'not-found');
    });
    const v = select({ fake: { provider: 'mock' } }, { env: {}, warn: (m) => warns.push(m), fallback: 'refuse' });

    const result = await v.verify('m');
    expect(result).toEqual({ result: 'mock:m' });
    expect((result as unknown as { providerSelection?: string }).providerSelection).toBe('configured');
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(warns).toEqual([]);
  });

  it('343-01/AC-2: the production code-review selector honours opts.fallback (self-invocation guard, nothing spawned)', async () => {
    vi.stubEnv('CLAUDECODE', '1');
    const warns: string[] = [];
    const v = selectCodeReviewVerifier(
      { codeReview: { provider: 'host-cli' } } as Parameters<typeof selectCodeReviewVerifier>[0],
      {
        env: { CADENCE_HOST_CLI_BIN: 'claude' },
        warn: (m) => warns.push(m),
        fallback: 'refuse',
      },
    );
    const err = await v.verify({ files: ['a.ts'], diff: 'diff --git a/a.ts b/a.ts\n+x\n' }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(VerifierFallbackRefusedError);
    const refused = err as VerifierFallbackRefusedError;
    expect(refused.label).toBe('code-review');
    expect(refused.message).toContain('code-review: host-cli unavailable and verification.fallback is refuse (self-invocation)');
    expect(refused.message).not.toMatch(/falling back to mock/i);
    expect(warns).toEqual([]);
  });
});

// Phase 343 (T3) — the three selection-time downgrade branches (anthropic with
// no key, local with no endpoint/model, a family with no host-cli builder).

/** A fake family WITHOUT a hostCli builder, so all three branches are reachable. */
function makeSelectionSpec() {
  const mockVerify = vi.fn(async (input: string) => ({ result: `mock:${input}` }));
  const select = createVerifierFactory<FakeConfig, FakeVerifier>({
    label: 'fake-seam',
    read: (c) => c?.fake,
    mock: () => ({ name: 'mock', verify: mockVerify }),
    anthropic: () => {
      throw new Error('anthropic builder must not run without a key');
    },
    local: () => {
      throw new Error('local builder must not run without an endpoint');
    },
  });
  return { select, mockVerify };
}

/** The exact 1.73.0 downgrade banner for a reason line (buildDowngradeBanner). */
function expectedBanner(reason: string): string {
  return [
    '',
    `  ⚠  ${MOCK_VERIFIER_NOTICE.label.toUpperCase()}`,
    `     ${reason}`,
    `     ${MOCK_VERIFIER_NOTICE.message}`,
    `     ${MOCK_VERIFIER_CAPABILITY.message}`,
    '     https://github.com/thomas-powers-jr/cadence/blob/main/docs/providers.md',
    '',
  ].join('\n');
}

const SELECTION_CASES = [
  {
    name: 'anthropic with no ANTHROPIC_API_KEY',
    config: { fake: { provider: 'anthropic' } } as FakeConfig,
    override: undefined,
    prerequisite: 'ANTHROPIC_API_KEY is unset',
    banner:
      'fake-seam: anthropic provider requested but ANTHROPIC_API_KEY is unset (a Claude Code/IDE login does not satisfy this — anthropic calls the Anthropic SDK directly and needs a separately API-billed key) — falling back to mock provider.',
  },
  {
    name: 'local with no CADENCE_LOCAL_BASE_URL / model',
    config: { fake: { provider: 'local' } } as FakeConfig,
    override: undefined,
    prerequisite: 'CADENCE_LOCAL_BASE_URL / model unset',
    banner:
      'fake-seam: local provider requested but CADENCE_LOCAL_BASE_URL / model unset — falling back to mock provider.',
  },
  {
    name: 'host-cli on a family with no host-cli builder',
    config: null,
    override: 'host-cli' as const,
    prerequisite: 'this verifier family has no host-cli builder',
    banner:
      'fake-seam: host-cli provider requested but this verifier family has not wired a host-cli builder yet — falling back to mock provider.',
  },
];

describe('verification.fallback "refuse" — selection-time downgrades refuse lazily (343-01 T3)', () => {
  for (const c of SELECTION_CASES) {
    it(`343-01/AC-5: ${c.name} — selection, await, inspect and JSON neither throw nor warn; .verify() throws the typed refusal`, async () => {
      const warns: string[] = [];
      const { select, mockVerify } = makeSelectionSpec();
      const cwd = makeTmpDir();
      const v = select(c.config, {
        env: {},
        cwd,
        warn: (m) => warns.push(m),
        fallback: 'refuse',
        ...(c.override ? { override: c.override } : {}),
      });

      // Selection did not throw and did not warn.
      expect(warns).toEqual([]);
      // Non-function properties behave normally.
      expect(v.name).toBe('mock');
      // await / Promise.resolve / returning from an async fn: `then` stays absent.
      expect((v as unknown as { then?: unknown }).then).toBeUndefined();
      await expect(Promise.resolve(v)).resolves.toBe(v);
      const fromAsync = async (): Promise<FakeVerifier> => v;
      expect(await fromAsync()).toBe(v);
      // Inspection never throws.
      expect(() => inspect(v)).not.toThrow();
      expect(() => JSON.stringify(v)).not.toThrow();
      expect(() => String((v as unknown as { [Symbol.toPrimitive]?: unknown })[Symbol.toPrimitive])).not.toThrow();
      expect(warns).toEqual([]);

      // The first method call throws the typed refusal.
      let err: unknown;
      try {
        void v.verify('x');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(VerifierFallbackRefusedError);
      const refused = err as VerifierFallbackRefusedError;
      expect(refused.label).toBe('fake-seam');
      expect(refused.message).toContain('fake-seam');
      expect(refused.message).toContain('verification.fallback is refuse');
      expect(refused.message).toContain(c.prerequisite);
      expect(refused.message).not.toMatch(/falling back to mock/i);
      expect(mockVerify).not.toHaveBeenCalled();
      expect(warns).toEqual([]);
    });

    it(`343-01/AC-3: ${c.name} — fallback absent and "mock" emit the exact 1.73.0 banner and return the mock tagged fallback`, async () => {
      for (const fallback of [undefined, 'mock'] as const) {
        const warns: string[] = [];
        const { select, mockVerify } = makeSelectionSpec();
        const cwd = makeTmpDir();
        const v = select(c.config, {
          env: {},
          cwd,
          warn: (m) => warns.push(m),
          ...(fallback !== undefined ? { fallback } : {}),
          ...(c.override ? { override: c.override } : {}),
        });
        expect(warns).toEqual([expectedBanner(c.banner)]);
        const result = await v.verify('y');
        expect(result).toEqual({ result: 'mock:y' });
        expect((result as unknown as { providerSelection?: string }).providerSelection).toBe('fallback');
        expect(mockVerify).toHaveBeenCalledTimes(1);
        expect(warns).toHaveLength(1);
      }
    });
  }

  it('343-01/AC-5: a class-based mock (MockVerifier, methods on the prototype) refuses on .verify() via the production selector', async () => {
    const warns: string[] = [];
    const cwd = makeTmpDir();
    const v = selectVerifier({ verifier: { provider: 'anthropic' } } as Parameters<typeof selectVerifier>[0], {
      env: {},
      cwd,
      warn: (m) => warns.push(m),
      fallback: 'refuse',
    });
    expect(warns).toEqual([]);
    expect(v).toBeInstanceOf(MockVerifier);
    expect(v.name).toBe('mock');
    await expect(Promise.resolve(v)).resolves.toBe(v);
    expect(() => inspect(v)).not.toThrow();
    expect(() => JSON.stringify(v)).not.toThrow();
    expect(() => String(v)).not.toThrow();

    let err: unknown;
    try {
      void v.verify({ acs: [], tests: {} } as unknown as Parameters<typeof v.verify>[0]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(VerifierFallbackRefusedError);
    const refused = err as VerifierFallbackRefusedError;
    expect(refused.label).toBe('verifier');
    expect(refused.message).toContain('verifier');
    expect(refused.message).toContain('ANTHROPIC_API_KEY is unset');
    expect(refused.message).toContain('verification.fallback is refuse');
    expect(refused.message).not.toMatch(/falling back to mock/i);
    expect(warns).toEqual([]);
  });
});
