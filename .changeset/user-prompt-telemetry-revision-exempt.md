---
"@thomas-powers-jr/cadence-core": patch
---

Fix: `cadence settle run --deep` no longer fails with `state.json changed since you read it` in a project that has CADENCE's Claude Code hooks installed (#500).

The `host-cli` deep-verify provider spawns `claude -p` in the project directory. That child session fires the project's `UserPromptSubmit` hook, whose `session.tokenUtilization` telemetry bump went through the compare-and-swap `commit()` path and advanced `state.json`'s `revision` while settle was still running, so settle's own final commit refused with `StateConflictError` on every attempt. The bump now uses the same revision-exempt write path that `session.subagentSpawns` moved to for #234, clamped to the field's `0..1` range. The optimistic-concurrency guard itself is unchanged: a real concurrent structural writer is still refused.
