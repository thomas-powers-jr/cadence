# 317-01 SPEC review #2 — manual, via `codex exec`

Second pass, after the first revision addressed review #1's 10 findings. Same
methodology as review #1 (see `317-01-SPEC-REVIEW-codex.md`'s header) —
adversarial prompt, raw-doc excerpts pasted inline, findings re-verified
against source before being trusted. Run 2026-09-26.

**Post-review verification note:** every blocking finding below was re-checked
against source. Findings 1-4, 9 confirmed accurate as written. Finding 10
(AC-5) confirmed accurate. The fresh Codex-docs fetch this finding's item 1
prompted (`developers.openai.com/codex/hooks.md`) resolved the Codex
regression-risk concern for AC-1/AC-2's bare shapes — see
`317-01-SPEC-REVIEW-codex-3.md` and the SPEC's own Constraints for the
resolution and its precise scope.

---

## Verdict

REJECT

## Part 1 — prior findings

1. **RESOLVED** — The committed manual review now exists. `317-01-SPEC-REVIEW-codex.md:1`.
2. **RESOLVED** — The cited handoff now exists. `docs/handoffs/HANDOFF-hook-json-block.md:1`.
3. **RESOLVED** — AC-2 now explicitly excludes real-host SubagentStop reachability and requires a direct transport test instead. `317-01-SPEC.md:27-31`.
4. **RESOLVED** — AC-6 tests an emitted JSON shape, AC-9 tests relay transparency only, and live-host proof is manual evidence rather than a coverage-gated AC. `317-01-SPEC.md:56`, `:73`, `:91`.
5. **RESOLVED** — AC-9 correctly identifies `hostCapabilities` as capabilities rather than host identity and no longer claims to prove Codex runtime blocking. `317-01-SPEC.md:73`; `packages/types/src/host.ts:11-29`.
6. **RESOLVED** — AC-4 now requires capturing the actual `install --local` command, correctly accounting for absolute local paths. `317-01-SPEC.md:39`; `packages/host-toolkit/src/locate-self.ts:30-32`.
7. **RESOLVED** — AC-1 requires three site cases or a shared renderer matrix; AC-4 names both reachable end-to-end cases; SubagentStop is deliberately direct-only. `317-01-SPEC.md:20`, `:41-46`.
8. **RESOLVED** — AC-7 now names the check, inputs, and expected normal-case outputs, with D-BP decided. `317-01-SPEC.md:60-63`, `:102-105`.
9. **RESOLVED** — The dispatcher/routing distinction and the `hook.ts:35` citation are corrected. `317-01-SPEC.md:16`, `:76`; `packages/core/src/hooks/dispatcher.ts:31-32`; `packages/host-toolkit/src/routing.ts:69-77`.
10. **NOT RESOLVED** — AC-5 now has byte goldens, but AC-10 still says the expected replacement text is merely "e.g.", so the SPEC itself does not pin one exact required string. `317-01-SPEC.md:51`, `:78`.

## Part 2 — fresh findings

Documentation checks:

- **PreToolUse:** Yes. The supplied documentation says `additionalContext` is ignored only for `permissionDecision: "defer"`; it therefore supports the AC-6 deny-plus-context shape. `317-01-SPEC.md:56` is correct.
- **Stop/SubagentStop:** No. The excerpts document `additionalContext` as non-error continuation feedback, distinct from the blocking examples, but do not establish that a combined `decision:"block"` plus `additionalContext` result is rejected or unsupported. The categorical "cannot combine — verified" claim is unsupported.
- **SubagentStop framing:** Accurate. Codex's separate shim copies only `files` (`packages/host-codex/src/shim.ts:47-50`), declares `agentIdentification: false` (`capabilities.ts:27-35`), and injects that declaration into core input (`cli.ts:110-113`), so the loud notice is reachable. Claude's toolkit extracts identity (`routing.ts:100-108`) but drops it during translation (`:181-185`), while Claude capabilities omit the declaration (`packages/host-claude-code/src/capabilities.ts:3-18`): a silent bug.

1. **Blocking — Codex compatibility is knowingly unresolved despite a universal shared-core transport change.** The objective mandates JSON plus exit 0 for every `ok:false` result (`317-01-SPEC.md:11`), and Codex invokes that same core hook command (`packages/host-codex/src/cli.ts:141-150`) while declaring PreToolUse and Stop as blocking hooks (`capabilities.ts:22-24`). Yet AC-9 expressly declines to establish that Codex honors the new exit-0 JSON transport (`317-01-SPEC.md:70-73`, `:108`). The existing research documents exit 2 as Codex's explicit block mechanism and does not prove exit-0 JSON blocking (`.cadence/research/codex-hooks.md:85-91`). This can ship a regression for Codex while calling the transport universal.
2. **Blocking — AC-6 overstates the Stop/SubagentStop documentation.** "Cannot combine" is not verified by the supplied excerpts; only "no documented combined shape" is supported. `317-01-SPEC.md:58`. The AC may exclude that case from this phase, but it must not assert an undocumented prohibition.
3. **Blocking — AC-7 remains non-determinate outside one nominal Claude configuration.** It says the check reads `.claude/settings.json` *or* `.codex/hooks.json` and reports exactly two outcomes (`317-01-SPEC.md:61-63`), but existing doctor checks have distinct missing-file, invalid-JSON, incomplete-install, stale-install, and success outcomes (`packages/core/src/doctor/run.ts:400-455`, `:487-547`). It also gives no result for both hosts installed with differing explicit/default shell settings, and the supplied shell semantics are Claude Code-specific — not `.codex/hooks.json` semantics.
4. **Non-blocking — One new citation is wrong.** The Claude silent-path explanation cites `handlers.ts:29` as the notice guard, but line 29 only reads `hostCapabilities`; the actual guard is `handlers.ts:47-49`. `317-01-SPEC.md:28`; `packages/core/src/hooks/handlers.ts:27-32`, `:46-49`.
