---
"@thomas-powers-jr/cadence-core": patch
---

`cadence settle run` now names a missing roadmap entry for the phase whose slice it just settled (phase 320, rec-20261004-001). After a successful settle, when `.cadence/ROADMAP.md` uses `### Phase N` headings or `.cadence/MILESTONES.md` uses `- **Phase N**` bullets but has no entry for that phase, one `note:` line on stderr names each missing file and the form to add, so the entry can be written before the settle is committed. The check is best-effort and only a notice: it never blocks the settle, never writes either file (roadmap prose is never auto-generated), adds nothing to stdout or `SUMMARY.json`, and stays silent when a file is absent, unreadable, or uses no phase convention, such as the `cadence init` stub.
