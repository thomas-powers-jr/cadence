# Session Handoff — 2026-09-22 (example)

## TL;DR for the next session

A fenced block that contains a nested-looking fence with an info string
must not close the outer fence early — only a bare closing marker (nothing
but optional whitespace after it) counts.

```
Here is some pasted text.
```typescript
## This must stay inside the fence, not become a real header
```

## State on handoff

- Branch: `docs/checkpoint-phase-1`

## CADENCE context

- Active phase: none

## Acceptance criteria touched

- AC-1: done

## What landed this session

- nothing yet

## Carry-forward gotchas

None

## Open decisions

None

## Next action

n/a
