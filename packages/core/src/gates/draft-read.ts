import type { GateImpl, GateResult } from './types.js';

/**
 * DRAFT-read gate (Phase 23.1; extracted from settle.ts verbatim in Phase
 * 39.2; content check added in Phase 340). Fires when 'draft-read' is in the
 * effective gate set (checked at the call site). No baseline (null
 * draftReadAt), an unavailable mtime, or an mtime not newer than
 * `state.draftReadAt` ⇒ pass, without hashing anything.
 *
 * When the mtime IS newer, the gate compares content before refusing: if
 * approve stamped `state.draftReadHash` and `ctx.draftContentHash()` (the
 * normalized hash of the exact DRAFT text this settle parsed) equals it, the
 * edit was a touch / re-checkout / line-ending or BOM rewrite — the gate
 * passes with a loud stderr notice. Otherwise (no stamp, an unavailable hash,
 * or a different hash) it refuses as before, unless --allow-stale-draft.
 * The `typeof === 'string'` guard keeps stamp-less states (and fixtures that
 * leave the field undefined) off `draftContentHash()` entirely.
 *
 * Known narrow race (rec-20261029-002): the hash is of the text settle's
 * preconditions read, while the mtime is stat'ed lazily later. A real edit
 * landing in between makes the mtime newer while that earlier text still
 * matches the stamp, so the gate passes — settle verified the approved text,
 * but the file on disk now differs. The pre-340 gate refused that case.
 */
export const runDraftReadGate: GateImpl = async (ctx): Promise<GateResult> => {
  if (ctx.state.draftReadAt === null) return { outcome: 'pass' };
  const mtimeMs = await ctx.draftMtimeMs();
  if (mtimeMs === null) return { outcome: 'pass' };
  const baselineMs = Date.parse(ctx.state.draftReadAt);
  if (mtimeMs > baselineMs) {
    const stamp = ctx.state.draftReadHash;
    if (typeof stamp === 'string' && (await ctx.draftContentHash()) === stamp) {
      ctx.io.err(
        'settle: DRAFT.md mtime is newer than draftReadAt but its content is unchanged since approve; draft-read passes.\n',
      );
      return { outcome: 'pass' };
    }
    if (!ctx.opts.allowStaleDraft) {
      const reason = `settle run refused: DRAFT.md was edited after approve (mtime ${new Date(mtimeMs).toISOString()} > draftReadAt ${ctx.state.draftReadAt}). Re-read it then re-approve, or pass --allow-stale-draft to override.`;
      ctx.io.err(`${reason}\n`);
      return { outcome: 'refuse', reason };
    }
    ctx.io.err(
      'settle: --allow-stale-draft set; proceeding past draft-read gate (DRAFT.md mtime newer than draftReadAt).\n',
    );
  }
  return { outcome: 'pass' };
};
