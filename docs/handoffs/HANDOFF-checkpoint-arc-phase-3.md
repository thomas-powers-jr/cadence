# HANDOFF — CADENCE Checkpoint Arc: Prove the Block, Build the Sensor, Then Design the Gate

**To:** Claude Code
**From:** Thomas, 2026-09-24
**Repo:** `thomas-powers-jr/cadence` @ `main`
**Baseline:** v1.67.3 core; `packages/checkpoint` private at `0.0.0`; **1 pending `minor` changeset** (`checkpoint-handoff-open-decisions`); loop IDLE; latest phase `316-checkpoint-schema-reconcile` (verify — CMD-A)
**Scout ID for this batch:** `scout-20260924-checkpoint-3`
**Parent document:** `docs/handoffs/HANDOFF-checkpoint-handoff-before-reset.md` (operator-authored arc design). Phases 0, 1, and 1.5 complete — reports in `docs/checkpoint/`.
**Supersedes:** `HANDOFF-checkpoint-arc-phase-2.md` — Phase 1.5 shipped as phase 316; this reissues the remainder with 0.4a promoted to first and Phase 3's preconditions folded in.

**Ledger rule from the parent document stands: do not mutate the Cadence ledger from this work.** Recommendations are filed by the operator.

Three items, **in this order**: **Release** (cut the pending changeset — 10 minutes) · **Phase 0.4a** (the deferred active block-probe) · **Phase 2** (sensor and state store). Then §6 — a Phase 3 design brief that is **not authorized work**, only the input the operator needs to authorize it.

---

## 1. Why 0.4a is now first

Phase 316 settled `strong` — tier `complex`, real `deep-verify` and `code-review`, zero bypasses, the first `strong` since phase 286. D-BI landed as a version-gated hybrid: the generator emits `cadence_handoff: 2` with a required `Open decisions` section; the validator selects its schema by frontmatter version; an unsupported version returns `HANDOFF_VERSION_UNSUPPORTED` rather than guessing. **The live handoff validates at exit 0.** Both drift tests exist and were proven to fail when desynchronized — and the AC-grammar desync run caught a real regex bug in passing.

Phase 1.5's report then did the most useful thing a report can do: it wrote a **Phase 3 preconditions** section listing seven things the Stop gate must handle before it consumes the validator. None are bugs today — nothing consumes the validator yet. All seven become bugs the moment Phase 3 does.

That list is only worth acting on if the `Stop` primitive actually blocks on exit 2 — which is still **NOT TESTED** on Claude Code `2.1.278`, by explicit operator choice during Phase 0's passive probe. **0.4a's result determines the arc's remaining shape.** If it passes, §6 becomes a Phase 3 design with seven acceptance criteria already named. If it fails, Phases 3–5 aren't buildable as designed and §6 is moot. Phase 2's result determines nothing downstream.

So: prove the primitive first.

---

## 2. Measured context — verify before doing anything

Measured against a `refs/heads/main` tarball, 2026-09-24. **If your measurements differ, yours are correct and this document is stale — say so and proceed from yours.**

### CMD-A — baseline

```bash
node -e "console.log('core',require('./packages/core/package.json').version,'| checkpoint',require('./packages/checkpoint/package.json').version)"
ls .changeset/*.md | grep -v README
ls docs/checkpoint/ packages/checkpoint/src/
node packages/checkpoint/bin/checkpoint.cjs validate .cadence/handoff/SESSION-2026-09-22-pr521-merged-checkpoint-proposal-dropped.md; echo "exit=$?"
```

Measured: core `1.67.3`; checkpoint `0.0.0`; one pending changeset (`checkpoint-handoff-open-decisions.md`, `minor` on core); `docs/checkpoint/` has reports for 0, 1, 1.5 plus the two Phase 0 measurement files; `packages/checkpoint/src/` is `cli.ts`, `index.ts`, `types.ts`, `validate.ts` — **no sensor, no state store**. The live handoff validates exit 0.

### CMD-B — Phase 0's load-bearing results (unchanged, restated)

```bash
grep -n "M2\|M4\|M10\|NOT TESTED\|0.4a" docs/checkpoint/REPORT-checkpoint-phase-0.md | head -12
```

| Finding | Value | Consequence |
|---|---|---|
| **M4** `session_id` across `/compact` | unchanged | State keyed by project is correct |
| **M4** `session_id` across `/clear` | new id assigned | Phase 5's single-winner must not key on `session_id` |
| **M2** `used_percentage` | present; **`null` on first render(s)** | Phase 2's sensor treats `null` as unknown, never 0 |
| **`Stop` blocks on exit 2** | **NOT TESTED** | **0.4a — this handoff** |
| **`PreCompact` blocks on exit 2** | **NOT TESTED** | **0.4a — this handoff** |
| **M10** auto-compaction | not reached | Phase 4's `auto` path unverified; out of scope here |

### CMD-C — the Phase 3 preconditions Phase 1.5 recorded

```bash
sed -n '/## Phase 3 preconditions/,/^## /p' docs/checkpoint/REPORT-checkpoint-phase-1.5.md
grep -n "export function findUnfilledSections" packages/core/src/handoff/placeholders.ts
```

Measured — seven items, all sourced to specific code:

1. **Version-downgrade vector.** A doc can declare `cadence_handoff: 1` to skip the `Open decisions` requirement.
2. **Unfilled-placeholder gap.** A freshly rendered, entirely unfilled v2 doc passes `validate()` — `<!-- FILL IN -->` markers are non-empty text. `cadence handoff --check` catches this via `findUnfilledSections()` (`placeholders.ts:8`); **Phase 3 must compose both checks.**
3. **Brief-mode `resume` gives no warning** on unfilled `Open decisions` (excluded from the brief; pre-existing behavior).
4. **BOM defeats frontmatter on string input** — CLI unaffected (Buffer → `TextDecoder`); only matters if a hook calls `validate()` with a string it read itself.
5. **Duplicate `cadence_handoff:` keys: first wins.**
6. **Frontmatter close search is not fence-aware** and only accepts literal `---`.
7. **Some AC-looking bullet shapes skip silently** (`- [x] AC-1`, `- ac-1`, `1. AC-1`, `+` bullets).

These are the Phase 3 acceptance criteria, pre-written. See §6.

### CMD-D — the every-turn `Stop` error (still open, still relevant)

```bash
grep -n "state.json is missing\|cadence onboard" packages/core/src/hooks/*.ts | head -5
```

Phase 0 found the CADENCE-managed `Stop` hook logs *`.cadence/ exists but state.json is missing … run cadence onboard`* on **every turn** in an un-onboarded worktree. Phase 3 will add a second `Stop` hook beside it. **Operator: file this if not yet filed.** Phase 3's handler must fire once, not per-turn.

### CMD-E — dedup preflight (read-only)

```bash
node packages/core/bin/cadence.cjs recommendation list --filter-regex "checkpoint|compact|handoff|resume|state.json is missing|Stop hook" --sort-by created
node packages/core/bin/cadence.cjs decision list --filter-text checkpoint
```

Run and report; do not file.

---

## 3. Decisions to record (operator-reserved)

### D-BK — 0.4a containment plan (must be recorded before running)

The active probe was deferred in Phase 0 because it risks wedging a session. Authorize only with:

- **A throwaway project directory**, not this repo, not any worktree of it.
- **A sentinel-file kill switch**: the probe hook exits 2 only while `$PROBE_DIR/BLOCK` exists; removing the file releases on the next event. The operator holds the file.
- **A `timeout` wrapper** on the hook script itself so a hung hook cannot hang the session.
- **Interactive, operator-driven** — not `claude -p`, so a wedge is observable and recoverable.

Record the plan as a decision before the first run.

### D-BJ — Threshold unit (parent Open Decision 6, still open — blocks Phase 2)

M2 measured `used_percentage` as the available signal. Determine from the captured statusline payload (`phase-0-autonomous-measurements.md`) whether absolute token counts are also present. **If both exist, record both** and let config choose; if only percentage, that's the unit. Phase 2's state schema cannot be written until this is decided.

### D-BM — Does the release happen first?

The pending changeset changes `cadence handoff`'s output (v2 frontmatter, new required section) — consumer-visible. I lean **cut it before 0.4a**: a probe session running against unreleased generator changes muddies any finding. Standard release pattern; `release-currency` will want it anyway.

---

## 4. Phase 0.4a — Active block-probe

**Objective.** Prove, against installed Claude Code `2.1.278`, that a `Stop` hook exiting 2 blocks the stop and continues the conversation, and that a `PreCompact` hook exiting 2 blocks manual compaction.

**Blocked on D-BK.** Do not run without the recorded containment plan.

**Acceptance criteria** (**numeric ids only**; anchor to captured payloads and exit codes, never to prose)

- **AC-1** Given the probe `Stop` hook and `$PROBE_DIR/BLOCK` present, when the assistant attempts to stop, then the stop is **blocked**, the JSON block reason appears in-session, and the hook's raw stdin payload plus exit code are captured to `hooks.jsonl`.
- **AC-2** Given `$PROBE_DIR/BLOCK` removed, when the assistant next attempts to stop, then the stop **succeeds** — captured the same way. Both observations, same session.
- **AC-3** The same pair for `PreCompact` with `trigger: "manual"`: `/compact` refused while blocked, succeeds after release, both captured.
- **AC-4** Given a `Stop` block, when the assistant continues and stops again with `BLOCK` still present, then the second block is observed and `stop_hook_active: true` is confirmed in its payload — the re-block signal Phase 3's ceiling depends on.
- **AC-5** `docs/checkpoint/REPORT-checkpoint-phase-0.4a.md` updates Phase 0's two NOT TESTED rows to **PASS** or **FAIL** with the evidence. **If either fails, the report says so plainly and marks Phases 3–4 not-authorizable in the parent design's roadmap.** That is a successful outcome.
- **AC-6** Probe hooks and probe directory removed in a dedicated config-only commit; hash reported (the Phase 0 AC 6 pattern).

**Non-goals.** No production hook. No state store. No re-block ceiling logic. No validator invocation. This proves the primitive and nothing built on it.

---

## 5. Phase 2 — Sensor and state store

**Objective.** A statusline wrapper writes `{used_percentage, ts}` atomically to a project-keyed state file; a transition table rejects illegal transitions. **Nothing in this phase can block, inject, or gate.**

**Blocked on D-BJ.** Independent of 0.4a's result.

**Constraints Phase 0 established that the parent design predates:**
- **`null` is a real value.** Written as `null`; `idle → armed` never fires on it.
- **Keyed by project, not `session_id`.**
- **Atomic write = temp + rename.** Reuse `core`'s `atomicWriteText` pattern; do not hand-roll.

**Acceptance criteria**

- **AC-1** Given a statusline payload with `context_window.used_percentage: 42`, when the wrapper runs, then the state file carries `{used_percentage: 42, ts: <iso>}` and stdout renders the original statusline **unchanged** — the wrapper is transparent, proven by byte comparison.
- **AC-2** Given `used_percentage: null`, when the wrapper runs, then state records `null` and no transition fires.
- **AC-3** For every edge in the parent design's state machine, one test asserts the legal transition succeeds and the reverse is rejected and logged. Illegal cross-state jumps (`idle → settled`, `reset → armed`) rejected.
- **AC-4** Given two concurrent writers, when both write, then the file is never torn — proven by an interleaving test.
- **AC-5** Per D-BJ: the threshold unit is recorded in the state schema and in `docs/checkpoint/REPORT-checkpoint-phase-2.md`.
- **AC-6** No hook is registered by this phase. `.claude/settings.json` is byte-identical before and after, except for the statusline entry.

**Files.** `packages/checkpoint/src/state.ts` (new) · `packages/checkpoint/src/sensor.ts` (new) · tests · `docs/checkpoint/REPORT-checkpoint-phase-2.md`.

**Non-goals.** No `Stop` hook. No validator invocation. No rehydration. No `PreCompact` handling.

---

## 6. Phase 3 design brief — NOT AUTHORIZED; input for the operator's decision

**Do not build this.** This section exists so that, if 0.4a passes, the operator can authorize Phase 3 against acceptance criteria that are already concrete rather than against the parent design's one-line roadmap entry.

**What Phase 3 is** (parent design): `Stop` arms when usage ≥ threshold, instructs the handoff write, then gates — runs the validator, blocks with diagnostics or settles. Re-block ceiling; bypass recorded as a gate bypass.

**What Phase 1.5 says it must also do**, mapped to acceptance criteria:

| Precondition | Phase 3 AC shape |
|---|---|
| Version-downgrade vector | The gate pins the *minimum* acceptable `cadence_handoff` version (≥ 2 for any doc the gate itself instructed); a v1 declaration on a gate-instructed doc is rejected with a named diagnostic. |
| Unfilled-placeholder gap | The gate composes `validate()` **and** `findUnfilledSections()`; a structurally valid doc with `FILL IN` markers is blocked, naming the unfilled sections. |
| Brief-mode `resume` warning gap | Phase 5 concern, not Phase 3 — carry forward. |
| BOM on string input | The gate pipes through the CLI (Buffer path) or explicitly strips BOM; a fixture proves a BOM-prefixed doc validates identically both ways. |
| Duplicate keys / non-fence-aware frontmatter | The gate only validates docs `cadence handoff` generated (never hand-authored input), and the DRAFT records that boundary. |
| Silent AC bullet shapes | Out of scope unless the gate relies on AC coverage — record the decision. |
| Every-turn `Stop` error (CMD-D) | The gate's `Stop` handler emits its arm/block message **once per state transition**, not per turn; a fixture proves three consecutive Stops in `armed` produce one instruction, not three. |

**Plus, from 0.4a:** the re-block ceiling uses `stop_hook_active` (AC-4 of 0.4a) as its signal, and a ceiling hit is released with a `systemMessage` and recorded as a gate bypass — the parent design's rule, now with a proven signal underneath it.

**Open design questions the operator should resolve before authorizing:**
- **Where does the gate's bypass record land?** In `.cadence/` (the loop's `gateBypasses`, which phase 283's assurance derivation reads) or in the checkpoint state file only? The former makes a forced context-reset visible in the *phase's* assurance grade, which is arguably correct — a phase whose handoff was force-released is less trustworthy — but couples two subsystems.
- **Tier for Phase 3.** `complex`, unconditionally. It writes a hook that can block a session; it gets real verification.

---

## 7. Standing rules

- **Numeric AC ids only.** The validator enforces this on handoffs; the DRAFT parser on phases.
- **Ledger is operator-only.** Report candidate findings; do not file.
- **Measure, never predict.** Every figure carries the command that produced it. If §2's numbers moved, yours are correct.
- **0.4a runs only with the recorded containment plan.** No exceptions.
- **Phase 3 does not start until 0.4a passes.** §6 is design input, not authorization.
- **`null` means unknown.** Never coerce to 0.
- **Reuse `atomicWriteText`.** No second atomic-write implementation.
- **Probe hooks leave in their own commit.**
- **Tier `complex` for Phase 2.** Phase 316 proved the recipe: real `deep-verify` + `code-review`, `strong`. Keep it.
- **Do not force-settle.** If any phase needs `--force`, stop and report.
- **Honest negative results are the goal.** "`Stop` does not block on 2.1.278" is the most valuable possible 0.4a result — it saves three phases of building on sand.

---

## 8. Report-back protocol

1. Verbatim `cadence doctor`, before and after each phase.
2. CMD-A through CMD-E output, with anything that moved from §2 called out.
3. **Release:** version and tag, or the reason it was deferred.
4. **D-BK's containment plan as recorded**, before 0.4a's first run.
5. **0.4a: raw `Stop` and `PreCompact` payloads and exit codes for both blocked and released cases, and `stop_hook_active` on the re-block.** Then the verdict: does blocking work on this version?
6. Which option was taken for **D-BJ** and **D-BM**, with decision ids (operator-filed).
7. Phase 2: the state-file schema as shipped, the transition-table test matrix, and the byte-comparison proof that the statusline wrapper is transparent.
8. Whether tier `complex` was used and whether `deep-verify` / `code-review` ran.
9. The operator's disposition on §6: authorize Phase 3, defer, or redesign — and any answer to the bypass-record question.
10. Any gate bypass used, with flag and reason.

---

## 9. Framing

Three phases in, the checkpoint arc has been unusually honest with itself. Phase 0 reported two premises as untested rather than assuming them. Phase 1 built the validator corpus-first and then found it rejected the generator's own output — and said so. Phase 1.5 fixed that, pinned both sides with drift tests, and left the next phase a list of seven things it must handle, each sourced to a line of code.

The thing that list can't tell you is whether the primitive under all of it works. Every design in the parent document — the arm, the gate, the ceiling, the compaction guard — assumes a hook that exits 2 stops the assistant. That assumption has a NOT TESTED next to it, put there deliberately because testing it risked wedging a session.

Test it in a box where wedging costs nothing. Then build the sensor, which can't block anything. And then the operator has what they need to decide whether Phase 3 gets built: a proven primitive, a measured sensor, and seven acceptance criteria that were written by the phase that found them.
