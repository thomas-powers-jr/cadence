---
"@thomas-powers-jr/cadence-core": patch
---

DRAFT.md, SPEC.md and UI-SPEC.md files saved on Windows now parse and edit correctly (phase 339; rec-20260918-005, rec-20260918-006, rec-20260918-007). Phase 310 had normalized CRLF only in the DRAFT parser. These cases still failed with misleading errors:
- a UTF-8 BOM, which PowerShell writes by default, failed every parser with "missing frontmatter";
- lone-CR line endings were not normalized;
- the SPEC and UI-SPEC parsers rejected CRLF;
- `cadence draft set-objective`, `add-ac` and `add-task` refused a PENDING CRLF or BOM draft with "draft status is unknown, not PENDING", or failed with "missing a ## Acceptance Criteria section".

All parse entry points and the frontmatter status reader now strip a leading BOM and turn CRLF and lone CR into LF before parsing. The three draft mutations write the file back in its original style: a CRLF file stays CRLF and a BOM is kept, so an edit changes only the edited bytes. A mixed-ending file is written back as all-CRLF, and a lone-CR file as LF. Line breaks in the text you pass to a mutation are turned into LF, then written in the file's style. An LF file is written exactly as before unless the text you pass contains a CR.
