---
"@thomas-powers-jr/cadence-core": patch
---

The Release workflow's "Create GitHub Release and verify registry" step now polls npm on a flat 15 s interval for up to 40 attempts, at least about 10 minutes of waiting, instead of giving up after about 45 s (phase 323, rec-20260802-005). The npm registry's edge caches package metadata for five minutes (`max-age=300`), so the old budget turned routine releases red although every package had published. Each miss prints one `release-integrity:` progress line to stderr naming the package, the version npm returned, the expected version, the attempt number and the elapsed seconds, so the run log shows when each package became visible; the final error also reports the elapsed time. The pre-publish idempotency check (`--verify-npm`) is unchanged: 3 quick attempts and no progress lines. A red verify step is now a real signal to investigate, not a propagation race.
