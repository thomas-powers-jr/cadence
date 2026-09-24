# HANDOFF — CADENCE Checkpoint Arc: Reconcile the Schema, Prove the Block, Then Build the Sensor

**To:** Claude Code
**From:** Thomas, 2026-09-23
**Repo:** `thomas-powers-jr/cadence` @ `main`
**Baseline:** v1.67.3; 0 pending changesets; loop IDLE; latest phase `314-hook-shim-cwd-passthrough`; `packages/checkpoint` exists at `0.0.0`, private (verify — CMD-A)
**Scout ID for this batch:** `scout-20260923-checkpoint-2`
**Parent document:** `docs/handoffs/HANDOFF-checkpoint-handoff-before-reset.md` — the operator's own arc design. Phases 0 and 1 are complete (`docs/checkpoint/REPORT-checkpoint-phase-0.md`, `REPORT-checkpoint-phase-1.md`). **This document authorizes the next step and nothing beyond it.**

**Ledger rule from the parent document stands: do not mutate the Cadence ledger from this work.** Recommendations are filed by the operator.

Three phases: **1.5** (schema reconciliation — a precondition the Phase 1 report itself named) · **0.4a** (the deferred active block-probe — a precondition to Phase 3, not to Phase 2) · **2** (sensor and state store, per the parent design). **Run 1.5 first.** 0.4a and 2 are independent and may run in either order after it.

---

## 1. Mission — and why Phase 2 is not the next phase as written

Phases 0 and 1 landed with unusual rigor. Phase 0 verified nine of ten platform premises against Claude Code `2.1.278`, answered M4 decisively (`/compact` preserves `session_id`; `/clear` assigns a new one), and — most importantly — **recorded two gaps as honest NOT TESTED rather than inferring them**: `Stop`/`PreCompact` blocking-on-exit-2, and auto-compaction (`M10`). Phase 1 shipped a corpus-first validator: 27 fixtures, 11 named diagnostic codes, CLI exit 2 on failure.

Phase 1's own report then surfaced a finding that blocks everything downstream, and stated it plainly:

> a real `cadence handoff`-generated document — including the very one this schema was derived from — **fails validation today**, exiting 2 with `SECTION_MISSING [Acceptance criteria touched]` and `SECTION_MISSING [Open decisions]`.

The validator's schema inserted two sections the live `cadence handoff` template does not emit. That is the exact inverse of the arc's own justifying principle — *"a document that passes checkpoint's validator must be a document `cadence resume` can already replay."* Verified in CMD-C below: the current live handoff fails the current validator.

**Phase 3 (the Stop gate) would block every session on a validator that rejects the generator's own output.** That is not a gate; that is a wedge. Phase 1's report called this "the concrete Phase-2-or-earlier work item." It is earlier. It is Phase 1.5.

**Second, Phase 3 is built on `Stop` blocking, and blocking was not tested.** Phase 0 recorded it NOT TESTED by explicit operator choice (the active probe, Task 0.4a, risked wedging a session). That was the right call for a passive probe pass — and it means Phase 3 cannot be authorized until 0.4a runs. **Phase 2 does not depend on it** and can proceed.

---

## 2. Measured context — verify before designing anything

Measured against a `refs/heads/main` tarball, 2026-09-23. **If your measurements differ, yours are correct and this document is stale — say so and proceed from yours.**

### CMD-A — baseline

```bash
node -e "console.log('core',require('./packages/core/package.json').version,'| checkpoint',require('./packages/checkpoint/package.json').version)"
ls .changeset/*.md 2>/dev/null | grep -v README | wc -l
ls packages/checkpoint/tests/fixtures | wc -l
ls docs/checkpoint/
```

Measured: core `1.67.3`; checkpoint `0.0.0` (private, `@thomas-powers-jr/cadence-checkpoint`); **0** pending changesets; **27** fixtures; Phase 0 and Phase 1 reports plus `phase-0-interactive-findings.md` present.

### CMD-B — what Phase 0 established and what it left open

```bash
sed -n '9,25p' docs/checkpoint/REPORT-checkpoint-phase-0.md
grep -n "M4\|M2\|M10\|NOT TESTED\|0.4a" docs/checkpoint/REPORT-checkpoint-phase-0.md | head -12
```

Measured — the load-bearing results:

| Finding | Value | Consequence for this arc |
|---|---|---|
| **M4** `session_id` across `/compact` | **unchanged** | State keyed by project (parent design) is correct; a session-keyed store would survive `/compact` but not `/clear` |
| **M4** `session_id` across `/clear` | **new id assigned** | Phase 5's `settled → reset` single-winner must not key on `session_id` |
| **M2** `used_percentage` | present; **`null` on first render(s)**, then 0–11% | Phase 2's sensor must treat `null` as "unknown," never as 0 |
| **`Stop` blocks on exit 2** | **NOT TESTED** (0.4a deferred) | **Phase 3 blocked until proven** |
| **`PreCompact` blocks on exit 2** | **NOT TESTED** | **Phase 4 blocked until proven** |
| **M10** auto-compaction | **not reached** | Phase 4's `auto` fail-open path unverified |
| **M9** canonical package | `@thomas-powers-jr/cadence-core` `1.67.2`; `@manehorizons/…` stale at `1.53.0` | Open Decision 2 answered |
| Undocumented | `PostCompact.compact_summary` field exists; `Stop` carries `background_tasks`, `session_crons` | Worth recording; not load-bearing yet |

### CMD-C — the schema mismatch (Phase 1.5's whole premise)

```bash
node packages/checkpoint/bin/checkpoint.cjs validate .cadence/handoff/SESSION-2026-09-22-pr521-merged-checkpoint-proposal-dropped.md; echo "exit=$?"
grep -n "'## " packages/core/src/handoff/render-session.ts
grep -n "SECTION_MISSING\|REQUIRED_SECTIONS\|Acceptance criteria touched\|Open decisions" packages/checkpoint/src/validate.ts | head -8
```

**Run the first command and paste the output.** Expected per Phase 1's report: exit 2 with two `SECTION_MISSING` diagnostics. If it passes, the mismatch was already fixed and Phase 1.5 collapses to a verification note.

The generator (`render-session.ts:78-94`) emits six sections: `TL;DR for the next session` · `State on handoff` · `CADENCE context` · `What landed this session` · `Carry-forward gotchas` · `Next action`. The validator requires eight — those six plus `Acceptance criteria touched` and `Open decisions`, inserted between them.

### CMD-D — two AC-id parsers, no drift test

```bash
grep -n "AC-\\\\d\|AC_ID" packages/core/src/parse/draft-parser.ts | head -3
grep -n "AC-\\\\d\|AC_ID_NON_NUMERIC" packages/checkpoint/src/validate.ts | head -3
node -e "const p=require('./packages/checkpoint/package.json');console.log('deps:',Object.keys({...p.dependencies,...p.devDependencies}))"
```

Measured: `core/src/parse/draft-parser.ts:51` uses `/^### (AC-\d+):[ \t]*(.*)$/m` (the pattern phase 288 hardened). `checkpoint/src/validate.ts` implements its own `AC_ID_NON_NUMERIC` check **independently** — the package depends only on `cadence-testkit`, not on `core` or `types`. Deliberate isolation, but it means **two parsers with two ideas of what an AC id looks like, and nothing pins them together.** Phase 288 exists because one of those parsers silently accepted-by-skipping; phase 293 set the precedent (pin `COMMAND_GUIDANCE` against `COMMANDS.map(c => c.name)`) for making two catalogs unable to drift. Address in Phase 1.5 (D-BI).

### CMD-E — the every-turn `Stop` error Phase 0 found

```bash
grep -n "state.json is missing\|cadence onboard" packages/core/src/hooks/*.ts | head -5
```

Phase 0's interactive pass logged, on **every single turn** in an un-onboarded worktree: *`hook dispatch failed: .cadence/ exists but state.json is missing … run cadence onboard`*. Correct message, wrong cadence — it should fire once. This is the exact workflow (isolated worktree per phase) CLAUDE.md prescribes, and Phase 3 will add a *second* `Stop` hook alongside it. **Not this arc's work, but file it** (operator) — Phase 3's own `Stop` handler must not repeat the pattern.

### CMD-F — dedup preflight (read-only; ledger writes are the operator's)

```bash
node packages/core/bin/cadence.cjs recommendation list --filter-regex "checkpoint|compact|handoff|resume|rehydrat|state.json is missing" --sort-by created
node packages/core/bin/cadence.cjs decision list --filter-text checkpoint
```

Run and report; do not file.

---

## 3. Decisions to record (operator-reserved, per the parent document's rule)

### D-BI — Which side moves: the generator, or the validator?

The mismatch has two honest resolutions and one dishonest one.

1. **Extend `cadence handoff`'s generator** to emit `Acceptance criteria touched` and `Open decisions` — the validator was right about what a good handoff *should* contain, and the generator catches up.
2. **Demote both sections to optional/warn in the validator** — the generator was right about what a handoff *does* contain, and the validator stops rejecting real output.
3. **Both** — generator emits them; validator requires them; a drift test pins generator headers to validator schema so they can never diverge again.

I lean **(3)**, and specifically the drift test is the non-negotiable part: **whatever the required-sections list is, it must be derived from or pinned to `render-session.ts`'s emitted headers by a test that fails when they disagree.** Two hand-maintained lists is the bug. The same applies to the AC-id grammar (CMD-D) — either `checkpoint` imports the pattern from `types`, or a test asserts the two regexes accept and reject identical corpora.

Note Phase 1's own flag: the two inserted sections were "an inference from the fixture corpus's requirements, not a literal answer to any of the four decisions the operator already made." **Decide whether you actually want them.** `Open decisions` seems clearly right (Open Decision 4 already governs its empty-state). `Acceptance criteria touched` is less obvious for a session handoff that spans multiple phases — say what it means, or drop it.

### D-BJ — Threshold unit (parent Open Decision 6, still open)

Percentage, absolute tokens, or both. Phase 2's sensor must write *something*. M2 measured `used_percentage` as the available signal, and it is `null` on first render. If absolute tokens are also in the statusline payload, record both and let the threshold config choose; if not, percentage is what exists. **This decision blocks Phase 2's state schema.**

### D-BK — Does 0.4a run in a throwaway session, and who runs it?

The active block-probe risks wedging a session — that is why it was deferred. Options: a dedicated throwaway project directory with a minimal `Stop` hook that exits 2 on a sentinel file, run interactively by the operator; or a `claude -p` headless run. **The operator's Phase 0 choice was explicit and informed; this document does not override it.** Authorize 0.4a only with a stated containment plan (throwaway dir, sentinel-file kill switch, `timeout` wrapper). Record the plan before running.

### D-BL — Scout ID (parent Open Decision 7)

`scout-20260923-checkpoint-2`, unless the operator prefers to continue Phase 0/1's.

---

## 4. Phase 1.5 — Schema reconciliation

**Objective.** A real `cadence handoff` document passes the checkpoint validator, and the generator and validator cannot drift apart silently.

**Blocked on D-BI.** Investigate first: run CMD-C and confirm the failure reproduces; read Phase 1's §4 flags in full.

**Acceptance criteria** (Given/When/Then; anchor to committed tests and real command output. **Numeric AC ids only** — the validator enforces this too, per Phase 1 AC 10.)

- **AC-1** Given the live handoff at `.cadence/handoff/SESSION-2026-09-22-…md` (and a freshly generated one via `cadence handoff`), when `checkpoint validate` runs, then it exits **0**. Prove red first — capture the current exit-2 output before any change.
- **AC-2** Per D-BI: a committed test pins the validator's required-sections list to `render-session.ts`'s emitted headers, and **fails when they disagree** — proven by temporarily desynchronizing one side.
- **AC-3** Per D-BI: the AC-id grammar is shared or pinned — either `checkpoint` imports it from `types`, or a drift test asserts both regexes accept and reject an identical fixture corpus (numeric, letter-prefixed, duplicate, empty).
- **AC-4** All 27 existing fixtures still resolve to their intended diagnostic codes; any fixture whose expected outcome changed under D-BI is listed with the reason.
- **AC-5** If D-BI extends the generator, `cadence resume` replays a document carrying the new sections without error — the arc's justifying principle, proven end-to-end.
- **AC-6** `docs/checkpoint/REPORT-checkpoint-phase-1.md`'s provisional-schema flag is resolved in a `REPORT-checkpoint-phase-1.5.md`, and the parent design's Phase 1 schema note is updated.

**Files.** `packages/checkpoint/src/validate.ts` · possibly `packages/core/src/handoff/render-session.ts` · possibly `packages/checkpoint/package.json` (a `types` dependency, if D-BI shares the grammar) · tests: drift tests, fixture updates · `docs/checkpoint/`.

**Non-goals.** No Stop hook. No state store. No change to `cadence resume`'s parsing beyond what AC-5 requires.

---

## 5. Phase 0.4a — Active block-probe (precondition to Phase 3)

**Objective.** Prove, against the installed Claude Code version, that a `Stop` hook exiting 2 blocks the stop and continues the conversation; and that a `PreCompact` hook exiting 2 blocks manual compaction.

**Blocked on D-BK's containment plan.**

**Acceptance criteria**

- **AC-1** A throwaway project with a `Stop` hook that exits 2 (with a JSON block reason) while a sentinel file exists: when the assistant attempts to stop, the stop is blocked and the reason appears in-session; when the sentinel is removed, the next stop succeeds. **Both observations captured with the hook's raw stdin payload and exit code.**
- **AC-2** The same for `PreCompact` with `trigger: "manual"` — `/compact` is refused while blocked, succeeds after release.
- **AC-3** The Phase 0 report's two NOT TESTED rows are updated to PASS or FAIL with the evidence, in a dedicated `REPORT-checkpoint-phase-0.4a.md`.
- **AC-4** If either blocking claim **fails**, the report states it plainly and **Phase 3/4 are marked not-authorizable** in the parent design's roadmap. That is a successful outcome.
- **AC-5** Probe hooks removed in a dedicated config-only commit, hash reported (the Phase 0 AC 6 pattern).

**Non-goals.** No production hook. No state store. No re-block ceiling logic — this proves the primitive, nothing built on it.

---

## 6. Phase 2 — Sensor and state store (per the parent design)

**Objective.** A statusline wrapper writes `{used_percentage, ts}` atomically to a project-keyed state file; a transition table rejects illegal transitions.

**Blocked on D-BJ.** Independent of 0.4a — this phase never blocks anything.

**Constraints from Phase 0 that the parent design predates:**
- **`null` is a real value** (M2). The sensor writes `null` as `null`, never coerces to 0, and the transition `idle → armed` never fires on `null`.
- **State keyed by project, not `session_id`** (M4) — the parent design said "pending M4"; M4 confirms it.
- **Atomic write = temp file + rename** (parent design) — reuse `core`'s `atomicWriteText` pattern; do not hand-roll a second one.

**Acceptance criteria**

- **AC-1** Given a statusline payload with `context_window.used_percentage: 42`, when the wrapper runs, then the state file carries `{used_percentage: 42, ts: <iso>}` and stdout still renders the original statusline unchanged (the wrapper is transparent).
- **AC-2** Given `used_percentage: null`, when the wrapper runs, then the state records `null` and no transition fires — proven by fixture.
- **AC-3** Given the transition table, when each **illegal** transition is attempted (e.g. `idle → settled`, `reset → armed`), then it is rejected and logged; every legal transition in the parent design's state machine succeeds — one test per edge, both directions.
- **AC-4** Given two concurrent writers, when both write, then the file is never torn — atomic rename proven by a test that interleaves writes.
- **AC-5** Per D-BJ: the threshold unit is recorded in the state schema and in `docs/checkpoint/`.
- **AC-6** No hook is registered. The sensor is a statusline wrapper only; nothing in this phase can block or inject.

**Files.** `packages/checkpoint/src/state.ts` (new) · `packages/checkpoint/src/sensor.ts` (new) · tests · `docs/checkpoint/REPORT-checkpoint-phase-2.md`.

**Non-goals.** No `Stop` hook (Phase 3, blocked on 0.4a). No validator invocation from the sensor. No rehydration. No `PreCompact` handling.

---

## 7. Standing rules

- **Numeric AC ids only.** The checkpoint validator enforces this on handoffs; the DRAFT parser enforces it on phases.
- **Ledger is operator-only.** Report candidate findings; do not file. (Parent document rule.)
- **Measure, never predict.** Every figure carries the command that produced it. If §2's numbers moved, yours are correct.
- **Prove red first.** CMD-C's exit-2 output must be captured before Phase 1.5 changes anything.
- **Two lists that must agree get a drift test.** Generator↔validator sections; core↔checkpoint AC grammar. The phase-293 precedent.
- **`null` means unknown.** Never coerce a missing sensor reading to 0.
- **Phase 3 does not start until 0.4a passes.** No exceptions — a gate built on an untested block primitive is a wedge.
- **Probe hooks leave in their own commit.** The Phase 0 AC 6 pattern.
- **Do not force-settle.** If any phase needs `--force`, stop and report.
- **Tier `complex` for Phase 1.5 and Phase 2** so `deep-verify` and `code-review` actually run — phases 311–314 all graded `mixed` because they ran at `standard`, where neither verifier gate fires. Declaring up is legitimate for verification-critical work; note it in the DRAFT rationale.
- **Honest negative results are the goal.** "`Stop` does not block on 2.1.278; Phases 3–5 are not buildable as designed" is the most valuable possible 0.4a result.

---

## 8. Report-back protocol

1. Verbatim `cadence doctor`, before and after each phase.
2. CMD-A through CMD-F output, with anything that moved from §2 called out.
3. **CMD-C's exit code and diagnostics on the live handoff, before and after Phase 1.5.**
4. Which option was taken for **D-BI through D-BL**, with decision ids (filed by the operator).
5. Whether both drift tests (AC-2, AC-3 of Phase 1.5) actually fail when the sides are desynchronized — proven, not asserted.
6. **0.4a: the raw `Stop` and `PreCompact` payloads and exit codes, for both the blocked and released cases.** And the verdict: does blocking work?
7. Phase 2: the state-file schema as shipped, and the transition-table test matrix.
8. Whether tier `complex` was used and whether `deep-verify` / `code-review` ran, per the settle provenance.
9. The resulting version and changeset levels, or confirmation that `checkpoint` stays private at `0.0.0`.
10. Any gate bypass used, with flag and reason.

---

## 9. Framing

The checkpoint arc is the first expansion work that goes beyond the Superpowers scorecard. No skill library addresses context loss; every agentic-coding session eventually hits the window and either compacts lossily or starts over. The thesis is CADENCE's own: `/compact` is a shape because it trusts a summariser's judgement, and a validated handoff-before-reset is a gate.

Phases 0 and 1 did this the right way. Phase 0 measured ten things and reported two of them as untested rather than assumed. Phase 1 built the validator corpus-first — and then its own final review found that the validator rejects the generator's real output, and said so in the report instead of burying it.

That finding is the next phase. A gate that blocks every session on a schema the system's own generator can't satisfy isn't verification; it's a wedge with a diagnostic. Reconcile the two sides and pin them so they can't drift. Prove the block primitive in a container where wedging costs nothing. Build the sensor, which can't block anything. Then — and only then — Phase 3.
