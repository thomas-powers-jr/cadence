# 319-01 DRAFT review — Codex (independent, read-only)

- reviewer: codex exec -s read-only --ephemeral (ChatGPT login, codex-cli 0.156.1), 2026-09-27
- target: uncommitted DRAFT in worktree `worktree-win32-host-cli-resolve` (base c899fcf4), revised between rounds
- outcome: REJECT (r1) → REJECT (r2) → REJECT (r3) → REJECT (r4) → APPROVE (r5); every finding applied to the DRAFT before the next round
- note: config planReview is mock; this manual review is the real plan review of record.

## Round 1

### Prompt

You are an independent plan reviewer for the CADENCE repo (TypeScript monorepo). Review the DRAFT at
.cadence/phases/319-win32-host-cli-binary-resolution/319-01-DRAFT.md before it is approved for BUILD.

Read the DRAFT, then read packages/core/src/verify/host-cli-client.ts (especially realSpawn, spawnCapture, toHostCliError, inferFamily, the self-invocation guard) and packages/core/tests/verify/host-cli-client.test.ts, and docs/providers.md's host-cli section. Also read an npm cmd-shim example: the real file is at C:\Users\softw\AppData\Roaming\npm\codex.cmd if accessible.

Judge:
1. Correctness of the design: will resolving PATH x PATHEXT and running an npm .cmd shim's JS target via node actually fix `spawn('codex')` on Windows without shell:true? Any Windows resolution rule it gets wrong (current-directory lookup, quoted PATH entries, PATHEXT order vs PATH order, trailing separators, UNC paths, .bat vs .cmd)?
2. Are the ACs testable, specific, and sufficient? Is any AC unverifiable or missing (e.g. a failure mode that would still silently fall back to mock)?
3. Are the task files/depends/verify lines consistent with the ACs and the repo's conventions (pure core + impure shell, exactOptionalPropertyTypes, no runtime deps, tests use injected fakes)?
4. Do the Boundaries conflict with anything the tasks need?
5. Security: any injection or arbitrary-execution risk introduced by parsing a .cmd file's target and running it?

Output: a verdict line `VERDICT: APPROVE` or `VERDICT: REJECT`, then numbered findings each tagged [blocker]/[major]/[minor] with the file/line evidence and a concrete fix. Be concise. Do not edit any files.

### Response

VERDICT: REJECT

1. [blocker] **Explicit `.cmd` paths cannot meet AC-2.** DRAFT lines 23–24 require an absolute `codex.cmd` to work, but T1 line 50 only passes through `.exe`/`.com`; every other candidate gets a PATHEXT suffix. It would probe `codex.cmd.COM`, etc. Fix: probe an explicitly extended bin unchanged before PATHEXT expansion; test both absolute and bare `codex.cmd`.

2. [major] **The proposed “shell-like” resolver omits current-directory lookup.** T1 line 50 searches only PATH, but `cmd` searches the current directory before PATH; this can select the wrong binary and the facts lack `cwd`, so it is untestable. Add injected `cwd` plus the `NoDefaultCurrentDirectoryInExePath` policy, and tests for CWD precedence, empty/trailing PATH segments, quoted-segment policy, and UNC paths. [Microsoft’s PATH documentation](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/path) confirms CWD precedence.

3. [major] **The real-process test misses the actual regression path.** T2 line 57 tests an *absolute* `.cmd`, while the failure is `spawn('codex')`. Add a win32-gated test that temporarily supplies `Path=<temp dir>` and `PATHEXT=.CMD`, invokes bare `codex`, and verifies the default factory runs the shim target. Also expose injected spawn options or assert them so AC-2’s “no shell” claim is testable; current `SpawnFn` only exposes `(bin, args)` (host-cli-client.ts:45–46).

4. [major] **Cmd-shim parsing is underspecified for an execution boundary.** “Last quoted target on the invoking line” (T1 line 50) can misidentify an arbitrary quoted string in a noncanonical `.cmd`. Direct Node spawning prevents shell metacharacter injection, but it can still execute an unintended JS file. Match the canonical `cmd-shim` node-invocation form, substitute only `%dp0%`/`%~dp0%`, reject other expansion syntax, normalize with `path.win32`, and require the target to remain under the shim directory. Node confirms `.cmd` requires a terminal if run directly, so bypassing it with a direct Node invocation is otherwise sound. [Node documentation](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows)

5. [minor] **T3 would leave contradictory host-cli documentation.** It adds Windows text near docs/providers.md:298, but the same section still says stdin “is not piped” (lines 348–353), contrary to host-cli-client.ts:64–65 and 454–479. Correct that stale text while touching the section.

The factory wiring, configured-bin family/guard preservation, no-runtime-dependency constraint, and existing loud `HostCliError` fallback path are otherwise consistent.

## Round 2

### Prompt

You are an independent plan reviewer for the CADENCE repo (TypeScript monorepo). This is ROUND 2. Re-review the revised DRAFT at
.cadence/phases/319-win32-host-cli-binary-resolution/319-01-DRAFT.md before it is approved for BUILD.

Your round-1 verdict was REJECT with these findings:
1. [blocker] explicit `.cmd` paths would be re-suffixed with PATHEXT (codex.cmd.COM) so AC-2 could not be met.
2. [major] current-directory lookup unspecified; add cwd policy, empty/trailing/quoted PATH segments, UNC tests.
3. [major] the real-process test used an absolute .cmd, not the bare `codex` regression path; "no shell" not testable because SpawnFn only exposes (bin, args).
4. [major] cmd-shim parsing underspecified ("last quoted target"); match canonical cmd-shim form, only %dp0%/%~dp0, reject other expansion, normalize with path.win32, require target under the shim dir.
5. [minor] docs/providers.md still says stdin "is not piped".

For each round-1 finding, state RESOLVED or NOT RESOLVED with a one-line reason citing the DRAFT text. Then look for any NEW problems the revision introduced (in particular: is the deliberate decision to never search the cwd, and to raise ENOENT from the resolver instead of passing the bare name to spawn, sound and testable? Is AC-2 now split coherently across T1 and T2?). Re-read packages/core/src/verify/host-cli-client.ts as needed.

Output: a verdict line `VERDICT: APPROVE` or `VERDICT: REJECT`, the per-finding status list, then any new numbered findings tagged [blocker]/[major]/[minor] with evidence and a concrete fix. Be concise. Do not edit any files.

### Response

VERDICT: REJECT

- 1. RESOLVED — AC-2/T1 now says an extension-bearing bin is “probed as-is (never re-suffixed).”
- 2. RESOLVED — AC-1/T1 specifies no implicit cwd search plus empty/trailing/quoted PATH handling and UNC tests.
- 3. RESOLVED — T2 adds both an options-observable underlying spawn seam and a Windows-gated real-process test using bare `codex`.
- 4. RESOLVED — T1 restricts parsing to canonical cmd-shim forms, rejects `%` in the relative target, uses `path.win32.resolve`, and enforces shim-directory containment.
- 5. RESOLVED — AC-6/T3 explicitly replaces the “stdin is not piped” claim.

1. [major] The “never search cwd” guarantee is bypassable through relative PATH entries. T1 says it searches “PATH directories” with `path.win32`, but does not reject `.`/relative or drive-relative segments; `path.win32.resolve(shimDir, rel)` can thereby consult the process cwd. Fix: accept only fully qualified drive-rooted or UNC PATH segments (or explicitly redefine the policy as “no implicit cwd”), and test `Path=.;C:relative;...` does not resolve a cwd-only binary.

2. [major] Explicit missing paths/extensions have no required `ENOENT` behavior. T1 only requires `Error.code = 'ENOENT'` for “Bare bin found nowhere”; a nonexistent configured `C:\...\codex.exe` could become `spawn-error` rather than preserving the existing `not-found` result. Fix: require every exhausted lookup—including separator-bearing and already-suffixed bins—to throw coded `ENOENT`; reserve generic errors for unsafe/unrecognized launchers, with tests for each.

3. [minor] The docs plan fixes the stale stdin sentence but leaves the existing opening examples showing `"<prompt>"` in argv. T3’s doc-content test only checks absence of the old phrase. Fix: update those examples to `claude -p --output-format json` and `codex exec --json --skip-git-repo-check -`, and test the prompt-is-stdin wording/examples.

AC-2’s T1/T2 division is otherwise coherent: T1 owns resolution/parsing; T2 owns argument composition, no-shell options, and the bare-name real-process regression.

## Round 3

### Prompt

You are an independent plan reviewer for the CADENCE repo. This is ROUND 3. Re-review the revised DRAFT at
.cadence/phases/319-win32-host-cli-binary-resolution/319-01-DRAFT.md.

Round 1 findings were all marked RESOLVED by you in round 2. Your round-2 NEW findings were:
1. [major] "never search cwd" bypassable through relative PATH entries (`.`, relative, drive-relative `C:relative`); accept only fully qualified drive-rooted or UNC segments and test it.
2. [major] only bare lookups required coded ENOENT; require every exhausted lookup (separator-bearing, already-suffixed) to throw coded ENOENT so it maps to `not-found`; reserve plain errors for unsafe/unrecognised launchers.
3. [minor] docs/providers.md opening examples still show "<prompt>" in argv; update them to `claude -p --output-format json` and `codex exec --json --skip-git-repo-check -` and test.

For each, state RESOLVED or NOT RESOLVED with a one-line reason citing the DRAFT text. Then report only NEW blocker/major problems (skip nitpicks). Check docs/providers.md to confirm the examples you referenced exist where the DRAFT says.

Output: `VERDICT: APPROVE` or `VERDICT: REJECT`, the status list, then any new findings tagged [blocker]/[major] with evidence and fix. Be concise. Do not edit any files.

### Response

VERDICT: REJECT

- 1. RESOLVED — AC-1/T1 require fully qualified PATH entries and explicitly exclude `.`, relative, and `C:tools` entries (DRAFT lines 19, 34, 50).
- 2. RESOLVED — AC-4/T1 require coded `ENOENT` for every exhausted bare, suffixed, and separator-bearing lookup (lines 34, 50).
- 3. RESOLVED — AC-6/T3 require the corrected stdin examples and a doc test (lines 41–44, 63–65). The stale `"<prompt>"` examples currently exist in the host-cli section of `docs/providers.md` lines 267–268.

[major] Root-relative PATH entries remain untested and can slip through a naïve `path.win32.isAbsolute()` check. T1 requires `path.win32` and lists fixtures for `.`, relative, and drive-relative segments, but omits `\tools`; that form is “absolute” to `path.win32` yet is neither drive-rooted nor UNC, violating AC-1’s allowed-entry rule. Fix: define a drive-rooted-or-UNC predicate and test that `\tools` is skipped.

[major] Shim-target containment is underspecified for prefix-directory escapes. T1 only says the resolved target must “stay under `shimDir`” (line 50) and specifies no adversarial fixture; a naïve prefix check accepts `C:\npm-evil\payload.js` as under `C:\npm`, allowing Node to run an escaping target contrary to AC-3. Fix: require separator-aware containment via `path.win32.relative()` (with Windows case handling) and test `..\npm-evil\payload.js` is refused with `spawn-error`.

## Round 4

### Prompt

You are an independent plan reviewer for the CADENCE repo. This is ROUND 4. Re-review the revised DRAFT at
.cadence/phases/319-win32-host-cli-binary-resolution/319-01-DRAFT.md.

Your round-3 findings were:
1. [major] root-relative PATH entries (`\tools`) pass `path.win32.isAbsolute`; define a drive-rooted-or-UNC predicate and test `\tools` is skipped.
2. [major] shim-target containment could use a naive string prefix check (`C:\npm-evil` under `C:\npm`); require separator-aware `path.win32.relative()` containment with case handling and test `..\npm-evil\payload.js` is refused with spawn-error.

For each, state RESOLVED or NOT RESOLVED with a one-line reason citing the DRAFT text. Then report only NEW blocker/major problems that would make the implemented phase incorrect or unsafe — not further hardening ideas that belong in a follow-up. If none, approve.

Output: `VERDICT: APPROVE` or `VERDICT: REJECT`, the status list, then any new findings tagged [blocker]/[major] with evidence and fix. Be concise. Do not edit any files.

### Response

VERDICT: REJECT

1. RESOLVED — AC-1/T1 explicitly requires a drive-rooted-or-UNC predicate and tests `\tools` is skipped (lines 19, 50).
2. RESOLVED — AC-3/T1 requires case-insensitive, separator-aware `path.win32.relative()` containment and a `..\npm-evil\payload.js` refusal test (lines 27, 50).

[major] Explicit `.cmd` bins can fail when `PATHEXT` omits `.CMD`. AC-2 requires `codex.cmd` and absolute `.cmd` paths be probed as-is (lines 23–24), but T1 only does so for a “PATHEXT-listed extension” (line 50), otherwise appending extensions. Fix: treat any explicitly suffixed bin as exact/as-is; use PATHEXT only to suffix extensionless names. Add a `.CMD`-absent PATHEXT test.

## Round 5

### Prompt

You are an independent plan reviewer for the CADENCE repo. This is ROUND 5. Re-review the revised DRAFT at
.cadence/phases/319-win32-host-cli-binary-resolution/319-01-DRAFT.md.

Your round-4 finding was:
1. [major] explicit `.cmd` bins fail when PATHEXT omits `.CMD`; treat any explicitly suffixed bin as exact and use PATHEXT only to suffix extensionless names; add a `.CMD`-absent PATHEXT test.

State RESOLVED or NOT RESOLVED with a one-line reason citing the DRAFT text. Then report only NEW blocker/major problems that would make the implemented phase incorrect or unsafe — not further hardening ideas that belong in a follow-up. If none, approve.

Output: `VERDICT: APPROVE` or `VERDICT: REJECT`, the status line, then any new findings tagged [blocker]/[major] with evidence and fix. Be concise. Do not edit any files.

### Response

VERDICT: APPROVE

STATUS: RESOLVED — T1 now probes explicit `.cmd` paths “exactly as given regardless of PATHEXT” and requires a `.CMD`-absent PATHEXT test.
