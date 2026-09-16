---
"@thomas-powers-jr/cadence-core": patch
---

Fix: `cadence settle run` no longer clobbers an already-shipped draft's canonical `SUMMARY.json`/`.md` when a later settle attempt against stale state hits a refusal.

`writeRefusedSettleSummary` previously wrote every refused settle attempt's record to the same canonical path as a successful settle, unconditionally — so retrying `settle run` against a draft that had already settled successfully (e.g. stale local `state.json` still pointing at a long-shipped phase) would silently overwrite the canonical record's AC PASS results, gate provenance, `contentHash`, and `stateAtSettle` with an empty, degraded refused record. Reproduced live: this happened to `278-01-SUMMARY.md`, recovered only because the working tree was dirty at the time.

The canonical write is now guarded: before writing, `writeRefusedSettleSummary` best-effort reads the existing on-disk canonical `SUMMARY.json` and checks whether its `acResults` array is non-empty (the only reliable signal of a prior successful settle — a prior *refused* record always has an empty `acResults`, even though its `gates` array is non-empty too). When the guard fires, the refused attempt is diverted to the existing snapshot-sibling mechanism instead (both `.json` and `.md`, written unconditionally in this case), and a stderr notice names both the guard and the diverted path. When there's nothing terminal to protect (no prior canonical file, or an existing one that is itself a prior refused record), behavior is unchanged — the canonical write still proceeds normally.
