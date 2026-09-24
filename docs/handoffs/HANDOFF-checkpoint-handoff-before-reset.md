# Handoff: Handoff-Before-Reset Checkpointing (working name `checkpoint`)

> Working name is internal only. No public name until the full collision check (npm, GitHub, trademark, SEO) is filed.

## Mission

Replace lossy `/compact` summarisation with a gated checkpoint. When session context passes a configurable threshold, Claude Code writes a Cadence handoff while it still holds the full context. A deterministic validator must accept that handoff before any reset is allowed. After `/clear` (or `/compact`), the settled handoff is rehydrated through `cadence resume`.

The thesis: `/compact` is a shape, because it relies on a summariser's judgement. This work turns it into a gate: the handoff must validate, and nothing auto-passes.

**Authorised scope for this handoff: Phase 0 and Phase 1 only.** Phases 2–6 are described so the design is visible. Each needs an explicit operator go.

---

## Measured context

### Documented platform facts

These come from the official hooks reference, https://code.claude.com/docs/en/hooks. They are sourced, not measured locally. Phase 0 re-verifies each one against the installed version.

- Hook events available: `Stop`, `PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`, `Notification`.
- `SessionStart` matchers include `startup`, `resume`, `clear`, `compact`, `fork`.
- `PreCompact` blocks compaction on exit 2. Its matcher values are `manual` and `auto`.
- `Stop` blocks on exit 2, or with a JSON block decision. This prevents stopping and continues the conversation.
- `additionalContext`, `systemMessage` and plain stdout are each capped at 10,000 characters. Overflow is written to a file with a preview of up to 2,000 characters, and Claude is not instructed to read that file.
- The docs recommend factual phrasing for injected context. Imperative, system-command-style text can trigger prompt-injection defences.
- The transcript file is written asynchronously and may lag. `Stop` provides `last_assistant_message`.
- No documented mechanism lets a hook or the model invoke `/compact` or `/clear`.

### Known upstream issues to design around

- anthropics/claude-code#91910: during subagent compaction, `PreCompact` and `SessionStart(compact)` fire with the parent's `session_id`, `transcript_path` and `cwd`. The payload carries no agent fields.
- anthropics/claude-code#43733: whether Claude acts on injected context after `SessionStart(compact)` is reported as inconsistent.
- anthropics/claude-code#36381: `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` was reported ignored for the main session on 2.1.79.

### To measure in Phase 0

Every one of these is a command, not a figure. Record each output verbatim in the report-back.

| Id | What | Command |
|---|---|---|
| M1 | Installed Claude Code version | `claude --version` |
| M2 | Statusline payload shape | Temporary statusline: `#!/bin/sh` / `tee "$HOME/.cache/checkpoint-probe/statusline.json" >/dev/null; echo probe`, then `jq '.context_window' "$HOME/.cache/checkpoint-probe/statusline.json"` |
| M3 | Hook input shapes | Probe hook on `Stop`, `SessionStart`, `PreCompact`, `PostCompact`, `Notification`, `UserPromptSubmit`: `jq -c '. + {probe_ts: now}' >> "$HOME/.cache/checkpoint-probe/hooks.jsonl"` |
| M4 | Does `session_id` survive `/clear`? Does it survive `/compact`? | `jq -r '[.hook_event_name, (.source // .trigger // "-"), .session_id] \| @tsv' "$HOME/.cache/checkpoint-probe/hooks.jsonl"` |
| M5 | Presence of `stop_hook_active` and `last_assistant_message` on Stop | `jq -c 'select(.hook_event_name=="Stop") \| keys' "$HOME/.cache/checkpoint-probe/hooks.jsonl" \| sort -u` |
| M6 | When `idle_prompt` fires relative to the last Stop | `jq -r 'select(.hook_event_name=="Stop" or .hook_event_name=="Notification") \| [.hook_event_name, (.notification_type // .message // "-"), .probe_ts] \| @tsv' "$HOME/.cache/checkpoint-probe/hooks.jsonl"` |
| M7 | Existing `/cadence-handoff` and `/cadence-resume` definitions | `grep -rlE "cadence-(handoff\|resume)" ~/.claude .claude 2>/dev/null` |
| M8 | Live Cadence CLI surface | `cadence --help`; then `--help` on each handoff- or resume-related subcommand that actually appears. Do not assume subcommand names. |
| M9 | Canonical package and repo | `curl -sS "https://registry.npmjs.org/@manehorizons/cadence-core" \| jq '."dist-tags".latest'` and `curl -sS "https://registry.npmjs.org/@thomas-powers-jr/cadence-core" \| jq '."dist-tags".latest'` |
| M10 | Autocompact override behaviour on the installed version | Set `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` in a throwaway session. Record the M2 `used_percentage` at the moment `PreCompact` (`auto`) fires in M3. |

Remove the probe hooks and the probe statusline after Phase 0, in their own commit.

---

## Design reference

This section is not authorised work. It records the target shape.

### State machine

The state file is keyed by **project**, not by `session_id`, pending the M4 result. It lives under `${CLAUDE_PLUGIN_DATA}` or a configured path.

```
idle ──(Stop, usage ≥ threshold)──▶ armed
armed ──(Stop, handoff file mtime > armedAt)──▶ written
written ──(validator pass)──▶ settled
written ──(validator fail)──▶ armed        (block with the specific diagnostics)
settled ──(SessionStart clear|compact)──▶ reset
reset ──(injection delivered + one-shot reinject consumed)──▶ resumed ──▶ idle
```

- Illegal transitions are rejected and logged. Transitions are atomic: write to a temp file, then rename.
- `settled → reset` is a single-winner transition. Only the first `SessionStart` after settlement may inject. This guards against #91910.
- There is a re-block ceiling (configurable). When it is hit, the stop is released with a `systemMessage` and the release is recorded as a gate bypass.

### Event map

| Event | Role |
|---|---|
| statusline (settings) | Sensor. Writes `{used_percentage, ts}` to state while still rendering normally. |
| `Stop` | Arm (instruct the handoff write), then gate (run the validator; block with diagnostics or settle). |
| `PreCompact` `manual` | Block unless the state is `settled`. An explicit bypass is allowed and recorded. |
| `PreCompact` `auto` | Fail open with a `systemMessage` warning. Never strand a session at the window limit. |
| `SessionStart` `clear\|compact` | Rehydrate. Run the resume CLI (surface per M8) and inject a resume core of at most 10,000 characters, factually phrased, with a pointer to the full handoff path. |
| `UserPromptSubmit` | One-shot reinject on the first prompt after reset, if not yet consumed (mitigates #43733). |
| `Notification` `idle_prompt` | Optional, opt-in only. `tmux send-keys -t "$TMUX_PANE" "/clear" Enter` when `settled`. |

---

## Open decisions (operator-reserved)

1. **Code location.** Choose one: an adapter package in the Cadence monorepo, so the handoff validator can share a schema with the phase validator, or a standalone plugin repo. Phase 1 does not start until this is answered.
2. **Canonical package and repo.** Memory holds both `@manehorizons/cadence-core` / `manehorizons/cadence` and `@thomas-powers-jr/cadence-core` / `thomas-powers-jr/cadence`. M9 measures both; the operator picks.
3. **Validator schema source.** Choose one: derive the schema from the existing `/cadence-handoff` template captured in M7, or define a new checkpoint-specific schema with a dedicated resume-core section.
4. **Empty open-decisions.** Should a handoff with no open decisions carry an explicit `None` (validator enforces presence), or may it omit the section?
5. **Section matching.** Should header matching be strict (exact text and order) or tolerant (case-insensitive, order-free)?
6. **Threshold unit.** Percentage of the window, absolute tokens, or both. This matters for 1M-context sessions.
7. **Scout ID** for any recommendations batch that comes out of this work.

---

## Phase 0: Premise verification (investigation)

A no-code outcome is valid. If any premise fails, stop and report rather than design around it. Examples:

- `context_window.used_percentage` is absent from the statusline payload.
- `Stop` cannot block.
- `SessionStart` does not fire on `/clear`.

### Acceptance criteria

1. M1–M10 are executed. Each command and its raw output appear in the report-back.
2. The report-back contains a pass/fail table for every documented platform fact above, checked against the installed version.
3. M4 is answered for both `/clear` and `/compact`, with the probe log lines as evidence.
4. The existing `/cadence-handoff` output structure is captured as a section list, with file path and commit hash as evidence, or it is reported as not found.
5. The live Cadence CLI surface for handoff and resume is captured from `--help` output. No flag appears in the report that is not in that output.
6. Probe hooks and probe statusline are removed in a dedicated config-only commit. The hash is reported.

---

## Phase 1: Handoff validator, corpus first

Blocked on Open Decisions 1, 3, 4 and 5. Stack: TypeScript, vitest, pnpm workspace conventions of the chosen location.

The validator is a pure function `validate(markdown: string, opts) → { ok, diagnostics[] }`, plus a CLI `checkpoint validate <path>` that exits 2 on failure. It must not read session state; freshness (mtime) is a Phase 3 runtime concern.

> **As built (Phase 1.5, CADENCE phase 316):** Phase 1 shipped with a provisional schema. It came from the Decision 3 schema source, plus two inserted sections (`Acceptance criteria touched`, `Open decisions`) that the `cadence handoff` generator did not emit. Phase 1.5 reconciled the two with version-gating. The generator now emits `cadence_handoff: 2` and a required `## Open decisions` section. The validator reads the frozen six-section v1 schema, or the v2 schema (six plus `Open decisions`), based on each document's frontmatter. `Acceptance criteria touched` is optional in both. See [`docs/checkpoint/REPORT-checkpoint-phase-1.5.md`](../checkpoint/REPORT-checkpoint-phase-1.5.md), including its Phase 3 preconditions.

### Fixture corpus

At minimum, one fixture per failure class:

- A valid handoff, drawn from the Decision 3 schema source.
- One fixture per required section, with that section missing.
- A letter-prefixed AC id (`AC-K1`).
- A duplicate AC id.
- A handoff with zero acceptance criteria.
- A measured-context entry that has a figure but no command.
- An empty open-decisions section, which fails or passes per Decision 4.
- A resume core over the 10,000-character budget. The validator reports the actual length.
- An empty file.
- Non-UTF-8 input.
- A header variant (case or order), which fails or passes per Decision 5.

### Acceptance criteria

7. The fixture corpus and failing tests land in a commit **before** any validator implementation. That commit's vitest output, showing each fixture failing, is in the report-back with its hash.
8. Every fixture maps to exactly one named diagnostic code. A fixture that fails for an unintended reason counts as a test failure.
9. After implementation, the valid fixture passes and every failure fixture fails with its intended diagnostic. Vitest output and commit hash go in the report-back.
10. AC id parsing accepts numeric-only ids and rejects any id containing a letter.
11. The CLI exits 0 on pass and 2 on fail, with diagnostics on stderr. Evidence: both exit codes shown against the valid fixture and against one failure fixture.
12. Diagnostics are specific enough to paste straight into a Stop block reason: section name, line number where applicable, and the violated rule.
13. No runtime dependency is added beyond what the chosen location already uses, or each addition is listed in the report-back with justification.

---

## Roadmap (not authorised)

- **Phase 2: Sensor and state store.** Statusline wrapper, atomic state file, transition table with illegal-transition rejection.
- **Phase 3: Stop trigger and gate.** Arm, mtime freshness, validator invocation, re-block ceiling, bypass recording.
- **Phase 4: PreCompact guard.** Block manual compaction unless settled; auto fails open with a warning.
- **Phase 5: Rehydrate.** `SessionStart clear|compact`, resume-core injection within budget, factual phrasing, one-shot `UserPromptSubmit` reinject, single-winner `settled → reset`.
- **Phase 6: Last mile (opt-in).** tmux `idle_prompt` reset for interactive use, and a headless outer loop (Agent SDK or `claude -p`) that ends a session on settle and starts a fresh one seeded with resume output.
- **Deferred config:** a `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` backstop, pending M10.

---

## Ledger work instructions

- **Do not mutate the Cadence ledger.** No `cadence recommendation add` and no status changes. Ledger mutations are filed by the operator and are never derived from this or any handoff.
- If the ledger is read for context, filter by `status` explicitly (exclude shipped, rejected, converted, archived). Never use array length as an open count.
- Put proposed recommendations in the report-back under **Proposed for operator filing**. Give each a title, rationale and evidence, tagged with the scout ID placeholder `<SCOUT-ID>` until Decision 7 is answered. Include no CLI flags that were not captured verbatim in M8.

---

## Standing rules

- Measure, then write. Every number in the report-back or in code comments carries the command that produced it. No predicted figures.
- Corpus before code. Phase 1 fixtures are proven red before implementation starts.
- Stop and report if the phase finds its own premise wrong. Do not manufacture a fix.
- Honest negative results are acceptable outcomes.
- Report, never rewrite. Historical SUMMARY.json and artifact files are never rewritten. Any `--force` use is reported **first** in the report-back.
- Config changes (settings.json, hook registration, statusline) travel in their own commits, separate from feature code.
- AC ids are numeric only.
- Mock conduction is not conduction. A phase settled under a mock provider is reported as structurally verified only.
- The pipeline reads and writes handoff documents only. It never touches PHI-bearing paths and never widens its own permissions.

---

## Report-back protocol

Return a single markdown file, `REPORT-checkpoint-phase-<n>.md`, with sections in this order:

1. **`--force` and gate bypasses.** Every use, or an explicit `None`.
2. **Premise status.** Pass/fail per documented fact (Phase 0), or confirmation that no premise shifted (Phase 1).
3. **Acceptance criteria.** One row per AC id: status, evidence command, raw output excerpt, commit hash.
4. **Measurements.** Every figure with its producing command.
5. **Deviations.** Anything done differently from this handoff, and why.
6. **Answers needed.** Open decisions still blocking the next phase.
7. **Proposed for operator filing.** Per the ledger instructions.
