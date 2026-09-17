---
"@thomas-powers-jr/cadence-core": patch
"@thomas-powers-jr/cadence-types": patch
---

Fix: `cadence resume` no longer silently serves a stale handoff when `state.json`'s `lastHandoff` pointer names a file that still exists but is no longer the freshest session doc (rec-20260917-001).

`locateFreshestHandoff` previously short-circuited on any existing pointer, returning it without ever comparing it against the other `SESSION-*.md` docs in the handoff directory. It now ranks the pointer alongside every glob-matched doc by `generated_at` → filename date → mtime (breaking exact ties in the pointer's favor, and unioning in a custom-labeled pointer filename that fails the `SESSION-*.md` glob), and only serves the pointer outright when it actually wins. When a fresher doc supersedes it, `resume` prints a loud stdout notice naming the stale pointer and the doc served instead — mirroring the existing dangling-pointer notice. The new `supersededHandoffPointer` field on `ResumeResultZ` (`@thomas-powers-jr/cadence-types`) carries this outcome through the CLI and service layer.
