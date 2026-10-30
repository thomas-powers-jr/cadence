import { readFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CadenceStateZ, type CadenceState } from '@thomas-powers-jr/cadence-types';
import { StateCorruptError, NotInitializedError, StateConflictError } from '../errors.js';
import { atomicWriteJSON, atomicWriteText } from './atomic-write.js';
import { renderStateMd } from '../render/state-md.js';
import type { StateBackend } from './backend.js';

/** An on-disk `state.json` as `replaceState` sees it. */
type ProbedState = number | 'absent' | 'corrupt';

function describeHad(v: ProbedState): string {
  if (v === 'absent') return 'no state.json';
  if (v === 'corrupt') return 'an unparseable state.json';
  return `revision ${v}`;
}

function describeCurrent(v: ProbedState): string {
  if (v === 'absent') return 'no state.json';
  if (v === 'corrupt') return 'an unparseable state.json';
  return String(v);
}

/**
 * The conflict `commit()` and `replaceState()` throw. With two revisions the
 * message is byte-identical to `commit()`'s historical text. `absent` /
 * `corrupt` sides are described in words and carry revision `-1`.
 */
function stateConflict(had: ProbedState, current: ProbedState): StateConflictError {
  return new StateConflictError(
    `state.json changed since you read it (you had ${describeHad(had)}, current is ${describeCurrent(current)}) — re-run this command to pick up the latest state.`,
    {
      expectedRevision: typeof had === 'number' ? had : -1,
      actualRevision: typeof current === 'number' ? current : -1,
    },
  );
}

export class SimpleStateBackend implements StateBackend {
  constructor(private readonly repoRoot: string) {}

  async resolveStateDir(): Promise<string> {
    return join(this.repoRoot, '.cadence');
  }

  async readState(): Promise<CadenceState> {
    const dir = await this.resolveStateDir();
    const path = join(dir, 'state.json');
    if (!existsSync(path)) {
      if (existsSync(dir)) {
        // rec-20260726-002: a fresh git worktree/clone carries the committed
        // .cadence/ scaffold but never state.json (gitignored since phase
        // 196) — `cadence init` refuses here ("already initialized"), so
        // point at `cadence onboard`, which bootstraps exactly this case.
        throw new NotInitializedError(
          '.cadence/ exists but state.json is missing (likely a fresh git worktree or clone — state.json is gitignored, not copied by git) — run `cadence onboard` to bootstrap it.',
        );
      }
      throw new NotInitializedError();
    }
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (err) {
      throw new StateCorruptError(`Cannot read state.json: ${(err as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new StateCorruptError(`state.json is not valid JSON: ${(err as Error).message}`);
    }
    const result = CadenceStateZ.safeParse(parsed);
    if (!result.success) {
      throw new StateCorruptError(`state.json failed schema validation: ${result.error.message}`);
    }
    return result.data;
  }

  /**
   * Write `state.json` AND the derived `STATE.md` together (Phase 41.1). The
   * single public write path — callers can no longer write one without the
   * other, killing the stale-STATE.md class.
   *
   * Optimistic concurrency (Phase 173): before writing, compares the
   * on-disk `revision` to `state.revision`. A mismatch means another writer
   * committed in between — refuse rather than silently clobber. On success
   * `state.revision` is bumped in place (mutating the caller's object), so a
   * caller that issues multiple sequential commits on the same in-memory
   * state (e.g. a hook handler with two independent write branches) stays in
   * sync automatically. No on-disk file yet (first-ever write for this
   * checkout) skips the check entirely — there is nothing to conflict with.
   */
  async commit(state: CadenceState, opts: { force?: boolean } = {}): Promise<void> {
    const dir = await this.resolveStateDir();
    const statePath = join(dir, 'state.json');
    if (existsSync(statePath)) {
      const onDisk = await this.readState();
      if (onDisk.revision !== state.revision) {
        if (!opts.force) {
          throw stateConflict(state.revision, onDisk.revision);
        }
        process.stderr.write(
          `cadence: force bypassing a state.json conflict (you had revision ${state.revision}, current is ${onDisk.revision}) — overwriting\n`,
        );
      }
      state.revision = onDisk.revision + 1;
    }
    await this.writeStateAndView(state);
  }

  /**
   * Explicit-revision replace (phase 341). See the `StateBackend` interface
   * doc. Checks the on-disk `state.json` against `expected`, refusing with
   * the same `StateConflictError` `commit()` throws on any mismatch, then
   * writes `state` with its `revision` untouched plus the derived `STATE.md`
   * through `commit()`'s write path. Like `commit()`, this is a check-then-
   * write without a lock: it narrows the race to one read→write round trip.
   */
  async replaceState(
    state: CadenceState,
    expected: { revision: number } | 'absent' | 'corrupt',
  ): Promise<void> {
    const onDisk = await this.probeOnDisk();
    const want: ProbedState = typeof expected === 'string' ? expected : expected.revision;
    if (onDisk !== want) {
      throw stateConflict(want, onDisk);
    }
    await this.writeStateAndView(state);
  }

  /** What `state.json` holds right now: its revision, or absent/corrupt. */
  private async probeOnDisk(): Promise<ProbedState> {
    const statePath = join(await this.resolveStateDir(), 'state.json');
    if (!existsSync(statePath)) return 'absent';
    try {
      return (await this.readState()).revision;
    } catch (err) {
      if (err instanceof StateCorruptError) return 'corrupt';
      throw err;
    }
  }

  /** `commit()`'s write path: `state.json` then the derived `STATE.md`. */
  private async writeStateAndView(state: CadenceState): Promise<void> {
    await this.writeState(state);
    await atomicWriteText(
      join(await this.resolveStateDir(), 'STATE.md'),
      renderStateMd(state),
    );
  }

  /**
   * Telemetry-exempt write path (Phase 194 / issue #234). See the
   * `StateBackend` interface doc for the full rationale — this deliberately
   * skips the `revision` compare-and-swap `commit()` performs so a
   * telemetry-only counter bump can never throw `StateConflictError` or
   * invalidate another writer's in-flight snapshot.
   *
   * Re-reads `state.json` fresh (never trusts a caller-held in-memory
   * copy), bumps the named field on that snapshot, and writes the whole
   * snapshot back — unconditionally, with no compare-and-swap. This
   * narrows (versus the bug this exists to fix) but does not fully close
   * one race: if a `commit()` elsewhere reads, checks, and writes in the
   * gap between this method's own read and write, this write will still
   * land and silently overwrite that commit's structural change with this
   * method's stale copy plus the bumped counter — no error either side.
   * That window is a single read→write round trip (this repo has no lock
   * file), versus the multi-minute `host-cli` gate window that produced
   * issue #234, so the residual risk is accepted as deliberately, vastly
   * narrower than the bug being fixed — a trade-off made on purpose for a
   * telemetry field nothing structural depends on, not an accidental side
   * effect of skipping `commit()`'s guard. Since phase 305 the same window
   * also opens once per `UserPromptSubmit` (the `tokenUtilization` bump), so
   * it is reached far more often than per subagent spawn; each occurrence is
   * still a single read→write round trip.
   */
  async bumpSessionCounter(
    field: 'subagentSpawns' | 'tokenUtilization',
    amount: number,
  ): Promise<void> {
    const dir = await this.resolveStateDir();
    const statePath = join(dir, 'state.json');
    if (!existsSync(statePath)) {
      // No state.json yet (pre-init) — nothing to attach telemetry to.
      return;
    }
    const onDisk = await this.readState();
    const bumped = Math.max(0, onDisk.session[field] + amount);
    // `tokenUtilization` is a 0..1 ratio in the schema; `subagentSpawns` is an
    // unbounded count (phase 305).
    onDisk.session[field] = field === 'tokenUtilization' ? Math.min(1, bumped) : bumped;
    await this.writeState(onDisk);
    await atomicWriteText(join(dir, 'STATE.md'), renderStateMd(onDisk));
  }

  /** Internal `state.json` primitive (Phase 41.1: private — use `commit`). */
  private async writeState(state: CadenceState): Promise<void> {
    const dir = await this.resolveStateDir();
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    CadenceStateZ.parse(state);
    await atomicWriteJSON(join(dir, 'state.json'), state);
  }

  async archive(milestone: string): Promise<void> {
    const dir = await this.resolveStateDir();
    const phasesDir = join(dir, 'phases');
    const archiveDir = join(dir, 'archive', milestone);
    await mkdir(archiveDir, { recursive: true });
    if (existsSync(phasesDir)) {
      await rename(phasesDir, join(archiveDir, 'phases'));
      await mkdir(phasesDir, { recursive: true });
    }
  }
}
