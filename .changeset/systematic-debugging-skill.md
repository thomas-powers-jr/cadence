---
"@thomas-powers-jr/cadence-core": patch
---

Adds a `systematic-debugging` skill whose hypotheses are recorded in the CADENCE assumption ledger, and documents why a pack cannot distribute it.

`cadence assumption` has been a full `open | validated | rejected` hypothesis store since Slice 9, with no callers anywhere. The new skill (`.claude/skills/systematic-debugging/SKILL.md`) gives it one: each hypothesis is an assumption row tied to one anchor recommendation, closed `validated` or `rejected` by an observation, and the skill's conclusion step is gated on `cadence assumption list --filter-rec <id> --filter-status open --format json` returning empty. The effect is that a debugging session leaves an inspectable trail instead of a transcript nobody rereads.

Stated plainly, because the distinction matters: **this is a gate the skill honors, not one the engine enforces.** Nothing exits non-zero if a conclusion is reached with hypotheses still open — CADENCE does not refuse a conclusion the way `settle` refuses a phase. What is mechanical is the ledger and the query; what is disciplinary is honoring it. The value is that anyone can run one command afterwards and see whether it was honored.

Two limitations are documented rather than papered over. `assumption validate|reject` take only an id, so the observation that justified a transition cannot be stored on the assumption — the skill puts it on the anchor as evidence, naming the assumption id by convention. And the skill is not declared in the `cadence/core-skills` manifest: `PackManifestZ` has no slot for a distributed-but-not-required skill, and `skillAudit.required` is non-conditional, so declaring it would refuse every phase that did no debugging. `docs/packs-design.md` records both.
