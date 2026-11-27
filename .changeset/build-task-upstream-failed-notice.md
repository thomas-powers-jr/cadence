---
"@thomas-powers-jr/cadence-core": patch
---

`build task` names an upstream-failed diff base (phase 355; rec-20261125-003). When `origin/<integrationRef>` resolves but its merge-base with `HEAD` cannot be computed (for example in a shallow clone), the record-time boundary/redundancy check no longer prints `git unavailable`. It prints that the merge-base could not be computed, adds the `git fetch --unshallow origin` (or `--deepen=<n>`) fix in a shallow clone, and says either that the check sees working-tree changes only or, when no newly touched file is visible, that it is skipped and the self-reported `touchedFiles` are kept. The `git unavailable` line is kept where no base resolves at all. What the check records and refuses is unchanged.
