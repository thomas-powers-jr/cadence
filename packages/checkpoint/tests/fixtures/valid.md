# Session Handoff — 2026-09-22 (example)

## TL;DR for the next session

Shipped the checkpoint validator scaffold. Next session should implement the CLI.

## State on handoff

- Branch: `docs/checkpoint-phase-1`
- Loop position: IDLE

## CADENCE context

- Active phase: none
- Active draft: none

## Acceptance criteria touched

- AC-1: done
- AC-2: done

## What landed this session

- packages/checkpoint scaffolded
- fixture corpus committed

## Carry-forward gotchas

- Windows hook spawn needs `shell: true` for npx-based commands.

## Open decisions

None

## Next action

Implement `validate()` per the fixture corpus.
