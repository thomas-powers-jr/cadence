---
"@thomas-powers-jr/cadence-core": minor
---

`cadence handoff` now generates a version-2 SESSION doc: the frontmatter reads `cadence_handoff: 2`, and the narrative zone gains a required `## Open decisions` stub between `Carry-forward gotchas` and `Next action`.

The new stub asks for each unresolved decision (what is undecided, the options, who decides), or an explicit `None`. It carries the usual `FILL IN` marker, so `cadence handoff --check` reports `Open decisions` as unfilled until someone writes it, and exits 3 just as it does for the other narrative stubs. `cadence resume --full` replays the section. Brief-mode `cadence resume` is unchanged in shape: `Open decisions` stays out of the brief, like the other non-brief sections.

Why: the checkpoint handoff validator (a private, unpublished workspace package) expected an `Open decisions` section that the generator never emitted, so real generated handoffs failed validation. The generator now emits it. The validator reads the handoff version from the frontmatter: version-1 docs keep the frozen six-section schema, and version-2 docs require `Open decisions`. Both handoff versions stay valid, so existing SESSION docs still replay through `cadence resume` exactly as before.
