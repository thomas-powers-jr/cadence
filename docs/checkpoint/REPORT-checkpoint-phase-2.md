# REPORT — Checkpoint Phase 2: Sensor and State Store

**Phase:** 331 (`331-01`), tier `complex`.
**Authorizing handoff:** `docs/handoffs/HANDOFF-checkpoint-phase-2.md`.
**Measured on:** Windows 11 (Thomas-PC), Node 22.19.0, Windows PowerShell 5.1, Git for Windows at `C:\Git`, 2026-10-15.

Phase 2 builds the sensor and the state store. Neither can block, inject or gate anything:

- `checkpoint statusline [--] <inner argv>` is a transparent statusline wrapper. It records a reading to `<project>/.cadence/checkpoint/reading.json`.
- `packages/checkpoint/src/state.ts` holds a transition table and a machine-state store at `<project>/.cadence/checkpoint/state.json`. Nothing outside tests calls it yet.
- `checkpoint statusline-install --settings <path>` wraps an existing `statusLine` command in a settings file. It changes nothing else in that file.

No hook is registered. Every figure below names the command or probe that produced it. A statement marked **reasoned** was not measured and carries no figure.

## Doctor before and after

Before is `node packages/core/bin/cadence.cjs doctor`, run at phase start in the first worktree, before any change. This is an excerpt, not the verbatim output: it keeps only the three non-ok lines, two of them elided with `…`, and the summary line. Every other check was `✓ ok`:

```
  ! warning worktree-phases: phase number collision across worktrees: … → Renumber one side; the next free phase number is 331.
  ! warning conduction-reachability: Real-provider conduction reachability — code-review: blocked by session; security-audit: blocked by profile, provider.
  ! warning conduction-drift-streak: 3 consecutive most-recent settle(s) with no non-mock verifier identity, broken by .cadence/phases/327-assurance-report/327-01-SUMMARY.json …

3 problem(s) across 27 checks.
```

During the build, doctor in `.claude/worktrees/331-sensor` reported `4 problem(s) across 27 checks.` The fourth problem is `release-currency`, raised by this phase's own pending core changeset (`checkpoint-sensor-core-atomic-write-export.md (minor)`). That is expected until a release consumes it.

After the settle, in the same worktree, `node packages/core/bin/cadence.cjs doctor` reported `3 problem(s) across 27 checks.`, all warnings:

- **`worktree-phases`:** phase numbers collide with the primary checkout's. Sibling worktrees share history, so this is expected.
- **`release-currency`:** this phase's own unreleased core changeset.
- **`conduction-reachability`:** reports that `code-review`'s real provider is blocked inside this session (the self-invocation guard).

## Baseline measurements

The handoff's CMD-A to CMD-E commands, run at phase start. Items that differ from the handoff's §2 are marked **moved**.

- **CMD-A:**
  - **moved:** core is `1.70.0`, not `1.68.0`.
  - checkpoint is `0.0.0`.
  - There were 0 pending changesets.
  - `packages/checkpoint/src/` held `cli.ts index.ts types.ts validate.ts`, with no `sensor.ts` or `state.ts`.
  - `docs/checkpoint/` held the reports for 0, 1, 1.5 and 0.4a.
- **CMD-B:** the 0.4a §6 payload excerpt matched the handoff.
  - This phase used Claude Code's documented statusline schema (code.claude.com/docs/en/statusline) as the primary source for the fixtures: fields under `context_window.*`, a top-level `exceeds_200k_tokens`, and `workspace.current_dir` / `workspace.project_dir`.
  - The raw `statusline.jsonl` lives on the operator's previous PC, `C:\Users\softw\…`, and was not needed.
- **CMD-C:** the state machine matched the parent design exactly.
- **CMD-D:**
  - `atomicWriteText` sits at `core/src/state/atomic-write.ts:69` and uses temp-file plus rename.
  - **moved:** checkpoint already listed `@thomas-powers-jr/cadence-core` as a devDependency (phase 316), not "only `cadence-testkit`".
  - **moved:** core's package entry did not export `atomicWriteText`.
  - D-BR therefore needed one additive re-export in `packages/core/src/index.ts` and a move of core to checkpoint's runtime `dependencies`.
- **CMD-E:**
  - `.github/workflows/ci.yml` runs `windows-latest` in the matrix.
  - Claude Code's statusline docs say the command runs through Git Bash when it is installed, and through PowerShell otherwise. That is the same fallback 0.4a measured for hooks.
  - The test spawns `powershell.exe` itself, so the PowerShell path is forced whether or not the runner has Git Bash (see Byte transparency per shell).

## Dedup preflight

These commands were run read-only before any ledger write. This phase made no ledger write.

- `node packages/core/bin/cadence.cjs recommendation list --filter-regex "checkpoint|sensor|statusline|state store|threshold" --sort-by created` returned four unrelated recommendations: rec-20260806-008, rec-20260811-003, rec-20260815-004 and rec-20261010-006. None covers the sensor or the state store.
- `node packages/core/bin/cadence.cjs decision list --filter-text checkpoint` returned dec-20260925-001 (D-BN) and the three decisions listed below.

## Decisions

The operator filed these before the phase started:

- **D-BJ:** `dec-20261013-001`. The threshold is a percentage with an absolute-token fallback, and state records both units.
- **D-BR:** `dec-20261013-002`. Checkpoint depends on cadence-core for `atomicWriteText`. The function is neither copied nor extracted.
- **D-BS:** `dec-20261013-003`. The state lives at `.cadence/checkpoint/` and is keyed by project.

The operator chose these in chat on 2026-10-15. They are recorded in the DRAFT, not in the ledger:

- **Project resolution.** Start at `workspace.current_dir` and use the nearest ancestor that contains `.cadence/` (see Project resolution).
- **Fallback percentage.** D-BJ's computed fallback percentage is deferred to Phase 3 (see Why absolutes are kept).
- **Ledger routing.** Recommendations auto-routed into the ledger at settle are held out of the phase commit for operator review.

## Reading schema

The sensor writes the following to `reading.json`. This is the actual output of the built wrapper on `packages/checkpoint/tests/fixtures/statusline/payload-42.json`, with the directories pointed at a scratch project:

```json
{
  "used_percentage": 42,
  "unknown": false,
  "absolute": {
    "total_input_tokens": 15500,
    "total_output_tokens": 1200,
    "context_window_size": 200000,
    "current_usage": {
      "input_tokens": 8500,
      "output_tokens": 1200,
      "cache_creation_input_tokens": 5000,
      "cache_read_input_tokens": 2000
    }
  },
  "exceeds_200k_tokens": false,
  "current_dir": "<scratch project>",
  "project_dir": "<scratch project>",
  "ts": "2026-10-15T19:12:13.202Z"
}
```

Field rules (type `CheckpointReading` in `packages/checkpoint/src/sensor.ts`):

- **`used_percentage`:** a number, or `null`. Every observed payload has carried an integer. The value is recorded raw, and a value that isn't a finite number becomes `null`. AC-6's "integer or `null`" wording is amended to this in the DRAFT's "As built" note.
- **`unknown`:** `true` when `used_percentage` is `null`, absent or `0`. This is the single predicate `isUnknownReading` in `state.ts`.
- **`absolute`:** `total_input_tokens`, `total_output_tokens` and `context_window_size` are each a number or `null`. `current_usage` holds the four fields shown above, or is `null` (Claude Code sends `null` before the first API call and again after `/compact`).
- **`exceeds_200k_tokens`:** a boolean, or `null`.
- **`current_dir` and `project_dir`:** strings, or `null`. They are raw payload values; an empty string becomes `null`.
- **`ts`:** an ISO-8601 timestamp taken when the reading was recorded.

Machine state (`state.json`) is a separate file, `{ "state": "<one of 6>", "since": "<ISO-8601>" }`. Only `transitionStore` writes it. The sensor never reads or writes it, so the two never read-modify-write each other's file.

## Byte transparency per shell

Command: `pnpm --filter @thomas-powers-jr/cadence-checkpoint exec vitest run tests/sensor-shell-transparency.test.ts --coverage.enabled=false --reporter=verbose`. All three `331-01/AC-1` cases ran (✓, none skipped). Measurement lines, verbatim:

```
[331-01/AC-1 measure] bash resolved to C:\Git\bin\bash.exe; uname -s = MINGW64_NT-10.0-26300
[331-01/AC-1 measure] raw node inner vs bash inner: equal (62 bytes)
[331-01/AC-1 measure] bash inner vs bash wrapper: equal (62 bytes)
[331-01/AC-1 measure] raw node inner vs PowerShell inner: equal (62 bytes)
[331-01/AC-1 measure] raw node inner hex: 1b5b33326de29c9320c39c6ec3af63c3b864c3a920e2809420e697a5e69cac1b5b306d0a1b5b313b33346d6d6f64656c3a1b5b306d204f7075730a637478
[331-01/AC-1 measure] PowerShell inner hex: 1b5b33326de29c9320c39c6ec3af63c3b864c3a920e2809420e697a5e69cac1b5b306d0a1b5b313b33346d6d6f64656c3a1b5b306d204f7075730a637478
[331-01/AC-1 measure] PowerShell inner vs PowerShell wrapper (--): equal (62 bytes)
[331-01/AC-1 measure] PowerShell inner vs PowerShell wrapper (no --): equal (62 bytes)
[331-01/AC-1 measure] PowerShell exit status: inner 0, wrapper (--) 0, wrapper (no --) 0
[331-01/AC-1 measure] PowerShell -Command argv for `statusline -- node x`: ["statusline","--","node","x"]
[331-01/AC-1 measure] PowerShell -Command argv for `statusline node x`: ["statusline","node","x"]
[331-01/AC-1 measure] PowerShell -Command exit status for `inner exits 3`: 1
[331-01/AC-1 measure] PowerShell -Command exit status for `inner exits 3; exit $LASTEXITCODE`: 3
[331-01/AC-1 measure] PowerShell -Command exit status for `wrapper around inner exiting 3`: 1
```

What these lines show:

- **The comparison.** For each shell S, the inner fixture runs through S, and `checkpoint statusline -- <inner>` runs through the same S with the same stdin. The two stdout buffers are compared with `Buffer.equals`.
- **The fixture.** Its output contains ANSI SGR escapes, multibyte UTF-8, LF-only line endings and no trailing newline. It echoes `model.display_name` from stdin, which proves the input was forwarded.
- **Byte-for-byte result.** The output was byte-identical through Git Bash and through `powershell.exe -NoProfile -Command`, with and without `--`. Windows PowerShell 5.1 did not re-encode a native program's stdout on this path, and it did not strip a bare `--`.
- **How PowerShell is forced.** The test helper (`tests/helpers/shells.ts`) spawns `powershell.exe -NoProfile -Command`, the spawn shape from 0.4a §5c. The only run condition is `it.runIf(process.platform === 'win32')`, so this case runs on the `windows-latest` CI leg and on win32 dev boxes.
- **How Git Bash is resolved.** The helper resolves it from `git --exec-path`, never from a bare `bash` on PATH, and asserts that `uname -s` reports MINGW/MSYS. That rules out the WSL launcher.
- **Exit codes.** Through `powershell.exe -Command`, a native nonzero exit collapses to 1 unless the command ends with `; exit $LASTEXITCODE`. This reproduces 0.4a §5c for statusline commands. The wrapper forwards its inner's exit code correctly; PowerShell collapses it.
- **Through the installer.** `tests/install.test.ts` installs into a temp settings file, then runs the installed command string through Git Bash and through `powershell.exe -NoProfile -Command`. Both are byte-identical to the original command run through the same shell.
- **Not covered by these tests.** It is not known whether Claude Code adds other PowerShell flags or uses `pwsh` instead of `powershell.exe`.
- **Bare form versus `&` form.** Measured from Windows PowerShell 5.1.26100.9444 with an argv probe (`process.stdout.write(JSON.stringify(process.argv.slice(2)))`), run as `powershell.exe -NoProfile -Command "<form>"`:

  ```
  node '<probe>' statusline -- node x    → ["statusline","--","node","x"]
  & node '<probe>' statusline -- node x  → ["statusline","--","node","x"]
  node '<probe>' statusline node x       → ["statusline","node","x"]
  ```

  The bare form and the `&` form deliver the same argv, and neither strips `--`.
- **windows-latest CI log.** These lines are from run `38921906308`, job `117043679708` (`test (windows-latest, 22)`). The run was on head `0ded6922`, checked out as CI merge ref `01d79b4` onto `2427df2d`, at `2026-10-16T15:15Z`:

  ```
  [331-01/AC-1 measure] bash resolved to C:\Program Files\Git\bin\bash.exe; uname -s = MINGW64_NT-10.0-26100
  [331-01/AC-1 measure] raw node inner vs bash inner: equal (62 bytes)
  [331-01/AC-1 measure] bash inner vs bash wrapper: equal (62 bytes)
  [331-01/AC-1 measure] raw node inner vs PowerShell inner: equal (62 bytes)
  [331-01/AC-1 measure] raw node inner hex: 1b5b33326de29c9320c39c6ec3af63c3b864c3a920e2809420e697a5e69cac1b5b306d0a1b5b313b33346d6d6f64656c3a1b5b306d204f7075730a637478
  [331-01/AC-1 measure] PowerShell inner hex: 1b5b33326de29c9320c39c6ec3af63c3b864c3a920e2809420e697a5e69cac1b5b306d0a1b5b313b33346d6d6f64656c3a1b5b306d204f7075730a637478
  [331-01/AC-1 measure] PowerShell inner vs PowerShell wrapper (--): equal (62 bytes)
  [331-01/AC-1 measure] PowerShell inner vs PowerShell wrapper (no --): equal (62 bytes)
  [331-01/AC-1 measure] PowerShell exit status: inner 0, wrapper (--) 0, wrapper (no --) 0
  [331-01/AC-1 measure] PowerShell -Command argv for `statusline -- node x`: ["statusline","--","node","x"]
  [331-01/AC-1 measure] PowerShell -Command argv for `statusline node x`: ["statusline","node","x"]
  [331-01/AC-1 measure] PowerShell -Command exit status for `inner exits 3`: 1
  [331-01/AC-1 measure] PowerShell -Command exit status for `inner exits 3; exit $LASTEXITCODE`: 3
  [331-01/AC-1 measure] PowerShell -Command exit status for `wrapper around inner exiting 3`: 1
  ```

  **The leg was red, so read these lines narrowly.**
  - **What passed:** all 3 tests in `sensor-shell-transparency.test.ts`, and both AC-8 installed-command shell tests (bash and `powershell.exe -NoProfile -Command`).
  - **What failed:** 3 tests in `sensor.test.ts`'s built-wrapper suite (AC-1 state-file half, AC-2, AC-9). Each failed on the 250 ms deadline notice appearing on stderr, and AC-5 logged `writeNotices=11` of 30.
  - **What that means for byte-transparency:** the AC-1 state-file half asserts `stderr === ''` before it compares stdout, so its stdout byte-equality check never ran on this leg. On windows-latest, byte-transparency rests on the shell-transparency and AC-8 tests above, not on the built-wrapper suite. The deadline failures are slice 331-02's.

## Transition matrix

States: `idle`, `armed`, `written`, `settled`, `reset`, `resumed`. That gives 36 ordered pairs, of which 7 are legal and 29 are rejected. They are enumerated by hand as a literal table in `packages/checkpoint/tests/state-transitions.test.ts` (not derived from `LEGAL_EDGES`). The rows are from-states and the columns are to-states:

| from \ to | idle | armed | written | settled | reset | resumed |
|---|---|---|---|---|---|---|
| idle | reject | **accept** | reject | reject | reject | reject |
| armed | reject | reject | **accept** | reject | reject | reject |
| written | reject | **accept** | reject | **accept** | reject | reject |
| settled | reject | reject | reject | reject | **accept** | reject |
| reset | reject | reject | reject | reject | reject | **accept** |
| resumed | **accept** | reject | reject | reject | reject | reject |

- **Rejection reasons.** Every rejection returns a one-line reason naming both states. `transitionStore` writes that reason to stderr once and leaves `state.json` byte-unchanged. `tests/state-store.test.ts` loops over a separate literal list of all 29 rejected pairs to prove this.
- **Arming needs a known reading.** `idle → armed` also needs a known reading in its context. A `null`, absent or `0` `used_percentage`, or no reading at all, is rejected with "unknown reading". The matrix test passes a known reading so that this pair exercises the plain legal edge.
- **Mutual reverses.** `armed → written` and `written → armed` are both legal CMD-C edges, so each is the other's reverse. The handoff's "reverse of every legal edge is rejected" therefore holds for the other five edges only (DRAFT AC-4 "As built").
- **Corrupt store.** A corrupt store is refused and never read as `idle`. That covers unparseable JSON, an unknown state, or a regular file where `.cadence/` or `.cadence/checkpoint/` should be (Windows reports `ENOENT` and POSIX reports `ENOTDIR`; both are handled).

## Tool sweep

All three tools were checked with the checkpoint files present, and none flags them.

- **The test** is `packages/checkpoint/tests/state-files-tool-sweep.test.ts`, in a testkit ephemeral repo with `.cadence/checkpoint/reading.json`, `state.json` and `reading.json.123.abcdef.tmp` seeded:
  - `cadence doctor --json`: the check names, severities, `ok` and exit status are identical with and without the seeded files, and no detail mentions them.
  - `cadence summary verify-all`: stdout, stderr and exit status are identical.
  - The boundary scan's `collectUnscopedTouchedFiles` does see all three files (asserted as a premise), and `filterCadenceSelfWrites` drops all three.
- **This worktree, by hand.**
  - `node packages/core/bin/cadence.cjs doctor` and `node packages/core/bin/cadence.cjs summary verify-all` were each run once without and once with seeded `.cadence/checkpoint/{reading.json,state.json,x.tmp}`.
  - Both diffs are empty, byte for byte. Doctor printed `4 problem(s) across 27 checks.` and exited 0 in both runs. verify-all printed `341 checked: 104 MATCH, 237 NO_HASH, 0 failed` and exited 0 in both runs.
  - Doctor's two mentions of "checkpoint" appear identically in both runs. One is the phase directory name; the other is this phase's changeset filename. Neither is a state file.
- **Not covered.** The sweep tested untracked files only. Nothing stops a consumer from committing `.cadence/checkpoint/`, and doctor's `state-tracked` check would not flag it (see Phase 3 preconditions).

## Tier and review provenance

The tier is `complex`, declared so that `deep-verify` and `code-review` fire.

Every task had one implementer subagent and one independent Opus reviewer. Each completion claim was re-run in the main thread before it was recorded. The independent reviewers changed the result:

- **T2:** a corrupt store read as `idle` on win32, store-level coverage existed for only 3 of the 29 rejected pairs, and a POSIX `ENOTDIR` parity gap would have turned CI red.
- **T3:** the `~/.cadence` exclusion compared path strings, so a junction, a symlinked home or an 8.3 short name could alias past it. The reviewer reproduced this.

Settle-time gate provenance, from `331-01-SUMMARY.json`:

- **`deep-verify`:** `status: "ran"`, `observedProvider: "host-cli"`. `deepVerifyMeta` is `{"diffProvided":true,"diffBytes":246366,"truncated":false,"filesCount":31,"provider":"host-cli"}`. All 10 ACs `pass` with evidence `ai-verified`.
- **`code-review`:** `status: "ran"`, `provider: "host-cli"`, `providerSelection: "configured"`. It did **not** converge, ending at 7/3 attempts, and was bypassed with `--allow-code-review-failure` (see "Gate bypasses"). The `ran` status does not reflect the bypass.
- **`assurance`:** `verifierRollup` `[{"provider":"host-cli","gateCount":1}]`, `evidenceTally` 10 `ai-verified`, `overall` `"strong"`. Because of the recording gap described under "Gate bypasses", read the phase as `mixed`.

## Package and hook status

- `packages/checkpoint/package.json` stays `"private": true` at `"version": "0.0.0"`.
- `pnpm changeset status --verbose --output <file>` lists `@thomas-powers-jr/cadence-checkpoint` as `"type": "none"`, `"oldVersion": "0.0.0"`, `"newVersion": "0.0.0"`. Core's fixed group goes `minor` from this phase's changeset.
- `tests/core-export.test.ts` asserts this (AC-10). It runs the real changesets CLI (`node_modules/@changesets/cli/bin.js status --verbose --output release-plan.json`) against a temp git repo on `main` holding this repo's workspace manifests and its real `.changeset/` directory, so the plan does not depend on CI's shallow checkout. It asserts that no changeset names checkpoint and checkpoint stays at `none` `0.0.0`. It also asserts that the five fixed-group packages share one type and version, and that while this phase's changeset is unreleased the group bumps at least `minor`. A mutation check (a temporary checkpoint `patch` changeset) made it fail. Added after settle's `deep-verify` (host-cli provider) rejected AC-10 because no test ran this command.
- No hook is registered or changed anywhere. `git diff --stat main -- .claude/settings.json` is empty, and `tests/install.test.ts` asserts that the repository's tracked `.claude/settings.json` has no `statusLine` key.

## Gate bypasses

The phase rule is no `--force` and no `--allow-*`, unless the operator authorizes it. One bypass was authorized:

> **Code-review bypass, authorized 2026-10-16, finding 6 only.** HIGH finding 6 (Windows ACL loss on rename) is a property of core's `atomicWriteText` at 28 call sites, pre-dates this phase, is not reachable through any published code path, and is filed as `rec-20261016-001` against core for its own phase. Bypass authorized for this finding only. Any further HIGH surfaced at settle is a new decision, not covered here. The earlier pre-authorization for the hung-filesystem residual (`process.exit` + libuv threadpool) stands separately.

### What the settle actually did

The settle was `settle run --auto --allow-code-review-failure`, which settled `331-01` at `2026-10-16T16:44:59.903Z`.

- **The flag bypassed more than was authorized.** `--allow-code-review-failure` applies to the whole gate; core's `code-review.ts` notes that it "bypasses ANY failing code-review", and it cannot be scoped to one finding. This run raised **two** HIGHs, and the settle went past both:
  - **Finding 6 (authorized):** `install.ts:447`. "On Windows, rename replaces settings.json with a temp file inheriting the parent DACL, dropping explicit ACLs."
  - **Finding 7 (not authorized beforehand):** `sensor.ts:322`. "All inner stdout is buffered until exit. A verbose or non-terminating statusline grows memory without bound and never renders; stream output with backpressure instead." The authorization above did not cover it. The operator saw it after the settle and chose to keep the settle and record it here, rather than void it and fix the buffering in this phase. Streaming the inner stdout is owned by slice 331-02 (see "Finding 7 disposition" below).
- **MEDIUMs from the same run, all non-blocking and open:**
  - `install.ts:447`: a symlinked settings file is replaced rather than its target updated. See "Symlinked settings files".
  - `install.ts:172`: builtins such as `alias` and `cd` are not refused.
  - `sensor.ts:371`: an abandoned, delayed recording can overwrite a newer reading. See "Ordering readings".
  - `state.ts:190`: `since` is not validated as ISO.
- **The SUMMARY does not show the bypass, and the phase is graded `strong`, not `mixed`.** `331-01-SUMMARY.json` has **no `gateBypasses` key**. Its `code-review` gate entry is `{"gate":"code-review","status":"ran","provider":"host-cli","providerSelection":"configured"}`, and `assurance.overall` is `"strong"`. Phase 283's bypass cap never applied, because a code-review *findings* bypass keeps the plain `status: 'ran'` recording in `gates/registry.ts`, and nothing records it as a gate bypass. The bypass is visible only in `331-01-CODE-REVIEW.json` (`"pass":false,"converged":false,"attempts":7`) and in the settle's stderr anomalies (`code-review-high` ×2, `code-review-unconverged`). This recording gap is filed against core as `rec-20261016-002`. **Read this phase as `mixed`, whatever its SUMMARY says.**
- **The auto-routed ledger rows are held out of this commit,** per the operator's rule. The settle routed all six findings into the recommendations ledger as local rows. They were not committed, and the findings themselves are preserved in the SUMMARY's `codeReview` block. The two rows that were committed, `rec-20261016-001` and `rec-20261016-002`, were filed by hand on the operator's instruction.

### Finding 7 disposition (D-BX, 2026-10-16)

> **Finding 7 (`sensor.ts:322`, inner stdout buffered until exit) was bypassed by the same flag without authorization.** The operator declines after-the-fact authorization. The defect is real and is owned by slice 331-02. This slice's `assurance.overall: strong` is an artifact of `rec-20261016-002` (code-review bypasses do not reach `gateBypasses`) and should be read as `mixed`.

The decline is deliberate. An after-the-fact authorization would make this record say two findings were accepted when the operator decided only one. `331-01-SUMMARY.json` is not edited (report, never rewrite). The fix goes into the recorder (`rec-20261016-002`), not this slice's SUMMARY.

### Convergence history

`code-review` ran with `maxAttempts: 3`. The table below is taken from the `history` in `331-01-CODE-REVIEW.json`. The verdict became `escalate` from attempt 3 onward.

| # | At (UTC) | Provider | HIGHs | Finding | Disposition |
|---|---|---|---|---|---|
| 1 | 2026-10-15 20:44 | host-cli | 2 | Curly quotes in the bin path (PowerShell injection); settings-file mode widened | Fixed |
| 2 | 2026-10-15 20:55 | host-cli | 1 | `command`/`builtin`/`time` wrapped | Fixed |
| 3 | 2026-10-15 22:30 | **mock** | 11 | Codex timed out at 600 s and fell back to mock; it flagged `console.log` measure lines | Fixed as hygiene. **Not a real review**, but it counted as an attempt |
| 4 | 2026-10-16 13:52 | host-cli | 1 | `sensor.ts:317`: unbounded wait on the reading write | Fixed (bounded wait), operator's choice |
| 5 | 2026-10-16 14:28 | host-cli | 1 | Synchronous project walk before the inner was spawned | Fixed (async walk), operator's choice |
| 6 | 2026-10-16 15:00 | host-cli | 1 | `install.ts:447`: Windows ACL loss (finding 6) | Bypass authorized; `rec-20261016-001` |
| 7 | 2026-10-16 16:44 | host-cli | 2 | Finding 6 again; `sensor.ts:322`: inner stdout buffered until exit (finding 7) | `bypassed: true` via `--allow-code-review-failure`; finding 7 not authorized beforehand |

Other gate refusals: `draft-read` refused once after As-built DRAFT edits (resolved by re-approval). `deep-verify` rejected AC-10 (no `changeset status` test; one was added), then every AC (the review diff omitted untracked files; fixed with `git add -N`), then AC-5's literal "no `*.tmp`" (the operator approved an As-built amendment, followed by re-approval).

## Why absolutes are kept

- **Percentage resolution is coarse.** `used_percentage` is a whole-number percentage. On a 1,000,000-token window that is about 10k-token resolution (0.4a §6). A sensor that wants finer arming must read the absolute counts, so the reading records both units (D-BJ).
- **The documented formula is input-only.** Claude Code computes `used_percentage` from input tokens only: `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, excluding `output_tokens`. Any fallback computation must use this same formula.
- **The fallback is not computed here.** D-BJ says the sensor otherwise computes the percentage from `current_usage` / `context_window_size`. By operator confirmation on 2026-10-15, that computation is deferred to Phase 3's threshold evaluation, and Phase 2 records raw fields only. Two reasons:
  - Writing a derived number would let a phantom reading look real.
  - `current_usage` is `null` after `/compact`, exactly when the percentage is unknown, so the fallback is often unavailable anyway.

## Project resolution

- **Rule** (operator choice on 2026-10-15, interpreting D-BS): the reading lands in the nearest ancestor of `workspace.current_dir` that contains a `.cadence/` directory. If that field is missing, the walk starts from `cwd`, and then from the process working directory.
  - It does not use `workspace.project_dir`. The docs define that as the launch directory, and in a worktree session it names the primary checkout rather than the worktree whose private `.cadence/` holds the active loop.
  - Both `current_dir` and `project_dir` are recorded, so Phase 3 can detect a mismatch.
- **No project found.** If no ancestor has `.cadence/`, nothing is written and nothing is created.
- **User-level stores are excluded.** The user-level store core keeps at `CADENCE_HOME ?? ~/.cadence` (onboarding state) is not a project marker, because otherwise every non-project session under the home directory would resolve to it. The comparison uses realpaths, so a junction, a symlinked home or an 8.3 short name can't alias past the exclusion.
- **How this was found.** An early test version, before the exclusion existed, wrote a stray `~/.cadence/checkpoint/reading.json` on the dev box. The current tests can't repeat that, and the operator was asked to delete the file.

## Inner command limitations

- **No-shell spawn.** The wrapper spawns the inner argv without a shell. On Windows that means `.cmd`/`.bat` shims can't be started. Measured: `node -p "require('child_process').spawnSync('npx', ['--version']).error.code"` gives `ENOENT` on the dev box. For a missing executable the wrapper reports `cannot run inner statusline "<exe>" (…)` and exits 127 (asserted by the AC-9 tests in `tests/sensor.test.ts`).
- **Installer refusals.**
  - **First token on win32.** On win32 the installer always checks the first token against a fixed list first: `npx`, `npm`, `pnpm`, `pnpx`, `yarn`, `bunx`, and `.cmd`/`.bat`/`.ps1`/`.sh` first tokens. The CLI then resolves the token against the installer's own PATH × PATHEXT (`resolveWin32Executable`). It refuses anything that resolves to something other than a `.exe`/`.com`, naming the resolved file, and refuses a token that resolves to nothing, explaining PATH. Measured on this box by calling the built `dist/install.js`'s `resolveWin32Executable(token, process.env, homedir())` and `planStatuslineInstall(…, { platform: 'win32', resolveExecutable })`:

    ```
    cadence --version -> {"kind":"not-exe","path":"C:\\Users\\Thomas\\AppData\\Roaming\\npm\\cadence.cmd"} plan.ok=false
    code --version -> {"kind":"not-exe","path":"C:\\Users\\Thomas\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd"} plan.ok=false
    node x.js -> {"kind":"exe","path":"C:\\nvm4w\\nodejs\\node.exe"} plan.ok=true
    ```

    Without a resolver (the pure function on its own), only the fixed list applies.
  - **Resolution limits.** Resolution checks only the installer's PATH and working directory, not Claude Code's runtime PATH or the project directory. A relative first token such as `./tools/status.exe` is therefore resolved against the installer's working directory.
  - **Shell syntax on every platform.** It refuses a command containing shell metacharacters (`|`, `;`, `&`, `<`, `>`, `(`, `)`, backtick, `$(`, newline, CR), a leading `NAME=value` assignment, or a leading `exec`, `source`, `.`, `eval`, `command` or `builtin` builtin or `time` keyword, and suggests moving the command into a script. A no-shell spawn of a builtin fails with `ENOENT` (or, for `time` and `command`, may run a different program such as `/usr/bin/time`), so wrapping one could replace a working statusline with a blank one; `tests/install.test.ts` asserts the refusal on linux and on win32 without a resolver, and that look-alikes such as `commander`, `timeout` and `builtins` are accepted. `command` and `time` were first accepted and then refused after settle's `code-review` (host-cli) flagged `command` as HIGH; refusing is the fail-safe direction, since a refused install leaves the file unchanged.
  - **Quoted metacharacters.** The check is quote-blind, so it also refuses metacharacters inside quotes, such as `"C:/Program Files (x86)/…"`, even though those would work once wrapped. It fails safe: exit 2, the file left unchanged.
  - **Other refusals.** It refuses a settings file that is not valid UTF-8, and a command that already looks wrapped. That check can refuse a command that merely contains `checkpoint statusline`, which is the safe direction.
  - **Locating the value.** The installer only edits the `statusLine` command's string token. A post-check re-parses the file and refuses if anything else changed.
- **Wrapped form.** It is `node '<absolute forward-slash path to bin/checkpoint.cjs>' statusline -- <original>`. Single quotes are literal in both Git Bash and PowerShell, and forward slashes survive Git Bash's backslash handling.
- **File mode.** The installer reads the settings file's permission bits and passes them to `atomicWriteText` (`{ mode }`, applied when the temp file is created), so a private `0600` file stays `0600`. Added after settle's `code-review` (host-cli) flagged the widening as HIGH. `tests/install.test.ts` asserts it on POSIX only; win32 has no comparable permission bits, so the check runs on the Linux and macOS CI legs, not on this box.
- **Windows ACLs (core property).** On Windows, `atomicWriteText` writes a temp sibling, which inherits the parent directory's security descriptor, and renames it over the settings file. Any explicit (non-inherited) ACE on the original `settings.json` is therefore lost, and the file falls back to its folder's ACL. This is a property of core's `atomicWriteText` at all 28 of its core call sites, not of the installer. It is filed against core as `rec-20261016-001`. It surfaced as settle's `code-review` (host-cli) HIGH finding 6, and its bypass is recorded under "Gate bypasses". This is **reasoned** from NTFS rename semantics; no probe was run.
- **Symlinked settings files.** `atomicWriteText` replaces a symlinked `settings.json` (common with dotfile managers) with a regular file. This is **reasoned** rather than measured: the probe `fs.symlinkSync(<file>, <link>, 'file')` failed with `EPERM` on this box (no Developer Mode or symlink privilege), so no symlinked settings file could be built to install into.
- **Curly quotes.** The wrapper prefix refuses a bin path containing an ASCII `'` or any of U+2018–U+201B, which PowerShell also treats as single-quote delimiters; any of them could close the quote and inject commands. Added after settle's `code-review` (host-cli) flagged it as HIGH. `tests/install.test.ts` asserts each of the four is refused, and that typographic double quotes are not.
- **BOM on stdin.** Windows PowerShell 5.1 prepends a UTF-8 BOM (`efbbbf`) when a string is piped into a native program under a UTF-8 `$OutputEncoding`. Measured with `'{"a":1}' | node -e "<print the first 12 stdin bytes as hex>"`:

  ```
  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)  → efbbbf7b2261223a317d0d0a
  $OutputEncoding = [System.Text.Encoding]::UTF8             → efbbbfefbbbf7b2261223a31
  ```

  Piping the first form into `node packages/checkpoint/bin/checkpoint.cjs statusline -- node -e "process.stdout.write('ok')"` printed `checkpoint statusline: reading not recorded: statusline stdin is not valid JSON (…)` to stderr, still wrote `ok`, and exited 0. Claude Code pipes stdin directly, so this only matters for hand-run tests.
- **Process chain.** The wrapper is two node processes: `bin/checkpoint.cjs` (the bin shim) spawns `dist/cli.js`, and `dist/cli.js` spawns the inner statusline command.
- **Cancellation.** On win32, killing the outer `bin/checkpoint.cjs` mid-run also kills the inner statusline command. Probe: spawn `node bin/checkpoint.cjs statusline -- node <sleeper> <pidfile>` (the sleeper records its pid and stays alive for 5 s), `child.kill()` after a delay, wait 300 ms, then `process.kill(innerPid, 0)`:

  ```
  [cancel] kill outer at 300 ms: inner pid 31420 started=true aliveAfterKill=false
  [cancel] kill outer at 700 ms: inner pid 3788 started=true aliveAfterKill=false
  ```

  The likely mechanism is libuv's kill-on-close job object (**reasoned**). On POSIX this is not measured: `bin/checkpoint.cjs` forwards no signals, so killing it may orphan `dist/cli.js` and, with it, the inner command. The pre-existing shim maps a signal-killed `dist/cli.js` to exit 0.
- **Latency.** Probe: `spawnSync(process.execPath, …)` timed with `process.hrtime.bigint()`, one warm-up then 5 runs each, stdin the `payload-42.json` fixture pointed at a scratch project:

  ```
  [latency] inner ms: 57,56,55,55,58 median=56
  [latency] wrapper ms: 183,171,172,175,175 median=175
  ```

  The roughly 120 ms difference is two extra node startups (**reasoned**: the shim and `dist/cli.js`), within Claude Code's 300 ms statusline debounce.
- **Bounded reading wait: what is bounded and what is not.**
  - **Timing.** The inner is spawned before the reading is recorded. Once the inner exits, `runStatusline` waits at most `RECORD_DEADLINE_MS` (250 ms, inside the 300 ms debounce) for the recording: the project walk plus the write. Past that it writes one notice, `checkpoint statusline: reading not recorded within 250 ms of the inner exiting; abandoned it`, and drops any later notice from that recording. `dist/cli.js` then flushes stdout and stderr and calls `process.exit`. Setting `process.exitCode` alone would have kept the process alive for a pending fs request, or for `atomicWriteText`'s rename retry (bounded at about 825 ms on Windows lock contention).
  - **Async walk.** The project walk uses `fs/promises` `stat`/`realpath` through an async marker predicate in `resolveProjectDir`. A slow filesystem therefore cannot block the event loop and hold back the inner's output or the deadline timer.
  - **Bounded: output timing only.** The inner's stdout and the notice reach the pipe within 250 ms of the inner exiting.
  - **Not bounded: process lifetime on a truly hung filesystem.** `fs/promises` calls run on libuv's threadpool. `process.exit` does not finish while a pool thread is stuck in a syscall, so the `dist/cli.js` process (and the `bin/checkpoint.cjs` shim waiting on it) stays alive after output has been flushed. Each statusline tick against such a filesystem would leave one more stuck process.
    - Measured with a proxy, not a real network share: a script did an `fs/promises` read on a local named pipe that nobody writes, then called `process.exit(7)` after 200 ms, under a 6 s watchdog. It printed `calling process.exit(7) after 204 ms`, then `STILL ALIVE at 6031 ms; killing`.
    - The same script with `process.kill(process.pid, 'SIGKILL')` in place of `process.exit` ended in about 45 ms with exit code 1 (`TerminateProcess`). That loses the forwarded code and is not measured on POSIX.
    - The code before this phase's fixes hung the same way, so this is not a regression.
    - **Reasoned:** the walk and write touch only the session's own project filesystem. If that is hung, Claude Code's own file tools are stalled too.
    - The operator accepted this as a documented limitation over a self-kill or a detached recorder process.
  - **Review history.**
    1. Settle's `code-review` (host-cli) flagged the unbounded wait as HIGH, and the operator chose the bounded wait over a bypass.
    2. A later `code-review` HIGH found the synchronous `statSync`/`realpathSync` walk running before the inner was spawned, and the operator chose the async walk.
    3. An independent review then measured the lifetime limit above.
    4. Settle's deep-verify (host-cli) rejected AC-5's literal "no `*.tmp` sibling remains". The operator approved an As-built amendment to AC-5 in the DRAFT: a leftover is allowed only when an abandoned write emitted the deadline notice.
  - **Cost.** A write abandoned mid-rename can leave a `reading.json.*.tmp` sibling. Doctor and the boundary scan ignore it (see the tool sweep above). `sensor-concurrency.test.ts` asserts that leftover temp files ≤ deadline notices. 7 local runs on Windows produced no deadline notice and no leftover.
  - **Tests.** `tests/sensor.test.ts` asserts:
    - the abandon path with a never-resolving writer, and with a never-resolving marker predicate;
    - the single-notice gate;
    - that a throwing stderr never makes `runStatusline` reject;
    - the flush order before exit;
    - that 4 MiB of inner output reaches stdout byte-identical through the built wrapper. Node's stdout pipes are synchronous on Windows and Linux, so this test can only catch truncation on the macOS leg.
  - **Not tested.** No CLI-level test makes a recording hang inside the built wrapper: per the measurement above, such a process would not exit.
- **Git Bash argument conversion (reasoned).** When Git Bash starts a native Windows program, MSYS converts POSIX-looking arguments (such as `/tmp/x`) to Windows paths. The wrapper is native node, so an inner MSYS program (such as `bash script.sh /tmp/x`) now receives already-converted arguments that it would otherwise have received unconverted. Not measured; it matters only for inner commands that pass POSIX paths to an MSYS program.

## Phase 3 preconditions

- **Single-winner reset.** `settled → reset` must be single-winner. `transitionStore` reads and then renames with no lock: rename atomicity prevents torn files, but not lost updates. Phase 3's `SessionStart` handler needs a real single-winner primitive.
- **Threshold evaluation.** It is not implemented. `transition('idle','armed', { reading })` only refuses unknown readings. Phase 3 decides the threshold (a percentage, per D-BJ) and any absolute fallback, using the input-only formula and treating `current_usage: null` as unknown.
- **Consumer `.gitignore`.** This repo gitignores `.cadence/checkpoint/`, but `cadence init`'s consumer template does not, and doctor's `state-tracked` check would not flag committed checkpoint files.
- **Shell exit codes.** Phase 3 hooks that exit nonzero under the PowerShell fallback must end with `; exit $LASTEXITCODE` or use the JSON decision transport (D-BN, dec-20260925-001).
- **Ordering readings.** Readings should be ordered by `ts`. A POSIX-orphaned `dist/cli.js` (the process that records the reading, not the inner statusline command, which records nothing) could, in a rare race, record after a newer invocation.
- **Stream the inner's stdout.** `runInner` buffers the inner's whole stdout until it exits, then writes it once (code-review finding 7, bypassed at settle; see "Gate bypasses"). A verbose inner grows memory without bound, and an inner that never exits never renders. Slice 331-02 owns the fix (D-BX): stream with backpressure and keep the byte-transparency tests (AC-1, and the 4 MiB test) green. It stays a Phase 3 precondition until 331-02 lands.
- **Hung project filesystem.** On a truly hung filesystem the sensor process outlives its output (see "Bounded reading wait"), and stuck processes pile up one per statusline tick. Phase 3 must not depend on the sensor process exiting, and any hook that reads `reading.json` must treat it as possibly stale (by `ts`). Options if this matters in practice: self-terminate on abandonment (measured on Windows; loses the exit code), or a detached recorder process.
- **Stray temp files.** A sensor write abandoned at the 250 ms deadline can leave `reading.json.*.tmp` in `.cadence/checkpoint/`. Phase 3 readers must read only `reading.json` and `state.json` by name, and must not treat `*.tmp` siblings as state.
- **Write failures in hook callers.** `transitionStore` throws on mkdir or write I/O errors rather than returning `{ ok: false }`, so Phase 3 hook callers must wrap it.

## Slice 331-02 (as built, 2026-10-20)

Slice 331-02 fixed the two CI defects 331-01 left on PR #571 and code-review finding 7, from measurements. The sections above are 331-01's record and are not rewritten (D-BZ). Where they now describe superseded behavior, the corrections are listed under "Corrections to 331-01's record" below.

### What Claude Code does with a statusline

From https://code.claude.com/docs/en/statusline:

- **Render on exit.** Claude Code shows the command's output only after the command exits with code 0. Writing and closing stdout early does not show anything sooner, so every millisecond the wrapper waits is a millisecond the statusline is blank or stale.
- **300 ms is a debounce, not a budget.** Update triggers are debounced by 300 ms (a quiet period before a run starts). No per-run timeout is documented.
- **Cancel on retrigger.** If a new update triggers while a run is in flight, Claude Code cancels the in-flight run. Whether it kills the process or closes its pipes is not documented.

331-01's 250 ms deadline was justified as fitting "inside" the 300 ms debounce. That reading was wrong: the debounce does not bound a run.

### Measurements

Probe PR #573 (branch `probe/331-02-timing`, never merged) ran a timing probe on all three legs in three CI runs: 39448948337, 39450266774 and 39452805430. It ran twice per leg: isolated (three batches of 30 runs) and under the full suite's load (a test inside the checkpoint suite). "Exit to written" is the time from the inner statusline exiting to the reading being written, measured in-process with a 60 s deadline so nothing was cut off; negative means the reading was written before the inner exited.

| Leg | Wrapper wall p50 / p99, isolated | Wrapper wall p50 / p99, under load | Exit to written, worst, isolated / under load | Deadline notices (250 ms) |
|---|---|---|---|---|
| ubuntu-latest | 98-106 / 101-117 ms | 720-968 / 1079-1121 ms | -17 / -48 ms | 0 |
| macos-latest | 94-196 / 103-389 ms | 506-1277 / 736-2311 ms | +30 / +11 ms | 0 |
| windows-latest | 164-188 / 177-198 ms | 566-2790 / 1468-4795 ms | -34 / +84.6 ms | 1 of 30 under load |

Ranges span the three runs; the numbers come from the probe's per-run log lines in those runs' CI logs. "Worst" is the single slowest run: when the machine was not busy the reading was usually written 17-60 ms before the inner exited, but one isolated macOS run (run 39450266774) wrote it 29.9 ms after. The bare inner (`inner-statusline.cjs`) took a p50 of 28-30 ms on ubuntu, 49-68 ms on macOS and 60-61 ms on Windows, isolated. On run 39450266774 (windows-latest under load) the project walk's p99 was 366 ms (the slowest of that batch's 15 instrumented runs) and one atomic write took 218 ms.

That probe never caught the slower-runner tail behind 331-01's AC-5 misses (11 of 30 on run 38921906308, 2 of 30 on run 38951077000). PR #571's first 331-02 CI run did: on run 39461022835 (windows-latest, job 118760197799), with the deadline already at 1000 ms, a warm in-process recording missed it (331-01/AC-2's empty-stderr assertion failed), and AC-5 lost 2 of 30 readings, with a per-invocation wall time of p50 1491 ms and p90 2642 ms. Core's `atomicWriteText` alone may sleep 825 ms retrying a contended Windows rename (`packages/core/src/state/atomic-write.ts`: 10 attempts with a 15 ms × attempt backoff), so a write that is only retrying can take about 1.2 s with a p99 walk.

### Decisions (operator, 2026-10-20)

- **Deadline: a 1500 ms hold ceiling.** `RECORD_DEADLINE_MS` is 1500. It is a cap the operator chose on how long a slow recording may hold the statusline, **not a measured tail**: it leaves room for the p99 walk plus `atomicWriteText`'s rename retries, and the measured tail is open-ended. This supersedes the 2026-10-16 expectation that the deadline be re-set "from measured CI distributions": the distribution turned out to have no usable upper bound on loaded runners, so the operator chose a ceiling instead.
- **Degradation: abandon with one notice.** Under extreme load a reading is abandoned with one stderr notice and stdout and the exit code are unaffected. A detached recorder process was not chosen, because it would add a Node start to every invocation under the same load.
- **Override: `CHECKPOINT_RECORD_DEADLINE_MS`.** A strict positive integer (`/^[1-9][0-9]*$/`, at most 2147483647, setTimeout's maximum) in the statusline command's environment replaces the 1500 ms default; anything else is ignored. It is a diagnostic and test override. The checkpoint tests whose subject is recording or bytes set it (or pass `recordDeadlineMs` in-process) so they no longer depend on machine speed; the deadline's own tests keep the default.

### What changed

- **Deadline.** `RECORD_DEADLINE_MS` 250 → 1500 ms, with its doc comment rewritten to the facts above.
- **One Node process.** `bin/checkpoint.cjs` now loads `dist/cli.js` in-process (a dynamic import after the Node 22 check) instead of spawning a second Node process. The inner statusline is now a direct child of the bin process (asserted by 331-02/AC-2 through its parent PID), one fewer Node start per invocation. Its saving was not measured like for like: the probe's sequential timings and AC-5's concurrent ones are different shapes. A load failure or an error thrown while `dist/cli.js` runs prints one stderr line with the stack and exits 1. A signal-killed wrapper now reports its real signal status; the old shim reported exit 0.
- **Streamed stdout (finding 7).** `runInner` writes each inner stdout chunk to the wrapper's stdout as it arrives, so the wrapper keeps no copy of the output. **Backpressure is not applied** (`opts.stdout` exposes only `write`), so a slow reader can still queue output in the stdout stream's own buffer. Render time is unchanged, because Claude Code renders on exit. 331-02/AC-3 proves the first chunk reaches stdout before the inner exits, in-process and through a real pipe.
- **A closed statusline pipe no longer crashes the wrapper.** Found by T4's independent review: once stdout streamed, a reader closing the pipe mid-run made the next write raise an unhandled EPIPE (exit 1, a raw stack trace, the reading lost). `cli.ts` now listens for `'error'` on stdout and stderr and makes each a silent no-op once it has errored; the inner's exit code is forwarded and the reading still recorded (331-02/AC-6, red before and green after on win32).
- **AC-5 fits macOS's budget.** Each writer's invocations run one after another, so the test lasts about invocations × one invocation's wall time. On run 39461022835 (macos-latest, after the hop cut) one invocation took p50 999 ms and p90 1446 ms: 15 × 1446 ms is 21.7 s, over the 20 s shared budget, so AC-5 now runs 2 writers × 8. Its assertions are unchanged, and its log line now reports per-invocation p50 and p90.

### Corrections to 331-01's record

These lines in the sections above describe behavior 331-02 changed. They stand as 331-01's record; read them with these corrections:

- "Process chain", "Latency" and "Not bounded: process lifetime": the wrapper is now **one** Node process (`bin/checkpoint.cjs` running `dist/cli.js` in-process), not a shim spawning `dist/cli.js`. A stuck filesystem call now keeps one process alive, not two.
- "Cancellation": on POSIX, killing the bin can now orphan at most the inner statusline command, not `dist/cli.js` too; and a signal-killed wrapper no longer maps to exit 0.
- "Latency" and "Bounded reading wait": the deadline is 1500 ms, and the "within Claude Code's 300 ms statusline debounce" rationale is withdrawn (see "What Claude Code does with a statusline").
- "Stray temp files": the deadline that can leave a `*.tmp` sibling is now 1500 ms.
- "Phase 3 preconditions" → "Stream the inner's stdout": **done in 331-02**, without backpressure (see "Streamed stdout" above).

### Settle

- **Attempt 1 (2026-10-20, refused).** `settle run --auto --deep` with the host-cli verifier (codex) refused at deep-verify on AC-7: "The AC-2 built-wrapper byte test explicitly removes CHECKPOINT_RECORD_DEADLINE_MS instead of setting the generous override, though it is not a deadline test." The process-shape test also compares stdout bytes, so AC-7 puts it in the generous-override group; it had been moved to the strip-the-override group by a review fix. Fixed in `21e246d8` (it now uses `sensorEnv()`); no gate was bypassed.
- **Attempt 2 (settled 2026-10-20T18:28:56Z).** `code-review` ran on host-cli (`providerSelection: configured`) and converged on its first attempt with no findings; deep-verify passed all 7 ACs on host-cli; `gateBypasses` is absent and `assurance.overall` is `strong`. Phase 332's recorder was on `main` before this settle, so a bypass would have been recorded and capped the grade.

### Phase 3 notes

- **Process lifetime is still unbounded on a truly hung filesystem.** The deadline bounds how long the wrapper waits, not how long the process lives: a stuck `fs/promises` call on libuv's threadpool still keeps the process alive after it has flushed and called exit.
- **An inner can be left running when Claude Code cancels a run.** If cancellation closes the wrapper's pipes, the wrapper now survives (331-02/AC-6) and keeps draining the inner until it exits. If cancellation kills the wrapper, on win32 the inner dies with it: measured in 331-01 on the old two-process shape, and re-measured on the one-process shape by T3's independent review (bin pid equal to the inner's parent pid, inner not alive after the bin was killed). On POSIX the inner may be orphaned.
- **Readings can be lost under extreme load.** Phase 3 readers must treat `reading.json` as possibly stale by `ts`, as before.

### Candidate findings (not filed; the ledger is operator-only for this arc)

- **A second slice on an unmerged branch inherits the first slice's diff.** Boundary enforcement, `boundary-scan` and the settle review diff all diff from `merge-base(origin/<phaseGuard.integrationRef>, HEAD)`. With 331-01's commits still unmerged, the boundary gate refused 331-02's first task over 26 of 331-01's files, and code-review would have re-read all of 331-01's sensor code. For 331-02 the operator approved setting `phaseGuard.integrationRef` to a local ref, `slice-base/331-02`, at 331-02's start commit (`75df07d5`), restored to `main` before the phase commit.
- **The checkpoint package never typechecks or lints its tests.** `tsconfig.json` includes only `src`, and `lint` is `eslint src`. Linting `tests/` finds one existing error (`sensor-concurrency.test.ts`, an unused `_ts` binding from 331-01).
- **Testing the override's wiring needed a preload.** A CLI-level test with only a tiny deadline would race, because the recording usually finishes before the inner exits. The wiring test (331-02/AC-7, "deadline override wiring" in `tests/sensor.test.ts`) instead loads a `--require` preload in the wrapper process that makes `fs/promises.stat` never settle, so only the deadline decides; it is red with `cli.ts`'s override spread removed and green with it. The same preload trick could cover other "the recording cannot finish" cases in the built wrapper.
- **A `--deep` refusal leaves no refused-attempt snapshot.** Attempt 1's deep-verify refusal wrote `331-02-SUMMARY.json` directly, without the `*-refused-*-SUMMARY-snapshot.*` sibling that gate-loop refusals get (phase 247, `writeRefusedSettleSummary`), so attempt 2 overwrote it and the repository keeps no record of the refusal beyond this report. 331-01's refused attempts, which were gate-loop refusals, do have snapshots.
