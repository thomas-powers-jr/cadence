# HANDOFF — CADENCE `assurance report`: The Portfolio Rollup

**To:** Claude Code
**From:** Thomas, 2026-10-10
**Repo:** `thomas-powers-jr/cadence` @ `main`
**Baseline:** v1.69.1; 0 pending changesets; loop IDLE; latest phase `326-docs-name-all-three-required-checks` (verify — CMD-A)
**Scout ID for this batch:** `scout-20261010-assurance-report`
**Backing rec:** none — dedup clear (CMD-F). The operator files it before `spec new`.
**Arc:** B (evidence) in the three-arc roadmap agreed 2026-10-10. Runs independently of Arc A (checkpoint Phase 2/3) — separate worktree.

> **Pre-flight corrections (2026-10-10, phase 327).** AC-1 as written omitted a category. The corpus has three: un-gradable (no gate provenance, phases 2–139), gradable but never graded (provenance but no `assurance` block, 140–243, including four records after the first graded phase), and graded (235–326). `stateAtSettle` first appears at phase 196 and is not a settled-vs-refused predicate for older records. Tests pin a frozen fixture at `7d96650`, not the live tree. The 96 never-graded records are reported as a count only — no re-derived grades. See `327-01-DRAFT.md` for the as-built criteria.

One phase. Expected changeset: **`minor`** (new CLI subcommand) → **v1.70.0**, but confirm from what lands.

---

## 1. Mission

Every number in this document was produced by a Python script run against a tarball. That is the problem.

CADENCE has spent eleven releases making its per-phase assurance honest: a grade that reads its own bypasses (283), reads `empty-diff` provenance (287), reads a deterministic scanner (282), sits on a parser that refuses what it can't read (288), behind a hook transport that survives PowerShell (317). Each phase's `SUMMARY.json` now carries a defensible account of how strongly it was verified.

**No command rolls those accounts up.** The corpus-wide picture — 337 records, 86 graded, the grade distribution, which gates actually fire and how often, how many settles were forced, how often a verifier silently fell back — exists only when someone writes a script. The 0-of-121 `boundary-scan` finding in August, the 32-of-39 `mixed` finding in the same month, the strong→mixed drift after 283: every one was a one-off measurement, reproducible only by re-running ad-hoc code.

`cadence assurance report` makes the portfolio picture a command. It is the substrate for the evidence write-up (Arc B's second deliverable) and it is the single most credible public artifact the project can produce — because it leads with the unflattering numbers, computed by the tool about itself.

---

## 2. Measured context — verify before designing anything

Measured against a fresh clone of `main` at `7d96650`, 2026-10-10. **If your measurements differ, yours are correct and this document is stale — say so and proceed from yours.**

### CMD-A — baseline

```bash
node -e "console.log('core',require('./packages/core/package.json').version)"
ls .changeset/*.md 2>/dev/null | grep -v README | wc -l
ls .cadence/phases | tail -1
ls packages/core/src/cli/commands/ | tr '\n' ' '
```

Measured: core `1.69.1`; **0** pending changesets; latest `326-…`; **no `assurance.ts` command exists**, and no subcommand of `summary`, `verify`, or `inspect` produces a corpus rollup.

### CMD-B — the corpus the report must describe (this is the phase's fixture)

```bash
node -e "
const fs=require('fs'),p=require('path');const root='.cadence/phases';
let n=0,withA=0,noProv=0,byp=0;const grade={},gate={},prov={},ev={},pre={},post={};
for(const d of fs.readdirSync(root)){const dir=p.join(root,d);if(!fs.statSync(dir).isDirectory())continue;
for(const f of fs.readdirSync(dir)){if(!f.endsWith('-SUMMARY.json')||f.includes('snapshot'))continue;n++;
let j;try{j=JSON.parse(fs.readFileSync(p.join(dir,f),'utf8'))}catch(e){continue}
const num=parseInt(d);const a=j.assurance;
if(a){withA++;grade[a.overall]=(grade[a.overall]||0)+1;const b=num>=283?post:pre;b[a.overall]=(b[a.overall]||0)+1;
  for(const[k,v]of Object.entries(a.evidenceTally||{}))ev[k]=(ev[k]||0)+v;}
if(j.gateBypasses&&j.gateBypasses.length)byp++;
if(!j.gates||!j.gates.length)noProv++;
for(const g of j.gates||[]){const k=g.gate+':'+g.status;gate[k]=(gate[k]||0)+1;if(g.providerSelection)prov[g.providerSelection]=(prov[g.providerSelection]||0)+1;}}}
console.log('records',n,'| with assurance',withA,'| no gate provenance',noProv,'| with bypasses',byp);
console.log('grade',grade);console.log('pre-283',pre,'post-283',post);console.log('providerSelection',prov);console.log('evidence',ev);
for(const g of['deep-verify','code-review','security-audit','boundary-scan','interactive-verdict'])console.log(g.padEnd(20),'ran',gate[g+':ran']||0,'skipped',gate[g+':skipped']||0);"
```

Measured:

| Dimension | Value |
|---|---|
| Records | **337** · 86 with assurance · **155 with no gate provenance at all** (pre-phase-263 history) · 18 with bypasses |
| Grade distribution | `mixed` 74 · `strong` 10 · `unverified` 2 |
| Pre/post phase 283 | pre: mixed 35 / strong 6 / unverified 2 · post: mixed 39 / strong 4 |
| `providerSelection` | `configured` 9 · `fallback` 3 · `empty-diff` 0 |
| Evidence tally | `executed` 319 · `ai-verified` 73 · `unverified` 20 · `assertion` 0 · `mention` 0 |
| `deep-verify` | ran **19** / skipped 163 |
| `code-review` | ran **15** / skipped 167 |
| `security-audit` | ran **3** / skipped 179 |
| `boundary-scan` | ran **13** / skipped 153 — **was 0 / 121 on 2026-08-16** |
| `interactive-verdict` | ran 4 / skipped 178 |

**Three things in that table are the report's reason to exist.** The `boundary-scan` 0→13 movement is a before/after nobody can see today. The 155 records with no provenance are a category the report must name rather than fold into "clean." And `security-audit` at 3-of-182 is a number the operator should be confronted with by a command, not discover in a chat.

**Every one of those numbers is an acceptance-criteria fixture.** The report's output must reproduce them from this corpus.

### CMD-C — the corpus walker to reuse

```bash
grep -n "readdirSync\|Sorted for determinism\|snapshot" packages/core/src/verify/historical-coverage-audit.ts | head -8
grep -n "stateAtSettle" packages/core/src/services/*.ts | head -3
```

Measured: `verify/historical-coverage-audit.ts:225-240` has a corpus walk that is **sorted for determinism** and tolerant of one unreadable directory (it doesn't take down the whole walk). Phase 322 established `stateAtSettle` as the marker that "only a successful settle writes" — the report should use the same predicate to separate settled records from refused ones. **Reuse the walker; do not write a third one.** Phase 322's `lastSettledPhase` derivation is the precedent for how to classify.

### CMD-D — the precedent for the output shape

```bash
node packages/core/bin/cadence.cjs retro rollup --help 2>&1 | head -20
grep -n "export async function" packages/core/src/services/retro-rollup.ts | head -3
```

Measured: `retro rollup` (`rec-20260712-002`, shipped) is the existing cross-phase aggregate command. **Match its conventions** — rendered text by default, `--json` for the machine shape, a `--since <phase>` window if it has one. Don't invent a second aggregate-command idiom.

### CMD-E — what "no provenance" means, precisely

```bash
node -e "
const fs=require('fs'),p=require('path');const root='.cadence/phases';let first=null,last=null;
for(const d of fs.readdirSync(root).sort((a,b)=>parseInt(a)-parseInt(b))){
for(const f of fs.readdirSync(p.join(root,d))){if(!f.endsWith('-SUMMARY.json'))continue;
let j;try{j=JSON.parse(fs.readFileSync(p.join(root,d,f),'utf8'))}catch(e){continue}
if(j.gates&&j.gates.length){if(first===null)first=d;last=d;}}}
console.log('first record with gate provenance:',first,'| last:',last);"
```

Run this. The report needs to state *why* 155 records can't be graded — because gate provenance landed in a specific phase and history before it is structurally un-gradable, not merely ungraded. That is the honest framing, and it's the one phase 282's drift report used ("12 unverifiable, reported as their own category").

### CMD-F — dedup preflight

```bash
node packages/core/bin/cadence.cjs recommendation list --filter-regex "assurance report|portfolio|corpus.*report|rollup|aggregate" --sort-by created
node packages/core/bin/cadence.cjs decision list --filter-text assurance
```

Measured pre-write: **no open rec covers this.** `rec-20260712-002` (retro rollup, shipped) is the pattern; `rec-20260729-006` (retroactive coverage audit, shipped) is the precedent for a corpus-wide re-derivation command. Neither is this.

---

## 3. Decisions to record

### D-BT — Command placement

1. **`cadence assurance report`** — new top-level noun, room for `assurance explain <phase>` later.
2. **`cadence summary report`** — under the existing `summary` command alongside `verify-all`.
3. **`cadence verify assurance`** — under `verify`.

I lean **(1)**. The assurance record is its own concept (phase 283 named it), and a top-level noun leaves room for the per-phase explainer that the evidence write-up will want. **Collision check**: `assurance` collides with nothing in `packages/core/src/cli/commands/` (CMD-A). Record it.

### D-BU — What the report computes vs. what it re-derives

The stored `assurance.overall` in old records predates phase 283 and 287's rules — phase 283's drift report found two records whose stored grade would change under the current rule. Options:

1. **Report stored grades only** — what the artifact says.
2. **Report re-derived grades only** — what the current rule would say.
3. **Report both, and the delta** — the stored distribution, the re-derived distribution, and the records that differ.

I lean **(3)**. The delta *is* the evidence story: "here is how many historical grades the honesty work moved." It's also the report-never-rewrite posture made visible — the files stay as written, the report shows what changed. `deriveAssuranceRecord` is pure (dec-20260728-001) so re-derivation is a function call per record.

### D-BV — Is the report a doctor check too?

A `doctor` check that warns when the portfolio's `strong` ratio over the last N settled phases falls below a floor (or when `security-audit` hasn't run in N phases) would make the report *prescriptive*. That's assurance floors (my August A3) — a separate decision. **Ship the report descriptive; file the floor.**

### D-BW — Does the output go in the README?

The evidence write-up will want a current snapshot. A `docs/evidence/assurance.md` generated by the command (not hand-maintained) with a doc-sync test that fails when stale is the honest pattern — the doc-sync gate already exists for CLAUDE.md's version line. Decide whether this phase ships the generator or files it.

---

## 4. Phase — `cadence assurance report`

**Objective.** One command renders the corpus-wide assurance picture — grade distribution, gate firing rates, provider mix, bypass count, evidence tally, and the un-gradable history as its own category — with `--json` for machines and every number reproducible from the fixture corpus.

**Investigate first:**
1. Run CMD-B and CMD-E on your checkout. Record the numbers — they are your AC fixtures.
2. Read `retro-rollup.ts` for the output idiom (CMD-D).
3. Read `historical-coverage-audit.ts:225-240` for the walker (CMD-C).

**Acceptance criteria** (Given/When/Then; anchor to committed tests and real command output, never SUMMARY prose — `dec-20260812-001`. **Numeric AC ids only.**)

- **AC-1** Given this repo's corpus, when `cadence assurance report` runs, then it reports the record count, the graded count, and the **un-gradable count as a named category with its reason** (no gate provenance; history before phase N per CMD-E). The three numbers sum to the total. Fixture: CMD-B's 337 / 86 / 155 at this commit.
- **AC-2** Given the same corpus, when the report runs, then the grade distribution matches CMD-B exactly (`mixed` 74, `strong` 10, `unverified` 2 at this commit), and per D-BU the re-derived distribution and the per-record delta are shown alongside.
- **AC-3** Given the same corpus, when the report runs, then per-gate `ran`/`skipped` counts match CMD-B for all five verifier-family gates, and `boundary-scan` shows 13 ran at this commit.
- **AC-4** Given `--since <phase>`, when the report runs, then every count is restricted to records at or after that phase, and `--since 283` reproduces CMD-B's post-283 split.
- **AC-5** Given `--json`, when the report runs, then the output is a stable, documented schema (recorded in `docs/reference/commands.md`), and the rendered text is derived from the same object — no number appears in text that isn't in the JSON.
- **AC-6** Given one unreadable `SUMMARY.json` in the corpus (a fixture with malformed JSON), when the report runs, then it reports that file as unreadable by path, counts it in a named category, and **does not fail** — the historical-coverage-audit tolerance posture.
- **AC-7** Given the full corpus, when the report runs twice, then the output is byte-identical — the walker is sorted and the computation is deterministic (the phase-282 lesson).
- **AC-8** The report **never writes** to any `SUMMARY.json`, `state.json`, or ledger file. Proven by a content-hash sweep before and after; `summary verify-all` reports 0 MISMATCH.
- **AC-9** `docs/reference/commands.md` gains the command with the JSON schema, and the doc-sync test covers it.

**Files.** `packages/core/src/cli/commands/assurance.ts` (new) · `packages/core/src/services/assurance-report.ts` (new) · reuse `verify/historical-coverage-audit.ts`'s walker (extract if needed — don't duplicate) · `packages/core/src/gates/assurance-record.ts` (import `deriveAssuranceRecord` for D-BU; **no changes to it**) · `docs/reference/commands.md` · tests: a fixture-corpus suite pinning every CMD-B number, the malformed-file case, the determinism case.

**Non-goals.** No assurance floors (D-BV — filed, not built). No doctor check. No changes to `deriveAssuranceRecord`. No README changes beyond what D-BW decides. No per-phase `assurance explain` (room is left for it; it is not this phase).

---

## 5. Standing rules

- **Numeric AC ids only.** `AC-1`, `AC-2`.
- **Measure, never predict.** Every figure carries the command that produced it. CMD-B's table is this phase's fixture — if your numbers differ, yours are correct and the ACs use yours.
- **Reuse the walker.** Three corpus walkers is the bug.
- **Report, never rewrite.** AC-8 is the proof. The report is read-only by construction.
- **Un-gradable is a category, not a gap.** Phase 282's drift report set the standard: name the unverifiable records and why.
- **Deterministic output.** AC-7. A report that renders differently twice is the scanner bug all over again.
- **Tier `complex`.** This is the command that will sit in the evidence write-up; it gets real `deep-verify` and `code-review`. Phase 316 proved the recipe.
- **Do not force-settle.** A phase about reporting forced settles must not itself be forced. If it needs `--force`, stop and report.
- **Declare `stop:` on every task**; record at least one with `--execution dispatch`.
- **Honest negative results are the goal.** If re-derivation (D-BU) moves more historical grades than expected, that is a finding for the write-up, not a reason to hide the delta.

---

## 6. Ledger work — file, never self-apply

Dedup preflight per CMD-F, verbatim output pasted. Then the operator files:

```bash
node packages/core/bin/cadence.cjs recommendation add \
  --title "cadence assurance report: corpus-wide assurance rollup as a command" \
  --summary "..." \
  --priority high --readiness ready-for-cadence-spec \
  --area assurance,cli,reporting --file packages/core/src/cli/commands/assurance.ts \
  --evidence "337-record corpus, 86 graded, 155 un-gradable (no provenance); every portfolio number to date (0/121 boundary-scan Aug, 32/39 mixed Aug, strong→mixed drift post-283) was a one-off script, never a command (measured 2026-10-10 at 7d96650)" \
  --scout-id scout-20261010-assurance-report
node packages/core/bin/cadence.cjs recommendation promote <id> --status accepted --readiness ready-for-cadence-spec
node packages/core/bin/cadence.cjs spec new assurance-report --from-rec <id>
```

Also file (operator): D-BV's assurance floor, and D-BW's generated evidence page if not built here.

**No hand-edits to `.cadence/intelligence/`.**

---

## 7. Report-back protocol

1. Verbatim `cadence doctor`, before and after.
2. CMD-A through CMD-F output, with anything that moved from §2 called out.
3. **CMD-E's result** — which phase first carries gate provenance, so the un-gradable category has its reason.
4. Dedup preflight, before any ledger write.
5. Which option was taken for **D-BT through D-BW**, with decision ids.
6. **The report's own output on this corpus**, rendered and `--json`, verbatim — this is the phase's deliverable and the write-up's first input.
7. **D-BU's delta**: every historical record whose stored grade differs from its re-derived grade, by phase id.
8. Whether AC-7's byte-identical fixture held.
9. Whether tier `complex` was used and `deep-verify` / `code-review` ran.
10. The resulting version and changeset level.
11. Any gate bypass used, with flag and reason.

---

## 8. Framing

CADENCE's argument is that a system shouldn't be trusted to report on itself — that honest accounting has to be structural, computed, and reproducible. For eleven releases that argument has been applied one phase at a time, and each phase's record is now something a stranger could check.

But the argument has never been applied to the *whole*. The portfolio picture — how many phases were strongly verified, how many were forced, which gates actually fire and which are decorative — has only ever existed as a script someone ran once, in a chat, against a tarball. Every finding that moved this project in the last two months was produced that way. None is reproducible by anyone but the person who ran it.

That's the gap between a well-engineered tool and one a hiring manager can evaluate in ninety seconds. Make the rollup a command. Let it lead with the numbers that don't flatter — 155 records that can't be graded, `security-audit` at three of a hundred and eighty-two, a `strong` rate that's honest because the grade finally reads its own bypasses. Then the evidence write-up has a source, the README has a snapshot that can't go stale, and the first thing a stranger sees is the tool telling the truth about itself.
