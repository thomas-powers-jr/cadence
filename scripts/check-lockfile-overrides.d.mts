// Hand-written declarations for check-lockfile-overrides.mjs (phase 357).
// Keep in step with the script: the parity test in
// packages/core/tests/scripts/script-declarations.test.ts compares export names.

/** One `pnpm.overrides` entry, split at the key's last `@`. */
export interface OverrideTarget {
  package: string;
  sourceVersion: string;
  range: string;
}

/** One resolved `package@version` entry from pnpm-lock.yaml's `packages:` block. */
export interface LockfilePackage {
  package: string;
  version: string;
}

/** A resolved instance whose major-version line no override target covers. */
export interface UnguardedLineFailure {
  package: string;
  range: null;
  resolvedVersion: string;
  instance: string;
  reason: 'unguarded-line';
}

/** A resolved instance that matches a target's major but not its range. */
export interface UnsatisfiedFailure {
  package: string;
  range: string;
  resolvedVersion: string;
  instance: string;
  reason: 'unsatisfied';
}

/** A declared override target whose package resolves nowhere in the lockfile. */
export interface UnresolvedTargetFailure {
  package: string;
  range: string;
  sourceVersion: string;
  resolvedVersion: null;
  instance: null;
  reason: 'unresolved-target';
}

export type OverrideFailure = UnguardedLineFailure | UnsatisfiedFailure | UnresolvedTargetFailure;

export interface OverrideCoverageResult {
  ok: boolean;
  failures: OverrideFailure[];
}

/**
 * Returns `repoRoot` for an empty argument; otherwise the argument resolved
 * against `repoRoot`. Throws when it lies outside the repo, does not exist,
 * or has no `pnpm-lock.yaml`.
 */
export declare function resolveProjectDir(
  arg: string | null | undefined,
  repoRoot: string,
  exists: (path: string) => boolean,
): string;

/** `packageJson` is a parsed package.json of any shape. */
export declare function extractOverrideTargets(packageJson: unknown): OverrideTarget[];

/** `packageJson` is a parsed package.json of any shape. */
export declare function findUnversionedOverrideKeys(packageJson: unknown): string[];

export declare function parseLockfilePackages(lockfileText: string): LockfilePackage[];

/** Throws when a matched target's range is neither `^x.y.z` nor `>=x.y.z`. */
export declare function checkOverrideCoverage(
  overrideTargets: readonly OverrideTarget[],
  lockfilePackages: readonly LockfilePackage[],
): OverrideCoverageResult;

export declare function describeFailure(failure: OverrideFailure): string;
