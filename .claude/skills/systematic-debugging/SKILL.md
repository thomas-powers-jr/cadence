---
name: systematic-debugging
description: Debug a failure by recording each hypothesis in the CADENCE assumption ledger and refusing to name a root cause while any hypothesis is still open. Use when a test fails, CI goes red, a gate refuses unexpectedly, behavior contradicts the code, a bug is reported, a fix did not work, or you have already tried more than one thing and are guessing. Use it especially under time pressure, when the cause seems obvious, and when you are tempted to fix the symptom you can see.
---

# Systematic debugging (ledger-backed)

Debugging fails in a predictable way: you form one hypothesis, find something
consistent with it, and stop. The trail lives in a transcript nobody rereads,
so the next person — often you — starts over.

This skill fixes the second problem structurally and the first by discipline.
Every hypothesis becomes a row in CADENCE's assumption ledger, tied to one
anchor recommendation, and it must be closed `validated` or `rejected` before
you may name a root cause.

**What is and is not enforced.** The ledger is real: `cadence assumption` rows
persist, and the conclusion query below is deterministic. But CADENCE does not
refuse a conclusion the way `settle` refuses a phase — no gate fires, nothing
exits non-zero if you conclude with hypotheses open. **This is a gate you
honor, not one the engine enforces.** Its value is that afterwards anyone can
run one command and see whether you honored it. Do not describe this skill, in
a SUMMARY or anywhere else, as CADENCE enforcing debugging discipline.

## Preconditions

- **A symptom you can reproduce.** If you cannot reproduce it, that is the
  finding — report it and gather data. It is not a licence to start
  hypothesizing; an unreproducible symptom cannot falsify anything, so every
  hypothesis you form is unfalsifiable by construction.
- **Read the error first, completely.** Stack trace, line numbers, exit code.
  A surprising number of bugs are already named in the text you skipped.
- **`.cadence/` is initialized.** The ledger commands write there. In a fresh
  worktree run `cadence onboard` first.
- **You have not already applied a fix.** If you have, say so — you are now
  debugging two things, and the fix may be masking the symptom.

## Pipeline

### 1. File the anchor

Every assumption must belong to a recommendation — `assumption add` requires
`--rec`. File one for the bug before forming any hypothesis:

```sh
cadence recommendation add \
  --title "bug: <symptom in one line>" \
  --summary "<what you observe, and the exact reproduction>" \
  --priority medium --readiness needs-evidence \
  --area <area> --file <path/to/suspect.ts>
```

Record the reproduction as its first evidence, so the trail starts with a fact
rather than a guess:

```sh
cadence recommendation evidence add <recId> --note "Reproduction: <exact steps> -> <exact output>"
```

Note the id. Every hypothesis hangs off it, and you advance it at the end.

### 2. One hypothesis at a time

```sh
cadence assumption add --rec <recId> --text "<falsifiable statement>"
```

**Falsifiable** means you can state, now, an observation that would prove it
wrong. "Something is wrong with the cache" is not a hypothesis. "The cache
returns a stale entry because the TTL is compared in seconds against a
millisecond timestamp" is.

**One at a time.** Filing three hypotheses and then investigating is how you
end up confirming whichever you happened to test first. If you genuinely have
three candidates, file the one you can disconfirm fastest, close it, then file
the next.

### 3. Design the observation that would reject it — then run it

Ask what you would see if the hypothesis were **false**, not what you would see
if it were true. Confirmation is cheap and almost everything is consistent with
a wrong hypothesis. Then run it and close the row:

```sh
cadence assumption reject <assumptionId>    # the observation contradicted it
cadence assumption validate <assumptionId>  # the rejection test failed to reject it
```

**Record the observation.** `validate` and `reject` take only an id — the
ledger keeps the verdict but has nowhere to keep the evidence for it
(`rec-20260918-001`). Put it on the anchor and name the assumption id in the
note. This is a convention, not a schema link; nothing validates the reference:

```sh
cadence recommendation evidence add <recId> --note "<assumptionId>: <what you ran> -> <what you saw> -> rejected"
```

### 4. The gate — check before concluding

```sh
cadence assumption list --filter-rec <recId> --filter-status open --format json
```

**Non-empty means stop.** You have an open hypothesis; either close it or
explain in the anchor's evidence why it is no longer relevant and then close
it. Do not name a root cause while this query returns anything.

This is the step the whole skill exists to make checkable. Run it as a command
and read the output — do not decide from memory that you closed everything.

### 5. Conclude, and close the anchor

The root cause is the validated assumption whose rejection test failed to
reject it. Record it, then advance the anchor so the session leaves no dead
row:

```sh
cadence recommendation evidence add <recId> --note "Root cause: <validated assumptionId> — <statement>. Fix: <what changes>."
cadence recommendation promote <recId> --status=accepted --readiness=ready-for-cadence-spec
```

If the bug was a false alarm, say so and close it the same way:

```sh
cadence recommendation promote <recId> --status=rejected
```

A `rejected` anchor with its hypothesis trail intact is a successful debugging
session. "No bug here, and here is what I ruled out" is a real result.

## Known failure modes to actively watch

- **Concluding on one confirmation.** You found something consistent with the
  hypothesis and stopped. Consistency is not evidence; you must have tried to
  reject it and failed.
- **Batching hypotheses.** Three rows filed at once, one investigated, the
  other two quietly closed to clear the gate. The gate is satisfied and you
  learned nothing — this is the failure the one-at-a-time rule exists for.
- **Closing a row to clear the gate.** `validate` on an assumption you never
  tested is the same self-report this repo refuses everywhere else. If you are
  closing it because you stopped caring, `reject` it and say why in the
  evidence.
- **Fixing the symptom and closing.** The test passes now but no assumption was
  ever validated. You have a green suite and an unexplained system; the bug
  will return under a different symptom.
- **Leaving the anchor open.** Step 5 exists because an abandoned `candidate`
  row is indistinguishable from real queued work, and the ledger is already
  large.
- **Hypothesizing without a reproduction.** See Preconditions. If you cannot
  reproduce it you cannot falsify anything, and the ledger fills with rows that
  can never be honestly closed.
- **Editing the ledger by hand.** `.cadence/intelligence/` is written through
  the CLI. A hand-edited row is a fabricated audit trail.
