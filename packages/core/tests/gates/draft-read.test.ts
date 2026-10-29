import { describe, it, expect } from 'vitest';
import { runDraftReadGate } from '../../src/gates/draft-read.js';
import type { SettleContext } from '../../src/gates/types.js';

const BASELINE = '2026-05-20T10:00:00.000Z';
const BASELINE_MS = Date.parse(BASELINE);

function ctx(over: {
  draftReadAt?: string | null;
  mtimeMs?: number | null;
  allowStaleDraft?: boolean;
  errs?: string[];
  /** Phase 340: the approve-time stamp. Omitted ⇒ the key is absent
   *  (`undefined`), exactly like the pre-340 fixture. */
  draftReadHash?: string | null;
  /** Phase 340: what `draftContentHash()` resolves to. */
  contentHash?: string | null;
  /** Phase 340: counts `draftContentHash()` calls. */
  hashCalls?: { n: number };
}): SettleContext {
  const errs = over.errs ?? [];
  return {
    cwd: '/x',
    state: {
      draftReadAt: over.draftReadAt ?? null,
      ...('draftReadHash' in over ? { draftReadHash: over.draftReadHash } : {}),
    } as never,
    draft: { acceptanceCriteria: [], tasks: [] } as never,
    progress: { draftId: 'd', tasks: {} },
    config: null,
    gateSet: { gates: ['draft-read'], softCap: false } as never,
    opts: over.allowStaleDraft ? { allowStaleDraft: true } : {},
    explicitIds: new Set<string>(),
    touchedFiles: [],
    coverage: async () => new Map(),
    draftMtimeMs: async () => over.mtimeMs ?? null,
    draftContentHash: async () => {
      if (over.hashCalls) over.hashCalls.n += 1;
      return over.contentHash ?? null;
    },
    verifiers: { deep: { verify: async () => ({ verdicts: {}, provider: 'mock' }) } },
    emit: { anomalies: async () => {} },
    runner: { test: async () => ({ ran: false, ok: true }) },
    io: { err: (s: string) => errs.push(s) },
  } as unknown as SettleContext;
}

describe('runDraftReadGate', () => {
  // AC-1: DRAFT edited after approve (mtime > baseline), no bypass → refuse with exact message
  it('refuses when DRAFT.md mtime is newer than draftReadAt', async () => {
    const errs: string[] = [];
    const res = await runDraftReadGate(
      ctx({ draftReadAt: BASELINE, mtimeMs: BASELINE_MS + 1000, errs }),
    );
    expect(res.outcome).toBe('refuse');
    const expectedMessage = `settle run refused: DRAFT.md was edited after approve (mtime ${new Date(
      BASELINE_MS + 1000,
    ).toISOString()} > draftReadAt ${BASELINE}). Re-read it then re-approve, or pass --allow-stale-draft to override.`;
    expect(errs.join('')).toBe(`${expectedMessage}\n`);
    // AC-2: the reason field mirrors the exact stderr message (minus trailing newline).
    expect(res.reason).toBe(expectedMessage);
  });

  // AC-1: --allow-stale-draft → pass with the exact bypass note
  it('passes with the bypass note when allowStaleDraft is set', async () => {
    const errs: string[] = [];
    const res = await runDraftReadGate(
      ctx({ draftReadAt: BASELINE, mtimeMs: BASELINE_MS + 1000, allowStaleDraft: true, errs }),
    );
    expect(res.outcome).toBe('pass');
    expect(errs.join('')).toBe(
      'settle: --allow-stale-draft set; proceeding past draft-read gate (DRAFT.md mtime newer than draftReadAt).\n',
    );
  });

  // AC-1: mtime not newer than baseline → pass, no stderr
  it('passes when DRAFT.md mtime is not newer than the baseline', async () => {
    const errs: string[] = [];
    const res = await runDraftReadGate(
      ctx({ draftReadAt: BASELINE, mtimeMs: BASELINE_MS - 1, errs }),
    );
    expect(res.outcome).toBe('pass');
    expect(errs).toEqual([]);
  });

  // AC-1: no draftReadAt baseline → pass (guard preserved from settle.ts)
  it('passes when draftReadAt is null', async () => {
    const errs: string[] = [];
    const res = await runDraftReadGate(ctx({ draftReadAt: null, mtimeMs: Date.now(), errs }));
    expect(res.outcome).toBe('pass');
    expect(errs).toEqual([]);
  });

  // AC-1: stat unavailable (null mtime) → pass, no stderr
  it('passes when the DRAFT mtime is unavailable', async () => {
    const errs: string[] = [];
    const res = await runDraftReadGate(ctx({ draftReadAt: BASELINE, mtimeMs: null, errs }));
    expect(res.outcome).toBe('pass');
    expect(errs).toEqual([]);
  });
});

describe('runDraftReadGate content check (phase 340)', () => {
  const HASH = 'a'.repeat(64);
  const OTHER = 'b'.repeat(64);
  const NEWER = BASELINE_MS + 1000;
  const REFUSAL = `settle run refused: DRAFT.md was edited after approve (mtime ${new Date(
    NEWER,
  ).toISOString()} > draftReadAt ${BASELINE}). Re-read it then re-approve, or pass --allow-stale-draft to override.`;
  const BYPASS =
    'settle: --allow-stale-draft set; proceeding past draft-read gate (DRAFT.md mtime newer than draftReadAt).\n';

  it('passes loudly when the mtime is newer but the content hash matches the stamp (340-01/AC-2)', async () => {
    const errs: string[] = [];
    const hashCalls = { n: 0 };
    const res = await runDraftReadGate(
      ctx({ draftReadAt: BASELINE, mtimeMs: NEWER, draftReadHash: HASH, contentHash: HASH, hashCalls, errs }),
    );
    // 340-01/AC-2
    expect(res).toEqual({ outcome: 'pass' });
    expect(errs.join('')).toBe(
      'settle: DRAFT.md mtime is newer than draftReadAt but its content is unchanged since approve; draft-read passes.\n',
    );
    expect(errs).toHaveLength(1);
    expect(hashCalls.n).toBe(1);
  });

  it('refuses with the existing message when the content hash differs (340-01/AC-3)', async () => {
    const errs: string[] = [];
    const res = await runDraftReadGate(
      ctx({ draftReadAt: BASELINE, mtimeMs: NEWER, draftReadHash: HASH, contentHash: OTHER, errs }),
    );
    // 340-01/AC-3
    expect(res).toEqual({ outcome: 'refuse', reason: REFUSAL });
    expect(errs.join('')).toBe(`${REFUSAL}\n`);
  });

  it('--allow-stale-draft with a different hash keeps the existing bypass notice (340-01/AC-3)', async () => {
    const errs: string[] = [];
    const res = await runDraftReadGate(
      ctx({
        draftReadAt: BASELINE,
        mtimeMs: NEWER,
        draftReadHash: HASH,
        contentHash: OTHER,
        allowStaleDraft: true,
        errs,
      }),
    );
    // 340-01/AC-3
    expect(res).toEqual({ outcome: 'pass' });
    expect(errs.join('')).toBe(BYPASS);
  });

  it('refuses as today when draftReadHash is null and the mtime is newer (340-01/AC-4)', async () => {
    const errs: string[] = [];
    const hashCalls = { n: 0 };
    const res = await runDraftReadGate(
      ctx({ draftReadAt: BASELINE, mtimeMs: NEWER, draftReadHash: null, contentHash: HASH, hashCalls, errs }),
    );
    // 340-01/AC-4
    expect(res).toEqual({ outcome: 'refuse', reason: REFUSAL });
    expect(errs.join('')).toBe(`${REFUSAL}\n`);
    expect(hashCalls.n).toBe(0);
  });

  it('refuses as today when a stamp exists but draftContentHash() returns null (340-01/AC-4)', async () => {
    const errs: string[] = [];
    const hashCalls = { n: 0 };
    const res = await runDraftReadGate(
      ctx({ draftReadAt: BASELINE, mtimeMs: NEWER, draftReadHash: HASH, contentHash: null, hashCalls, errs }),
    );
    // 340-01/AC-4
    expect(res).toEqual({ outcome: 'refuse', reason: REFUSAL });
    expect(errs.join('')).toBe(`${REFUSAL}\n`);
    expect(hashCalls.n).toBe(1);
  });

  it('refuses as today and never hashes when draftReadHash is absent (undefined) (340-01/AC-4)', async () => {
    // Pins the `typeof === 'string'` guard: pre-340 states and `as never`
    // fixtures leave the key undefined, which a `!== null` guard would let
    // through to draftContentHash().
    const errs: string[] = [];
    const hashCalls = { n: 0 };
    const res = await runDraftReadGate(
      ctx({ draftReadAt: BASELINE, mtimeMs: NEWER, contentHash: HASH, hashCalls, errs }),
    );
    // 340-01/AC-4
    expect(res).toEqual({ outcome: 'refuse', reason: REFUSAL });
    expect(errs.join('')).toBe(`${REFUSAL}\n`);
    expect(hashCalls.n).toBe(0);
  });

  it('never calls draftContentHash when the mtime is not newer (340-01/AC-4)', async () => {
    const errs: string[] = [];
    const hashCalls = { n: 0 };
    const res = await runDraftReadGate(
      ctx({ draftReadAt: BASELINE, mtimeMs: BASELINE_MS, draftReadHash: HASH, contentHash: OTHER, hashCalls, errs }),
    );
    // 340-01/AC-4
    expect(res).toEqual({ outcome: 'pass' });
    expect(errs).toEqual([]);
    expect(hashCalls.n).toBe(0);
  });
});
