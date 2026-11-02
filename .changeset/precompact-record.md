---
"@thomas-powers-jr/cadence-core": minor
"@thomas-powers-jr/cadence-types": minor
"@thomas-powers-jr/cadence-host-claude-code": minor
"@thomas-powers-jr/cadence-host-toolkit": minor
---

Claude Code compactions now leave a record (phase 345; rec-20261101-001). The Claude Code adapter installs a `PreCompact` hook that routes to a new `pre-compact` abstract event, forwarding the host's trigger (`auto` or `manual`) as `compactTrigger`. `cadence hook pre-compact` writes one machine-facts record to `.cadence/local/precompact/PRECOMPACT-<YYYYMMDDTHHMMSS.mmmZ>.md`: the trigger (JSON-quoted), the loop position and active phase, draft and spec, local git facts (no fetch), and the hook payload's field names, never their values. Only the newest five records are kept. The hook never writes stdout, never changes `state.json`, `STATE.md`, any `SESSION-*.md` handoff doc or any intelligence file, never creates `.cadence/`, and always exits 0 with one stderr line. The Claude Code shim also clamps a non-zero core exit to 0 for this event, through host-toolkit's new `resolveHookShimExit`, so a newer adapter running against an older core cannot block a compaction. When the newest record is newer than the freshest SESSION doc, the SessionStart banner and `cadence resume` print a `Pre-compaction record:` pointer line, and `cadence resume --json` carries an optional `precompactRecord` object `{ path, trigger, generatedAt }`. The types package gains `pre-compact` in `AbstractEventZ`, an optional `compactTrigger` on `HookContextZ` and `ExtractedPayload`, and an optional `precompactRecord` on `ResumeResultZ`; existing data keeps parsing. The Codex adapter keeps `PreCompact` unmapped.

Upgrade notes:

- Existing Claude Code installs lack the new `PreCompact` hook entry, so `cadence doctor`'s `host-hooks` check reports an error until you run `cadence doctor --fix --wire-host` (or re-run the Claude Code installer).
- Projects initialized before phase 341 do not gitignore `.cadence/local/`. Add `.cadence/local/` to `.gitignore` so the records stay out of the working tree.
