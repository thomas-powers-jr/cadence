---
"@thomas-powers-jr/cadence-core": minor
"@thomas-powers-jr/cadence-types": minor
---

`cadence settle run` now records a checkpoint Stop-gate force-release as a gate bypass (phase 336, D-CE). This applies when a session was released at the gate's re-block ceiling without a validated handoff during the draft being settled. Settle reads the sticky `lastForcedAt` from `.cadence/checkpoint/state.json` in the checkout it runs in; the read is best-effort and never throws. A session whose working directory resolved to a different checkout records its release in that checkout's store, which this settle does not see. When `lastForcedAt` is at or after the draft's open time, `SUMMARY.gateBypasses` gains `{ gate: 'checkpoint-stop', flag: 'ceiling-release', severity: 'error' }`, so that slice's `assurance.overall` cannot exceed `mixed`. A new `checkpoint-force-released` anomaly type carries the event, and an absent, old or malformed checkpoint record changes nothing. Core also now exports `findUnfilledSections`, so the checkpoint gate names a SESSION doc's unfilled sections with core's own detector.
