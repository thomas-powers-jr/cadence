# Checkpoint Phase 0 — interactive findings (M4, M5, M6; M10 partial)

Source data: `~/.cache/checkpoint-probe/hooks.jsonl` (10 lines) and
`~/.cache/checkpoint-probe/statusline.jsonl` (138 lines), captured from a throwaway
session opened correctly in this worktree (`C:\Users\softw\projects\cadence\.claude\worktrees\checkpoint-phase-0-1`).
First attempt failed silently because the throwaway session was opened in the wrong
folder (the main `cadence` checkout, which has no probe hooks) — see the "Deviations"
note below. Second attempt, opened with an explicit `ls scripts/checkpoint-probe` sanity
check first, produced the data below.

## M4 — does `session_id` survive `/clear`/`/compact`?

Evidence, in order from `hooks.jsonl`:

| Event | session_id |
|---|---|
| `Stop` (before `/compact`) | `614a2625-4798-442c-bad2-1b8d6c5985ec` |
| `PreCompact` (trigger: `manual`) | `614a2625-4798-442c-bad2-1b8d6c5985ec` |
| `SessionStart` (source: `compact`) | `614a2625-4798-442c-bad2-1b8d6c5985ec` |
| `PostCompact` (trigger: `manual`) | `614a2625-4798-442c-bad2-1b8d6c5985ec` |
| `SessionStart` (source: `clear`) | `772561bf-115c-42de-9275-9b2bd97508af` |

**`/compact` — survives.** Same `session_id` before, during, and after a manual compaction.
**`/clear` — does not survive.** A new `session_id` is assigned.

This directly answers the state-machine design's open question ("keyed by project, not
`session_id`, pending M4"): the premise holds for `/clear` (a session-keyed state file
would be orphaned) but not for `/compact` (session-keying would actually work there). The
design's project-keyed choice is the right one for both cases, since it doesn't depend on
which reset path was taken.

## M5 — `Stop` payload key set

Two `Stop` events captured, both with the same key set:
```
session_id, transcript_path, cwd, scratchpad_dir, prompt_id, permission_mode, effort,
hook_event_name, stop_hook_active, last_assistant_message, background_tasks,
session_crons, probe_ts (probe_ts is our own addition, not part of the real payload)
```

`stop_hook_active` (`false` in both) and `last_assistant_message` (present, full text, not
truncated — one instance was several thousand characters) are both **confirmed present**,
matching the design reference's assumption. Two fields not mentioned anywhere in the
handoff's documented facts: `background_tasks` and `session_crons` (both empty arrays in
these samples, but present as keys) — worth recording as extra payload surface for any
future schema that reads `Stop`.

## M6 — `idle_prompt` timing relative to the last `Stop`

`Stop` at `probe_ts=1790120546679`, `Notification` (`idle_prompt`, message "Claude is
waiting for your input") at `probe_ts=1790120609073`. Gap: **62,394 ms (~62.4 seconds)**.
One data point only — not enough to claim a fixed delay, but confirms the notification is
tied to elapsed idle time after a `Stop`, not fired immediately.

## M3 — PreCompact / PostCompact / SessionStart(compact|clear) payload shapes

- `PreCompact`: `{ session_id, transcript_path, cwd, scratchpad_dir, prompt_id, hook_event_name, trigger, custom_instructions, probe_ts }`. `trigger` was `"manual"` this pass (this session's `/compact` was manually invoked); `custom_instructions` was `null`.
- `SessionStart` (`source: "compact"`): same base fields plus `model`. No `context_window`/resume-relevant field on this event itself — the design's plan to inject a resume core here still needs its own explicit hook-response mechanism, not something riding along on this payload.
- `PostCompact`: same base fields plus `trigger` and, notably, a full **`compact_summary`** field — Claude Code's own generated compaction summary, delivered in full (the one captured here ran to several thousand characters of structured analysis). This is new, undocumented-in-the-handoff payload richness: a `PostCompact` hook can read the actual summary text the platform produced, not just know that compaction happened.
- **Observed order**: `PreCompact` → `SessionStart(compact)` → `PostCompact`, by `probe_ts` (1790121025779 → 1790121142562 → 1790121144943). The handoff's design reference didn't state where `PostCompact` falls relative to `SessionStart(compact)` — now confirmed: `PostCompact` fires *after* `SessionStart(compact)`, roughly 2.4 seconds later in this sample. Any design that assumes resume-injection happens strictly before the compaction summary is available should account for this ordering.
- `SessionStart` (`source: "clear"`): same base fields, no `model` key present this time (present for `startup` and `compact` sources, absent for `clear` in this sample) — worth re-checking on a larger sample before treating as a firm rule.

## M2 (cross-check against the statusline log)

`context_window.used_percentage` is `null` on the very first 1-2 statusline renders of a
fresh session (`current_usage: null` alongside it), then becomes a real number (observed
range 0–11% across 138 samples in this short session). The design reference's premise
("statusline exposes `context_window.used_percentage`") **holds**, with the caveat that it
starts `null` before the platform has computed anything — a consumer polling this value
needs to treat `null` as "not yet known," not as `0%`.

## M10 — autocompact override (partial; auto-trigger not yet reached)

**Not captured this pass.** The compaction this throwaway session performed was
**manual** (`/compact`, `trigger: "manual"`), not an automatic threshold-triggered one.
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` behavior specifically requires an *auto*-triggered
`PreCompact` (`trigger: "auto"`), which needs the session to actually fill up enough
context on its own — the plan already flagged this as best-effort and potentially
taking a long time. Recorded here as an honest, explicit gap, not rounded up to a pass:
**M10 remains open pending a session that reaches real auto-compaction.**

## Platform-fact pass/fail table

| Documented fact | Status | Evidence |
|---|---|---|
| Hook events available: `Stop`, `PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`, `Notification` | **PASS** | All six appear in `hooks.jsonl` with the expected shapes. |
| `SessionStart` matchers include `startup`, `resume`, `clear`, `compact`, `fork` | **PARTIAL PASS** | `startup`, `compact`, `clear` directly observed. `resume`, `fork` not exercised this pass (not part of Task 0.4's steps). |
| `PreCompact` blocks on exit 2; matcher values `manual`, `auto` | **PARTIAL** | `manual` trigger observed directly. `auto` not observed (needs real threshold, see M10). Blocking-on-exit-2 **NOT TESTED** — our probe is a passive observer by design (Task 0.2); Task 0.4a's active block-probe was not run this pass. |
| `Stop` blocks on exit 2, or JSON block decision | **NOT TESTED (direct)**, but see circumstantial evidence below | Not independently forced. |
| `additionalContext`/`systemMessage`/stdout capped at 10,000 chars, overflow to a 2,000-char preview file | **NOT TESTED** | Would require deliberately oversized hook output; out of scope for the passive probe. |
| Docs recommend factual, non-imperative phrasing for injected context | **N/A (guideline, not a testable platform fact)** | — |
| Transcript file written asynchronously; `Stop` provides `last_assistant_message` | **PASS** | Confirmed present and complete in both captured `Stop` events (M5). |
| No documented mechanism for a hook/model to invoke `/compact`/`/clear` | **CONSISTENT (not contradicted)** | Nothing in the captured payloads suggests such a mechanism; a human still had to run both commands. |

**Circumstantial evidence on the "non-2 exit codes don't block" claim:** during this pass, the
pre-existing CADENCE-managed `Stop` hook (unrelated to our probe) failed with a **non-blocking
status code** (`hook dispatch failed: .cadence/ exists but state.json is missing` — a known,
separate issue: this worktree never ran `cadence onboard`) at the same time our own probe's
`Stop` entry succeeded silently. The session was not blocked or stopped by that failure — it
kept going normally. This is consistent with "only exit 2 blocks," though it wasn't a
deliberately engineered test of that specific fact.

**Known upstream issues** (#91910 subagent compaction, #43733 injected-context consistency,
#36381 `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`): none were exercised this pass (no subagent
compaction occurred; the override needs the still-pending auto-trigger case). Not contradicted,
not confirmed — recorded as not tested rather than assumed either way.

## Deviations

- **First interactive attempt produced zero data**, silently. Root cause (confirmed via
  screenshot the operator provided): the throwaway session was opened in the main
  `cadence` checkout, not this worktree — a different `.claude/settings.json` with no
  probe hooks at all. No error was visible because there was nothing to error; the
  probe simply never existed in that session's hook config. Fixed by giving the
  operator the exact worktree path and an explicit `ls scripts/checkpoint-probe`
  sanity check to run *before* anything else next time — worth carrying forward as a
  standing instruction for any future "open a session elsewhere and do X" step in this
  or similar plans.
- **Bonus finding, incidental to this phase:** a fresh git worktree/clone without
  `cadence onboard` run produces a real, currently-reproducible `Stop`-hook error
  (`.cadence/ exists but state.json is missing`) — non-blocking, but visible on every
  turn. Not something checkpoint owns or should fix; noted here only because the probe
  incidentally surfaced it, and it's a plausible candidate for "Proposed for operator
  filing" below.
