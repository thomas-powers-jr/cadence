# 317-01 SPEC review #4 — manual, via `codex exec`

Fourth pass, after round-3 fixes (98ff0724, bb312f3d). Same methodology as reviews #1-#3 (`codex exec -s read-only --ephemeral`, ChatGPT login). Run 2026-09-26 against HEAD 686cd7aa.

**Post-review verification note:** the one blocking fresh finding (AC-7 gives no outcome for an unsupported hand-edited `shell` value such as `"zsh"` or `null`) was confirmed by direct read of `317-01-SPEC.md` AC-7: only absent, `"bash"`, and `"powershell"` are specified. Not yet fixed at the time this file was written. Trend of blocking findings across reviews: 10 → 4 → 2 → 1.

---

## Prompt

You are an independent, adversarial reviewer of a CADENCE SPEC. Read-only; do not edit files. This is review #4.

Target: `.cadence/phases/317-hook-json-block/317-01-SPEC.md` at HEAD of this worktree (branch worktree-hook-json-block, HEAD 686cd7aa). Prior reviews are in the same directory: `317-01-SPEC-REVIEW-codex.md` (#1, REJECT, 10 findings), `-codex-2.md` (#2, REJECT, 4), `-codex-3.md` (#3, REJECT, 2 blocking + 1 non-blocking). Round-3 fixes landed in commits 98ff0724 and bb312f3d; see `git diff cb943c6e..HEAD -- .cadence/phases/317-hook-json-block/`. Supporting material: `317-01-raw-doc-excerpts.md`, `317-01-red-state-capture.md`, the probe scripts, and decisions dec-20260925-001 (D-BN), dec-20260926-002 (D-BP), dec-20260926-003 (D-BO) in `.cadence/intelligence/decisions.json`.

Do this:
1. For EACH finding in review #3 (and any #1/#2 finding #3 marked unresolved), state Resolved / Not resolved, with SPEC file:line evidence. In particular: AC-6's heading vs body on Stop/SubagentStop combined shape; AC-7's per-outcome behavior for every branch of `checkHostHooks` in `packages/core/src/doctor/run.ts` (~400-455) — verify against the real code, branch by branch; the stdin probe `.stdin.end()` fix.
2. Fresh adversarial pass over the WHOLE SPEC against the real code: every file:line citation still accurate; every AC testable and unambiguous (Given/When/Then determinable); no AC contradicting another or a LOCKED DESIGN.md decision or D-BN/D-BO/D-BP; scope boundaries coherent. Check especially whether the round-3 fixes introduced new inconsistencies (the pattern in prior rounds).
3. Context, judge separately and do NOT count as a blocker against this SPEC unless it makes an AC wrong as written: a separate stacked phase 318 (branch worktree-subagent-agentid-routing, not in this worktree) fixes host-toolkit routing.ts to forward agentId/agentType, making Claude Code's SubagentStop block path (handlers.ts handleSubagentResult, redundantWorkEnforcement=block) reachable. Identify every place in 317's SPEC that states or depends on SubagentStop blocking being unreachable, and say whether each would become wrong, or merely need an as-built note, once 318 lands.

Output: `VERDICT: APPROVE` or `VERDICT: REJECT` on the first line, then "Prior findings status" (numbered), "Fresh findings" (each BLOCKING or NON-BLOCKING with file:line), and "Phase 318 interaction". Be concise and cite evidence.

## Output

VERDICT: REJECT

## Prior findings status

1. Review #3 item 1 — **Resolved.** AC-9 limits Codex confirmation to AC-1/2 bare shapes. [SPEC:79](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:79)

2. Review #3 item 2 — **Resolved.** AC-6’s heading and body now say only “no documented combined shape,” not “cannot combine.” [SPEC:54](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:54)

3. Review #3 item 3 — **Resolved.** AC-7 now specifies every `checkHostHooks` outcome: missing file; invalid JSON; incomplete managed entries; complete/current; stale; and the final no-managed branch. The latter is structurally shadowed today by `findMissingManagedHooks`, but both it and incomplete installs are explicitly assigned a `hook-transport` pass/N/A result. [SPEC:62](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:62) [run.ts:400](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/packages/core/src/doctor/run.ts:400)

4. Review #3 item 4 — **Resolved.** The guard citation is now correct. [SPEC:28](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:28) [handlers.ts:47](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/packages/core/src/hooks/handlers.ts:47)

5. Review #3 item 5 — **Resolved.** AC-10 pins an exact replacement comment, and current old-comment location is correct. [SPEC:84](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:84) [hook.ts:35](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/packages/core/src/cli/commands/hook.ts:35)

6. Review #3 fresh AC-7 finding — **Resolved.** Bad-install states are explicitly `pass('hook-transport', 'Not applicable …')`, while complete installs proceed to shell reporting. [SPEC:63](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:63)

7. Review #3 stdin-probe finding — **Resolved.** The committed probe calls `.stdin.end()`, and the evidence explains the prior omitted display snippet. [probe:14](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-probe-stdin.mjs:14) [red-state:55](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-red-state-capture.md:55)

8. Review #1 finding 3 / review #2 prior finding 3 — **Resolved on current HEAD.** The false SubagentStop path remains unreachable through either adapter, but AC-2 accurately requires a direct transport test rather than claiming host reachability. [SPEC:27](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:27) [routing.ts:181](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/packages/host-toolkit/src/routing.ts:181)

## Fresh findings

1. **BLOCKING — AC-7 leaves hand-edited invalid/non-string `shell` values undefined.** It handles only absent, `"bash"`, and `"powershell"` values, despite explicitly discussing hand-edited entries. A complete managed install with `shell: "zsh"` or `shell: null` reaches the new check, but has no prescribed severity, detail, or remediation. Specify an exact outcome for unsupported values. [SPEC:68](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:68) [SPEC:70](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:70) [raw-doc-excerpts:64](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-raw-doc-excerpts.md:64)

2. **NON-BLOCKING — locator citation is imprecise.** `resolveLocalPaths()` is the Claude adapter wrapper at [locate-self.ts:16](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/packages/host-claude-code/src/locate-self.ts:16); the absolute-path implementation at toolkit `locate-self.ts:30-32` is named `resolveAdapterLocalPaths`. The claim is true, but [SPEC:39](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:39) conflates the two.

3. **NON-BLOCKING — AC-4 calls the fixture’s manually spawned PowerShell process “Claude Code’s outer PowerShell spawn,” while its constraints correctly say it is only a reproduction form, not Claude Code’s verified invocation.** Rename that hop to the fixture’s PowerShell wrapper. [SPEC:46](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:46) [SPEC:92](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:92)

## Phase 318 interaction

I verified the stacked branch forwards `agentId`/`agentType` and sets Claude’s `agentIdentification: true` (commit `57231c4a`). It does not affect this verdict.

Would become wrong after 318 lands:

- [SPEC:27-28](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:27): Claude Code SubagentStop is no longer unreachable or silently dropped.
- [SPEC:31](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:31): “do not claim … reachability until rec ships” is stale.
- [SPEC:43](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:43): redundant-work’s PreToolUse site is no longer the only reachable non-ASCII block site; SubagentStop uses the same message.
- [SPEC:94](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:94): “only four” reachable false sites becomes five through Claude Code.

Needs only an as-built note:

- [SPEC:31](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:31) direct transport test remains valid, but is no longer required by reachability.
- [SPEC:47](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:47) may retain SubagentStop exclusion as scope, but not “per reachability caveat.”
- [SPEC:91](C:/Users/softw/projects/cadence/.claude/worktrees/hook-json-block/.cadence/phases/317-hook-json-block/317-01-SPEC.md:91) should mark the Claude-specific unreachable-path decision as historical/as-built; Codex remains the declared-loud gap.