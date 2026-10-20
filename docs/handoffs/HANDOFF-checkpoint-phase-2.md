# HANDOFF — CADENCE Checkpoint Phase 2: Sensor and State Store

**To:** Claude Code
**From:** Thomas, 2026-09-26
**Repo:** `thomas-powers-jr/cadence` @ `main`
**Baseline:** v1.68.0; `packages/checkpoint` private at `0.0.0`; checkpoint Phases 0, 1, 1.5, 0.4a complete; **Phase 2 not started** (verify — CMD-A)
**Scout ID for this batch:** `scout-20260926-checkpoint-phase-2`
**Parent document:** `docs/handoffs/HANDOFF-checkpoint-handoff-before-reset.md` (operator-authored arc design; §Design reference has the state machine).
**Supersedes:** `HANDOFF-checkpoint-arc-phase-3.md` §5 — this is that section with its blocker resolved and one AC added. Release and 0.4a from that document are done; its §6 Phase 3 brief is stale (it predates the JSON-block finding) and will be reissued when Phase 3 is authorized.

**Ledger rule from the parent document stands: do not mutate the Cadence ledger from this work.** The operator files decisions and recommendations.

> **As built (phase 331, 2026-10-15):** Phase 2 was built as phase 331. See `docs/checkpoint/REPORT-checkpoint-phase-2.md`. Three §2 measurements had moved by then:
> - core was `1.70.0`, not `1.68.0`;
> - checkpoint already listed core as a devDependency (phase 316);
> - core's package entry did not export `atomicWriteText`, so D-BR took one additive core re-export.
>
> AC-8's settings edit is made by a new `checkpoint statusline-install` command. The repository's own `.claude/settings.json` was not changed. The DRAFT (`.cadence/phases/331-checkpoint-sensor-state-store/331-01-DRAFT.md`) records further ACs and the As-built amendments.

**Runs in parallel with the hook-JSON-block work.** Phase 2 registers no hook, blocks nothing, and depends on nothing in that arc. Use a separate worktree.

---

## 1. Mission

Phase 2 builds the sensor: a transparent statusline wrapper that records context usage to a project-keyed state file, and a transition table that makes illegal state changes impossible. **Nothing in this phase can block, inject, or gate.** That is what makes it safe to run in parallel and safe to ship before the block primitive is fully migrated.

The parent design specified this phase before Phase 0 ran. Four measured facts since then constrain it, and one of them is new as of 0.4a:

1. **State is keyed by project, not `session_id`** — M4 proved `/clear` assigns a new id.
2. **`null` is a real reading** — M2 found `used_percentage` is `null` before the first real turn.
3. **Post-reset `0` is also "unknown"** — 0.4a observed the same session go to `0` after one `/compact` and `null` after the next. Resets are not consistent even within a session.
4. **Both units are present** — an integer `used_percentage` (coarse: ~10k-token resolution on a 1M window) and absolute counts under `current_usage.*` / `total_input_tokens` against `context_window_size`. D-BJ's answer is *record both*.

Facts 2 and 3 together mean the sensor's "unknown" predicate is **`null || 0`**, and the `idle → armed` transition never fires on either.

---

## 2. Measured context — verify before designing anything

Measured against a `refs/heads/main` tarball, 2026-09-26. **If your measurements differ, yours are correct and this document is stale — say so and proceed from yours.**

### CMD-A — baseline

```bash
node -e "console.log('core',require('./packages/core/package.json').version,'| checkpoint',require('./packages/checkpoint/package.json').version)"
ls .changeset/*.md 2>/dev/null | grep -v README | wc -l
ls packages/checkpoint/src/
ls docs/checkpoint/
```

Measured: core `1.68.0`; checkpoint `0.0.0`; `packages/checkpoint/src/` is `cli.ts`, `index.ts`, `types.ts`, `validate.ts` — **no `sensor.ts`, no `state.ts`**; reports for 0, 1, 1.5, 0.4a present.

### CMD-B — the statusline payload shape (D-BJ's evidence)

```bash
sed -n '/^## 6/,/^## 7/p' docs/checkpoint/REPORT-checkpoint-phase-0.4a.md
```

Measured, verbatim from the 0.4a probe (413 statusline lines, one session):

```json
{
  "total_input_tokens": 65933,
  "total_output_tokens": 13,
  "context_window_size": 1000000,
  "current_usage": {
    "input_tokens": 2,
    "output_tokens": 13,
    "cache_creation_input_tokens": 65931,
    "cache_read_input_tokens": 0
  },
  "used_percentage": 7,
  "remaining_percentage": 93
}
```

Plus `exceeds_200k_tokens` (boolean) alongside `context_window`. `context_window_size` is a model constant, not a live signal. **The raw log is at the operator's `checkpoint-probe/logs/statusline.jsonl`** — if a fixture needs more shapes than the report excerpts, ask for it rather than inventing one.

### CMD-C — the state machine (parent design, unchanged)

```bash
sed -n '/^## Design reference/,/^## Open decisions/p' docs/handoffs/HANDOFF-checkpoint-handoff-before-reset.md
```

Measured edges:

```
idle     ──(Stop, usage ≥ threshold)──────────────▶ armed
armed    ──(Stop, handoff mtime > armedAt)────────▶ written
written  ──(validator pass)───────────────────────▶ settled
written  ──(validator fail)───────────────────────▶ armed
settled  ──(SessionStart clear|compact)───────────▶ reset      (single-winner)
reset    ──(injection delivered + reinject consumed)▶ resumed ──▶ idle
```

**Phase 2 implements the table and the storage. It does not implement any trigger.** Every edge above is driven by a hook event that Phase 3+ will own; Phase 2 exposes the transition function and proves it rejects every illegal move.

### CMD-D — the atomic-write seam to reuse

```bash
sed -n '60,75p' packages/core/src/state/atomic-write.ts
node -e "const p=require('./packages/checkpoint/package.json');console.log('deps:',Object.keys({...p.dependencies,...p.devDependencies}))"
```

Measured: `atomicWriteText` at `core/src/state/atomic-write.ts:69` — temp-file + rename. `checkpoint` currently depends only on `cadence-testkit`. **Decide (D-BR) whether to add a `core` dependency for this one function, or extract the pattern to a shared location.** Do not hand-roll a second atomic writer; that rule has held across the whole repo.

### CMD-E — the shell-path lesson applies to statusline commands too

0.4a proved Claude Code runs hook commands through `powershell.exe` on Windows when Git Bash isn't detected, and that this silently changed hook behavior. **The statusline command resolves through the same mechanism.** A wrapper that is byte-transparent on bash and mangles one byte on PowerShell is the same class of bug. AC-1 carries the PowerShell path explicitly.

```bash
sed -n '17,30p' .github/workflows/ci.yml
```

Measured: CI runs `windows-latest`. Determine whether the runner has Git Bash on PATH; if so, the PowerShell-path fixture must force it.

### CMD-F — dedup preflight (read-only)

```bash
node packages/core/bin/cadence.cjs recommendation list --filter-regex "checkpoint|sensor|statusline|state store|threshold" --sort-by created
node packages/core/bin/cadence.cjs decision list --filter-text checkpoint
```

Run and report; do not file.

---

## 3. Decisions (operator-reserved — record before or at phase start)

### D-BJ — Threshold unit: **record both** *(resolved by 0.4a §6; operator to file)*

The state file carries `used_percentage` (integer or `null`) **and** the absolute counts (`current_usage.*`, `total_input_tokens`, `context_window_size`). The threshold *config* names its unit. Rationale from the measurement: percentage is ~10k-token coarse; a sensor wanting finer arming should read absolutes. Recording both costs nothing and defers the choice to config.

### D-BR — How does `checkpoint` get `atomicWriteText`?

1. Add `@thomas-powers-jr/cadence-core` as a dependency of `checkpoint` for this one import.
2. Extract the atomic-write function to `types` or a small shared package.
3. Copy it.

I lean **(1)** as the cheapest honest option — `checkpoint` was isolated from `core` deliberately (Phase 1), but a runtime dependency on a stable primitive is different from coupling the validator's grammar. **(3) is disqualified.** If (1) is taken, note the isolation was for the *validator*, and record why the sensor is different.

### D-BS — Where does the state file live?

Parent design says project-keyed. Candidates: `.cadence/checkpoint/state.json` (inside the loop's directory, alongside its other state) or `.cadence-checkpoint/` (separate). I lean **inside `.cadence/`** — but note `cadence doctor`, `summary verify-all`, and the boundary scanner all walk `.cadence/`; confirm none of them will trip on a new file there. If any does, that's a finding, not a reason to move the file.

---

## 4. Phase 2 — Sensor and state store

**Objective.** A statusline wrapper writes `{ used_percentage, absolute, ts }` atomically to a project-keyed state file; a transition table accepts every legal edge and rejects every illegal one; nothing is registered as a hook.

**Investigate first:**
1. Confirm CMD-B's payload shape against the raw `statusline.jsonl` if any fixture needs a shape the report doesn't show.
2. Resolve D-BR before writing `state.ts`.
3. Determine `windows-latest`'s shell resolution (CMD-E) so AC-1's PowerShell fixture actually takes the PowerShell path.

**Acceptance criteria** (Given/When/Then in the DRAFT; anchor to committed tests and captured output, never SUMMARY prose — `dec-20260812-001`. **Numeric AC ids only.**)

- **AC-1** Given a statusline payload with `used_percentage: 42` and populated `current_usage`, when the wrapper runs, then the state file carries `{ used_percentage: 42, absolute: { … }, ts: <iso> }` and **stdout is byte-identical to the original statusline** — proven by byte comparison, **on both the bash path and the PowerShell path** (per CMD-E; the PowerShell fixture runs on the `windows-latest` CI leg, not skipped, not `continue-on-error`).
- **AC-2** Given `used_percentage: null`, when the wrapper runs, then state records `null` in that field, still records any absolutes present, and **no transition fires**.
- **AC-3** Given `used_percentage: 0` immediately following a state of `settled` or `reset` (the post-`/compact` reading 0.4a observed), when the wrapper runs, then the reading is classified **unknown**, not as a genuine `0`, and `idle → armed` does not fire. A test pins both the `null` and the post-reset-`0` cases as the same predicate.
- **AC-4** For every edge in CMD-C's machine, one test asserts the legal transition succeeds; for every *non*-edge pair (including the reverse of each legal edge and cross-state jumps such as `idle → settled`, `reset → armed`, `settled → written`), one test asserts rejection with a logged reason. The matrix is enumerated in the test file, not sampled.
- **AC-5** Given two writers invoking the wrapper concurrently, when both write, then the state file is never torn — proven by an interleaving test that reads the file mid-sequence and always parses.
- **AC-6** Per D-BJ: the state schema records both units; `docs/checkpoint/REPORT-checkpoint-phase-2.md` documents the schema and the coarse-resolution rationale for keeping absolutes.
- **AC-7** Given the wrapper installed as the statusline command, when `cadence doctor`, `cadence summary verify-all`, and the boundary scanner run, then none reports the new state file as an anomaly (per D-BS). If one does, the DRAFT records it as a finding.
- **AC-8** `.claude/settings.json` is byte-identical before and after **except** the statusline entry. No `hooks` entry is added or changed. Proven by diff.

**Files.** `packages/checkpoint/src/state.ts` (new — transition table + store) · `packages/checkpoint/src/sensor.ts` (new — wrapper) · `packages/checkpoint/package.json` (per D-BR) · tests: transition matrix, transparency (both shells), interleaving, unknown-predicate · `docs/checkpoint/REPORT-checkpoint-phase-2.md`.

**Non-goals.** No `Stop` hook. No `PreCompact` handling. No validator invocation from the sensor. No rehydration. No threshold *evaluation* — the table exposes `idle → armed` as a function; nothing calls it yet. No changes to `core`'s hook path (that is the parallel arc).

---

## 5. Standing rules

- **Numeric AC ids only.** `AC-1`, `AC-2`.
- **Ledger is operator-only.** Report candidate findings; do not file.
- **Measure, never predict.** Every figure carries the command that produced it. If §2's numbers moved, yours are correct.
- **`null` and post-reset `0` both mean unknown.** Never coerce to a real reading.
- **Reuse `atomicWriteText`.** No second atomic-write implementation (D-BR).
- **Transparent means byte-identical on both shells.** AC-1's PowerShell leg is not optional.
- **This phase registers no hook.** AC-8 is the proof. If the work seems to need one, stop — that's Phase 3.
- **Separate worktree from the hook-JSON-block work.** No shared branch.
- **Tier `complex`.** Phase 316 proved the recipe — real `deep-verify` + `code-review`, `strong`. A state store that Phase 3 will gate on deserves it.
- **Do not force-settle.** If this phase needs `--force`, stop and report.
- **Declare `stop:` on every task**; record at least one with `--execution dispatch`.
- **Honest negative results are the goal.** "The statusline command doesn't reach the wrapper on the PowerShell path at all" would be a finding worth more than the sensor.

---

## 6. Report-back protocol

1. Verbatim `cadence doctor`, before and after.
2. CMD-A through CMD-F output, with anything that moved from §2 called out.
3. Dedup preflight, before any (operator) ledger write.
4. Decision ids for **D-BJ, D-BR, D-BS** (operator-filed).
5. The state-file schema as shipped, verbatim.
6. **AC-1's byte-comparison result on both shells**, and how the PowerShell path was forced on `windows-latest`.
7. The transition-matrix test file's enumeration — every pair, legal or rejected.
8. Whether AC-7 surfaced any tool tripping on the new file.
9. Whether tier `complex` was used and whether `deep-verify` / `code-review` ran, per settle provenance.
10. Confirmation that `checkpoint` stays private at `0.0.0` and no hook was registered.
11. Any gate bypass used, with flag and reason.

---

## 7. Framing

Phase 2 is the quiet one. It can't block a session, can't inject a prompt, can't gate anything — and that's exactly why it's the right thing to build while the hook transport is being migrated in the next worktree over. When Phase 3 is authorized, it will need a state file it can trust and a transition table that already refuses every move it shouldn't make. This phase builds both, proves them against a machine it doesn't yet drive, and records a reading it doesn't yet act on.

The one thing to hold onto: the sensor's job is to tell the truth about a number, and 0.4a showed that number lies twice — `null` before the first turn, and a `0` after a reset that looks like a reading and isn't. Record both as unknown. A sensor that arms on a phantom zero is the whole arc failing on its first real session.
