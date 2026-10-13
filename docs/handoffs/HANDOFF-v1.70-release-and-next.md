# HANDOFF — v1.70.0 Release, Then Three Small Closers

**To:** Claude Code
**From:** Thomas, 2026-10-10
**Repo:** `thomas-powers-jr/cadence` @ `main` (`8d47d00`, PR #558 merged)
**Baseline:** core `1.69.1`; **1 pending changeset** (`assurance-report.md`, `minor`); loop IDLE; latest phase `327-assurance-report`, settled `strong` with real `host-cli` deep-verify + code-review, zero bypasses.

Four items, in order. **Item 1 is the only one that matters today**; items 2–4 are each under an hour and can trail.

---

## 1. Release v1.70.0

Follow `.claude/skills/release-cut/SKILL.md` end to end — all seven steps, **step 3 (doc-sync verification) and step 6 (independent verification) are not optional**.

- Lockstep bump to `1.70.0` across all five published packages; `testkit` stays private.
- `CLAUDE.md`'s version line and `CHANGELOG.md`'s newest heading in the **same commit** as `packages/core/package.json` — the pre-commit doc-sync gate aborts otherwise.
- Step 3: run the full doc-content test surface, then `grep -rn "1\.69\.1" --include=*.md .` and triage every hit. `DESIGN.md`'s "Current architecture (as of …)" line is the one that has slipped before.
- Release notes lead with `cadence assurance report` as a one-paragraph story (the changeset text is already right — use it), not a bullet.
- Step 6: `npm view` all five packages, `git ls-remote --tags`, `gh release view v1.70.0` — independently, after the workflow reports green. **Do not `gh run rerun --failed` on a red Release run**; verify reality first.

**Known interaction:** the `braces` audit exception (`GHSA-vfj7-8cjw-p6xm`) expires **2026-11-18**. It does not block this release. It will block one after that date unless Dependabot #474 (`@changesets/cli` 3.x) lands first — see item 4.

## 2. Snapshot the report (10 minutes, after the release)

```bash
node packages/core/bin/cadence.cjs assurance report > docs/evidence/assurance-$(date +%Y-%m-%d).txt
node packages/core/bin/cadence.cjs assurance report --json > docs/evidence/assurance-$(date +%Y-%m-%d).json
```

Create `docs/evidence/` if absent. Commit both on a branch. **Do not** add a staleness test — `dec-20261010-004` filed the generated-page idea deliberately; a dated snapshot is a record, not a live doc. This is Arc B's first input; the live tree now carries record 338 (phase 327 itself), so the numbers will differ slightly from the frozen fixture — that's expected and correct.

## 3. Amend the handoff that shipped the phase (5 minutes)

`docs/handoffs/HANDOFF-assurance-report.md` still carries the two-category AC-1 (86 + 155 ≠ 337). The DRAFT, SPEC, and shipped code are right; the handoff a future reader opens is not. Add a block directly under the header:

> **Pre-flight corrections (2026-10-10, phase 327).** AC-1 as written omitted a category. The corpus has three: un-gradable (no gate provenance, phases 2–139), gradable but never graded (provenance but no `assurance` block, 140–243, including four records after the first graded phase), and graded (235–326). `stateAtSettle` first appears at phase 196 and is not a settled-vs-refused predicate for older records. Tests pin a frozen fixture at `7d96650`, not the live tree. The 96 never-graded records are reported as a count only — no re-derived grades. See `327-01-DRAFT.md` for the as-built criteria.

Same branch as item 2 is fine.

## 4. Dependabot #474 (whenever, before 2026-11-18)

`@dependabot rebase`, then land it as its own PR. It drops `braces` from the tree and retires the exception. Not urgent today; urgent in five weeks.

---

## Then: Arc A, Phase 2

`docs/handoffs/HANDOFF-checkpoint-phase-2.md` is written, D-BJ is resolved, and it's parallel-safe. That's the next phase. Fresh worktree off the post-release `main`, tier `complex`, `CADENCE_HOST_CLI_BIN=codex` — the phase-327 recipe.

## Standing rules

- Branch + PR for everything, including the snapshot and the handoff amendment. No direct push.
- One phase, one commit — items 2 and 3 are docs, not a phase; they can share a branch.
- Verify every release claim independently. The workflow's own green is not proof.
- Write a session handoff before closing.

## Report back

1. `npm view` output for all five packages at `1.70.0`.
2. The `grep` triage from step 3 — every `1.69.1` hit and what was done with it.
3. The committed snapshot path and the live report's three category counts.
4. Confirmation the handoff amendment landed.
