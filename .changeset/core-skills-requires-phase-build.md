---
"@thomas-powers-jr/cadence-core": patch
---

The bundled `cadence/core-skills` pack now declares `skillAudit.required: ["phase-build"]`, producing the first pack-attributed `skillAudit.provenance` entry.

Packs Slice 5 (phase 294) shipped the pack with `commands[]` only, because the `Skill`-tool telemetry matcher was missing from the host settings and a declared requirement would have hard-refused its own settle. Phase 295 fixed the matcher, so the manifest now declares the requirement (`version` bumped to `1.1.0`): the demand unions into `runSkillAuditCheck`'s effective set and is attributed to `pack:cadence/core-skills` in `SUMMARY.json`'s `skillAudit.provenance`, which had read `[]` in every settle record to date.

Scoped honestly: this does **not** enforce that every phase ran through `phase-build`. `state.skillAudit.invoked` is deduped, append-only and never reset, so the requirement is satisfied by the skill appearing anywhere in a checkout's invocation history. A fresh git worktree starts empty and must genuinely invoke it; a long-lived checkout inherits the satisfaction, and the invoked list is only evicted after 100 *distinct* skills, so in practice it never lapses. The requirement is also not phase-conditional, so any phase whose telemetry lacks the skill will refuse unless `--allow-skill-audit-miss` is passed — a bypass that, as of this release, records in `SUMMARY.gateBypasses`.

Consumers are unaffected unless they enable the `cadence/core-skills` pack.
