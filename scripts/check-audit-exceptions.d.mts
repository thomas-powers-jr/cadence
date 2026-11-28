// Hand-written declarations for check-audit-exceptions.mjs (phase 357).
// Keep in step with the script: the parity test in
// packages/core/tests/scripts/script-declarations.test.ts compares export names.

export { resolveProjectDir } from './check-lockfile-overrides.mjs';

/** Thrown when `pnpm audit --json` reports an error instead of a report. */
export declare class AuditUnavailableError extends Error {}

/** One row of docs/security/audit-exceptions.md's allowlist table. */
export interface AuditException {
  id: string;
  package: string;
  justification: string;
  /** ISO `YYYY-MM-DD`. */
  expiry: string;
}

/** A high or critical advisory, normalized from `pnpm audit --json`. */
export interface Advisory {
  id: string;
  package: string;
  severity: string;
}

export type AllowedAdvisory<A extends Advisory = Advisory> = A & { justification: string; expiry: string };

export type FailedAdvisory<A extends Advisory = Advisory> = A & { reason: string };

export interface AdvisoryDecision<A extends Advisory = Advisory> {
  ok: boolean;
  allowed: AllowedAdvisory<A>[];
  failures: FailedAdvisory<A>[];
}

export declare function parseExceptionsTable(markdown: string): AuditException[];

/** Throws on an expiry that is not a valid date. */
export declare function isExpired(expiry: string, now?: Date): boolean;

/** Throws (via `isExpired`) when a matching exception's expiry is not a valid date. */
export declare function decideAdvisories<A extends Advisory>(
  advisories: readonly A[],
  exceptions: readonly AuditException[],
  now?: Date,
): AdvisoryDecision<A>;

/**
 * `auditJson` is raw parsed `pnpm audit --json` output of either historical
 * shape. Throws `AuditUnavailableError` on an `{ error }` payload.
 */
export declare function extractHighSeverityAdvisories(auditJson: unknown): Advisory[];
