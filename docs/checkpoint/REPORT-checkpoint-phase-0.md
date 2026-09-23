# REPORT — checkpoint Phase 0 (premise verification)

## 1. `--force` and gate bypasses

None. Phase 0 has no interaction with any CADENCE gate at all — it is pure measurement plus temporary, self-removing tooling (probe hooks and a probe statusline), never touching `.cadence/` state.

## 2. Premise status

Pass/fail/not-tested table for each documented platform fact, evidence-backed (full detail and raw payload shapes in `docs/checkpoint/phase-0-interactive-findings.md`):

| Documented fact | Status | Evidence |
|---|---|---|
| Hook events available: `Stop`, `PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`, `Notification` | **PASS** | All six observed firing with expected payload shapes in `hooks.jsonl`. |
| `SessionStart` matchers include `startup`, `resume`, `clear`, `compact`, `fork` | **PARTIAL PASS** | `startup`, `compact`, `clear` directly observed with correct `source` field. `resume`, `fork` not exercised. |
| `PreCompact` blocks on exit 2; matcher values `manual`, `auto` | **PARTIAL** | `manual` trigger observed. `auto` not reached (see M10 below). Blocking-on-exit-2 itself **NOT TESTED** — the probe is a passive observer by design; the optional active block-probe (Task 0.4a) was not run, by explicit operator choice, to avoid the risk of wedging a session. |
| `Stop` blocks on exit 2, or with a JSON block decision | **NOT TESTED (direct)** | Not independently forced. Circumstantial evidence only (see below). |
| `additionalContext`/`systemMessage`/stdout capped at 10,000 characters, overflow to a file with a 2,000-character preview | **NOT TESTED** | Would require deliberately oversized hook output; out of scope for a passive probe. |
| Docs recommend factual, non-imperative phrasing for injected context | **N/A** | A style guideline, not a testable platform fact. |
| Transcript file written asynchronously; `Stop` provides `last_assistant_message` | **PASS** | Confirmed present and complete (full text, not truncated) in two captured `Stop` events. |
| No documented mechanism for a hook or the model to invoke `/compact`/`/clear` | **CONSISTENT (not contradicted)** | Nothing in captured payloads suggests such a mechanism; a human ran both commands manually, as expected. |

**Circumstantial evidence, not a direct test:** during the interactive pass, the pre-existing CADENCE-managed `Stop` hook (unrelated to this work) failed with a non-blocking status code on every turn (a fresh-worktree-needs-`cadence onboard` issue — see §7) while our own probe's sibling `Stop` entry succeeded silently, and the session was never actually stopped or blocked. Consistent with "only exit 2 blocks," though not a deliberately engineered test of that specific claim.

**Known upstream issues** (#91910, #43733, #36381): none were exercised this pass — no subagent compaction occurred, and the `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` case needs the still-open auto-compaction trigger (M10). Recorded as not tested, not assumed either way.

## 3. Acceptance criteria

| AC | Status | Evidence | Commit |
|---|---|---|---|
| AC 1 — M1–M10 executed, each command and raw output in the report-back | **PASS (M1, M7, M8, M9 full; M2–M6 full; M10 partial — see §4)** | See §4 below | `8ecf97da8d74abfab3b318ba90f1fc56c2910bed` (autonomous), `8dfa3073e8ed2b77dc8f258f6404714ad63cd22d` (interactive) |
| AC 2 — pass/fail table for every documented platform fact | **PASS** | §2 above, cross-referenced against the installed version (`2.1.278`) | `8dfa3073e8ed2b77dc8f258f6404714ad63cd22d` |
| AC 3 — M4 answered for both `/clear` and `/compact`, with probe log evidence | **PASS** | `/compact`: `session_id` unchanged across `Stop → PreCompact → SessionStart(compact) → PostCompact`. `/clear`: `session_id` changes at `SessionStart(clear)`. Both cited by exact `session_id` value in `phase-0-interactive-findings.md` §M4. | `8dfa3073e8ed2b77dc8f258f6404714ad63cd22d` |
| AC 4 — existing `/cadence-handoff` output structure captured as a section list, with path + commit hash | **PASS** | `.claude/commands/cadence-handoff.md` / `cadence-resume.md`, commit `ff35843b29706cd3ed394a49ffae80ec5fae7671`; live section list captured from `.cadence/handoff/SESSION-2026-09-22-pr521-merged-checkpoint-proposal-dropped.md` (commit `3bc20d26`) | `8ecf97da8d74abfab3b318ba90f1fc56c2910bed` |
| AC 5 — live CLI surface from `--help`; no flag in the report not in that output | **PASS** | `cadence --help`, `cadence handoff --help`, `cadence resume --help` output captured verbatim; every flag referenced elsewhere in this work traces back to it | `8ecf97da8d74abfab3b318ba90f1fc56c2910bed` |
| AC 6 — probe hooks/statusline removed in a dedicated config-only commit, hash reported | **PASS** | `git diff 3803113fe7720d84b82e47d4b610ed94ae9ffb51 -- .claude/settings.json` → no output (byte-exact match to the pre-probe baseline) | `a825329b088ddc2fa0ac4bdcca7a683ccae663c6` |

## 4. Measurements

| Id | Command | Result |
|---|---|---|
| M1 | `claude --version` | `2.1.278 (Claude Code)` |
| M2 | Statusline probe, 138 samples | `context_window.used_percentage` present; `null` on the first render(s) of a session, then a real number (0–11% observed). Premise holds, with the "starts null" caveat noted. |
| M3 | Hook probe across `Stop`, `SessionStart`, `PreCompact`, `PostCompact`, `Notification`, `UserPromptSubmit` | All six captured with full payload shapes; see `phase-0-interactive-findings.md` §M3 for field-by-field detail, including the previously-undocumented `PostCompact.compact_summary` field and the observed `PreCompact → SessionStart(compact) → PostCompact` ordering. |
| M4 | `session_id` continuity across `/compact` and `/clear` | `/compact` survives (same id); `/clear` does not (new id assigned). |
| M5 | `Stop` payload key set | `stop_hook_active` and `last_assistant_message` both present and complete; also observed (undocumented) `background_tasks`, `session_crons`. |
| M6 | Gap between last `Stop` and next `idle_prompt` `Notification` | 62,394 ms (~62.4s), one data point. |
| M7 | `/cadence-handoff` output structure | Six real section headers captured verbatim (see AC 4); this repo's checkpoint schema (Phase 1) is built directly on this text. |
| M8 | Live Cadence CLI surface | Full `--help` output for the root command plus `handoff`/`resume` subcommands captured verbatim. |
| M9 | Canonical package/repo | `@thomas-powers-jr/cadence-core` at `1.67.2` (matches this repo); `@manehorizons/cadence-core` stale at `1.53.0`. Answers Open Decision 2. |
| M10 | Autocompact override behavior at real auto-triggered `PreCompact` | **Not reached.** The only compaction this pass produced was manual (`trigger: "manual"`). Per operator decision (this session), not pursued further — recorded as an honest, explicit gap rather than a forced pass. |

`CLAUDE_PLUGIN_DATA` (design-premise finding, not a numbered M-item): unset in this environment; the design's configured-path fallback is the only live branch here.

## 5. Deviations

- **Probe scripts written in Node, not bash+jq**, because this machine is Windows and hooks are spawned via a win32 shell with no Git-Bash-`jq` path guarantee.
- **Statusline probe made append-only (JSONL), not overwrite-only**, after recognizing during planning review that an overwrite-only file could never answer M10 (no way to correlate "value at the moment of `PreCompact(auto)`" against a single last-write-wins snapshot).
- **AC 2's blocking-semantics facts recorded as NOT TESTED by default**, rather than inferred from the passive probe's absence of errors. The optional active block-probe (Task 0.4a) that could have tested this directly was intentionally not run, per explicit operator decision, due to its risk of wedging a session.
- **The first interactive attempt produced zero data, silently**, because the throwaway session was opened in the main `cadence` checkout instead of this worktree — a different `.claude/settings.json` with no probe hooks at all, so there was nothing to error. Root-caused via a screenshot the operator provided showing an unrelated `scripts/` directory listing. Fixed by giving the operator the exact worktree path plus an explicit `ls scripts/checkpoint-probe` sanity check to run before anything else. Worth carrying forward as a standing instruction for any future plan step that says "open a session elsewhere and do X."
- **M10 and the active block-probe (Task 0.4a) both left incomplete** by explicit, informed operator choice (see AC 2, above) rather than time running out unnoticed.

## 6. Answers needed

Decisions 1, 3, 4, and 5 were already answered by the operator during Phase 1 planning (see `docs/checkpoint/REPORT-checkpoint-phase-1.md`). Only Decision 6 (threshold unit: percentage vs. absolute tokens vs. both) and Decision 7 (Scout ID for any recommendations batch from this work) remain open. Neither blocks anything already built; both are inputs to the not-yet-authorized Phase 2 (sensor and state store).

## 7. Proposed for operator filing

Tagged `<SCOUT-ID>` per the handoff's ledger instructions (Decision 7 not yet answered). Not filed — proposed only; no `cadence recommendation add` was run.

1. **Fresh git worktree/clone produces a recurring, non-blocking `Stop`-hook error.** Evidence: every `Stop` in the interactive pass logged `hook dispatch failed: .cadence/ exists but state.json is missing (likely a fresh git worktree or clone — state.json is gitignored, not copied by git) — run \`cadence onboard\` to bootstrap it.` The message is correct and actionable, but it fires on *every single turn* in an un-onboarded worktree rather than once — a real, currently-reproducible rough edge for the exact workflow (isolated worktrees for phase work) this repo's own CLAUDE.md prescribes as standard practice. `<SCOUT-ID>`
2. **A wrong-directory session produces zero signal that anything is wrong**, which cost real time in this phase (see §5). Not a checkpoint-specific problem, but a general observation: when a project-scoped hook command references a script that doesn't exist in the current tree at all, there's no operator-visible warning distinguishing "no hooks configured here" from "hooks configured but silently no-oping." A cheap mitigation for any future multi-worktree instructions: always name the exact absolute path and ask for a one-line sanity check (e.g. `ls <expected-file>`) as the literal first command in a new session, before anything else. `<SCOUT-ID>`
