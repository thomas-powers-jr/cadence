import type { AbstractEvent, HookContext } from '@thomas-powers-jr/cadence-types';
import { SimpleStateBackend } from '../state/simple.js';
import { loadConfig } from '../config/loader.js';
import { getLogger, configureLoggerFromConfig } from '../logging/logger.js';
import { findLatestSettledPhase } from '../phases/latest-settled.js';
import { findNewerPrecompactRecord } from '../handoff/run-resume.js';
import type { PrecompactRecordPointer } from '../handoff/precompact.js';
import {
  handleSessionStart,
  handleUserPrompt,
  handlePreToolEdit,
  handlePostToolEdit,
  handleSessionStop,
  handleSubagentResult,
  handleSubagentStart,
  handleSkillInvoke,
  handlePreCompact,
  type HookResult,
} from './handlers.js';

export class HookDispatcher {
  /**
   * @param now Clock for the phase 349 liveness stamp; injected by tests.
   */
  constructor(
    private readonly repoRoot: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async dispatch(event: AbstractEvent, ctx: HookContext): Promise<HookResult> {
    // Phase 345: pre-compact runs before the shared readState/loadConfig
    // prologue, so a missing or corrupt state.json or an invalid config.json
    // can never throw for it (and never blocks a compaction).
    if (event === 'pre-compact') return handlePreCompact(ctx, this.repoRoot);
    const backend = new SimpleStateBackend(this.repoRoot);
    const result = await this.dispatchWithState(event, ctx, backend);
    // Phase 349 (AC-1): stamp host-hook liveness AFTER the handler returned,
    // through the revision-exempt path that re-reads state.json, so a
    // handler's own commit() of its stale in-memory copy cannot overwrite it
    // and the stamp never advances `revision`. Best-effort: a failure here
    // never fails the hook.
    try {
      await backend.stampHookEvent(this.now().toISOString());
    } catch (err) {
      getLogger()
        .child({ seam: 'hook' })
        .debug('hook-liveness stamp failed', { event, error: (err as Error).message });
    }
    return result;
  }

  private async dispatchWithState(
    event: Exclude<AbstractEvent, 'pre-compact'>,
    ctx: HookContext,
    backend: SimpleStateBackend,
  ): Promise<HookResult> {
    const state = await backend.readState();
    const config = await loadConfig(this.repoRoot);
    configureLoggerFromConfig(config);
    getLogger().child({ seam: 'hook' }).debug('dispatch', { event });
    switch (event) {
      case 'session-start': {
        // Phase 322 (T2, AC-4): best-effort — a failed lookup yields null
        // (the banner then falls back to the checkout-local label, or
        // nothing) and never fails the hook.
        let lastSettledPhase: string | null = null;
        try {
          lastSettledPhase = await findLatestSettledPhase(this.repoRoot);
        } catch {
          lastSettledPhase = null;
        }
        // Phase 345 (T5, AC-7): best-effort — a pointer only when the newest
        // pre-compaction record is newer than the freshest SESSION doc; any
        // failure contributes nothing.
        let precompactRecord: PrecompactRecordPointer | null = null;
        try {
          precompactRecord = await findNewerPrecompactRecord(
            this.repoRoot,
            state.session.lastHandoff,
          );
        } catch {
          precompactRecord = null;
        }
        return handleSessionStart(ctx, state, lastSettledPhase, precompactRecord);
      }
      case 'user-prompt':
        return handleUserPrompt(ctx, state, config, backend);
      case 'pre-tool-edit':
        return handlePreToolEdit(ctx, state, config);
      case 'post-tool-edit':
        return handlePostToolEdit(ctx, state, config, backend);
      case 'session-stop':
        return handleSessionStop(ctx, state, config);
      case 'subagent-result':
        return handleSubagentResult(ctx, state, config, backend);
      case 'subagent-start':
        return handleSubagentStart(ctx, state, config, backend);
      case 'skill-invoke':
        return handleSkillInvoke(ctx, state, config, backend);
    }
  }
}
