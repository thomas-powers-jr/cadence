# 317-01 SPEC review #5 — focused delta check of feffec21, via `codex exec`

Operator-chosen (2026-09-26) focused check of only the review-#4 fix commit `feffec21`, instead of a fifth full review. `codex exec -s read-only --ephemeral`, ChatGPT login.

**Post-review verification note:** finding 1 confirmed by direct read — `packages/core/src/doctor/model.ts` exports only `pass()` and `fail(name, severity, detail, remediation, fixId?)`; no `warn()`. Finding 2 confirmed — this file did not exist when the SPEC first cited it. Both fixed in the commit that adds this file.

---

## Prompt

You are an independent reviewer doing a FOCUSED DELTA check of a CADENCE SPEC fix. Read-only; do not edit files.
Run `git show feffec21` in this worktree. It edits `.cadence/phases/317-hook-json-block/317-01-SPEC.md` to address review #4 (`.cadence/phases/317-hook-json-block/317-01-SPEC-REVIEW-codex-4.md`), which had 1 BLOCKING finding (AC-7 gave no outcome for an unsupported hand-edited `shell` value) and 2 NON-BLOCKING (locator citation conflating resolveLocalPaths/resolveAdapterLocalPaths; AC-4 calling the fixture's PowerShell wrapper "Claude Code's outer PowerShell spawn").
Check ONLY:
1. Does each of the three edits fully resolve its review-#4 finding? Verify citations against the real code (packages/host-claude-code/src/locate-self.ts, packages/host-toolkit/src/locate-self.ts) and the doc excerpt (`317-01-raw-doc-excerpts.md`, around the `shell` field).
2. Is the new AC-7 "Unsupported value" bullet unambiguous and testable, and consistent with the rest of AC-7 (absent key → rule-stated; "bash"/"powershell" → configured value reported; first-managed-entry scope; the install-state classification branches) and with dec-20260926-002 (D-BP: doctor states the rule, does not measure the resolved shell)? Is `warn` a real DoctorCheck severity helper in packages/core/src/doctor/run.ts?
3. Did the edit introduce any NEW inconsistency elsewhere in the SPEC (including the updated review-trail sentence in Constraints)?
Do not re-review unchanged parts of the SPEC.
Output: first line `VERDICT: APPROVE` or `VERDICT: REJECT`, then numbered findings tagged BLOCKING / NON-BLOCKING with file:line evidence. Be concise.

## Output

VERDICT: REJECT

1. **BLOCKING** — AC-7 requires nonexistent `warn(...)`. `packages/core/src/doctor/run.ts:51-58` imports only `pass` and `fail`; the DoctorCheck helpers are `pass()` and `fail(name, 'warning', ...)` in `packages/core/src/doctor/model.ts:43-60`. Thus `SPEC.md:71` is not literally implementable without unscoped new API work. Replace it with `fail('hook-transport', 'warning', ...)`.

2. **NON-BLOCKING** — The updated review trail falsely says a focused delta review was “recorded in `317-01-SPEC-REVIEW-codex-5-delta.md`” (`SPEC.md:109`), but no such file exists in the phase directory. This review is the requested delta check and is read-only, so the sentence is premature.

The locator citation and fixture-wrapper wording fixes are accurate. The unsupported-value taxonomy is otherwise unambiguous, follows first-managed-entry scope, and remains consistent with D-BP; the raw doc supports only `"bash"`/`"powershell"` (`317-01-raw-doc-excerpts.md:64-65`).
---

# Follow-up check of 28390f1e (the fix for this review's findings)

Same tool and mode. **Result: APPROVE**, no findings. With this, the SPEC as of `28390f1e` has a passing independent review: the full review #4 plus these two focused delta checks.

## Prompt

Independent read-only check. Do not edit files. Run `git show 28390f1e` in this worktree. It fixes the two findings in `.cadence/phases/317-hook-json-block/317-01-SPEC-REVIEW-codex-5-delta.md`: (1) AC-7's "Unsupported value" bullet named a nonexistent `warn()` doctor helper; (2) the Constraints review-trail sentence cited a review file that did not yet exist.
Check ONLY: is the new helper call exactly implementable against `packages/core/src/doctor/model.ts` (signature, argument order, severity literal, cited line numbers)? Is the review-trail sentence now factually accurate against the files and commits that exist (`git log --oneline -6`, `ls .cadence/phases/317-hook-json-block/`)? Any new inconsistency introduced by this commit?
First line `VERDICT: APPROVE` or `VERDICT: REJECT`, then numbered findings tagged BLOCKING / NON-BLOCKING with file:line. Be brief.

## Output

VERDICT: APPROVE

1. **NON-BLOCKING** — No issue: `317-01-SPEC.md:71` calls `fail(name, severity, detail, remediation)` in the exact order; `'warning'` is valid and `model.ts:52-60` accurately covers the helper signature.

2. **NON-BLOCKING** — No issue: `317-01-SPEC.md:109` accurately records the delta review and its subsequent correction. The review file exists, and `28390f1e` immediately follows `feffec21` in the six-commit log.