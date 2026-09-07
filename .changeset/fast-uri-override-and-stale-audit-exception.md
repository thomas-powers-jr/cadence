---
"@thomas-powers-jr/cadence-core": patch
---

Security housekeeping: pin `fast-uri` past its four high advisories, and retire the resolved `hono` audit exception. Both were making CI red on every PR to `main` — the `Security` workflow was already failing on `main` at `d8d19ad4`, independent of any change.

The `pnpm.overrides` entry for `fast-uri` was wrong twice over. `"fast-uri@3.1.2": "^3.1.5"` under-shot the fix by one patch version — `GHSA-5jgf-p345-68v8`, `GHSA-f65p-4m7j-42xc`, `GHSA-fph4-wmhf-6fwf` and `GHSA-jqff-g426-hqxp` are all patched in `>=3.1.6`, so the lockfile sat on the still-vulnerable `3.1.5` — and, having performed that bump, its pinned key `fast-uri@3.1.2` then matched nothing in the tree, making it exactly the silent-no-op stale override key phase 253 wrote `scripts/check-lockfile-overrides.mjs` to catch. It is now the range key `"fast-uri@<3.1.6": "^3.1.6"`, which resolves `fast-uri@3.1.7` and cannot rot the same way on the next bump. `pnpm audit --audit-level high` goes from 4 high advisories to none.

`docs/security/audit-exceptions.md` documented one exception, `GHSA-88fw-hqm2-52qc` for `hono`, expired `2026-08-28`. Its own justification said "Re-check on the next `@modelcontextprotocol/sdk` bump"; that bump has landed (`^1.29.0` now resolving `1.30.0`) and the advisory no longer appears in `pnpm audit` at all. The row is removed as **resolved**, not re-justified and not date-extended — the same treatment phase 260 gave the vitest/vite/postcss rows. An expiry is the gate; pushing it forward would defeat it.

That empties the exceptions table, which previously failed a doc test asserting at least one row. **That assertion is retired.** It encoded phase 182's snapshot — when the table genuinely documented live advisories — as though it were an invariant. Zero documented exceptions is the healthy state, and a gate forbidding an empty table pressures a maintainer to keep a dead row alive to stay green. Every per-row check survives: any row present must have all four columns populated and must not be expired, verified adversarially by injecting an expired probe row and confirming the suite still fails. An unlisted or expired high/critical advisory still fails the `audit` job through `scripts/check-audit-exceptions.mjs`, which is the real gate.

Two current-state doc tests are updated to match, rather than left pinning a state that no longer exists: 253-01/AC-1's fast-uri override target, and 260-01/AC-5's "the hono row must survive" clause.
