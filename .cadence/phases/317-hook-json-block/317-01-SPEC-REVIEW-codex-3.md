# 317-01 SPEC review #3 — manual, via `codex exec`

Third pass, after the second revision addressed review #2's items 1 (Codex
compatibility, resolved via a fresh `curl` of Codex's current docs — see
`317-01-raw-doc-excerpts.md`), plus the citation and AC-10 fixes. Same
methodology as reviews #1/#2. Run 2026-09-26.

**Post-review verification note:** item 1 (Codex regression risk) confirmed
resolved and scoped correctly (bare shapes only). Items 2 (AC-6 heading still
said "cannot combine" despite the body already being softened) and 3 (AC-7's
outcome taxonomy didn't match `checkHostHooks`'s real branches) were real,
confirmed by direct read of `packages/core/src/doctor/run.ts:400-455`, and
fixed in commit `98ff0724` — not yet independently reviewed at the time this
file was written. Item 4 (non-blocking, the stdin-probe snippet's missing
`.stdin.end()`) was a documentation-only omission — the actually-executed
script (`317-01-probe-stdin.mjs` in this directory) did call it; fixed in the
same commit.

---

## Verdict

**REJECT** — Review 2 items 2 and 3 remain blocking.

## Prior findings status

1. **Resolved.** AC-9 accurately scopes Codex support to AC-1/AC-2's bare shapes, explicitly excluding AC-6's combined shape. Current [Codex hooks documentation](https://developers.openai.com/codex/hooks) confirms the deny, Stop, and SubagentStop forms. `317-01-SPEC.md:75`
2. **Not resolved — blocking.** AC-6's body now correctly says "no documented combined shape," but its heading still states "Stop/SubagentStop cannot combine them," the unsupported claim Review 2 rejected. `317-01-SPEC.md:54`
3. **Not resolved — blocking.** AC-7 does not determine behavior for incomplete or stale installs, and misstates existing outcomes: missing settings is not-applicable, but invalid JSON, no managed entries, incomplete installs, and stale entries are warning/error outcomes in `checkHostHooks`, not not-applicable. `317-01-SPEC.md:63`, `packages/core/src/doctor/run.ts:400`
4. **Resolved.** The cited loud-notice guard is correctly `handlers.ts:47-49`. `317-01-SPEC.md:28`, `packages/core/src/hooks/handlers.ts:47`
5. **Resolved.** AC-10 now pins one exact replacement string rather than offering an example. `317-01-SPEC.md:80`

The new AC-2 Codex framing is accurate: the current capability comment says agent identity is undocumented, the Codex shim does not map identity fields, and current Codex docs document `agent_id`/`agent_type`. The gap is presently loud but closable. `packages/host-codex/src/capabilities.ts:27`, `packages/host-codex/src/shim.ts:47`

## Fresh findings

- **Blocking — AC-7's declared not-applicable cases contradict the implementation.** Invalid JSON produces a `host-hooks` warning; absent managed hooks produces a warning; incomplete installs produce an error; stale hooks produce a warning. AC-7 must explicitly state whether `hook-transport` is omitted, not-applicable, or informational in each case, rather than treating them as one not-applicable case. `317-01-SPEC.md:64`, `packages/core/src/doctor/run.ts:409`
- **Non-blocking — the companion stdin probe is incomplete as written.** `process.stdin.pipe(process.stdout)` cannot exit after only `.stdin.write(...)`; the parent must also call `.stdin.end()`. The displayed probe therefore cannot yield its stated exit code as shown. This does not disprove the full-chain red result, which is otherwise internally plausible and consistent with the installer and handler source. `317-01-red-state-capture.md:45`
