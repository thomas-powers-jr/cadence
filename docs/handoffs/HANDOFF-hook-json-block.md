# HANDOFF — CADENCE Hook Blocking: JSON Decisions, Not Exit Codes

**To:** Claude Code
**From:** Thomas, 2026-09-25
**Repo:** `thomas-powers-jr/cadence` @ `main`
**Baseline:** v1.68.0; 0 pending changesets; loop IDLE; latest phase `316-checkpoint-schema-reconcile`; checkpoint Phase 0.4a complete (verify — CMD-A)
**Scout ID for this batch:** `scout-20260925-hook-json-block`
**Backing rec:** none yet — **the finding came from a throwaway probe folder, not the repo, so it is not in the ledger.** The operator files it at `high` before this phase starts (§6).
**Origin:** `docs/checkpoint/REPORT-checkpoint-phase-0.4a.md` §5 — read §5a–5c in full before speccing.

One phase, `core` + `host-claude-code`. Expected changeset: **`minor`** (blocking-transport change, new doctor check) → **v1.69.0**, but confirm from what lands. Phase 2 of the checkpoint arc may run in parallel; it does not depend on this and does not block anything.

---

## 1. Mission

Every CADENCE gate that refuses an action from inside a hook does it one way. `packages/core/src/cli/commands/hook.ts:33-37`, verbatim:

```ts
if (!result.ok) {
  if (result.blockMessage) process.stderr.write(result.blockMessage + '\n');
  // Exit 2 = blocking per Claude Code hook protocol; stderr surfaces to the model.
  process.exitCode = 2;
}
```

That is the transport for `boundaryEnforcement: block` (phase 155), redundant-work block mode, the `SubagentStop` safety net, and the `Stop`-handler block path — every `ok: false` a handler can return.

**Checkpoint Phase 0.4a proved, with independent reproduction, that on Windows without Git Bash detected, Claude Code runs hooks through `powershell.exe`, and PowerShell collapses a child's exit code 2 → 1.** Claude Code's own transcript logged `exitCode: 1` for three consecutive hook calls whose script sent 2. The docs describe this exit as *"a non-blocking error for most hook events: the action proceeds."*

So on that platform, **every CADENCE hook block is fail-open.** The edit proceeds. The transcript shows `Failed with non-blocking status code`. The gate that was supposed to refuse doesn't — and nothing in `doctor`, settle provenance, or the anomaly log records that the block was attempted and ignored. The dispatch-scoped `block` escalation phase 280 shipped, the first-ever `boundary-scan: ran`, phase 289's read-only guard where it rides a hook — inert on that platform, silently.

The same probe proved the alternative works: **`Stop` blocks via `{"decision":"block","reason":...}` on stdout, exit 0** — PASS, with `stop_hook_active: true` on re-blocks and the harness auto-injecting the continuation turn. JSON is honored where exit codes are not.

This is the hook-path twin of the v1.67.0 Windows stdin fix (phase 296: a >32 KB prompt made deep-verify silently degrade to `mock`). Same platform, same shape — a transport detail that turns a gate into a suggestion — found by the same method: measure, don't assume.

---

## 2. Measured context — verify before designing anything

Measured against a `refs/heads/main` tarball, 2026-09-25. **If your measurements differ, yours are correct and this document is stale — say so and proceed from yours.**

### CMD-A — baseline

```bash
node -e "console.log('core',require('./packages/core/package.json').version)"
ls .changeset/*.md 2>/dev/null | grep -v README | wc -l
ls docs/checkpoint/ | grep 0.4a
```

Measured: core `1.68.0`; **0** pending changesets; `REPORT-checkpoint-phase-0.4a.md` and `phase-0.4a-findings.md` present.

### CMD-B — the single transport, and every path that uses it

```bash
sed -n '31,37p' packages/core/src/cli/commands/hook.ts
grep -n "ok: false" packages/core/src/hooks/handlers.ts
grep -n -B12 "ok: false" packages/core/src/hooks/handlers.ts | grep -oE "handle[A-Za-z]+|source: '[a-z.A-Z]+'" | sort -u
```

Measured: **one** translation point (`hook.ts:36`), **five** `ok: false` sites in `handlers.ts`, across three handler families — `hook.preToolEdit` (boundary + redundant-work blocks), `hook.subagentStop` (safety net), and `handleSessionStop`. Every one rides exit 2. No handler emits a JSON decision anywhere.

### CMD-C — stdout is already used, so the seam exists

```bash
grep -n "contextPayload" packages/core/src/hooks/handlers.ts packages/core/src/cli/commands/hook.ts
```

Measured: `contextPayload` (handlers `:17`, `:114`, `:452`) is written to **stdout** via `console.log` at `hook.ts:32`. So the hook command already writes structured content to stdout for the host to consume. **The JSON decision goes through the same seam — but note the ordering: `contextPayload` is printed before the `ok` check.** A block that also carries a `contextPayload` must produce one well-formed stdout document, not two fragments.

### CMD-D — the 0.4a evidence, restated for this phase

```bash
sed -n '/## 3. Verdict table/,/## 4/p' docs/checkpoint/REPORT-checkpoint-phase-0.4a.md
sed -n '/### 5c/,/## 6/p' docs/checkpoint/REPORT-checkpoint-phase-0.4a.md
```

Measured (from the report; the raw `hooks.jsonl` is in `phase-0.4a-findings.md`):
- `Stop` + JSON decision → **PASS**, three blocks, `stop_hook_active: true`, sub-second auto-continuation.
- `Stop` + exit 2 → the 2 **never arrived**; Claude Code recorded `exitCode: 1`; turn ended normally; human had to type the next message.
- Root cause reproduced independently in `$TEMP/probe-repro/`: PowerShell exit-code collapse, Claude Code `2.1.282`, Windows 11, Git Bash not detected (proven by a third-party bash hook failing with a PowerShell parser error in the same session).
- `PreCompact` + exit 2 → NOT TESTED (same likely cause); `PreCompact` + JSON → NOT TESTED (probe didn't implement it).

### CMD-E — the JSON shapes, and a hard rule about verifying them

The raw docs at `https://code.claude.com/docs/en/hooks.md` are the source of truth. **0.4a proved that AI-summarizing fetch tools silently truncate this page mid-table and then confidently mis-state its contents.** Fetch it with `curl` and grep the raw markdown. Do not use a summarizer. Do not trust this document's rendering of the shapes without re-verifying.

What 0.4a captured verbatim, plus the repo's own research notes:

- **Top-level decision** (from the decision-control table row, verbatim in the report): `UserPromptSubmit, UserPromptExpansion, PostToolUse, PostToolUseFailure, PostToolBatch, Stop, SubagentStop, ConfigChange, PreCompact` → `{"decision": "block", "reason": "..."}`.
- **`PreToolUse`** (from `.cadence/research/codex-hooks.md:105-107`, for Claude Code): `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "..."}}`.

```bash
curl -sL https://code.claude.com/docs/en/hooks.md | grep -n -B2 -A14 'permissionDecision\|"decision": "block"' | head -60
sed -n '100,112p' .cadence/research/codex-hooks.md
```

**Confirm both shapes against the raw doc and record the verbatim rows in the DRAFT.** `PreToolUse` is the one that matters most — it is the boundary-block transport — and it uses a different shape from `Stop`.

### CMD-F — CI already runs Windows; the fixture must run there

```bash
sed -n '17,30p' .github/workflows/ci.yml
grep -rn "shell:\|command:" packages/host-claude-code/src/install.ts | head -6
```

Measured: CI matrix is `ubuntu-latest, macos-latest, windows-latest` on Node 22. The installer registers hook commands with **no `shell` field** — so on a Windows runner without Git Bash they take the PowerShell path, which is exactly the path the fixture must exercise. **Determine whether `windows-latest` has Git Bash on PATH** (it usually does, via Git for Windows) — if so, the fixture must force the PowerShell path explicitly rather than rely on the fallback.

### CMD-G — dedup preflight

```bash
node packages/core/bin/cadence.cjs recommendation list --filter-regex "exit.?code|powershell|git bash|json.*decision|hook.*block|shell" --sort-by created
node packages/core/bin/cadence.cjs decision list --filter-text hook
```

Measured pre-write: **no open rec covers this.** Nearest neighbours — `rec-20260701-012` (boundary block mode, shipped: the thing that's inert) and `rec-20260916-004` (verifier children fire hooks, open: adjacent, separate).

---

## 3. Decisions to record

### D-BN — JSON only, or JSON plus exit 2?

1. **JSON decision on stdout, exit 0** — the documented, probe-verified transport. Clean.
2. **JSON on stdout *and* exit 2** — belt-and-braces; the JSON is honored on every shell, the exit code additionally on shells that propagate it.
3. **Exit 2 only, plus `shell: "bash"` in the installer** — force the propagating shell.

I lean **(1)**, and I'd argue against (2) despite its appeal: the docs say stdout that Claude Code treats as plain text on a non-zero exit is a *non-blocking error*, so a JSON body paired with exit 2 may be parsed differently per event, and the interaction is undocumented. **One transport, verified.** (3) is disqualified: it makes CADENCE's gates depend on Git Bash being installed, which is precisely the environmental assumption that just failed silently — and the installer can't verify the user has it.

If you take (2), **prove per event** that JSON + exit 2 is honored identically to JSON + exit 0, on both shells. Undocumented interactions are where the last two Windows bugs lived.

### D-BO — What does a blocked-but-ignored hook record?

Today, when PowerShell collapses the exit code, nothing on CADENCE's side knows the block was ignored. After this phase JSON should be honored — but the *class* of failure (transport says block, host proceeds) is worth detecting, not just fixing.

Options: **(a)** nothing — the fix removes the failure mode; **(b)** a `doctor` check that reports the resolved hook shell and warns if it's PowerShell (per D-BP); **(c)** a settle-time anomaly if a block was emitted for an edit that nonetheless landed in the diff.

I lean **(b) now, (c) filed**. (c) is genuinely valuable — it's the hook-path analogue of `empty-diff` provenance — but it needs the block emission to be recorded somewhere settle can read, which is a state-schema change and its own phase.

### D-BP — Does `doctor` learn the hook shell?

The probe found Git Bash absence only from a *third-party* hook's error text. CADENCE has no view of which shell its hooks run under. A `hook-shell` doctor check — reading the installed hook entries for a `shell` field and, absent one, reporting *"defaults to bash, falls back to PowerShell on Windows without Git Bash — exit-code blocking is unreliable on that path"* — is cheap, informational, and would have surfaced this months ago.

**Determine whether the resolved shell is observable** (a `SessionStart` hook could record `$SHELL`/`$PSVersionTable` presence into state). If it's only inferable, the check states the rule rather than the fact, and says so.

### D-BQ — `Stop` and the checkpoint arc's Phase 3

Phase 3 (not yet authorized) will add a `Stop` hook that blocks via JSON. After this phase, CADENCE's existing `Stop` handler also blocks via JSON. **Two `Stop` hooks, both emitting JSON decisions, from the same installer.** Decide now whether Phase 3's hook is a *separate* registered entry or a branch inside the existing `handleSessionStop` — the latter avoids two decisions racing on one event, and the 0.4a finding that the harness auto-injects a continuation turn means two blockers could ping-pong. Record the direction; don't build Phase 3 here.

---

## 4. Phase — Hook blocking via JSON decisions

**Objective.** Every `ok: false` a CADENCE hook handler returns is delivered to Claude Code as a JSON decision on stdout, honored regardless of the shell the hook runs under; a fixture proves it through the PowerShell path.

**Investigate first, in this order:**

1. **Verify the per-event JSON shapes** against the raw doc via `curl` (CMD-E). Record verbatim. This is not optional — the probe proved summarizers get this page wrong.
2. Enumerate which event each of the five `ok: false` sites fires on, and map each to its shape (`PreToolUse` → `hookSpecificOutput.permissionDecision`; `Stop`/`SubagentStop`/`PostToolUse` → top-level `decision`).
3. Determine whether `windows-latest` has Git Bash on PATH (CMD-F) — if yes, the fixture must force PowerShell.
4. Resolve the `contextPayload` + block ordering (CMD-C) so one stdout document results.

**Acceptance criteria** (Given/When/Then in the DRAFT; anchor to committed tests and real hook output, never SUMMARY prose — `dec-20260812-001`. **Numeric AC ids only.**)

- **AC-1** Given `boundaryEnforcement: block` and a `PreToolUse` edit outside declared `files:`, when the hook runs, then stdout carries `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": <blockMessage>}}`, exit code per D-BN, and **the edit is refused by Claude Code** — proven by a real hook invocation capturing the host's response, not by asserting the stdout string alone.
- **AC-2** Given the `SubagentStop` safety net and `handleSessionStop` block paths, when each fires `ok: false`, then stdout carries the top-level `{"decision": "block", "reason": ...}` shape and the stop is blocked.
- **AC-3** Given the same block scenarios executed **through `powershell.exe`** (forced via `shell: "powershell"` in a test fixture's settings, or an equivalent that reproduces the 0.4a collapse), when the hook runs, then the block is **honored** — the exact case that failed before. This AC is the phase.
- **AC-4** Given a handler returning `ok: true` with a `contextPayload`, when the hook runs, then stdout is **byte-identical** to pre-change. Capture fixtures first. Non-blocking paths must not move.
- **AC-5** Given a handler returning `ok: false` **and** a `contextPayload`, when the hook runs, then stdout is one well-formed document the host accepts (per investigation step 4), and a test pins it.
- **AC-6** Per D-BP: `cadence doctor` reports the hook shell posture; on a PowerShell-default install it states that exit-code blocking is unreliable and that CADENCE blocks via JSON. `docs/reference/commands.md`'s doctor table gains the row in the same commit.
- **AC-7** The `windows-latest` CI leg runs the PowerShell-path fixture (AC-3) — not skipped, not `continue-on-error`. If the runner can't be made to take the PowerShell path, the DRAFT records that and the fixture runs against a local reproduction with captured output committed as evidence.
- **AC-8** `hook.ts`'s comment *"Exit 2 = blocking per Claude Code hook protocol"* is replaced with an accurate statement of the transport actually used, citing the 0.4a report.

**Files.** `packages/core/src/cli/commands/hook.ts` · `packages/core/src/hooks/handlers.ts` (return shape may gain an event-aware decision field) · `packages/core/src/hooks/dispatcher.ts` · `packages/host-claude-code/src/install.ts` (only if D-BN option 3, which is disqualified) · `packages/core/src/doctor/run.ts` + `host-hooks.ts` (D-BP) · `docs/reference/commands.md` · `docs/host-adapters.md` · `docs/claude-code.md` · tests: new JSON-decision suite, PowerShell-path fixture, byte-identical fixtures for non-block paths.

**Non-goals.** No `PreCompact` handler (Phase 4, not authorized). No checkpoint `Stop` gate (Phase 3, not authorized — D-BQ records direction only). No change to what *causes* a block, only how it's transported. No `host-codex` changes unless investigation shows it shares the transport — if it does, file it; Codex's hook model (`apply_patch` matcher, `.cadence/research/codex-hooks.md`) differs and deserves its own verification.

---

## 5. Standing rules

- **Numeric AC ids only.** `AC-1`, `AC-2`.
- **Raw source, not a summarizer.** The hooks doc is fetched with `curl` and grepped. 0.4a's mid-report correction exists because a summarizing fetch got this exact page wrong three times.
- **Measure, never predict.** Every figure carries the command that produced it. If §2's numbers moved, yours are correct.
- **Prove the collapse red first.** Before changing the transport, a fixture reproduces exit 2 → 1 through PowerShell and shows the edit proceeding. That is the red state.
- **One transport, verified per event.** Don't pair JSON with exit 2 unless proven equivalent on both shells.
- **Non-block paths are byte-identical.** AC-4 is the regression bar.
- **The Windows CI leg runs the fixture.** A fix for a Windows-only fail-open that isn't tested on Windows isn't a fix.
- **Config/settings changes are their own commit.**
- **Tier `complex`.** This changes how every CADENCE gate refuses. It gets real `deep-verify` and `code-review`.
- **Do not force-settle.** If this phase needs `--force`, stop and report.
- **Declare `stop:` on every task**; record at least one with `--execution dispatch`.
- **Honest negative results are the goal.** "The `PreToolUse` deny shape doesn't work as documented on 2.1.282" would be a finding worth more than the fix.

---

## 6. Ledger work — file, never self-apply

**The operator files the backing rec before this phase starts**, since the finding originated outside the repo:

```bash
node packages/core/bin/cadence.cjs recommendation add \
  --title "Hook blocks fail open on Windows/PowerShell: exit code 2 collapses to 1, every block-mode gate is inert" \
  --summary "..." \
  --priority high --readiness ready-for-cadence-spec \
  --area hooks,gates,host-claude-code --file packages/core/src/cli/commands/hook.ts \
  --evidence "checkpoint 0.4a probe: Claude Code 2.1.282 transcript recorded exitCode:1 for three hook calls that sent 2, PowerShell path (Git Bash undetected); Stop via JSON decision PASSED in the same session; collapse reproduced independently in \$TEMP/probe-repro (docs/checkpoint/REPORT-checkpoint-phase-0.4a.md §5c)" \
  --scout-id scout-20260925-hook-json-block
```

Then promote + `spec new --from-rec`. Dedup preflight per CMD-G first, verbatim output pasted.

**Also file** (operator): D-BO option (c) — settle-time detection of an emitted-but-ignored block — and, if investigation shows `host-codex` shares the transport, a separate rec for it.

**No hand-edits to `.cadence/intelligence/`.**

---

## 7. Report-back protocol

1. Verbatim `cadence doctor`, before and after.
2. CMD-A through CMD-G output, with anything that moved from §2 called out.
3. **The verbatim JSON shapes from the raw hooks doc**, per event, as fetched with `curl` — and whether they match what this document and `codex-hooks.md` recorded.
4. Dedup preflight, before any ledger write.
5. Which option was taken for **D-BN through D-BQ**, with decision ids.
6. **The red fixture**: exit 2 collapsing to 1 through PowerShell, the edit proceeding — captured before the fix.
7. **AC-3's result**: the same scenario honored through PowerShell after the fix — captured, with the host's actual response.
8. Whether `windows-latest` took the PowerShell path natively or had to be forced, and how.
9. Whether AC-4's byte-identical fixtures held.
10. Whether `host-codex` shares the transport, and the rec id if so.
11. The resulting version and changeset level.
12. Any gate bypass used, with flag and reason. If `--force` was used, say so first.

---

## 8. Framing

CADENCE's argument is that a gate is a thing with an exit code, and a suggestion is a thing with a prompt. For ten releases that argument has been tested inward — grades that ignored bypasses, a scanner that flipped, a parser that skipped, a verifier that silently went mock on a long prompt.

This one is the sharpest version yet, because it is *literally* about the exit code. Every hook-path refusal CADENCE makes is delivered as `process.exitCode = 2`, with a comment citing the protocol. On a common platform configuration, the shell between CADENCE and Claude Code rewrites that 2 to a 1, and the protocol says a 1 means *proceed*. The gate becomes a notice in the transcript. Nothing records that it was meant to be a wall.

It was found by a probe built to test something else, in a folder that will be deleted. The report that found it corrected itself once, against the raw source, when a summarizing tool got the documentation wrong. That's the method working exactly as designed — and it's why this phase carries a rule about `curl`.

Move the transport to the one the probe proved is honored. Test it on the platform that broke. Then the checkpoint arc's Phase 3 builds on the same primitive, verified once, for both.
