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

After: _pending settle — filled in after `cadence settle run --auto`._

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
- **windows-latest CI log:** _pending the PR's CI run. The `raw node inner vs PowerShell inner` and hex lines from that log will be quoted here._

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

Settle-time gate provenance (`deep-verify`, `code-review` provider, and the verifier identity): _pending settle._

## Package and hook status

- `packages/checkpoint/package.json` stays `"private": true` at `"version": "0.0.0"`.
- `pnpm changeset status --verbose --output <file>` lists `@thomas-powers-jr/cadence-checkpoint` as `"type": "none"`, `"oldVersion": "0.0.0"`, `"newVersion": "0.0.0"`. Core's fixed group goes `minor` from this phase's changeset.
- `tests/core-export.test.ts` asserts this (AC-10). It runs the real changesets CLI (`node_modules/@changesets/cli/bin.js status --verbose --output release-plan.json`) against a temp git repo on `main` holding this repo's workspace manifests and its real `.changeset/` directory, so the plan does not depend on CI's shallow checkout. It asserts that no changeset names checkpoint and checkpoint stays at `none` `0.0.0`. It also asserts that the five fixed-group packages share one type and version, and that while this phase's changeset is unreleased the group bumps at least `minor`. A mutation check (a temporary checkpoint `patch` changeset) made it fail. Added after settle's `deep-verify` (host-cli provider) rejected AC-10 because no test ran this command.
- No hook is registered or changed anywhere. `git diff --stat main -- .claude/settings.json` is empty, and `tests/install.test.ts` asserts that the repository's tracked `.claude/settings.json` has no `statusLine` key.

## Gate bypasses

_Pending settle._ The phase rule is no `--force` and no `--allow-*`.

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
- **Hung project filesystem.** On a truly hung filesystem the sensor process outlives its output (see "Bounded reading wait"), and stuck processes pile up one per statusline tick. Phase 3 must not depend on the sensor process exiting, and any hook that reads `reading.json` must treat it as possibly stale (by `ts`). Options if this matters in practice: self-terminate on abandonment (measured on Windows; loses the exit code), or a detached recorder process.
- **Stray temp files.** A sensor write abandoned at the 250 ms deadline can leave `reading.json.*.tmp` in `.cadence/checkpoint/`. Phase 3 readers must read only `reading.json` and `state.json` by name, and must not treat `*.tmp` siblings as state.
- **Write failures in hook callers.** `transitionStore` throws on mkdir or write I/O errors rather than returning `{ ok: false }`, so Phase 3 hook callers must wrap it.
