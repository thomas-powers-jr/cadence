import { describe, it, expect } from 'vitest';
import {
  CadenceStateZ,
  emptyState,
  type CadenceState,
  type StateSnapshot,
} from '@thomas-powers-jr/cadence-types';
import {
  SNAPSHOT_KEEP,
  sanitizeHost,
  snapshotFileName,
  isSnapshotName,
  sortNewestFirst,
  planPrune,
  unknownStateKeys,
  assertSnapshotPathsSafe,
  compareVersions,
  planStateLoad,
  type PlanStateLoadInput,
} from '../../src/state/snapshot.js';

const HASH = 'a'.repeat(64);

function baseState(over: Partial<CadenceState> = {}): CadenceState {
  const s = emptyState('demo');
  s.project.createdAt = '2026-01-01T00:00:00.000Z';
  return { ...s, ...over };
}

function snap(state: CadenceState, cadenceVersion = '1.72.0'): StateSnapshot {
  return {
    snapshotVersion: 1,
    savedAt: '2026-10-29T23:15:02.000Z',
    host: 'pc-a',
    cadenceVersion,
    state,
  };
}

function input(over: Partial<PlanStateLoadInput> & Pick<PlanStateLoadInput, 'snapshot'>): PlanStateLoadInput {
  return {
    local: null,
    localCorrupt: false,
    rawStateKeysUnknown: [],
    syncRevision: null,
    phaseDirExists: true,
    runningVersion: '1.72.0',
    force: false,
    ...over,
  };
}

describe('sanitizeHost', () => {
  it('341-01/AC-1: replaces dots and spaces with dashes', () => {
    expect(sanitizeHost('my pc.local')).toBe('my-pc-local');
  });
  it('341-01/AC-1: falls back to unknown-host when nothing is left', () => {
    expect(sanitizeHost('')).toBe('unknown-host');
  });
  it('341-01/AC-1: cuts a long host name to 40 characters', () => {
    const out = sanitizeHost('x'.repeat(60) + '.example.com');
    expect(out).toBe('x'.repeat(40));
    expect(out).toHaveLength(40);
  });
});

describe('snapshotFileName', () => {
  it('341-01/AC-1: names the file state-<utc stamp to the second, no colons>-<host>.json', () => {
    const name = snapshotFileName('pc-a', new Date('2026-10-29T23:15:02.987Z'));
    expect(name).toBe('state-2026-10-29T231502Z-pc-a.json');
  });
  it('341-01/AC-1: sanitizes the host inside the name', () => {
    expect(snapshotFileName('my.pc', new Date('2026-10-29T23:15:02Z'))).toBe(
      'state-2026-10-29T231502Z-my-pc.json',
    );
  });
  it('341-01/AC-1: SNAPSHOT_KEEP is the constant 3 and names are recognised', () => {
    expect(SNAPSHOT_KEEP).toBe(3);
    expect(isSnapshotName('state-2026-10-29T231502Z-pc-a.json')).toBe(true);
    expect(isSnapshotName('README.md')).toBe(false);
    expect(isSnapshotName('state-x.json.bak')).toBe(false);
  });
});

describe('sortNewestFirst / planPrune', () => {
  const n = (stamp: string, host = 'pc') => `state-2026-10-${stamp}Z-${host}.json`;

  it('341-01/AC-1: sorts newest first without mutating its input', () => {
    const names = [n('01T000000'), n('03T000000'), n('02T000000')];
    const copy = [...names];
    expect(sortNewestFirst(names)).toEqual([n('03T000000'), n('02T000000'), n('01T000000')]);
    expect(names).toEqual(copy);
  });

  it('341-01/AC-1: prunes nothing with 0 files', () => {
    expect(planPrune([], n('01T000000'))).toEqual([]);
  });

  it('341-01/AC-1: prunes nothing with exactly 3 files', () => {
    const names = [n('01T000000'), n('02T000000'), n('03T000000')];
    expect(planPrune(names, n('03T000000'))).toEqual([]);
  });

  it('341-01/AC-1: with 5 files keeps the just-written one plus the newest 2 others', () => {
    const names = [n('01T000000'), n('02T000000'), n('03T000000'), n('04T000000'), n('05T000000')];
    expect(planPrune(names, n('05T000000'))).toEqual([n('02T000000'), n('01T000000')]);
  });

  it('341-01/AC-1: a just-written name that sorts oldest (clock behind) survives', () => {
    const names = [n('01T000000', 'slow'), n('02T000000'), n('03T000000'), n('04T000000'), n('05T000000')];
    const pruned = planPrune(names, n('01T000000', 'slow'));
    expect(pruned).not.toContain(n('01T000000', 'slow'));
    expect(pruned).toEqual([n('03T000000'), n('02T000000')]);
  });

  it('341-01/AC-1: never touches names that are not state-*.json', () => {
    const names = ['README.md', 'notes.json', n('01T000000'), n('02T000000'), n('03T000000'), n('04T000000')];
    const pruned = planPrune(names, n('04T000000'));
    expect(pruned).toEqual([n('01T000000')]);
    expect(pruned).not.toContain('README.md');
    expect(pruned).not.toContain('notes.json');
  });
});

describe('unknownStateKeys', () => {
  it('341-01/AC-3: returns top-level keys CadenceStateZ does not know', () => {
    const raw = { ...baseState(), futureField: 1, another: 'x' };
    expect(unknownStateKeys(raw)).toEqual(['futureField', 'another']);
  });
  it('341-01/AC-3: returns nothing for a known-key state and for non-objects', () => {
    expect(unknownStateKeys(baseState())).toEqual([]);
    expect(unknownStateKeys(null)).toEqual([]);
    expect(unknownStateKeys([1, 2])).toEqual([]);
    expect(unknownStateKeys('x')).toEqual([]);
    // Derived from the schema, so every schema key is known.
    expect(unknownStateKeys(Object.fromEntries(Object.keys(CadenceStateZ.shape).map((k) => [k, 1])))).toEqual([]);
  });
});

describe('assertSnapshotPathsSafe', () => {
  it('341-01/AC-3: accepts plain identifiers', () => {
    const s = baseState({
      activePhase: '341-state-save-load',
      activeDraft: '341-01',
      activeSpec: '341-01',
      activeTask: { id: 'T2', status: 'IN_PROGRESS', touchedFiles: [] },
      session: { tokenUtilization: 0, lastHandoff: 'SESSION-2026-10-29-x.md', subagentSpawns: 0, subagentBaselines: {} },
    });
    expect(assertSnapshotPathsSafe(s)).toBeNull();
  });

  it('341-01/AC-3: refuses an unsafe activePhase with an exact message', () => {
    expect(assertSnapshotPathsSafe(baseState({ activePhase: '../../tmp' }))).toBe(
      'snapshot refused: state.activePhase "../../tmp" is not a safe phase slug (expected leading digits followed by letters, digits, \'.\', \'_\' or \'-\'). A snapshot is untrusted input, so --force cannot override this; re-save the snapshot from a checkout whose state is sound.',
    );
  });

  it('341-01/AC-3: refuses an unsafe activeDraft with an exact message', () => {
    expect(assertSnapshotPathsSafe(baseState({ activeDraft: 'a/b' }))).toBe(
      'snapshot refused: state.activeDraft "a/b" is not a plain identifier (expected a letter or digit followed by letters, digits, \'.\', \'_\' or \'-\', with no \'..\'). A snapshot is untrusted input, so --force cannot override this; re-save the snapshot from a checkout whose state is sound.',
    );
  });

  it('341-01/AC-3: refuses an unsafe session.lastHandoff with an exact message', () => {
    const s = baseState();
    s.session.lastHandoff = '../SESSION-x.md';
    expect(assertSnapshotPathsSafe(s)).toBe(
      'snapshot refused: state.session.lastHandoff "../SESSION-x.md" is not a bare SESSION-*.md file name. A snapshot is untrusted input, so --force cannot override this; re-save the snapshot from a checkout whose state is sound.',
    );
  });
});

describe('planStateLoad — unsafe paths (never overridden by --force)', () => {
  const unsafe = ['../x', '/abs', 'a/b', '..'];
  const fields = ['activePhase', 'activeDraft', 'activeSpec', 'activeTask.id'] as const;

  for (const field of fields) {
    for (const value of unsafe) {
      it(`341-01/AC-3: refuses ${field} = ${JSON.stringify(value)} even with --force`, () => {
        const s = baseState();
        if (field === 'activeTask.id') s.activeTask = { id: value, status: 'IN_PROGRESS', touchedFiles: [] };
        else s[field] = value;
        for (const force of [false, true]) {
          const r = planStateLoad(input({ snapshot: snap(s), force }));
          expect(r.ok).toBe(false);
          if (!r.ok) {
            expect(r.reason).toContain(`snapshot refused: state.${field} ${JSON.stringify(value)}`);
            expect(r.reason).toContain('--force cannot override this');
          }
        }
      });
    }
  }

  it('341-01/AC-3: refuses lastHandoff = "../SESSION-x.md" even with --force', () => {
    const s = baseState();
    s.session.lastHandoff = '../SESSION-x.md';
    for (const force of [false, true]) {
      const r = planStateLoad(input({ snapshot: snap(s), force }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain('state.session.lastHandoff "../SESSION-x.md" is not a bare SESSION-*.md file name');
    }
  });

  it('341-01/AC-3: the unsafe-path check runs before the phase-existence fact is consulted', () => {
    const r = planStateLoad(input({ snapshot: snap(baseState({ activePhase: '../../tmp' })), phaseDirExists: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('is not a safe phase slug');
  });
});

describe('planStateLoad — other refusals, exact text, AC-3 order', () => {
  it('341-01/AC-3: unknown keys name the keys and the snapshot cadenceVersion', () => {
    const r = planStateLoad(input({ snapshot: snap(baseState(), '1.80.0'), rawStateKeysUnknown: ['futureField', 'other'] }));
    expect(r).toEqual({
      ok: false,
      reason:
        'snapshot refused: its state has top-level key(s) this cadence does not know: futureField, other (snapshot written by cadence 1.80.0, running 1.72.0). Loading would silently drop them. Update cadence to at least 1.80.0, or pass --force to load anyway and drop them.',
    });
  });

  it('341-01/AC-3: unknown keys are skipped by --force with a loud warning', () => {
    const r = planStateLoad(input({ snapshot: snap(baseState(), '1.80.0'), rawStateKeysUnknown: ['futureField'], force: true }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toContain(
        '--force: loading despite unknown top-level state key(s) futureField from cadence 1.80.0; they are dropped.',
      );
    }
  });

  it('341-01/AC-3: a project-name mismatch is refused, even with --force', () => {
    const local = baseState();
    local.project = { name: 'other', createdAt: '2026-01-01T00:00:00.000Z' };
    for (const force of [false, true]) {
      const r = planStateLoad(input({ snapshot: snap(baseState()), local, force }));
      expect(r).toEqual({
        ok: false,
        reason:
          'snapshot refused: it belongs to project "demo" but the local state.json belongs to project "other". Load it in the "demo" repository instead.',
      });
    }
  });

  it('341-01/AC-3: a missing phase directory says to pull or switch branch', () => {
    const r = planStateLoad(input({ snapshot: snap(baseState({ activePhase: '341-x', loopPosition: 'BUILD', draftReadHash: HASH })), phaseDirExists: false }));
    expect(r).toEqual({
      ok: false,
      reason:
        'snapshot refused: its active phase "341-x" has no .cadence/phases/341-x/ directory on this branch. Pull the latest commits or switch to the branch that carries that phase, then load again.',
    });
  });

  it('341-01/AC-3: phaseDirExists is ignored when the snapshot has no active phase', () => {
    const r = planStateLoad(input({ snapshot: snap(baseState()), phaseDirExists: false }));
    expect(r.ok).toBe(true);
  });

  it('341-01/AC-3: local work since the last sync names both revisions and suggests save first', () => {
    const local = baseState({ revision: 12 });
    const r = planStateLoad(input({ snapshot: snap(baseState({ revision: 30 })), local, syncRevision: 9 }));
    expect(r).toEqual({
      ok: false,
      reason:
        'snapshot refused: the local state.json is at revision 12, past revision 9 recorded by this machine\'s last save or load (.cadence/local/state-sync.json), so this machine has changed since its last sync. Run `cadence state save` first to keep that work, or pass --force to replace it.',
      check: 'local-work',
    });
  });

  it('341-01/AC-3: checks run in AC-3 order (project before phase before local work)', () => {
    const local = baseState({ revision: 12 });
    local.project = { name: 'other', createdAt: 'x' };
    const s = baseState({ activePhase: '341-x', loopPosition: 'BUILD', draftReadHash: HASH });
    const r0 = planStateLoad(
      input({ snapshot: snap({ ...s, activeDraft: '../x' }), local, syncRevision: 1, phaseDirExists: false, rawStateKeysUnknown: ['k'] }),
    );
    expect(!r0.ok && r0.reason).toContain('state.activeDraft "../x" is not a plain identifier');
    const r1 = planStateLoad(input({ snapshot: snap(s), local, syncRevision: 1, phaseDirExists: false, rawStateKeysUnknown: ['k'] }));
    expect(!r1.ok && r1.reason).toContain('top-level key(s)');
    const r2 = planStateLoad(input({ snapshot: snap(s), local, syncRevision: 1, phaseDirExists: false }));
    expect(!r2.ok && r2.reason).toContain('belongs to project');
    const r3 = planStateLoad(input({ snapshot: snap(s), local: baseState({ revision: 12 }), syncRevision: 1, phaseDirExists: false }));
    expect(!r3.ok && r3.reason).toContain('has no .cadence/phases/341-x/ directory');
  });
});

describe('planStateLoad — the A→B→A baton flow', () => {
  function load(p: PlanStateLoadInput): CadenceState {
    const r = planStateLoad(p);
    if (!r.ok) throw new Error(r.reason);
    return r.state;
  }

  it('341-01/AC-3: A saves, B loads/commits/saves, A loads back with no refusal', () => {
    // A at revision 10 saves: sync marker 10, snapshot carries revision 10.
    const aState = baseState({ revision: 10 });
    const aSync = aState.revision;
    // B has a busier local counter (no marker yet) and loads A's snapshot.
    const bLoaded = load(input({ snapshot: snap(aState), local: baseState({ revision: 3 }) }));
    expect(bLoaded.revision).toBe(11);
    // B commits several times, then saves (marker = its revision).
    const bLater = { ...bLoaded, revision: bLoaded.revision + 4 };
    // A loads B's snapshot; A made no commits since its save.
    const r = planStateLoad(input({ snapshot: snap(bLater), local: aState, syncRevision: aSync }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.revision).toBe(16);
  });

  it('341-01/AC-3: the same flow where A committed after saving is refused, and --force allows it loudly', () => {
    const aSync = 10;
    const aLocal = baseState({ revision: 13 });
    const bSnap = snap(baseState({ revision: 15 }));
    const refused = planStateLoad(input({ snapshot: bSnap, local: aLocal, syncRevision: aSync }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain('at revision 13, past revision 10');
    const forced = planStateLoad(input({ snapshot: bSnap, local: aLocal, syncRevision: aSync, force: true }));
    expect(forced.ok).toBe(true);
    if (forced.ok) {
      expect(forced.state.revision).toBe(16);
      expect(forced.warnings).toContain(
        '--force: skipping the local-work check. The local state.json is at revision 13, past the last sync at revision 10; that local work is replaced (the previous state.json is backed up to .cadence/local/state.json.bak).',
      );
    }
  });

  it('341-01/AC-3: a first transfer onto a machine with a high local revision and no sync marker is allowed', () => {
    const r = planStateLoad(input({ snapshot: snap(baseState({ revision: 2 })), local: baseState({ revision: 500 }), syncRevision: null }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.revision).toBe(501);
  });
});

describe('planStateLoad — restored state', () => {
  function rich(): CadenceState {
    return CadenceStateZ.parse({
      ...baseState({
        revision: 7,
        activePhase: '341-state-save-load',
        activeDraft: '341-01',
        activeSpec: null,
        loopPosition: 'BUILD',
        tier: 'standard',
        draftReadAt: '2026-10-29T20:00:00.000Z',
        draftReadHash: HASH,
        openDrafts: [{ id: '341-01', since: '2026-10-29' }],
        decisions: [{ id: 'dec-1', phase: '341', title: 't', decidedAt: '2026-10-29' }],
        deferred: [{ id: 'def-1', from: '341-01', title: 'later', createdAt: '2026-10-29' }],
        skillAudit: { required: ['tdd'], invoked: ['tdd'], provenance: [{ skill: 'tdd', source: 'config' }] },
        activeTask: { id: 'T2', status: 'IN_PROGRESS', touchedFiles: ['a.ts'] },
      }),
      session: {
        tokenUtilization: 0.8,
        lastHandoff: 'SESSION-2026-10-29.md',
        subagentSpawns: 5,
        subagentBaselines: { agent1: { startedAt: 'x', taskStatuses: { T1: 'DONE' }, touchedFiles: [] } },
      },
    });
  }

  it('341-01/AC-4: resets session counters and keeps every other field', () => {
    const s = rich();
    const r = planStateLoad(input({ snapshot: snap(s), local: baseState({ revision: 2 }) }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.session.tokenUtilization).toBe(0);
    expect(r.state.session.subagentSpawns).toBe(0);
    expect(r.state.session.subagentBaselines).toEqual({});
    expect(r.state.session.lastHandoff).toBe('SESSION-2026-10-29.md');
    expect(r.state.skillAudit).toEqual(s.skillAudit);
    expect(r.state.activeTask).toEqual(s.activeTask);
    expect(r.state.decisions).toEqual(s.decisions);
    expect(r.state.deferred).toEqual(s.deferred);
    expect(r.state.draftReadAt).toBe(s.draftReadAt);
    expect(r.state.draftReadHash).toBe(s.draftReadHash);
    const strip = (x: CadenceState): Partial<CadenceState> => {
      const copy: Partial<CadenceState> = { ...x };
      delete copy.revision;
      delete copy.session;
      return copy;
    };
    expect(strip(r.state)).toEqual(strip(s));
    expect(CadenceStateZ.parse(r.state)).toEqual(r.state);
  });

  it('341-01/AC-4: does not mutate the snapshot it was given', () => {
    const s = rich();
    const before = structuredClone(s);
    planStateLoad(input({ snapshot: snap(s) }));
    expect(s).toEqual(before);
  });

  it('341-01/AC-4: revision is max(local, snapshot) + 1', () => {
    const cases: Array<[number | null, number, number]> = [
      [null, 7, 8],
      [2, 7, 8],
      [20, 7, 21],
      [7, 7, 8],
    ];
    for (const [localRev, snapRev, want] of cases) {
      const local = localRev === null ? null : baseState({ revision: localRev });
      const r = planStateLoad(input({ snapshot: snap(baseState({ revision: snapRev })), local }));
      expect(r.ok && r.state.revision).toBe(want);
    }
  });

  it('341-01/AC-4: a clean load carries no warnings', () => {
    const r = planStateLoad(input({ snapshot: snap(baseState({ revision: 1 })), local: baseState() }));
    expect(r).toMatchObject({ ok: true, warnings: [] });
  });
});

describe('planStateLoad — corrupt local state', () => {
  it('341-01/AC-4: skips the project and local-work checks and warns loudly', () => {
    const r = planStateLoad(input({ snapshot: snap(baseState({ revision: 4 })), local: null, localCorrupt: true, syncRevision: 1 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.revision).toBe(5);
    expect(r.warnings).toContain(
      'the local .cadence/state.json does not parse; skipping the project and local-work checks and replacing it with the snapshot (its bytes are backed up to .cadence/local/state.json.bak).',
    );
  });

  it('341-01/AC-4: localCorrupt alone skips the checks, even with a stale parsed local beside it', () => {
    // Pins the skip to `localCorrupt`, not to `local === null`: a mismatched
    // project and a stale sync marker would each refuse if checked.
    const local = baseState({ revision: 50 });
    local.project = { name: 'other', createdAt: 'x' };
    const r = planStateLoad(input({ snapshot: snap(baseState({ revision: 4 })), local, localCorrupt: true, syncRevision: 1 }));
    expect(r.ok).toBe(true);
  });

  it('341-01/AC-4: unsafe paths are still refused when local state is corrupt', () => {
    const r = planStateLoad(input({ snapshot: snap(baseState({ activeDraft: '../x' })), local: null, localCorrupt: true, force: true }));
    expect(r.ok).toBe(false);
  });
});

describe('planStateLoad — warnings', () => {
  it('341-01/AC-4: warns when a mid-loop snapshot predates draftReadHash', () => {
    const s = baseState({ activePhase: '341-x', activeDraft: '341-01', loopPosition: 'BUILD', draftReadHash: null });
    const r = planStateLoad(input({ snapshot: snap(s) }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toContain(
        'the snapshot is mid-loop (BUILD) but carries no draftReadHash, so the draft-read gate will fall back to the mtime-only check after this checkout. Re-approve the DRAFT (`cadence draft approve`) so settle does not refuse on a fresh checkout\'s file times.',
      );
    }
  });

  it('341-01/AC-4: no mid-loop warning at IDLE or with a hash', () => {
    const idle = planStateLoad(input({ snapshot: snap(baseState()) }));
    const hashed = planStateLoad(input({ snapshot: snap(baseState({ activePhase: '341-x', loopPosition: 'BUILD', draftReadHash: HASH })) }));
    expect(idle.ok && idle.warnings).toEqual([]);
    expect(hashed.ok && hashed.warnings).toEqual([]);
  });

  it('341-01/AC-4: warns when the snapshot was written by a newer cadence', () => {
    const r = planStateLoad(input({ snapshot: snap(baseState(), '1.73.0'), runningVersion: '1.72.0' }));
    expect(r.ok && r.warnings).toEqual([
      'the snapshot was written by cadence 1.73.0, newer than the running cadence 1.72.0. Update cadence if anything in the restored state looks off.',
    ]);
  });

  it('341-01/AC-4: no newer-cadence warning for the same or an older version', () => {
    for (const v of ['1.72.0', '1.9.9', '1.72.0-rc.1', 'garbage']) {
      const r = planStateLoad(input({ snapshot: snap(baseState(), v), runningVersion: '1.72.0' }));
      expect(r.ok && r.warnings).toEqual([]);
    }
  });

  it('341-01/AC-4: compareVersions orders major.minor.patch numerically and ranks prereleases below releases', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.72.0', '1.72.0')).toBe(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(compareVersions('1.73.0-rc.1', '1.72.0')).toBeGreaterThan(0);
    expect(compareVersions('1.72.0-rc.1', '1.72.0')).toBeLessThan(0);
    expect(compareVersions('v1.72.1', '1.72.0')).toBeGreaterThan(0);
    expect(compareVersions('garbage', '1.72.0')).toBeNull();
  });
});
