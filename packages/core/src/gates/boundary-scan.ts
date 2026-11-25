import { collectUnscopedTouchedFiles, filterCadenceSelfWrites } from '../git/boundary-diff.js';
import { runBoundaryCheck } from '../checks/boundary.js';
import { effectiveBoundaryEnforcement } from './engine.js';
import { isGateSealed } from './types.js';
import type { GateImpl, GateResult } from './types.js';

/**
 * Settle-time boundary diff scan (Phase 156). Follow-on to phase 155's
 * edit-time `boundaryEnforcement: 'block'`, which cannot see a violation that
 * never passed through the host's pre-tool-edit hook (most notably a
 * subagent-driven edit). No-ops unless `effectiveBoundaryEnforcement` resolves
 * to `'block'`. Enumerates every file touched by the whole phase via an
 * UNSCOPED git diff (`collectUnscopedTouchedFiles`, not `ctx.touchedFiles`/
 * `ctx.diff()`, which are pre-scoped to the declared `files:` set and can
 * structurally never surface an out-of-boundary file), drops `.cadence/**`
 * self-writes, and refuses when a file outside the declared `files:` union is
 * found — unless bypassed via `--force`/`--allow-boundary-scan-failure` and
 * the gate is not sealed.
 *
 * Phase 226 (T3): a genuine bypass (unsealed, `--force` or
 * `--allow-boundary-scan-failure` set, past a real finding) now also carries
 * `flags.boundaryScanBypassed: true` on the returned `GateResult` — mirroring
 * `test-coverage`'s `coverageBypassed` — so the registry's gate-provenance
 * collection can report this as "skipped (bypassed)" instead of "ran".
 *
 * Phase 280 (280-01, T10, AC-2): `anyTaskDispatched` is derived here from
 * `ctx.progress.tasks[*].execution === 'dispatch'` (already threaded onto
 * `SettleContext.progress` by T8) and passed as `effectiveBoundaryEnforcement`'s
 * optional third `progressSignal` param (T9). Once any recorded task in the
 * phase carries `execution: 'dispatch'`, this gate runs in block mode for the
 * rest of the phase regardless of config/draft `boundaryEnforcement` — the
 * dispatch-scoped escalation never de-escalates.
 *
 * Phase 351 (351-01, AC-2/AC-3): the gate names its diff base. A fallback to
 * the local `<integrationRef>` (because `origin/<integrationRef>` does not
 * resolve) prints a stderr notice with the 7-char merge-base sha; when the
 * remote-tracking ref resolves but its merge-base with HEAD cannot be
 * computed after a retry (`upstream-failed`), the gate refuses — naming a
 * shallow clone when that is the cause — unless unsealed and bypassed, in
 * which case only working-tree changes are scanned and the result carries
 * `flags.boundaryScanBypassed`. The "could not resolve a base ref" notice now
 * prints only for the `none` source.
 *
 * Phase 352 (352-01, AC-1): every bypass return also carries
 * `flags.boundaryScanBypass` — the flag that fired, the bypassed causes
 * (`merge-base`, `offenders`, in that order) and the offending paths — and
 * both bypass lines name the flag by the rule: `--allow-boundary-scan-failure`
 * whenever it is set, else `--force`.
 */
export const runBoundaryScanGate: GateImpl = async (ctx): Promise<GateResult> => {
  const anyTaskDispatched = Object.values(ctx.progress.tasks).some((t) => t.execution === 'dispatch');
  if (effectiveBoundaryEnforcement(ctx.config, ctx.draft, { anyTaskDispatched }) !== 'block') {
    return { outcome: 'pass' };
  }

  const integrationRef = ctx.config?.phaseGuard?.integrationRef ?? 'main';
  const { files, baseSource, baseSha, shallow } = await collectUnscopedTouchedFiles(ctx.cwd, integrationRef);
  if (baseSource === 'none') {
    ctx.io.err(
      `boundary-scan: could not resolve a base ref against \`${integrationRef}\` — ` +
        'committed-file scan skipped, only working-tree changes were checked\n',
    );
  }

  const filtered = filterCadenceSelfWrites(files);

  const declaredFiles = ctx.draft.tasks.flatMap((t) => t.files);
  if (declaredFiles.length === 0) {
    // Fail-open: an empty declared set means there is no boundary to enforce.
    return { outcome: 'pass' };
  }

  const sealed = isGateSealed(ctx, 'boundary-scan');
  const bypassFlagSet = ctx.opts.force === true || ctx.opts.allowBoundaryScanFailure === true;
  // Phase 352 (352-01, AC-1): the flag rule — `--allow-boundary-scan-failure`
  // whenever it is set, else `--force` (the registry.ts rule) — for both
  // bypass lines and the bypass report.
  const flag: '--allow-boundary-scan-failure' | '--force' =
    ctx.opts.allowBoundaryScanFailure === true ? '--allow-boundary-scan-failure' : '--force';

  // Phase 351 (351-01, AC-2): the local fallback is no longer silent.
  if (baseSource === 'local' && baseSha !== null) {
    ctx.io.err(
      `boundary-scan: origin/${integrationRef} did not resolve; diffing against the merge-base ` +
        `with the local ${integrationRef} ref (${baseSha.slice(0, 7)})\n`,
    );
  }

  // Phase 351 (351-01, AC-3): `origin/<ref>` resolves but its merge-base with
  // HEAD could not be computed (after a retry) — refuse rather than diff
  // against a possibly stale local ref, unless an unsealed bypass is set.
  let baseBypassed = false;
  if (baseSource === 'upstream-failed') {
    const what =
      `settle run refused: boundary-scan could not compute the merge-base of origin/${integrationRef} ` +
      'and HEAD after a retry';
    if (sealed || !bypassFlagSet) {
      const reason = sealed
        ? shallow
          ? `${what}, and this is a shallow clone. Run git fetch --unshallow origin (or --deepen=<n>) and ` +
            're-run settle. This gate is sealed (gates.sealed) and cannot be bypassed with --force or ' +
            '--allow-boundary-scan-failure.'
          : `${what}. Re-run settle. This gate is sealed (gates.sealed) and cannot be bypassed with ` +
            '--force or --allow-boundary-scan-failure.'
        : shallow
          ? `${what}, and this is a shallow clone. Run git fetch --unshallow origin (or --deepen=<n>) and ` +
            're-run settle, or pass --allow-boundary-scan-failure to scan only working-tree changes.'
          : `${what}. Re-run settle, or pass --allow-boundary-scan-failure to scan only working-tree changes.`;
      ctx.io.err(`${reason}\n`);
      return { outcome: 'refuse', reason };
    }
    ctx.io.err(`boundary-scan: ${flag} set; scanning working-tree changes only.\n`);
    baseBypassed = true;
  }

  const events = runBoundaryCheck({
    declaredFiles,
    touchedFiles: filtered,
    stamp: () => new Date().toISOString(),
    root: ctx.cwd,
    severity: 'error',
  });

  if (events.length === 0) {
    return baseBypassed
      ? {
          outcome: 'pass',
          flags: { boundaryScanBypassed: true, boundaryScanBypass: { flag, causes: ['merge-base'], offenders: [] } },
        }
      : { outcome: 'pass' };
  }

  const offenders = events.map((e) => String(e.context.file));
  for (const file of offenders) {
    ctx.io.err(`boundary-scan: ${file} touched but not declared in any task's files:\n`);
  }

  const bypassed = !sealed && bypassFlagSet;
  if (!bypassed) {
    const reason = sealed
      ? 'settle run refused: boundary-scan found file(s) outside the declared boundary. ' +
          'This gate is sealed (gates.sealed) and cannot be bypassed with --force or ' +
          '--allow-boundary-scan-failure.'
      : 'settle run refused: boundary-scan found file(s) outside the declared boundary. ' +
          'Pass --allow-boundary-scan-failure to record them and settle anyway, or --force to bypass.';
    ctx.io.err(`${reason}\n`);
    return { outcome: 'refuse', reason };
  }

  ctx.io.err(`boundary-scan: ${flag} set; proceeding past ${offenders.length} offending file(s).\n`);
  return {
    outcome: 'pass',
    summaryPatch: { boundaryScan: { offenders } },
    flags: {
      boundaryScanBypassed: true,
      boundaryScanBypass: {
        flag,
        causes: baseBypassed ? ['merge-base', 'offenders'] : ['offenders'],
        offenders,
      },
    },
  };
};
