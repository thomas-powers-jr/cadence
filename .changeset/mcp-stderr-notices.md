---
"@thomas-powers-jr/cadence-core": patch
---

MCP tool results keep stderr notices (phase 356; rec-20260822-002). The MCP server built each tool result's text from stdout or, only when stdout was empty, stderr, so a tool that printed a stdout line on success lost its stderr notices: a zero-acceptance-criteria `cadence_settle` returned `Settled 01-01` without the notice the CLI prints. The first text item is unchanged; when a tool wrote to both streams, its stderr notices now follow as a second text item, so a `json: true` report in the first item still parses. Refusals, which write stderr only, keep their single item.
