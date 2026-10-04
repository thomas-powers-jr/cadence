# npm audit exceptions

CI runs `scripts/check-audit-exceptions.mjs` (`.github/workflows/security.yml`,
`audit` job) on every push, pull request, and the weekly security schedule.
That script runs the audit itself — via a pinned modern pnpm through
`corepack` rather than this repo's own pinned `pnpm@9.12.0`, since `pnpm
audit` under 9.12.0 hits npm's retired legacy audit endpoint (410 Gone —
pnpm/pnpm#11265; see the script's own comments for detail) — and cross-checks
any high or critical advisory it reports against the table below.

**Policy:** any high or critical advisory that is not listed in the table
below, or that is listed but whose `Expiry` date has passed, fails CI. To
accept a specific advisory temporarily, add a row with a justification and a
firm expiry date — do not add open-ended exceptions. When the expiry
arrives, the exception lapses automatically (the advisory starts failing
CI again) and must be re-justified or the underlying dependency must be
upgraded. Renewing an exception past its original expiry requires naming
*why the underlying fix slipped* (a link to what's blocking it) — restating
the original justification verbatim is not a valid renewal.

Advisory ids are the GHSA id (e.g. `GHSA-xxxx-xxxx-xxxx`) or, if GitHub has
not assigned one yet, the npm advisory id reported by `pnpm audit`. Expiry
dates are ISO 8601 (`YYYY-MM-DD`).

## What blocks a merge

Merge-blocking status differs by check, and the difference matters when
reading a green run. As of 2026-08-07, `main`'s branch protection
`required_status_checks.contexts` is `["ci-success", "security-success",
"codeql-success"]` — phase 255's T5 follow-up (registering the two
aggregators as required contexts, deferred at the time to a manual,
post-merge operator step) has been completed (`rec-20260807-002`). Both
`security-success` and `codeql-success` now genuinely block a merge to
`main`. What follows describes what each check *means* — the distinction
still matters, since a green `codeql-success` is a narrower guarantee than
a green `security-success` (see below).

`security-success` (`.github/workflows/security.yml`) aggregates
`secret-scan` and `audit` -- both genuinely fail their job on a real
condition: `audit` fails on an undocumented (or expired-exception)
high/critical `pnpm audit` advisory (the policy above), or on a
`pnpm.overrides` target that no longer covers every resolved instance of
that package in `pnpm-lock.yaml` (`scripts/check-lockfile-overrides.mjs`,
phase 253's drift detector); `secret-scan` fails on a credential gitleaks
detects in the diff. So a red security-success means something concrete
failed, and a green one means none of those conditions were present.
`codeql-success` (`.github/workflows/codeql.yml`) is different in kind: it
gates on the CodeQL `analyze` job *completing*, not on the scan finding zero
issues -- CodeQL's `analyze` step does not fail its own job by default when
it finds alerts; findings surface in the GitHub Security tab, not as a
failed job. Once both checks are actually registered as required, a PR will
still be able to merge with codeql-success green while CodeQL has open
findings. Read a green codeql-success as "the analysis job ran to
completion" only -- never as "no CodeQL findings."

## Exceptions

| Advisory ID | Package | Justification | Expiry |
| --- | --- | --- | --- |
| GHSA-vfj7-8cjw-p6xm | braces | Stack-exhaustion denial of service through deeply nested patterns. Reached only through dev tooling: every path starts at `@changesets/cli` 2.x (2.31.1) and ends at `micromatch@4.0.8` → `braces@3.0.3`, via several `@changesets/*` packages (e.g. `@changesets/config`, `@changesets/git`, and `@manypkg/get-packages@1.1.3` → `globby@11.1.0` → `fast-glob@3.3.3`). No production path (`pnpm why braces -r --prod` is empty), so no published CADENCE package ships it. No patched release exists (vulnerable `<= 3.0.3`, no first patched version). Unblock: a patched `braces` release, or adopting `@changesets/cli` 3.x (Dependabot #474), which drops `braces` from the tree. Operator-approved 2026-10-04 (phase 321). | 2026-11-18 |
<!--
To add a new exception, append a row above this comment, e.g.:

| GHSA-xxxx-xxxx-xxxx | some-package | Vulnerable code path is unreachable in our usage; upstream fix tracked. | 2026-12-31 |
-->

## Known CI configuration discrepancies (not audit exceptions)

- `.github/workflows/docs.yml:44` pins `pnpm/action-setup@v4`, while every
  other workflow that sets up pnpm (`ci.yml`, `release.yml`, and both jobs
  in `security.yml`) pins `@v6`. This is a real, minor version-pin drift —
  not a CVE, so it does not belong in the exceptions table above — noted
  here for visibility. Not fixed as part of phase 253 (out of scope); see
  `rec-20260805-001`.
