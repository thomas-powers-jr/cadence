---
"@thomas-powers-jr/cadence-core": minor
---

`@thomas-powers-jr/cadence-core` now exports `atomicWriteText(path, text, opts?)` from its package entry (phase 331). It is the same writer core uses for its own state files: it writes a unique temp sibling and renames it over the target, so a concurrent reader never sees a torn file, and it retries a transient Windows `EPERM`/`EACCES`/`EBUSY` on the rename. The private checkpoint package's statusline sensor is its first consumer. Core's engine behavior and CLI are unchanged.
