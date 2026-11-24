import type { CadenceState } from '@thomas-powers-jr/cadence-types';

export interface StateBackend {
  resolveStateDir(): Promise<string>;
  readState(): Promise<CadenceState>;
  /**
   * Write `state.json` + the derived `STATE.md` together (Phase 41.1). The
   * former `writeState` is now private to the implementation — `commit` is
   * the only public write path, so STATE.md can never go stale.
   *
   * Optimistic concurrency (Phase 173): compares the current on-disk
   * `revision` to `state.revision` (the revision the caller's in-memory copy
   * was read at). A mismatch means another writer committed since this
   * caller read — refuses with `StateConflictError` rather than silently
   * overwriting, unless `opts.force` is set. On success, mutates
   * `state.revision` in place so a caller issuing several sequential
   * commits on the same object stays in sync without re-reading.
   */
  commit(state: CadenceState, opts?: { force?: boolean }): Promise<void>;
  /**
   * Explicit-revision replace (phase 341, `cadence state load`). Additive
   * beside `commit()`, whose semantics it does not change: where `commit()`
   * compares to `state.revision` and bumps it, `replaceState` checks the
   * on-disk file against `expected` — what the caller saw when it planned —
   * and writes `state.revision` EXACTLY as given (the planner already set it
   * to `max(local, snapshot) + 1`).
   *
   * `expected` is `{ revision }` (a parseable file at that revision),
   * `'absent'` (no file) or `'corrupt'` (a file that still fails to parse).
   * Any mismatch refuses with the same `StateConflictError` `commit()`
   * throws. Otherwise writes `state.json` + the derived `STATE.md` through
   * `commit()`'s own write path.
   */
  replaceState(
    state: CadenceState,
    expected: { revision: number } | 'absent' | 'corrupt',
  ): Promise<void>;
  /**
   * Telemetry-exempt write path (Phase 194 / issue #234). For purely
   * informational `session` counters — `session.subagentSpawns` and (phase
   * 305 / issue #500) `session.tokenUtilization`, clamped to its 0..1 range —
   * that must never be able to trip the optimistic-concurrency guard
   * `commit()` enforces via `revision`. The `UserPromptSubmit` hook fires
   * inside a host-cli verifier's own `claude -p` child, so a revision-bumping
   * telemetry write there invalidated `settle run --deep`'s snapshot.
   *
   * Re-reads `state.json` fresh from disk (ignores any caller-supplied
   * in-memory snapshot), applies `amount` to the named field, and writes
   * `state.json` + `STATE.md` back — WITHOUT comparing to or bumping
   * `revision`, so this call can never throw `StateConflictError` and never
   * causes a concurrent caller's own `commit()` to fail. This is a
   * deliberate "last write wins" trade-off for a field nothing structural
   * depends on — see `SimpleStateBackend.bumpSessionCounter`'s doc comment
   * for the narrow residual race this accepts. A no-op (not an error) when
   * `state.json` does not exist yet — there is no session to attach
   * telemetry to before first init.
   */
  bumpSessionCounter(field: 'subagentSpawns' | 'tokenUtilization', amount: number): Promise<void>;
  /**
   * Revision-exempt hook-liveness stamp (phase 349). Sets
   * `session.lastHookEventAt` to `atIso` — the time the hook dispatcher
   * handled an event — by the same path `bumpSessionCounter` uses: re-reads
   * `state.json` fresh from disk (ignores any caller-held in-memory copy),
   * sets the field, and writes `state.json` + `STATE.md` back WITHOUT
   * comparing to or bumping `revision`, so it can never throw
   * `StateConflictError` or invalidate a concurrent caller's snapshot (the
   * hooks also fire inside a host-cli verifier's child mid-settle). The
   * dispatcher calls it after the event's handler returns, so a handler's
   * own `commit()` of its earlier in-memory copy cannot overwrite the stamp.
   *
   * Throttled: skipped when the on-disk stamp is live (not later than
   * `atIso`) and less than 60 s older than it; written when it is absent,
   * unparseable, 60 s or more old, or later than `atIso`. A no-op when
   * `state.json` does not exist yet.
   *
   * Like `bumpSessionCounter`, this is a deliberate "last write wins"
   * trade-off for a field nothing structural depends on, and accepts the
   * same narrow non-CAS race: a `commit()` elsewhere that reads, checks and
   * writes between this method's own read and write is silently overwritten
   * by this method's stale copy plus the stamp. See
   * `SimpleStateBackend.stampHookEvent`'s doc comment.
   */
  stampHookEvent(atIso: string): Promise<void>;
  archive(milestone: string): Promise<void>;
  beforeBranchSwitch?(from: string, to: string): Promise<void>;
  afterBranchSwitch?(branch: string): Promise<void>;
}
