import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createVerifierFactory,
  VerifierFallbackRefusedError,
  type VerifierProvider,
} from '../../src/verify/verifier-factory.js';
import { HostCliError } from '../../src/verify/host-cli-client.js';
import { selectCodeReviewVerifier } from '../../src/verify/code-review-factory.js';

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

afterEach(() => {
  vi.unstubAllEnvs();
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
