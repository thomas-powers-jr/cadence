---
"@thomas-powers-jr/cadence-core": patch
---

Fix: `parseDraftMd` no longer rejects a CRLF-terminated `DRAFT.md` with a misleading "missing frontmatter" error.

A `DRAFT.md` rewritten in text mode on Windows (Python's default `open(..,'w')`, PowerShell redirection, some editors) comes out `\r\n`-terminated. The frontmatter delimiter regex only ever matched bare `\n`, so such a file failed to parse even though its frontmatter was well-formed — and the error named the wrong cause. `parseDraftMd` now normalizes `\r\n` to `\n` once at its entry point before any section/frontmatter regex runs, so a CRLF draft parses field-for-field identically to its LF equivalent (no stray `\r` left in any string field), while a genuinely malformed frontmatter delimiter still throws the same error as before.
