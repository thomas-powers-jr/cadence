---
"@thomas-powers-jr/cadence-core": patch
---

Fix: `--allow-skill-audit-miss` now records the bypass in `SUMMARY.gateBypasses` instead of leaving it on stderr only.

A settle that proceeded past an un-invoked required skill was invisible in the durable phase artifact: `SUMMARY.gateBypasses` carried no entry, so a later reader could not tell it apart from a settle where every required skill was invoked. Two independent causes — `anomalyToGateBypass` had no `skill-audit-miss` case, and `emitSkillAuditMiss` writes straight to the notifier, so the event never joined the `anomalies` array that the bypass list is derived from. skill-audit also cannot use the `gates[].skipReason` convention that records `--allow-failing-build` and `--allow-boundary-scan-failure`, because it is deliberately not a `Gate` enum member and is dispatched outside the gate registry, so it produces no `gates[]` entry at all. `runSkillAuditCheck` now reports the bypass to settle, which pushes a `{ gate: 'skill-audit', flag: '--allow-skill-audit-miss', reason, severity: 'warn' }` entry exactly as the `pack-resolution` bypass already did. The existing stderr notice is unchanged — the durable record supplements it. Refusal behavior, the clean-pass path, and the unenforceable `telemetry.skillInvocations: false` path are all untouched and record nothing.
