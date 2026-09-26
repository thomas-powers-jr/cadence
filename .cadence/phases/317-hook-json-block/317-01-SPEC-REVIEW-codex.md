# 317-01 SPEC review — manual, via `codex exec` (substituting for the built-in gate)

**Why this file exists, not `317-01-SPEC-REVIEW.json`:** `cadence spec approve` ran against
this project's `.cadence/config.json`, which configures `specReview.provider: "mock"`
explicitly (not a fallback — a deliberate config choice, one of 4 gate families on mock;
`verifier`/`perTaskVerifier`/`codeReview` are the 3 on `host-cli`). `CADENCE_HOST_CLI_BIN`
only selects the binary inside an already-`host-cli` gate; it cannot upgrade a
literally-mock-configured one. The sidecar's `provider: "mock"`, `verdict: "abstained"`
is real but is not a review. This file is the actual independent review, per this
repo's own documented remedy ("dispatch a real independent review manually — don't
treat the mock fallback's pass as one").

**How it was produced:** `codex exec -s read-only --ephemeral`, pointed at this
worktree, given the SPEC plus supporting source files plus verbatim excerpts of the
raw Claude Code hooks doc (fetched via `curl`, not summarized) inline in the prompt
(the sandbox may have no network). Prompt asked for an adversarial review: per-AC
testability under `coverageMode: assertion`, file:line claim verification, internal
contradictions, and honesty about the Codex-transport ambiguity. Run 2026-09-26.

**Post-review verification note (added by the reviewing session, not Codex):** every
blocking finding below was independently re-checked against the actual source files
before being accepted — this review's claims are not taken on faith. Verified TRUE:
findings 1, 2, 3 (worse than stated — see `rec-20260926-001`), 4, 6, 9. Findings 7, 8,
10 are valid structural/precision critiques, accepted as written. Finding 5's URL
citation (`learn.chatgpt.com/docs/hooks`) was flagged here as unverified/possibly
fabricated at the time this review was first read. **Correction, added during the
SPEC's revision pass (2026-09-26):** `learn.chatgpt.com` is in fact a real OpenAI
docs domain — `developers.openai.com/codex/hooks`'s own page HTML lists it as a
registered "site variant domain" for the same documentation, and its `llms.txt`
index is cited by the live page itself. The specific path `/docs/hooks` was not
independently re-verified, but the domain itself was wrongly doubted; this
correction stands in place of the original flag. Finding 5's underlying code claim
(`hostCapabilities` is a capability descriptor, not a host-identity field —
`packages/types/src/host.ts:11-29`) was independently verified true by direct read,
separate from the citation, and remains correct.

---

Verdict: **REJECT**

AC testability under assertion coverage: AC-1, AC-3, and the Stop half of AC-2 are testable; AC-4 needs correction first; AC-5 is only partly provable; AC-6 and AC-9 require forbidden live-host proof; AC-7 is under-specified; AC-8 also needs CI-run evidence; AC-10's proposed test is insufficient.

1. **(blocking)** `317-01-SPEC.md:82` claims a committed manual review at `317-01-SPEC-REVIEW-codex.md`. That file does not exist; the phase directory contains only the SPEC and `317-01-SPEC-REVIEW.json`, whose result is `provider: "mock"`, `verdict: "abstained"`, `pass: false`. The SPEC is marked `APPROVED` without the review record it says makes that meaningful.

2. **(blocking)** `317-01-SPEC.md:69` relies on `docs/handoffs/HANDOFF-hook-json-block.md`, but that file is absent from the worktree and not tracked. The count itself is independently correct, but the claimed handoff comparison is unverifiable.

3. **(blocking)** AC-2's SubagentStop path is not reachable through either installed shim. `packages/host-toolkit/src/routing.ts:100-108` extracts `agentId`/`agentType`, but `:181-185` drops them when constructing translated stdin. The Codex shim likewise only copies `files` at `packages/host-codex/src/shim.ts:47-50`. Core only promotes camel-case `agentId`/`agentType` at `packages/core/src/cli/commands/hook.ts:23-29`, so `handleSubagentResult` takes its early `ok: true` return at `handlers.ts:310-321`; its false site at `:368` cannot occur from a real shim invocation. A unit test can fake the core input, but cannot prove the claimed host route.

4. **(blocking)** AC-6 and AC-9 contradict the no-live-host constraint at `317-01-SPEC.md:75`. AC-6 requires a document "the host accepts"; AC-9 requires the selected form be "actually proven to block." A repository test can prove emitted bytes and exit status, not host acceptance/blocking. AC-6 also omits the required combined-result output contract — whether context is discarded, encoded, or otherwise represented — so "one well-formed document" is too weak to falsify.

5. **(blocking)** AC-9 is both under-specified and based on a false host-identification premise. `ctx.raw.hostCapabilities` has no host identity field (`packages/types/src/host.ts:11-29`); it is only a capability descriptor. So it cannot safely select a Codex-only transport branch. The SPEC is narrowly honest that it does not know runtime behavior, but it falsely implies a `packages/host-codex` test can settle that behavior. *(Citation of "current official documentation" and its URL not verified — see note above.)*

6. **(blocking)** AC-4's "exact command install.ts registers" is not exact. `317-01-SPEC.md:31` uses relative `packages/.../dist/...` paths, while `packages/host-claude-code/src/install.ts:47-51` uses `resolveLocalPaths()`, and `packages/host-toolkit/src/locate-self.ts:30-32` returns absolute paths. The fixture must obtain and execute the command emitted by a real `install --local`, not an equivalent-looking manually written command.

7. **(blocking)** AC-1/AC-2/AC-4 do not define a sufficient assertion matrix for the stated "every `ok:false`" objective. Under assertion coverage, one test containing `AC-1` can exercise only the build gate and leave boundary/redundancy untested; AC-4 permits either output shape, leaving the other end-to-end path unproved. Require explicit cases for all three PreToolUse sites, Stop, and SubagentStop — or explicitly remove the unreachable SubagentStop claim from scope.

8. **(blocking)** AC-7 is not a determinate contract. It permits either "resolved" or "inferred" posture while D-BP remains open, defines neither the inference inputs nor the output/check ID, and asks `doctor` to describe Claude Code's own shell selection without running Claude Code. Existing `checkHostHooks` only validates managed entries (`packages/core/src/doctor/run.ts:400-455`); no shell-posture mechanism exists to extend.

9. **(non-blocking)** Two source citations are wrong or misleading:
   - `317-01-SPEC.md:16` says `dispatcher.ts` maps `pre-tool-edit` to real `PreToolUse`; dispatcher maps the abstract event to `handlePreToolEdit` (`packages/core/src/hooks/dispatcher.ts:31-32`). The real-to-abstract mapping is `EVENT_TABLE` in `packages/host-toolkit/src/routing.ts:69-77`.
   - `317-01-SPEC.md:61` cites the old exit-2 comment as `hook.ts:36`; it is line 35. Line 36 is the assignment.

10. **(non-blocking)** AC-5 and AC-10 are coverage-gameable. "Capture before touching" in AC-5 cannot be proven by a later committed test. AC-10 proposes only asserting that old text is absent, which does not prove the replacement comment describes the actual transport or cites checkpoint 0.4a. Both need explicit expected bytes/text, not absence checks.

Requested handler count check: it is correct. `handlers.ts` has exactly five `ok: false` sites — 177, 230, 256, 297, and 368 — so the intended mapping is three PreToolUse sites plus Stop and SubagentStop. The defect is reachability of the SubagentStop false site through the real adapters, not the raw count.
