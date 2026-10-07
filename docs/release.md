# Release Process

Cadence releases are deliberate and workflow-driven. Local machines prepare the
version bump and changelog; GitHub Actions performs the public npm publish with
provenance and finishes the repository release record.

## Done Bar

A release is done only when all four public records agree:

- npm shows the new version for every public `@thomas-powers-jr/cadence-*` package.
- `origin` has the matching `v<version>` git tag.
- GitHub has a non-draft Release for that exact tag.
- GitHub marks that Release as the latest release.

The Release workflow enforces that done bar after publish. It publishes the
packages, pushes the tag, creates or updates the GitHub Release from
`packages/core/CHANGELOG.md`, then verifies npm, tag, and release metadata before
the job exits green.

## Prepare A Version

1. Add a changeset for the user-facing change.
2. Run the local gate: `pnpm build`, `pnpm typecheck`, `pnpm lint`, and
   `pnpm test`.
3. Run `pnpm changeset:version`.
4. Commit the version bump, changelogs, and release narrative updates.
5. Merge through a PR so the required `ci-success` check is green on `main`.

The workflow uses `packages/core/package.json` as the canonical version and checks
that every non-private `@thomas-powers-jr/cadence-*` package under `packages/` has the
same version.

## Publish

Run the **Release** workflow from GitHub Actions on `main`.

- `dry_run=false` publishes to npm, pushes `v<version>`, creates or updates the
  GitHub Release, and verifies the release record.
- `dry_run=true` only packs/validates; it does not publish, tag, or create a
  GitHub Release.

The workflow step `node scripts/release-integrity.mjs` is idempotent. If the tag
or GitHub Release already exists, it verifies the tag and updates the release
notes/latest marker instead of creating an untagged draft.

Workflow reruns are safe after a successful publish. Before publishing, the job
checks npm for the current package version; if every public package is already
published, it skips the publish command and continues to tag/release verification.

### Registry propagation

After publishing, the release-integrity step polls `npm view <package> version`
until npm reports the new version for every public package. It polls on a flat
15 s interval for up to 40 attempts per package, so it waits at least about
10 minutes before giving up. The budget is that long because the npm registry's
edge serves package metadata with `Cache-Control: public, max-age=300`: for up
to five minutes after a publish, npm can keep answering with the previous
version. The pre-publish idempotency check reads the same metadata seconds
before publishing, so that five-minute window can start before the publish
does. The earlier budget of about 45 s lost this race on routine releases
(v1.67.3, v1.68.0 and v1.69.0 all went red although every package had
published). `npm view` already revalidates against the registry on every call,
so no npm flag skips the stale edge copy; only time helps. The public packages
are checked one after another in each round, so the step's wall time is longer
than those 10 minutes of waiting.

The step log shows one progress line per miss on stderr, naming the package,
the version npm returned (or the reason `npm view` failed), the expected
version, the attempt number and the seconds elapsed, so the log records when
each package became visible. If npm still disagrees after the last attempt, the
step fails and names the package, the last answer or `npm view` failure, and
the elapsed time. Propagation has been waited out by then, so a red verify step
after that budget is a real mismatch to investigate, not a propagation race.
The pre-publish check keeps its fast 3-attempt budget and prints no progress
lines.

## Repair

If npm publish succeeds but the GitHub Release step fails, rerun the Release
workflow after fixing the reported mismatch. The rerun skips npm publish when the
registry is already current, then recreates/updates the tag and GitHub Release
record. The helper names the failing package, missing tag, or bad release metadata
in stderr.

For a manual repair from a checked-out `main` with GitHub auth:

```sh
node scripts/release-integrity.mjs
```

That command does not publish packages. It only creates or updates the GitHub
Release and verifies that npm, the remote tag, and GitHub release metadata agree.
