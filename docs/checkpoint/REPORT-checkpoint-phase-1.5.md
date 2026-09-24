# REPORT — checkpoint Phase 1.5 (handoff schema reconcile, CADENCE phase 316)

Phase 1 ([REPORT-checkpoint-phase-1.md](REPORT-checkpoint-phase-1.md), §4
Deviations) shipped the checkpoint handoff validator against a provisional
schema: it required two sections (`Acceptance criteria touched`, `Open
decisions`) that `cadence handoff`'s generator never emitted, so real
generated SESSION docs failed validation. This phase (CADENCE slice `316-01`)
reconciles the generator and the validator, and adds drift tests so they
cannot silently diverge again. Arc authorization:
[`docs/handoffs/HANDOFF-checkpoint-arc-phase-2.md`](../handoffs/HANDOFF-checkpoint-arc-phase-2.md).

## Red-before evidence

Real, captured output from before this phase's changes, at worktree base
commit `f553841d`:

```
$ node packages/checkpoint/bin/checkpoint.cjs validate .cadence/handoff/SESSION-2026-09-22-pr521-merged-checkpoint-proposal-dropped.md
SECTION_MISSING [Acceptance criteria touched]: Required section "## Acceptance criteria touched" is missing.
SECTION_MISSING [Open decisions]: Required section "## Open decisions" is missing.
exit=2

$ node packages/checkpoint/bin/checkpoint.cjs validate .cadence/handoff/SESSION-2026-09-23.md
SECTION_MISSING [Acceptance criteria touched]: Required section "## Acceptance criteria touched" is missing.
SECTION_MISSING [Open decisions]: Required section "## Open decisions" is missing.
exit=2
```

After this phase, both documents validate with exit 0.

## D-BI outcome

The operator chose the hybrid, implemented as version-gating:

- The generator (`renderSession()`, `packages/core/src/handoff/render-session.ts`)
  now emits `cadence_handoff: 2` in its frontmatter and a required
  `## Open decisions` narrative section (between `Carry-forward gotchas` and
  `Next action`).
- The validator selects its required-section schema — `SECTIONS_V1` vs
  `SECTIONS_V2`, both exported from `packages/checkpoint/src/validate.ts` —
  from the document's frontmatter `cadence_handoff:` value:
  - `1` reads the frozen six-section pre-phase-316 schema;
  - `2`, or no frontmatter / no `cadence_handoff:` key (read as "latest"),
    reads six-plus-`Open decisions`;
  - an unsupported value returns a single `HANDOFF_VERSION_UNSUPPORTED`
    diagnostic rather than guessing.
- `Acceptance criteria touched` is optional in both versions.

**Known gap, explicitly deferred to Phase 3, not closed here:** a document
could be hand-edited to declare `cadence_handoff: 1` to skip the
`Open decisions` requirement. This is harmless today because no gate consumes
the validator yet; Phase 3's Stop gate must close it before it matters (see
[Phase 3 preconditions](#phase-3-preconditions)).

## Section drift desync runs (AC-4)

The section drift test compares the headers `renderSession()` actually emits
against the validator's v2 required-section list, and separately calls
`validate()` on a rendered document. Each side was desynced deliberately to
prove the test goes red.

Desync (a), header removed from the renderer:

```
AssertionError: expected [ 'TL;DR for the next session', …(5) ] to deeply equal [ 'TL;DR for the next session', …(6) ]

- Expected
+ Received

@@ -2,8 +2,7 @@
    "TL;DR for the next session",
    "State on handoff",
    "CADENCE context",
    "What landed this session",
    "Carry-forward gotchas",
-   "Open decisions",
    "Next action",
  ]
```

And the AC-1 half of that same desync:

```
AssertionError: expected { Object (ok, diagnostics) } to deeply equal { ok: true, diagnostics: [] }

- Expected
+ Received

  {
-   "diagnostics": [],
-   "ok": true,
+   "diagnostics": [
+     {
+       "code": "SECTION_MISSING",
+       "message": "Required section \"## Open decisions\" is missing.",
+       "section": "Open decisions",
+     },
+   ],
+   "ok": false,
  }
```

Desync (b), entry removed from the validator's v2 list:

```
AssertionError: expected [ 'TL;DR for the next session', …(6) ] to deeply equal [ 'TL;DR for the next session', …(5) ]

- Expected
+ Received

@@ -2,7 +2,8 @@
    "TL;DR for the next session",
    "State on handoff",
    "CADENCE context",
    "What landed this session",
    "Carry-forward gotchas",
+   "Open decisions",
    "Next action",
  ]
```

In desync (b), only the header-comparison test failed — the direct
`validate()` call still passed, because the extra `## Open decisions` header
in the rendered doc was simply unknown to a spec that no longer listed it.
This demonstrates the drift test catches something `validate()` alone would
miss.

## AC-grammar drift desync runs (AC-5)

Before the fix, the shared AC-id corpus test failed with:

```
Tests 3 failed | 7 passed (10)
```

The failing entries were `AC-` (no digits) and `AC-1 ` (trailing space
before the colon): checkpoint accepted both by silently skipping the bullet
(no diagnostic at all), while core's `parseDraftMd` and types'
`AcceptanceCriterionZ` both rejected them. The third failure was the direct
assertion expecting an `AC_ID_MALFORMED` diagnostic that did not exist yet.
After the fix — a new `AC_ID_MALFORMED` diagnostic in
`checkAcceptanceCriteria()` — all corpus entries agree across
core/types/checkpoint.

A **second** three-way disagreement was found and fixed during this phase's
independent review, not in the original corpus: `- AC-1**: text` (a stray
closing `**` with no opening `**`) was accepted by checkpoint — the old
regex's two independently-optional `**` groups let a lone closing marker
through — while core and types both rejected `AC-1**`. Fixed by making the
bold markers a matched pair in the regex and excluding `*` from the id
capture. The corpus now includes `AC-1**` pinned to `reject` on all three
sides.

Independent review also caught a gap in the section-drift test (previous
section): AC-1's Then clause requires the CLI to exit 0 on the freshly
rendered document, not just a direct `validate()` call, and the first
implementation only covered the direct call. The desync-(a) capture above
predates that fix and shows 2 failing tests; a rerun today would also fail
the CLI check added afterward (3 failures), for the same underlying reason.

## Changed fixtures (AC-6)

Exactly one of the 27 pre-existing fixtures changed outcome:

- `missing-section-ac.md` moved from `SECTION_MISSING [Acceptance criteria
  touched]` to valid (`{ok:true}`), because that section is now optional.

Footnote, so nobody mistakes it for a re-baseline: `non-utf8.md` changes
**only** on the string-input validation path (its `SECTION_MISSING`
diagnostic count drops from 8 to 7, since AC is now optional). Its
Buffer-input path — the only path its actual tests exercise, both in
`validate.test.ts` and the CLI — is unaffected and still returns
`NON_UTF8_INPUT` exactly as before. This is not an AC-6 violation; it is
recorded so the "one fixture changed" claim is not read as incomplete.

## Provisional-schema resolution

Phase 1's report flagged that its two inserted sections
(`Acceptance criteria touched`, `Open decisions`) were "an inference from the
fixture corpus's requirements, not a literal answer to any of the four
decisions the operator already made," and that this made the schema
provisional. This phase resolves that: the operator's D-BI hybrid decision
makes `Open decisions` a real, generator-emitted, required (v2) section, and
demotes `Acceptance criteria touched` to optional in both schema versions,
since the generator has never emitted it and there is no plan for it to. The
schema is no longer provisional.

## Phase 3 preconditions

Everything found during this phase that Phase 3 (the Stop gate) must account
for before it can safely consume this validator:

- **The version-downgrade vector.** A document can declare
  `cadence_handoff: 1` to skip the `Open decisions` requirement — harmless
  today, not once a gate consumes the validator. *(Source: the D-BI outcome
  above; version selection in `packages/checkpoint/src/validate.ts`.)*
- **The unfilled-placeholder gap.** A freshly rendered, entirely unfilled v2
  document still passes `validate()`: its `<!-- ... FILL IN ... -->` markers
  are non-empty text, so `checkOpenDecisions`'s empty-check does not fire, and
  there is no unfilled-placeholder detection in the validator by design (a
  DRAFT Boundary). `cadence handoff --check` already catches this via
  `findUnfilledSections()`, so Phase 3 should compose both checks, not assume
  the validator alone is sufficient. *(Source: `checkOpenDecisions` in
  `packages/checkpoint/src/validate.ts`; the phase 316 DRAFT's Boundaries.)*
- **Brief-mode `cadence resume` gives no warning when `Open decisions` is left
  unfilled.** `findUnfilledSections()` in `run-resume.ts` runs against the
  already-shortened brief content, so an unfilled `Open decisions` section
  (which is excluded from the brief) produces no warning in brief mode, only
  in `--full`. This matches pre-existing behavior for other non-brief sections
  (not a regression introduced here), but Phase 3 should know it if it relies
  on brief-mode warnings. *(Source: `packages/core/src/handoff/run-resume.ts`.)*
- **A BOM defeats frontmatter detection on string input.** A byte-order mark
  at the start of a *string* passed to `validate()` hides the frontmatter, so a
  v1 doc with a BOM reads as v2/latest and fails. The CLI is unaffected (it
  passes a Buffer, which `validate()` decodes via `TextDecoder`, stripping the
  BOM); this only matters if Phase 3's Stop hook ever calls `validate()` with
  a string it read itself rather than piping through the CLI. *(Source:
  frontmatter parsing in `packages/checkpoint/src/validate.ts`.)*
- **Duplicate `cadence_handoff:` keys: first one wins.** A parser quirk, same
  class as the downgrade vector, not a new hole. *(Source: frontmatter
  parsing in `packages/checkpoint/src/validate.ts`.)*
- **The frontmatter close search is not fence-aware and only accepts a
  literal `---`.** A document with no real frontmatter that happens to open
  with a `---` thematic break and has a later, unrelated `---` further down
  would have every header between the two swallowed as "frontmatter,"
  producing spurious `SECTION_MISSING` diagnostics; a `cadence_handoff:`-like
  line in that range, even inside a fenced code block, would also be misread
  as the version. Unrealistic for anything `cadence handoff` actually
  generates, but worth Phase 3 knowing about if it ever validates
  hand-authored input. *(Source: `parseFrontmatter` in
  `packages/checkpoint/src/validate.ts`.)*
- **Some AC-looking bullet shapes still skip silently with no diagnostic:**
  checkbox bullets (`- [x] AC-1: ...`), lowercase (`- ac-1: ...`),
  numbered-list markers (`1. AC-1: ...`), and `+` bullets. Out of scope for
  this phase; only matters if Phase 3 relies on `Acceptance criteria touched`
  coverage being exhaustive. *(Source: `checkAcceptanceCriteria()` in
  `packages/checkpoint/src/validate.ts`.)*
