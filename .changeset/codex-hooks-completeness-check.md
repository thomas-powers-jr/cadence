---
"@thomas-powers-jr/cadence-core": patch
"@thomas-powers-jr/cadence-host-toolkit": patch
"@thomas-powers-jr/cadence-host-codex": patch
---

Fix: `cadence doctor`'s `codex-hooks` check now verifies completeness, not just marker existence, closing the identical gap phase 295 fixed for `checkHostHooks` (Claude Code).

`.codex/hooks.json` used to report `ok` on any single `_managedBy: "cadence"` marker anywhere in the document. It now checks every managed hook entry Codex's installer actually writes (`SessionStart`, `UserPromptSubmit`, `PreToolUse`/`PostToolUse` matched on `^apply_patch$`, `Stop`, `SubagentStop`) is present, failing with severity `error` and naming every missing entry when it isn't. The expected-hook list moved into `@thomas-powers-jr/cadence-host-toolkit` as `CODEX_EXPECTED_HOOKS` — the new single source of truth `packages/host-codex`'s installer builds its `desired` hook map from (no change to what it actually installs) — with core holding its own independently-duplicated copy (core cannot import host-adapter code), pinned against the toolkit original by a new drift test. Both `@thomas-powers-jr/cadence-core` and `@thomas-powers-jr/cadence-host-toolkit` now export `CODEX_EXPECTED_HOOKS` for that test.
