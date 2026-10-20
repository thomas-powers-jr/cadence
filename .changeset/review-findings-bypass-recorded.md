---
"@thomas-powers-jr/cadence-core": minor
---

`cadence settle run` now records a code-review or security-audit findings bypass (phase 332, rec-20261016-002). When `--allow-code-review-failure`, `--allow-security-audit-failure` or `--force` waves through code-review HIGH findings or security-audit CRITICAL findings, `SUMMARY.json.gateBypasses` gets one `error`-severity entry per gate, naming the flag the gate printed, the number of bypassed findings and their highest severity, so `assurance.overall` is capped at `mixed` and never `strong`. Previously such a bypass left no `gateBypasses` entry and could grade `strong`. Which findings refuse settle, the flags' scope and the gates' stderr wording are unchanged, a bypassed code-review or security-audit call that throws is still recorded as a skipped gate, and a refused settle still records no `gateBypasses`.
