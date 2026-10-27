import type { CadenceConfig } from '@thomas-powers-jr/cadence-types';
import type { VerifierProvider } from '../verify/verifier-factory.js';
import {
  hostCliBin as resolveHostCliBin,
  hostCliBinaryResolves,
  realHostCliPresenceFacts,
} from '../verify/host-cli-presence.js';
import { discoverKey } from './key-discovery.js';

/**
 * The seven verifier seam config blocks (parallels config-explain PROVIDER_BLOCKS).
 * Order matches config explain's render order.
 */
export const VERIFIER_SEAMS = [
  'specReview',
  'uiSpecReview',
  'verifier',
  'perTaskVerifier',
  'codeReview',
  'planReview',
  'securityAudit',
] as const;
export type VerifierSeam = (typeof VERIFIER_SEAMS)[number];

/** The seam the default ('deep-verify') activation flips. */
export const DEEP_VERIFY_SEAM: VerifierSeam = 'verifier';

export interface VerifierReadiness {
  /** Effective provider of the deep-verify seam. */
  provider: VerifierProvider;
  /** Credentials present for that provider (mock ⇒ true). */
  keyPresent: boolean;
  seamsReal: VerifierSeam[];
  seamsMock: VerifierSeam[];
  /**
   * Seams whose configured provider is real but whose credentials are absent —
   * guaranteed to fall back to `mock` at runtime (see the prerequisite branches
   * in `verify/verifier-factory.ts`). Issue #331: this is the set
   * `seamsReal`/`seamsMock` cannot express, because those partition by
   * *configured provider name* and so classify a keyless `anthropic` seam as
   * real. In `VERIFIER_SEAMS` order. Never includes a `mock` seam (not a
   * downgrade — it announces itself) nor a `host-cli` seam (no required
   * credential by design; see `credsPresent`). A `host-cli` seam whose binary
   * will not launch is reported in `seamsUnresolvable` instead.
   */
  seamsDowngraded: VerifierSeam[];
  /**
   * Phase 337: every seam configured as `host-cli` when the effective host CLI
   * binary (`hostCliBin`) will not launch — guaranteed to fall back to `mock`
   * at spawn. In `VERIFIER_SEAMS` order; empty when no seam is `host-cli` or
   * the binary resolves.
   */
  seamsUnresolvable: VerifierSeam[];
  /** Phase 337: the effective host CLI binary (`CADENCE_HOST_CLI_BIN` from env
   *  or `.env`, else `claude`). Present only when some seam is `host-cli`. */
  hostCliBin?: string;
  /** deep-verify provider is real, its credentials are present, and — for
   *  host-cli — its binary will launch (deep-verify is not in
   *  `seamsUnresolvable`). */
  ready: boolean;
  reason: string;
}

/** The provider configured for `seam`. Exported so a caller reporting a seam
 *  from `seamsDowngraded` can name the provider that will downgrade. */
export function seamProvider(config: CadenceConfig, seam: VerifierSeam): VerifierProvider {
  return (config[seam] as { provider: VerifierProvider }).provider;
}

/** Are `provider`'s credentials present for `seam`? local needs a base URL + a model
 *  (the seam's own `model`, else CADENCE_LOCAL_MODEL — mirrors verify/verifier-factory.ts).
 *  `cwd` (default `process.cwd()`) is where a `.env` file is discovered — a key found
 *  there counts the same as one exported into the env (AC-1). */
export function credsPresent(
  provider: VerifierProvider,
  seam: VerifierSeam,
  config: CadenceConfig,
  env: NodeJS.ProcessEnv,
  cwd: string = process.cwd(),
): boolean {
  if (provider === 'mock') return true;
  if (provider === 'anthropic') return Boolean(discoverKey('ANTHROPIC_API_KEY', env, cwd).value);
  // Phase 165: host-cli has no required credential by design — it shells out
  // to the user's already-installed, already-authenticated host CLI, with a
  // hardcoded default binary (`claude`) when CADENCE_HOST_CLI_BIN is unset
  // (mirrors verify/verifier-factory.ts's `discoverKey(...) ?? 'claude'`).
  // Whether that binary actually exists/authenticates is checked lazily at
  // spawn time (host-cli-client.ts), the same way `local`/`anthropic` never
  // probe connectivity here either — so "present" just means "nothing is
  // missing", which is unconditionally true. Without this branch, `host-cli`
  // fell through to the `local` check below and was misreported as broken.
  if (provider === 'host-cli') return true;
  const model =
    (config[seam] as { model?: string }).model ??
    discoverKey('CADENCE_LOCAL_MODEL', env, cwd).value;
  return Boolean(discoverKey('CADENCE_LOCAL_BASE_URL', env, cwd).value) && Boolean(model);
}

/** True when this process is running inside a live Claude Code session — the
 *  `CLAUDECODE` env var, documented at https://code.claude.com/docs/en/env-vars
 *  (see `verify/host-cli-client.ts`'s `SELF_INVOCATION_ENV_VAR` for the fuller
 *  citation). Used to disambiguate a Claude Code login (no bearing on the
 *  `anthropic` provider's credentials) from an actually-missing API key. */
export function isClaudeCodeSession(env: NodeJS.ProcessEnv): boolean {
  return env.CLAUDECODE === '1';
}

/** Verifier-posture assessment, shared by `activate`, `doctor` and `onboard`.
 *  `cwd` (default `process.cwd()`) is threaded to `credsPresent` for `.env` discovery.
 *  `presence` (phase 337; default: a real filesystem probe via
 *  `verify/host-cli-presence.ts`) is called at most once, and only when some
 *  seam is `host-cli`; tests inject it to stay independent of the machine. */
export function assessReadiness(
  config: CadenceConfig,
  env: NodeJS.ProcessEnv,
  cwd: string = process.cwd(),
  presence: (bin: string) => boolean = (bin) =>
    hostCliBinaryResolves(bin, realHostCliPresenceFacts(env)),
): VerifierReadiness {
  const seamsReal: VerifierSeam[] = [];
  const seamsMock: VerifierSeam[] = [];
  const seamsDowngraded: VerifierSeam[] = [];
  for (const seam of VERIFIER_SEAMS) {
    const seamsProvider = seamProvider(config, seam);
    (seamsProvider === 'mock' ? seamsMock : seamsReal).push(seam);
    // Issue #331: credential-check EVERY real seam, not just deep-verify —
    // otherwise a keyless `anthropic` seam sits in `seamsReal` and reads as
    // healthy while being certain to downgrade.
    if (seamsProvider !== 'mock' && !credsPresent(seamsProvider, seam, config, env, cwd)) {
      seamsDowngraded.push(seam);
    }
  }
  // Phase 337: probe the host-cli binary once, lazily, only if a seam uses it.
  const hostCliSeams = VERIFIER_SEAMS.filter((seam) => seamProvider(config, seam) === 'host-cli');
  let bin: string | undefined;
  let binResolves = true;
  if (hostCliSeams.length > 0) {
    bin = resolveHostCliBin(env, cwd);
    binResolves = presence(bin);
  }
  const seamsUnresolvable: VerifierSeam[] = binResolves ? [] : hostCliSeams;
  const provider = seamProvider(config, DEEP_VERIFY_SEAM);
  const keyPresent = credsPresent(provider, DEEP_VERIFY_SEAM, config, env, cwd);
  const deepVerifyUnresolvable = provider === 'host-cli' && !binResolves;
  const ready = provider !== 'mock' && keyPresent && !deepVerifyUnresolvable;
  let reason: string;
  if (provider === 'mock') {
    reason = 'deep-verify uses the mock provider — no real AI verification.';
  } else if (provider === 'host-cli') {
    reason = binResolves
      ? `deep-verify uses host-cli with "${bin}" found; its login and the self-invocation guard are checked only when a review runs.`
      : `deep-verify is set to host-cli but "${bin}" was not found (CADENCE_HOST_CLI_BIN or PATH) — every host-cli review will fall back to mock.`;
  } else {
    reason = keyPresent
      ? `deep-verify uses ${provider} with credentials present.`
      : `deep-verify is set to ${provider} but its credentials are missing.`;
  }
  return {
    provider,
    keyPresent,
    seamsReal,
    seamsMock,
    seamsDowngraded,
    seamsUnresolvable,
    ...(bin !== undefined ? { hostCliBin: bin } : {}),
    ready,
    reason,
  };
}
