---
"@thomas-powers-jr/cadence-core": patch
---

AC clause capture skips the heading (phase 354; rec-20261124-001). `parseDraftMd` and `parseSpecMd` captured an AC's Given, When and Then text with unanchored patterns run over the whole AC block, so a capitalised `Then ` (or `When `) in an `### AC-N:` heading, or a `Then ` earlier in the Given text, started that clause there and repeated the AC's other clauses inside it; deep-verify, plan-review, spec-review and the `UNBOUNDED_AC_THEN` warning read the garbled text. Both parsers now share one clause rule: the heading line is never searched, and the labels are found in the order Given, When, Then, each at a line start when one carries it, else inline, so a one-line `Given …, When …, Then …` AC parses as before. Over the repository's own 430 DRAFT and SPEC files up to phase 353, only two AC fields change, both heading-induced.
