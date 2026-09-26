# 317-01 DRAFT plan review — Codex (independent, read-only)

- reviewer: codex exec -s read-only --ephemeral (ChatGPT login), 2026-09-26
- config planReview is mock; this manual review is the plan review of record.
- round 1 target c9db85db: REJECT, 1 blocking (stale SubagentStop reachability narrative vs stacked phase 318); design choices a–g all APPROVE.
- fix: da470878. Round 2 (focused delta check of da470878): APPROVE.

## Round 1 prompt

You are an independent, adversarial reviewer of a CADENCE DRAFT (plan) before approval. Read-only; do not edit files.
Target: `.cadence/phases/317-hook-json-block/317-01-DRAFT.md` at HEAD (commit c9db85db) in this worktree. Its ACs were seeded from `317-01-SPEC.md`, which passed independent review (see the `317-01-SPEC-REVIEW-codex*.md` files). Governing decisions: dec-20260925-001 (D-BN), dec-20260926-002 (D-BP), dec-20260926-003 (D-BO) in `.cadence/intelligence/decisions.json`. The project's plan-review gate is a mock, so this is the real plan review.

Check against the actual code (cite file:line):
1. Coverage: every AC-1..AC-10 is done-mapped by a task whose tests can assert it with a `317-01/AC-N` token in an asserting it() (assertion-mode, phase-qualified). Any AC only nominally covered?
2. Task correctness vs code: packages/core/src/cli/commands/hook.ts; packages/core/src/hooks/handlers.ts sites :114 :177 :230 :256 :297 :368 :452; dispatcher.ts; host-claude-code/src/cli.ts and install.ts (the `install --local` command shape, the stdin/relay); host-codex/src/shim.ts; packages/core/src/doctor/run.ts checkHostHooks (~400-455) and runDoctor; packages/core/src/doctor/model.ts; tests/cli/hook.test.ts; packages/*/tests/shim-integration.test.ts; .github/workflows/ci.yml; .gitattributes. Is each task implementable within its `files:` list? Would any task need to touch a file its `files:` omits or the Boundaries forbid?
3. Ordering/dependencies: T1 capture-first before T3; waves; build (`dist/`) staleness; parallel file conflicts.
4. False-green risks: could any test pass without the behavior it claims (e.g. golden test vs stale dist; T4 on non-Windows; T6 relay)?
5. Judge these explicit open design choices, each with APPROVE/CHANGE and why:
   a. blockMessage still written to stderr alongside the JSON on exit 0. Claude Code's current hooks doc (Exit code 0 section) says: "Stderr from a hook that exits 0 goes to the debug log only, never the transcript, and Claude never sees it." Codex's current doc (https://developers.openai.com/codex/hooks.md) is silent on exit-0 stderr.
   b. ok:false on any event without a documented JSON block shape keeps legacy stderr+exit 2 plus a loud stderr notice.
   c. fallback reason string `blocked by a CADENCE hook` when blockMessage is absent.
   d. Stop/SubagentStop block carrying contextPayload: emit the bare block doc and a loud stderr notice that the payload was dropped.
   e. renderer returns {stdout, stderr, exitCode} rather than the string the SPEC's AC-1 note suggested.
   f. tier set to complex (standard profile: adds code-review + deep-verify at settle).
   g. Stacked-phase constraint: a phase 318 branch stacked on this one makes Claude Code SubagentStop reachable; the DRAFT forbids tests asserting SubagentStop unreachable or pinning a count of reachable sites. Is anything in the DRAFT still inconsistent with that?
Output: first line `VERDICT: APPROVE` or `VERDICT: REJECT`, then numbered findings tagged BLOCKING / NON-BLOCKING with file:line, then the a–g judgments. Be concise.

## Round 1 output

VERDICT: REJECT

1. **BLOCKING** — The stacked-318 constraint contradicts stale reachability claims in the DRAFT. It correctly forbids tests asserting SubagentStop is unreachable or counting reachable sites ([DRAFT:161](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-DRAFT.md:161)), but AC-2 still says it is unreachable and must not be claimed reachable ([DRAFT:28](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-DRAFT.md:28), [DRAFT:32](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-DRAFT.md:32)). It also incorrectly calls PreToolUse the only reachable non-ASCII site and excludes SubagentStop “per” that caveat ([DRAFT:44](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-DRAFT.md:44), [DRAFT:47](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-DRAFT.md:47)), and tells the changeset not to claim the now-true reachability ([DRAFT:151](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-DRAFT.md:151)). Reframe the direct renderer test and T4 exclusion as phase-317 scope, not unreachable-path evidence.

2. **NON-BLOCKING** — AC coverage is substantive: T1–T7 map AC-1…AC-10, and the phase-qualified asserting-title convention is explicit ([DRAFT:95](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-DRAFT.md:95)). The files lists are implementable without violating boundaries; notably the existing CLI mixes payload/stdout/stderr/exit handling at [hook.ts:32](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/packages/core/src/cli/commands/hook.ts:32), and doctor’s host-hook classification is localized at [run.ts:400](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/packages/core/src/doctor/run.ts:400).

3. **NON-BLOCKING** — Ordering and false-green controls are adequate: T1 is explicitly capture-first and built before transport edits; T3 gates later shim tests; T4 is Windows-only while T5 pins the Windows CI leg. CI currently runs `windows-latest` without `continue-on-error` ([ci.yml:23](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.github/workflows/ci.yml:23)). The Codex relay test is meaningful because the shim inherits child stdout and propagates its code ([cli.ts:141](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/packages/host-codex/src/cli.ts:141)).

a. **APPROVE** — Keeping `blockMessage` on stderr preserves diagnostics while stdout remains the sole JSON control channel; Claude documents exit-0 stderr as debug-only.

b. **APPROVE** — The legacy exit-2 fallback plus a loud warning is the safe behavior where no JSON block format is documented.

c. **APPROVE** — `blocked by a CADENCE hook` is deterministic and fail-closed when a future handler omits a message.

d. **APPROVE** — Emit the documented bare Stop/SubagentStop block and loudly report the dropped payload; do not invent an undocumented combined shape.

e. **APPROVE** — `{ stdout, stderr, exitCode }` correctly models the three independent process outputs and keeps rendering unit-testable.

f. **APPROVE** — `complex` is justified; the standard/complex gate set includes code review and deep verification.

g. **CHANGE** — Remove or reword all stale unreachable/count-adjacent narrative identified in finding 1; retaining the direct unit test and excluding SubagentStop from T4 is fine as scope, not as a reachability assertion.
## Round 2 prompt

Independent read-only focused delta check. Do not edit files. Run `git show da470878` in this worktree. It addresses the single BLOCKING finding of a plan review of `.cadence/phases/317-hook-json-block/317-01-DRAFT.md`: stale "SubagentStop is unreachable" narrative conflicting with a stacked phase 318 (branch worktree-subagent-agentid-routing, PR #540, not in this worktree) that makes Claude Code's SubagentStop block path reachable once it lands on top of this branch. The review asked to reword AC-2's caveat (DRAFT ~line 28 and ~32), AC-4 case 2 (~44) and the AC-4 exclusion (~47), and T8's changeset instruction (~151) so the direct renderer test and the T4 exclusion are framed as phase-317 scope, not unreachable-path evidence.
Check ONLY: (1) is every such stale claim in the DRAFT now resolved — grep the whole DRAFT for remaining "unreachable"/"reachable"/"only four"/"not reachable" wording and judge each; (2) is the new text factually accurate for this branch as it stands (without 318) AND after 318 lands; (3) did the edit introduce any inconsistency with the Boundaries or tasks.
First line `VERDICT: APPROVE` or `VERDICT: REJECT`, then numbered findings tagged BLOCKING / NON-BLOCKING with file:line. Be brief.

## Round 2 output

VERDICT: APPROVE

1. NON-BLOCKING — `.cadence/phases/317-hook-json-block/317-01-DRAFT.md:28,32,44,47,151,161`: remaining reachability wording is correctly base-qualified or explicitly scope-only; no stale “only four” claim remains.

2. NON-BLOCKING — `.cadence/phases/317-hook-json-block/317-01-DRAFT.md:28-32`: accurate before phase 318 and after it lands; Claude routing then forwards identity, while Codex remains unaffected.

3. NON-BLOCKING — `.cadence/phases/317-hook-json-block/317-01-DRAFT.md:119-125,149-161`: renderer-only SubagentStop coverage and T4’s exclusion are consistently framed as phase-317 scope and match the tasks/boundaries.