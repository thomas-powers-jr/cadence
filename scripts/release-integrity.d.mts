// Hand-written declarations for release-integrity.mjs (phase 357).
// Keep in step with the script: the parity test in
// packages/core/tests/scripts/script-declarations.test.ts compares export names.

/** A public `@thomas-powers-jr/cadence-*` package found under `packages/`. */
export interface PublicPackage {
  name: string;
  version: string;
  dir: string;
}

export interface ReleasePlan {
  version: string;
  /** `v<version>`. */
  tag: string;
  packages: PublicPackage[];
  notes: string;
}

export interface ReleaseResult extends ReleasePlan {
  action: 'dry-run' | 'created' | 'updated';
  /** Empty on a dry run. */
  releaseUrl: string;
}

export interface ReleaseNotesInput {
  version: string;
  packages: readonly { name: string }[];
  changelogEntry: string;
  /** Omitted or empty: no workflow-run line. */
  runUrl?: string;
}

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface VerifyNpmOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ReleaseIntegrityOptions extends VerifyNpmOptions {
  dryRun?: boolean;
}

export declare const POST_PUBLISH_VERIFY_ATTEMPTS: number;
export declare const POST_PUBLISH_VERIFY_INTERVAL_MS: number;

/** Strips a leading `v`; throws unless the result is `x.y.z[-pre|+build]`. Accepts any value. */
export declare function normalizeVersion(raw: unknown): string;

/** Throws when the changelog has no `## <version>` heading. */
export declare function extractChangelogEntry(changelog: string, version: string): string;

/** Throws when any package's version differs from `version`. */
export declare function validatePackageVersions(
  packages: readonly { name: string; version: string }[],
  version: string,
): void;

export declare function buildReleaseNotes(input: ReleaseNotesInput): string;

/** Throws when no public package is found. */
export declare function discoverPublicPackages(root: string): Promise<PublicPackage[]>;

/** Returns trimmed stdout; throws on a spawn error or a non-zero exit. */
export declare function runCommand(command: string, args: readonly string[], options?: RunCommandOptions): string;

export declare function buildReleasePlan(root?: string, env?: NodeJS.ProcessEnv): Promise<ReleasePlan>;

export declare function verifyNpmPublished(options?: VerifyNpmOptions): Promise<ReleasePlan>;

export declare function runReleaseIntegrity(options?: ReleaseIntegrityOptions): Promise<ReleaseResult>;
