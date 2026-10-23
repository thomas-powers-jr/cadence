# REPORT — Checkpoint Phase 3: the Stop Gate

**Phase:** 336 (`336-01`), tier `complex`.
**Authorizing handoff:** `docs/handoffs/HANDOFF-v1.71-release-335-336.md` §3. The work order is untracked and local to the operator's primary checkout.
**Measured on:** Windows 11 (Thomas-PC), Node v22.19.0, Windows PowerShell 5.1, git 2.54.0.windows.1, 2026-10-22.

Phase 3 is the first part of the checkpoint arc that can block a person. Three subcommands were added to the private `checkpoint` package; core gained one export and one settle-time bypass record:

- **`checkpoint stop-gate`** is a Claude Code `Stop` hook.
  - It blocks once when context usage crosses `--threshold` (default 70%).
  - It settles only on a SESSION handoff doc that validates at `cadence_handoff: 2` with no unfilled sections.
  - It force-releases at `--ceiling` (default 3) consecutive re-blocks.
- **`checkpoint session-start`** is a `SessionStart` hook. It walks the store back to `idle` as a single winner.
- **`checkpoint hooks-install --settings <path>`** writes both hooks.
- **Core changes:**
  - `findUnfilledSections` is exported from the index.
  - `settle run` records a force-release that happened inside the draft's window as a gate bypass (D-CE).

No hook was installed in this repository. Every figure below names the command or test that produced it. A statement marked **reasoned** was not measured.

## Decisions

- **D-CE, the force-release record:** option 2. The checkpoint state file is the source of truth, and settle surfaces the record as an anomaly that maps to `gateBypasses`.
  - It was recorded as `dec-20261022-001`, then superseded the same day by **`dec-20261022-002`** (D-CE rev. 1), with the operator's approval.
  - The revision makes the record a sticky `lastForcedAt`, which no later edge clears. The original wording keyed on `forced: true`, but SessionStart's reset to `idle` clears that hours before settle reads it.
  - The window anchor is the active draft's `openDrafts[].since`. The work order's "first PROGRESS write" is not recorded anywhere.
- **Reusing `findUnfilledSections`:** export it from core's index (operator choice, 2026-10-22). Checkpoint imports it; there is no second copy.
- **Where the threshold and ceiling live:** flags on the hook command, written by the installer. There are no config fields (operator choice, 2026-10-22). Defaults are threshold 70 (the operator kept this default), ceiling 3, and max reading age 600 s.
- **The new dependency:** checkpoint depends on `@thomas-powers-jr/cadence-host-toolkit` as `workspace:*` and reuses `mergeManagedHookEntries`. The operator accepted this, along with re-serializing `settings.json` (below).
- **Single-winner primitive:** `open(<project>/.cadence/checkpoint/session-start.lock, 'wx')`.
  - The winner re-reads the state under the lock.
  - A lock left by a crashed handler is reported and never broken (refuse + suggest).
  - Rename-claiming `state.json` was rejected: during a claim, readers would see a missing file and read it as `idle`.

## Transition matrix

The pure `transition()` table from Phase 2 is unchanged. Its 7 plain edges and 29 rejected pairs keep their literal matrix in `packages/checkpoint/tests/state-transitions.test.ts`.

Phase 3 adds two **guarded** edges. They are kept apart from `LEGAL_EDGES`, and each is legal only with its own context flag set to exactly `true`:

| edge | requires | used by |
|---|---|---|
| `armed → settled` | `ctx.forced === true` | the Stop gate's ceiling release |
| `armed → idle` | `ctx.sessionReset === true` | SessionStart, for a stale `armed` |

**`GUARDED_MATRIX`** sits in the same test file beside the old `MATRIX`, which still pins `armed → settled` as `reject`. It covers:

- each guarded edge with its own flag, with `false`, with the other flag, and with `{}`;
- both flags set at once, which opens no other pair.

**Store-level rules** (`packages/checkpoint/src/state.ts`, tested in `tests/state-store.test.ts`):

- `transitionStore` refuses a guard flag passed on any other edge, for example `written → settled` with `forced`, which would otherwise drop the D-CE record.
- Both writers refuse to erase an ill-typed `lastForcedAt` found on disk.
- Both writers refuse an extras patch aimed at a state other than `armed`/`written`.
- `updateStoreExtras` accepts an optional `expectedSince`, which narrows lost updates.

**Optional state fields and how each edge treats them:**

| field | meaning | carried by | cleared by |
|---|---|---|---|
| `instructed` | instruction issued for the current entry into `armed` | patch only | every edge |
| `blocks` | consecutive gate blocks in the current chain | `armed ↔ written` | every other edge; a silent Stop with `stop_hook_active: false` |
| `forced`, `forcedAt` | the latest settle was a ceiling release | the forced edge writes them | every later edge |
| `lastForcedAt` | sticky D-CE record | every edge | nothing |

### Stop gate, per state

These rules are the pure `decideStop` in `packages/checkpoint/src/stop-gate.ts`. The store is written before stdout, and nothing is printed unless every write succeeded.

| state | condition | store ops | stdout |
|---|---|---|---|
| `idle` | known effective usage ≥ threshold, fresh reading | `idle → armed` {instructed, blocks: 1} | block naming `cadence handoff` |
| `idle` | unknown usage, stale or pre-reset reading, below threshold | none | none |
| `armed` | no doc newer than `since`, not yet instructed | update {instructed, blocks} | block (instruction) |
| `armed` | no doc, already instructed | none, or `{blocks: null}` on a `stop_hook_active: false` Stop | none |
| `armed` | doc passes | `armed → written → settled` | none |
| `armed` | doc fails | `armed → written → armed` {instructed, blocks} | block with diagnostics |
| `armed` | would block, `stop_hook_active`, chain reaches ceiling | `armed → settled` {forced} (never via `written`) | `{"systemMessage": …}` |
| `settled` | any | none | none |
| `written` / `reset` / `resumed` | crash leftover | none | none; one stderr notice |

**How the effective usage is chosen** (`effectivePercentage`):

- It is `used_percentage` when that value is known (finite and > 0).
- Only when `used_percentage` is null or absent does the gate fall back to `(input_tokens + cache_creation_input_tokens + cache_read_input_tokens) / context_window_size × 100` (D-BJ, input-only).
- A `used_percentage` of `0`, a negative value, a non-finite value or a non-number reads as unknown, and never falls back. This is the post-`/compact` case: a stale `current_usage` must not block a freshly compacted session.

**The minimum version.** The gate requires a doc to declare at least `cadence_handoff: 2` only when it declares a version at all. A doc with no `cadence_handoff` key is read as the latest version (`declaredHandoffVersion`, shared with `validate()`). It is then checked against the v2 sections, so it can settle. `tests/stop-gate.test.ts` pins this. A declared `1` is the only value that triggers `version-downgrade`. `01`, `0` and `"1"` are refused by the validator as unsupported versions.

**When a reading counts as absent:**

- it is older than `--max-reading-age-s`;
- it is more than 5 s in the future;
- its `ts` is before the state's `since`, meaning it was taken before the last reset.

### SessionStart

- Only sources `startup`, `clear` and `compact` act. `resume` and `fork` change nothing.
- The winner walks to `idle` with existing edges only:
  - `settled → reset → resumed → idle`
  - `armed → idle` (sessionReset)
  - `written → armed → idle`
  - `reset → resumed → idle`
  - `resumed → idle`
- `lastForcedAt` survives every walk.

## Raw hook payloads (end-to-end capture)

**Capture setup:**

- The capture was taken from the **built** bin (`node packages/checkpoint/bin/checkpoint.cjs …`), driven by `scratchpad/336/e2e-capture.mjs`, not from an interactive Claude Code session. Headless `claude -p` never runs the statusline, so a live capture needs an interactive session; that is an operator step and is listed below.
- The script installed hooks into a throwaway project with `hooks-install --settings <tmp>/.claude/settings.json --threshold 1 --ceiling 3`.
- It then fed the bins 0.4a-shaped `Stop`/`SessionStart` stdin payloads.
- The handoff docs were rendered with core's real `renderSession` (`packages/core/dist/handoff/render-session.js`).
- Every run below exited 0 with empty stderr.

**Installed `settings.json`:** the second install printed `checkpoint hooks already installed in <path>; nothing written`.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node 'C:/Users/Thomas/Documents/Projects/cadence/.claude/worktrees/336-checkpoint-stop-gate/packages/checkpoint/bin/checkpoint.cjs' stop-gate --threshold 1 --ceiling 3"
          }
        ],
        "_managedBy": "cadence-checkpoint"
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node 'C:/Users/Thomas/Documents/Projects/cadence/.claude/worktrees/336-checkpoint-stop-gate/packages/checkpoint/bin/checkpoint.cjs' session-start"
          }
        ],
        "_managedBy": "cadence-checkpoint"
      }
    ]
  }
}
```

**Blocked: threshold crossing** (`idle`, a reading of 42%, `stop_hook_active: false`). Stdout, verbatim:

```
{"decision":"block","reason":"checkpoint: context usage is 42% (threshold 1%). Before you stop, run `cadence handoff` to scaffold a SESSION handoff doc under .cadence/handoff/, then fill every section: replace each FILL IN marker with narrative, and write None under Open decisions if there are none. Keep `cadence_handoff: 2` in its frontmatter and set nothing below `cadence_handoff: 2`. Then stop again so the gate can check the doc."}
```

Store after: `{"state":"armed","since":"2026-10-22T19:33:23.642Z","instructed":true,"blocks":1}`. The next Stop, with `stop_hook_active: true` and no doc, printed nothing (one instruction per entry into `armed`).

**Blocked: invalid doc.** The doc was unfilled (rendered scaffold) and `stop_hook_active` was `false`, so the chain restarted at 1. Stdout:

```
{"decision":"block","reason":"checkpoint: the newest handoff doc does not pass the checkpoint gate: [unfilled-section] \"TL;DR for the next session\" still holds a FILL IN marker; [unfilled-section] \"What landed this session\" still holds a FILL IN marker; [unfilled-section] \"Carry-forward gotchas\" still holds a FILL IN marker; [unfilled-section] \"Open decisions\" still holds a FILL IN marker; [unfilled-section] \"Next action\" still holds a FILL IN marker. Fix that doc (or run `cadence handoff` for a fresh scaffold), fill every section, set nothing below `cadence_handoff: 2`, then stop again."}
```

The same unfilled content, rewritten so its mtime was after the new `since`, then blocked again with `stop_hook_active: true` and `blocks: 2`. Each `written → armed` restamps `since`. An unchanged invalid doc is therefore not re-checked, and the next Stop with no newer doc is silent.

**Forced: ceiling release** (the third consecutive would-be block, `stop_hook_active: true`). Stdout:

```
{"systemMessage":"checkpoint: released this stop at the block ceiling of 3 consecutive blocks without a valid handoff doc. A force-release is recorded in .cadence/checkpoint/state.json (forced, forcedAt, lastForcedAt), and settle reports it as a checkpoint-stop ceiling-release bypass. Write the handoff with `cadence handoff` before ending the session."}
```

Store after: `{"state":"settled","since":"2026-10-22T19:33:23.946Z","forced":true,"forcedAt":"2026-10-22T19:33:23.946Z","lastForcedAt":"2026-10-22T19:33:23.946Z"}`.

**Reset.** `SessionStart` with `source: "clear"` printed nothing. Store after: `{"state":"idle","since":"2026-10-22T19:33:24.100Z","lastForcedAt":"2026-10-22T19:33:23.946Z"}`. The forced fields are gone and the sticky record stays.

**Released: valid handoff.** A fresh 55% reading blocked and armed again, with the same instruction text at 55%. Then a filled v2 doc (every marker replaced) made the gate exit 0 with **empty stdout**, so the agent was allowed to stop. Store after: `{"state":"settled","since":"2026-10-22T19:33:24.250Z","lastForcedAt":"2026-10-22T19:33:23.946Z"}`. A `SessionStart` with `source: "resume"` then left it unchanged.

## Settle: providers, grade, bypasses

**Run:** `CADENCE_HOST_CLI_BIN=codex node packages/core/bin/cadence.cjs settle run --auto`, run detached in this worktree with no `--force` or `--allow-*`.

**Refused attempts:**
1. **Untracked files.** Deep-verify rejected AC-2, AC-4, AC-5, AC-6 and AC-7 as having no proving test. Every new source and test file was untracked, and the review diff includes only tracked files, so the verifier never saw them. This is the Phase 2 trap repeated, and it was fixed the same way: `git add -N` on the new files, which commits nothing.
2. **Truncated diff.** Deep-verify rejected AC-5. The 326,244-byte diff was truncated to the 262,144-byte `verifier.diffCapBytes`. That dropped `packages/checkpoint/tests/stop-gate.test.ts` (which holds AC-5's proving tests) and every core file in this phase. So the attempt's passes on AC-15 and AC-16 also had no code behind them and count as no evidence.
   - **Fix:** the operator raised `verifier.diffCapBytes` permanently to 393216 (384 KiB) in `.cadence/config.json`, committed with this phase (operator choice, 2026-10-22).
   - **Why it's safe:** prompts reach the host CLI on stdin, so the cap is bounded by context and cost, not by an OS argument limit (see `docs/reference/config.md`).
   - **Cost:** every future settle that runs deep-verify can send a larger prompt and use more host-CLI quota.
3. **First-reference linkage.** The full 327,434-byte diff was sent untruncated, and deep-verify still rejected AC-4, AC-5, AC-6, AC-7 and AC-20.
   - **Cause for AC-4 to AC-7: the linked tests.** Settle's coverage scan links only the first `336-01/AC-N` occurrence in each test file. In `packages/checkpoint/tests/stop-gate.test.ts` those first occurrences were fixture-precondition checks, so the verifier was told the linked tests were renderer and validator sanity checks. The gate tests that prove those ACs, such as the valid doc settling and the version-downgrade block, came later in the same file. For AC-7, only the filled-doc BOM pair was linked, not the unfilled pair. A scan of all 20 ACs showed AC-17 had the same weak first link.
   - **Fix, with no behaviour change:**
     - The three fixture checks keep their assertions and drop their AC tokens.
     - The first AC-7 test now covers both twin pairs.
     - Two AC-17 helper pins drop their tokens.
   - **AC-20 was a substantive rejection.** Re-serialization can change formatting outside the managed entries. That includes CRLF line endings, duplicate keys, number and string-escape spellings (integers beyond 2^53 among them) and integer-like key order. The literal AC forbade that, and the pre-BUILD summary given to the operator ("refuses any edit that changes anything outside its own entries") overstated the guard. The operator approved an As-built amendment of AC-20 to semantic equality as `JSON.parse` sees the file (2026-10-23), choosing it over a byte-preserving rework. AC-20's first linked test now also asserts parsed equality outside the checkpoint entries and the guard's refusal of a tampered plan.

**Results** (attempt 4, `Settled 336-01` at `2026-10-23T13:46:08.428Z`; figures read from `.cadence/phases/336-checkpoint-stop-gate/336-01-SUMMARY.json`):
- **`deep-verify`:** ran under host-cli, with `CADENCE_HOST_CLI_BIN=codex` set in the environment and in `.env`. `deepVerifyMeta` is `{ diffProvided: true, diffBytes: 332807, truncated: false, filesCount: 31, provider: "host-cli" }`. All 20 ACs passed with evidence `ai-verified` (`evidenceTally.ai-verified` = 20).
- **`code-review`:** ran under host-cli (`providerSelection: "configured"`, codex). It converged on its first pass with no HIGH finding (`336-01-CODE-REVIEW.json`: `pass: true`). It reported two MEDIUM findings, both left open and listed under candidate findings below.
- **`assurance.overall`:** `strong`.
- **`gateBypasses`:** absent from the SUMMARY, meaning none. No `--force` or `--allow-*` flag was used.
- **Anomalies:** none were recorded in the SUMMARY. The run printed the expected `files-outside-boundary` warn on stderr for `docs/handoffs/HANDOFF-v1.71-release-335-336.md`. That work order was copied into the worktree for reference and moved out before settle; it was never edited.
- **Conduction-drift streak:** `cadence status` reports 0, broken by this SUMMARY, which carried a non-mock verifier identity.

## Premises that proved wrong (report-back #4)

- **`findUnfilledSections` already exists.** The work order said it did not; it is in core (`packages/core/src/handoff/placeholders.ts`). It was not exported from core's index, and core's `exports` map has only `"."`, so reusing it took a new export.
- **The state store dropped extra fields.** `transitionStore` rewrote `{state, since}` from scratch, so the instruction flag, block chain and force record needed a store extension (T3).
- **There was no `armed → settled` edge.** The ceiling row of the work order's table had no edge to use; one was added as a guarded edge.
- **AC-2's unknown reading keys on a different field.** The unknown-reading rule keys on `used_percentage` (null, 0 and absent all count), not on `current_usage`. A null `current_usage` only stops the absolute fallback.
- **Settle's `emit.anomalies` seam is a no-op** (as D-CA found). D-CE's anomaly therefore goes in through the pure `collectAnomalies`, which adds `packages/core/src/notify/collect.ts` to the core files the work order listed.
- **D-CE's window anchor is not recorded.** "After the phase's first PROGRESS write" does not exist anywhere (each task's `updatedAt` is overwritten), so the anchor became `openDrafts[].since`.
- **D-CE as first worded missed its common case.** Keying on `forced: true` misses the usual sequence (release, then `/clear`, then settle). Superseded by the sticky `lastForcedAt` (`dec-20261022-002`).
- **The state header listed too few reset sources.** `state.ts` named `SessionStart clear|compact` as the reset sources. A fresh `startup` after a settled session would then stay settled forever, so `startup` resets too. `resume` and `fork` do not.

## Candidate findings (not filed; the ledger is operator-only for this arc)

- **Consumer `.gitignore`.** `cadence init`'s consumer `.gitignore` template still does not ignore `.cadence/checkpoint/` (the work order said to file this as a rec, not fix it here).
- **Hooks point at one checkout's bin.** The installed hook command points at the installing checkout's `bin/checkpoint.cjs`, as `statusline-install` does. Installing from a worktree that is later deleted leaves a dangling `Stop`/`SessionStart` hook that fails, non-blocking, on every turn.
- **The bin can still exit 1.** `bin/checkpoint.cjs` exits 1 when `dist` or core fails to load, or on Node < 22. Claude Code treats that as non-blocking, so nothing wedges, but it breaks "every non-block path exits 0" in letter.
- **CRLF docs lose their section names in core.** `findUnfilledSections` splits on `\n` only, so a CRLF doc's markers are reported under `(preamble)`. The gate still blocks.
- **A non-UTF-8 handoff doc fails silently for the agent.** The shell treats it as no doc and writes one `NON_UTF8_INPUT` stderr line. It can never settle, but the agent never sees the encoding problem: exit-0 Stop stderr is not shown to it. Making it visible needs a change to `decideStop`'s input contract.
- **Impossible dates pass the timestamp check** (settle code-review, MEDIUM, open). The strict ISO check in `packages/checkpoint/src/state.ts` and core's `ISO_DATETIME_RE` both rely on `Date.parse`, which normalizes an impossible date such as `2026-02-30` instead of rejecting it. A hand-edited, malformed `lastForcedAt` could therefore still count as a force-release record.
- **`stop_hook_active` is not specific to this gate** (also raised by settle code-review, MEDIUM, open). It is set when any Stop hook blocks. A chain can therefore overcount by one when another hook's block precedes this gate's first block of a chain.
- **Windows read during a concurrent rename.** On Windows, `readMachineState` has no retry for a read that hits a concurrent rename (`EPERM`). In a two-session race that would print a spurious "cannot read" line. It is harmless under the single-session precondition.
- **Re-serializing `settings.json` loses some detail.** The losses include duplicate keys, number spellings (integers above 2^53, `1.0`, `1e3`, `-0`), string-escape spellings, integer-like key order and CRLF. The guard compares parsed values and cannot see these.
- **Not every evasion leaves a force record.** An agent that ignores the instruction, or writes one invalid doc and stops, is silent after the first block. That follows CMD-D, one instruction per entry into `armed`. No chain grows, so no `lastForcedAt` is written, and the next `SessionStart` resets the stale `armed` to `idle`. The `mixed` cap therefore covers only sessions that keep producing invalid docs until the ceiling.
- **Pre-filled text can fail validation.** The validator's `MEASURED_CONTEXT_MISSING_COMMAND` check also scans the fenced pre-filled lines in "State on handoff" (`validate.ts`). A real `cadence handoff` render whose `git log --oneline -8` contains a percentage-like commit subject could fail on content the agent did not write. There were zero such subjects in this repo's last 2000 commits.
- **Deep-verify sees only one linked test per AC per file (core).** `scanTestCoverage` links only the first `AC-N` occurrence in each test file, and the verifier prompt lists those references as an AC's linked tests. A file that opens with a weak or precondition test for an AC therefore hides its stronger proofs from the verifier, even when the full diff is present. This caused settle attempt 3's AC-4 to AC-7 rejections. Linking every asserting block per file, or the best one, is a core change outside this phase.
- **Changeset trap at release time** (carried from 335). Any test that reads the live `.changeset/` directory breaks the release PR (`core-export.test.ts` reads it). A candidate step for release-cut: run the full suite after `changeset version`, before committing.

## Phase 4 preconditions

- **A record settle can't compare is not counted.** A valid `lastForcedAt` whose active draft has no parseable `openDrafts[].since` produces one stderr line from `settle run` (`settle: checkpoint force-release record (lastForcedAt …) found but the active draft has no open-time to compare it against; not recorded as a bypass`) and no bypass. An absent, older or malformed record is silent.
- **Same checkout only.**
  - Where the gate writes: it resolves its store from the Stop payload's `cwd`, walking up to the nearest `.cadence/`.
  - Where settle reads: `<settle cwd>/.cadence/checkpoint/state.json`.
  - Every git worktree has its own `.cadence/`. A session rooted in the primary checkout that builds and settles a phase in `.claude/worktrees/<slug>` records its force-release in the primary's store, and the worktree's settle never sees it. Nothing warns about this.
  - Native worktree sessions root their `cwd` inside the worktree, so the common flow is covered, but nothing enforces it.
- **One session per project.** Neither the store writers nor the gate lock against a concurrent Stop gate in a second Claude Code session on the same project. `updateStoreExtras` narrows the window with `expectedSince`; `transitionStore` re-validates each edge but has no compare-and-swap. A reading from a different session in the same project is also accepted as this session's.
- **A stale lock wedges resets.** `session-start.lock` left by a crash refuses every later reset until it is deleted by hand. The notice prints on every `SessionStart`. It is not known whether Claude Code shows a `SessionStart` hook's exit-0 stderr to the human, which decides how actionable the notice is.
- **An interrupted plan leaves a leftover state.** If a two-write plan is interrupted between its writes (`armed → written`, then `→ armed` or `→ settled`), the store is left in `written`. The gate stays inert (one stderr notice per Stop) until the next `SessionStart` walks it to `idle`.
- **No internal deadline.** A stalled network filesystem holds `Stop` until Claude Code's own hook timeout.
- **Live capture outstanding.** No interactive Claude Code session has run the installed hooks yet. Before Phase 4 relies on the harness behaviour seen here, an operator should capture the real loop with a low `--threshold` in a scratch project: the block, the synthetic re-block, the ceiling release `systemMessage`, and the `/clear` reset.
- **Brief-mode `resume` warning.** It is still Phase 5's job, as recorded out of scope.
