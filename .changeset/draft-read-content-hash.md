---
"@thomas-powers-jr/cadence-types": minor
"@thomas-powers-jr/cadence-core": minor
---

`settle run`'s `draft-read` gate no longer refuses a DRAFT.md whose modification time changed but whose content did not (phase 340; dec-20261029-001). A `git checkout`, `git switch`, clone, pull or copy to another machine gives an unedited DRAFT a fresh mtime, and settle used to refuse it unless you passed `--allow-stale-draft`. `cadence draft approve` now also records `draftReadHash` in `state.json`: the sha256 of the DRAFT's text with a leading BOM stripped and CRLF and lone CR line endings turned into LF, so line-ending and BOM changes do not count as edits. When the DRAFT's mtime is newer than the approve time, settle refuses only if that hash no longer matches; a match passes with a notice on stderr. A real edit with a newer mtime is refused with the same message as before, and `--allow-stale-draft` still bypasses it. State approved before this change has no hash and keeps the mtime-only check. The new `draftReadHash` state field defaults to `null` when absent, so existing `state.json` files keep parsing.
