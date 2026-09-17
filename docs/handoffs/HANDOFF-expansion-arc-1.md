# HANDOFF — CADENCE Expansion Arc 1: Require a Skill, Then Ship One

**To:** Claude Code
**From:** Thomas, 2026-09-17
**Repo:** `thomas-powers-jr/cadence` @ `main`
**Baseline:** v1.67.1 released; 3 pending changesets (verify — CMD-A); loop IDLE; latest phase `310-draft-frontmatter-crlf-rejection`
**Scout ID for this batch:** `scout-20260917-expansion-1`

Two phases: **Phase 1** (finish Packs Slice 5 — declare `phase-build` as a required skill, producing the first `pack:<id>` provenance in a real settle) · **Phase 2** (the first expansion skill: `systematic-debugging`, distributed through `cadence/core-skills`). Phase 1 first — it is small, unblocked, and proves the enforcement path Phase 2 depends on.

**This is the first expansion phase since the pivot was approved.** Sixteen consecutive phases (295–310) were hardening, housekeeping, and external bug fixes — all necessary, and the expansion surfaces have not moved in three assessments: 3 skills, 38-line scout, zero `assumption` ledger callers, pack declaring `commands` only.

---

## 1. Mission

### 1a. The blocker is gone; finish the slice

Phase 294 shipped `cadence/core-skills` with `commands` only because the skill-invocation hook never fired — `state.skillAudit.invoked` had never been non-empty in the project's history. Phase 295 fixed `host-hooks` completeness; this repo's `.claude/settings.json` now carries the `Skill` matcher and `SubagentStart`.

**Measured: the telemetry is live.** `invoked` populates across phases 299–308 — `phase-build`, `pr-land`, `cadence-resume`. The signal Slice 2's provenance depends on now exists.

`skillAudit.provenance` is **still `[]` in every settle in the corpus.** The pack still declares no `skillAudit.required`. The field Slice 2 was built to fill has never been filled. Phase 1 fills it.

### 1b. The first expansion skill — and why debugging

The Superpowers scorecard has five unclaimed items. `systematic-debugging` is the one to ship first because it is the cheapest and the most on-thesis: the substrate already exists. `cadence assumption add / show / list / validate / reject / reopen` — a full hypothesis ledger with `open | validated | rejected` states — has **zero callers** anywhere in `.claude/`.

Superpowers' debugging skill is four phases of prompt discipline: reproduce, hypothesize, test, confirm. It is advice. A CADENCE debugging skill records each hypothesis as an assumption, requires an observation to `validate` or `reject` it, and — this is the gate-shaped part — **refuses to declare root cause while `cadence assumption list --filter-status open --filter-rec <id>` returns anything.** That query is deterministic. The skill's conclusion is gated on it.

It ships *through the pack*, which is what packs exist for.

---

## 2. Measured context — verify before designing anything

Measured against a `refs/heads/main` tarball, 2026-09-17. **If your measurements differ, yours are correct and this document is stale — say so and proceed from yours.**

### CMD-A — baseline (note the pending changesets)

```bash
node -e "console.log('core',require('./packages/core/package.json').version)"
ls .changeset/*.md | grep -v README
ls .cadence/phases | tail -2
```

Measured: core `1.67.1`; **3 pending changesets** (phases 308–310, unreleased); latest `310-…`. **Decide whether to cut a release before or after this arc** (D-BD) — three unreleased fixes already queued means this arc's changesets ride with them.

### CMD-B — the telemetry now works; provenance is still empty

```bash
node -e "
const fs=require('fs'),p=require('path');const root='.cadence/phases';
for(const d of fs.readdirSync(root).filter(x=>parseInt(x)>=295)){
  for(const f of fs.readdirSync(p.join(root,d))){if(!f.endsWith('-SUMMARY.json'))continue;
  const j=JSON.parse(fs.readFileSync(p.join(root,d,f),'utf8'));const s=j.skillAudit||{};
  if((s.invoked||[]).length)console.log(d.slice(0,30),'| invoked',JSON.stringify(s.invoked),'| provenance',JSON.stringify(s.provenance));}}"
cat .cadence/packs/cadence/core-skills/pack.json
node -e "const s=require('./.claude/settings.json');console.log('PostToolUse',(s.hooks.PostToolUse||[]).filter(e=>e._managedBy==='cadence').map(e=>e.matcher))"
```

Measured: `invoked` non-empty in 6 of 16 recent phases, `phase-build` the most frequent; `provenance: []` in all; pack declares `commands` only; `PostToolUse` carries both `Edit|Write|MultiEdit|NotebookEdit` and `Skill` matchers.

**Note which phases show `invoked: []`** — not every phase invokes a skill. That is the self-refusal risk Phase 1 must reason about (D-BE).

### CMD-C — how provenance is attributed

```bash
sed -n '1,12p' packages/core/src/checks/skill-audit.ts
grep -n "addAll(" packages/core/src/checks/skill-audit.ts
sed -n '/export function satisfies/,/^}/p' packages/core/src/verify/skill-match.ts
```

Measured: `SkillRequirementSource = 'config' | 'draft' | \`pack:${string}\``; pack requirements are added via `addAll(pack.manifest.skillAudit?.required ?? [], \`pack:${pack.id}\`)`; `satisfies` matches `inv === req` or `inv.endsWith(':' + req)`. The observed invoked form is bare (`phase-build`), so a requirement of `phase-build` matches directly.

### CMD-D — the assumption ledger (Phase 2's substrate) and its one hard constraint

```bash
sed -n '/\.command(.add.)/,/^    });/p' packages/core/src/cli/commands/assumption.ts | head -12
grep -n "for (const action of" packages/core/src/cli/commands/assumption.ts
grep -n "status: z.enum" packages/types/src/intelligence.ts
grep -rln "cadence assumption" .claude/ | wc -l
```

Measured: `assumption add` takes **`--rec <id>` (required)** and `--text <text>` (required). Transitions: `validate | reject | reopen`. Status enum: `open | validated | rejected`. **Zero references to `cadence assumption` anywhere in `.claude/`.**

**The constraint that shapes Phase 2:** an assumption *must* belong to a recommendation. A debugging session's hypotheses need a rec to hang off. See D-BG — this is a genuine design decision, not a detail.

### CMD-E — the skill template to match

```bash
head -5 .claude/skills/phase-build/SKILL.md
grep -n "^#" .claude/skills/phase-build/SKILL.md
```

Measured: frontmatter `name` + `description` (with explicit "use when" trigger phrases), then `# Title`, `## Preconditions`, `## Pipeline`, `## Known failure modes to actively watch`. **Match this shape.** The `description` is what the host uses to decide when to invoke — write the trigger phrases for real debugging situations, not generically.

### CMD-F — dedup preflight

```bash
node packages/core/bin/cadence.cjs recommendation list --filter-regex "debug|assumption|hypothes|core-skills|skillAudit.required" --sort-by created
node packages/core/bin/cadence.cjs recommendation list --filter-regex "rec-20260823-004|rec-20260822-010"
node packages/core/bin/cadence.cjs decision list --filter-text skill
```

Measured pre-write: **no open rec covers either phase.** `rec-20260823-004` (Slice 5) and `rec-20260822-010` (Slice 2) are both `shipped` — Phase 1 is a continuation of shipped work, not a duplicate. Nothing on debugging at all.

---

## 3. Decisions to record

### D-BD — Release before or after this arc?

Three fix changesets (308–310) are unreleased. Options: **(a)** cut `v1.67.2` (or `.68.0`) now, then run this arc clean; **(b)** let the arc's changesets ride with them.

I lean **(a)**. This arc is the first expansion work in sixteen phases and deserves its own release note, not a rider on three hardening fixes. And a clean baseline makes any regression this arc introduces unambiguous. Your call — `release-currency` will want a decision either way.

### D-BE — Which skill does the pack require, and what about phases that don't invoke it?

`skillAudit.required` is **not phase-conditional** (phase 294's D-AW). A required skill must fire on *every* phase or settle refuses.

CMD-B shows `phase-build` fires on build phases but not on every settled phase — some show `invoked: []`. So requiring `phase-build` will refuse any phase built without invoking it.

1. **Require `phase-build` and accept the refusal** — it is the honest requirement (every real build should go through the pipeline), and a refusal on a phase that skipped it is the feature working. Document the escape hatch (a config override or `--allow-*` flag, if one exists — verify).
2. **Require nothing; keep `commands` only** — repeats phase 294's outcome and leaves provenance empty.
3. **Build phase-conditional requirements** — new mechanism, out of scope; file it if the friction proves real.

I lean **(1)**. The whole point of packs is *enforcement*, and a pack that requires nothing enforces nothing. But **verify the escape hatch exists before enabling** — if the only way past a refusal is `--force`, that is a design gap to file before shipping the requirement, not after. Record what the bypass flag is.

### D-BF — Does Phase 1 settle its own phase under the new requirement?

Adding the requirement in Phase 1 means Phase 1's own settle is the first test. If Phase 1 was built via `phase-build`, it passes and produces the first provenance entry. If not, it refuses — which is itself the proof.

**Build Phase 1 via `phase-build` deliberately**, so the first live enforcement is a pass with provenance, and then confirm the refusal path separately with a fixture. Don't discover the refusal path on the phase that introduces it.

### D-BG — What does a debugging hypothesis hang off?

`assumption add` requires `--rec`. Options:

1. **The skill files a recommendation first** — `cadence recommendation add --title "bug: <symptom>" ...`, then hypotheses attach to it. Natural: a bug *is* a recommendation-shaped thing (a defect to fix), and the rec lifecycle (`shipped` when fixed) closes the loop. Cost: every debugging session creates a rec, and the ledger is already at 87 active / 42 `needs-decision`.
2. **Relax `--rec` to optional** — schema change to `AssumptionZ`, blast radius on every consumer of `recommendationId`. Additive-optional is possible but changes the ledger's invariant that assumptions are always attributable.
3. **Attach to the active phase's converted rec** — most phases have one; debugging inside a phase attaches naturally. Fails for debugging outside a phase.

I lean **(1) for v1**, with the rec filed at `low` / `needs-evidence` and the skill responsible for advancing it to `shipped` (or `rejected` if the bug was a false alarm) at conclusion — so debugging sessions don't accumulate as dead ledger entries. **If the ledger cost proves real, that is evidence for (2) as a follow-up.** Record whichever you choose and the reasoning.

### D-BH — Is the debugging skill *required*, or only *distributed*?

Debugging doesn't happen on every phase, so it cannot go in `skillAudit.required` (D-BE's non-conditional constraint). The pack **distributes** it — declares it exists, and the doctor `pack-commands` check can verify it's present — but does not require it.

Its gate is internal: the skill's own contract refuses conclusion while open assumptions exist, backed by a deterministic `assumption list` query. **That is shape backed by a structural check, and the SKILL.md should say so explicitly** — the honest claim is "the skill's conclusion is gated on a ledger query," not "CADENCE enforces debugging discipline."

Note: the pack manifest's `commands[]` is for slash commands, and skills are not commands. **Determine whether the manifest has a slot for declaring a distributed-but-not-required skill.** If not, that is a small Slice-6 mechanism gap — file it, don't build it here; the skill can still ship as a file in `.claude/skills/` and be *referenced* from the pack's documentation.

---

## 4. Phase 1 — Declare the skill

**Objective.** `cadence/core-skills` declares `skillAudit.required: ["phase-build"]`; a real settle produces the first `pack:cadence/core-skills` provenance entry in the corpus.

**Investigate first:**
1. Confirm the escape hatch for a skill-audit refusal (D-BE). Name the flag or config path. If none exists short of `--force`, **stop and file it** before proceeding.
2. Confirm the pack manifest accepts `skillAudit.required` as authored (`PackManifestZ` is `.strict()`).

**Acceptance criteria** (Given/When/Then in the DRAFT; anchor to committed tests and real command output, never SUMMARY prose — `dec-20260812-001`. **Numeric AC ids only.**)

- **AC-1** Given the manifest declares `skillAudit.required: ["phase-build"]`, when `resolvePacks` runs, then it resolves successfully with the requirement present — proven by real command output.
- **AC-2** Given the pack enabled and a phase built via `phase-build`, when it settles, then `SUMMARY.json`'s `skillAudit.provenance` contains an entry attributing `phase-build` to `pack:cadence/core-skills` — **the first non-empty provenance array in the corpus.** This phase's own settle is that proof (D-BF).
- **AC-3** Given the pack enabled and a fixture phase where `phase-build` was **not** invoked, when settle runs, then `runSkillAuditCheck` refuses, naming the skill and its `pack:` source — the refusal path proven by fixture, separately from the live pass.
- **AC-4** Given the refusal in AC-3, when the documented escape hatch (per D-BE) is used, then settle proceeds and the bypass is recorded in `gateBypasses` — not silent.
- **AC-5** `docs/packs-design.md` §7 Slice 5 entry is updated to reflect the requirement landing, and the pack's manifest `version` is bumped.
- **AC-6** The full existing test suite is green with the pack enabled.

**Files.** `.cadence/packs/cadence/core-skills/pack.json` · `docs/packs-design.md` · tests: extend the real-manifest resolution test; new skill-audit refusal fixture.

**Non-goals.** No new mechanism. No phase-conditional requirements. No changes to `runSkillAuditCheck`.

---

## 5. Phase 2 — `systematic-debugging`

**Objective.** Ship the first expansion skill: a debugging discipline whose conclusion is gated on the assumption ledger, distributed through `cadence/core-skills`.

**Investigate first:**
1. Resolve D-BG (what a hypothesis hangs off) and D-BH (distributed vs required, and whether the manifest has a slot for it).
2. Read Superpowers' `systematic-debugging` skill for what it gets right — reproduce first, one hypothesis at a time, disconfirm before confirm — and note what CADENCE adds: **the trail is a ledger, and the conclusion is gated.** Don't reproduce its prose; reproduce its discipline with structure underneath.

**The skill's contract** (SKILL.md, matching CMD-E's template):

- **Preconditions:** a reproducible symptom. If it can't be reproduced, the skill's first output is that finding — not a hypothesis.
- **Pipeline:**
  1. File the anchor per D-BG; record the reproduction as its first evidence.
  2. For each hypothesis: `cadence assumption add --rec <id> --text "<falsifiable statement>"`. **One at a time.** A hypothesis that can't be falsified isn't one.
  3. Design the observation that would *reject* it. Run it. `cadence assumption reject <id>` or `validate <id>` with the observation recorded.
  4. **Before declaring root cause:** `cadence assumption list --filter-rec <id> --filter-status open --format json`. **Non-empty means stop.** The skill does not conclude with open hypotheses. This is the gate.
  5. Root cause is the validated assumption(s) whose rejection-test failed to reject. Record it; advance the anchor rec.
- **Known failure modes:** declaring root cause after one confirmation without attempting rejection; batching hypotheses; "fixing" a symptom and closing without a validated cause; leaving the anchor rec open after conclusion.

**Acceptance criteria** (**numeric ids only**)

- **AC-1** `.claude/skills/systematic-debugging/SKILL.md` exists, matches the template shape (CMD-E), and its `description` names concrete trigger phrases for real debugging situations.
- **AC-2** Given the skill invoked on a fixture bug with a known cause, when the pipeline runs, then every hypothesis appears in the assumption ledger tied to one anchor, each closed with `validated` or `rejected` — proven by `assumption list --format json` output, not by prose.
- **AC-3** Given the skill reaches step 4 with at least one `open` assumption, when it attempts to conclude, then it does not — the SKILL.md's own gate holds, demonstrated on the fixture.
- **AC-4** Given the skill concludes, when the anchor rec is inspected, then it is no longer `candidate` — advanced per D-BG's lifecycle. No dead ledger entries.
- **AC-5** Per D-BH: the pack references the skill through whatever slot exists, or the DRAFT records that no slot exists and files the Slice-6 gap.
- **AC-6** The skill's invocation is observable in `state.skillAudit.invoked` after use — proving it rides the same telemetry as `phase-build`.
- **AC-7** `docs/packs-design.md` gains a "distributed skills" note and the Superpowers scorecard entry for `systematic-debugging` moves to **replaced**, with the honest framing from D-BH (gated on a ledger query, not enforced by CADENCE).

**Files.** `.claude/skills/systematic-debugging/SKILL.md` (new) · `.cadence/packs/cadence/core-skills/pack.json` (per D-BH) · `docs/packs-design.md` · tests: a fixture-bug walkthrough that asserts ledger state, not prose.

**Non-goals.** No `AssumptionZ` schema change unless D-BG option 2 is chosen (and then additive-optional, additive rules apply). No enforcement of the debugging skill on every phase. No changes to the `assumption` CLI. No other expansion skills — one at a time.

---

## 6. Ledger work — file, never self-apply

Dedup preflight per CMD-F, verbatim output pasted before any write. Then, for each phase, author a rec from §4/§5 (do not auto-derive from this document):

```bash
node packages/core/bin/cadence.cjs recommendation add \
  --title "..." --summary "..." \
  --priority medium --readiness ready-for-cadence-spec \
  --area packs,skills --file .cadence/packs/cadence/core-skills/pack.json \
  --evidence "skillAudit.invoked populates in 6 of 16 phases since 295; skillAudit.provenance is [] in all 322 corpus records; pack declares commands only (measured 2026-09-17)" \
  --scout-id scout-20260917-expansion-1
```

If D-BH finds no manifest slot for distributed skills, **file that as Slice 6** with the constraint explained. If D-BE finds no escape hatch short of `--force`, **file that before enabling the requirement.**

**No hand-edits to `.cadence/intelligence/`.**

---

## 7. Standing rules

- **Numeric AC ids only.** `AC-1`, `AC-2`.
- **Measure, never predict.** Every figure carries the command that produced it. If §2's numbers moved, yours are correct.
- **Verify the escape hatch before enabling the requirement.** A gate whose only bypass is `--force` is a gate that will get forced.
- **Build Phase 1 via `phase-build`** so its own settle is the first live pass, not the first live refusal.
- **One hypothesis at a time** in the debugging skill — batching them is the failure mode the ledger exists to prevent.
- **Honest claims only in SKILL.md.** The debugging skill's gate is a ledger query the skill honors, not a CADENCE gate. Say exactly that.
- **Config/manifest changes are their own commit**, separate from code and docs.
- **Report, never rewrite.** No historical artifact edits; `summary verify-all` clean before and after.
- **Do not force-settle.** If Phase 1 refuses its own settle, that is a finding about D-BE, not a reason to force.
- **Declare `stop:` on every task**; record at least one with `--execution dispatch`.
- **Honest negative results are the goal.** "No escape hatch exists; requirement not enabled; gap filed" is a successful Phase 1.

---

## 8. Report-back protocol

1. Verbatim `cadence doctor`, before and after each phase.
2. CMD-A through CMD-F output, with anything that moved from §2 called out.
3. Dedup preflight, before any ledger write.
4. Which option was taken for **D-BD through D-BH**, with decision ids.
5. **The escape hatch for skill-audit refusal** — named, or reported absent.
6. **Whether `skillAudit.provenance` is non-empty in Phase 1's own settle artifact** — the first-ever instance, verbatim.
7. Phase 2: the fixture bug's full assumption trail as `assumption list --format json` output — every hypothesis, its status, and the anchor rec's final state.
8. Whether the debugging skill's invocation appeared in `state.skillAudit.invoked`.
9. Whether a manifest slot for distributed skills exists (D-BH), or the Slice-6 rec id.
10. The resulting version and changeset levels.
11. Any gate bypass used, with flag and reason. If `--force` was used, say so first.

---

## 9. Framing

Sixteen phases of hardening, housekeeping, and external bug fixes. All of it needed. Two of those phases closed the first bugs anyone outside the project ever filed, and one of them found that on Windows a deep-verify prompt over 32 KB had been silently degrading to `mock` — a settle that looked verified and verified nothing. That's the kind of thing you want found before the expansion track ships anything on top of it.

It's found. The hooks fire. The telemetry populates. The pack resolves. Every piece of the enforcement path exists and has been exercised — except the one line that makes a pack *require* something instead of merely *declaring* it.

Write that line. Then ship the first skill that isn't advice: a debugging discipline whose conclusion is gated on a ledger query, distributed through the same pack, riding the same telemetry. The Superpowers scorecard has sat at seven-of-fourteen for three months. This moves it to eight — and, more to the point, proves the distribution channel works for the six that remain.
