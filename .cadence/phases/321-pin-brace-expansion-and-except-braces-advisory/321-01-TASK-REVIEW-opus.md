# 321-01 — independent review record (fresh-context Opus subagents)

Each review ran in a fresh-context Opus subagent that did not implement the task, and every
completion claim was re-verified in the main thread before `cadence done`. Settle's AI gates
(`deep-verify`, `code-review`) are not in this phase's standard tier × standard profile gate
set, so these reviews are the independent review of record.

| Scope | Verdict | Notes |
|---|---|---|
| T1 override + lockfile | APPROVE | Proved the regenerated `pnpm-lock.yaml` is byte-identical to what pnpm 9.12.0 produces under `--frozen-lockfile --lockfile-only`, with a negative control (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` on the old lockfile). Replayed the tests over old/new package.json × lockfile combinations, and confirmed the `>=5.0.11` check is numeric. Carry-forward (not this phase): the `brace-expansion@^2.0.0` → `^2.1.4` floor is below the 2.x fixes; no 2.x instance resolves today. |
| T2 exception row + gate test | APPROVE | Every factual claim in the row was checked against `gh api`, `pnpm why` and PR #474's diff. The real `pnpm audit --json` was fed through the script's own exported functions: the only high is `braces`, allowed until 2026-11-18. All six doc mutants were caught. Minors applied: multi-path wording; the test now asserts both unblock conditions and the dev-only evidence. |
| T3 changeset + records, and whole branch | NOT READY → READY TO MERGE | Important: "PR #546 was the first PR blocked" was false. Dependabot #545 (2026-10-02) failed first, on the two `brace-expansion` advisories, and `braces` appeared on 2026-10-04. "Failing on main itself" had never been observed. Both were corrected in the changeset and ROADMAP and recorded as DRAFT As-built notes, and the GHSA-6j4f fix version was corrected to 5.0.10. The reviewer re-verified and approved T3. |

Main-thread verification before settle: `pnpm turbo run lint typecheck test build --force`
exit 0 (28/28 tasks; core 469 files passed, 1 skipped); `node scripts/check-lockfile-overrides.mjs`
exit 0. `node scripts/check-audit-exceptions.mjs` cannot spawn `corepack` on this Windows box,
so the PR's Linux `audit` job is the live gate run of record.
