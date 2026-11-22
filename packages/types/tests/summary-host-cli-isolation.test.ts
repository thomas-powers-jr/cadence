import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GateProvenanceZ, SummaryZ } from '../src/summary.js';

// Phase 344 (T3) - `hostCliIsolation` on a gate's provenance entry, schema
// only. That the three settle gates actually record it, and that a SUMMARY
// carrying it still verifies against its content hash, is asserted in core
// (`packages/core/tests/gates/host-cli-isolation-provenance.test.ts`).

const CLAUDE_FLAGS = ['--setting-sources', 'project', '--strict-mcp-config'];
const CODEX_FLAGS = ['--ignore-user-config'];

/** A minimal, valid SUMMARY of the shape written before this phase: its gate
 *  entries carry verifier identity but no `hostCliIsolation`. */
function prePhaseSummary(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    draftId: '01-01',
    completedAt: '2026-01-01T00:00:00.000Z',
    acResults: [{ id: 'AC-1', pass: true }],
    taskResults: [{ id: 'T1', status: 'DONE', notes: '' }],
    decisions: [],
    deferred: [],
    skillAudit: { required: [], invoked: [] },
    gates: [
      { gate: 'deep-verify', status: 'ran', observedProvider: 'host-cli' },
      { gate: 'code-review', status: 'ran', provider: 'host-cli', providerSelection: 'configured' },
      { gate: 'security-audit', status: 'skipped', skipReason: 'not in the active tier × profile gate set' },
    ],
  };
}

/** A settled SUMMARY from this repo's own corpus, written long before this phase. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURE_241 = join(
  REPO_ROOT,
  '.cadence',
  'phases',
  '241-anchor-ladder-reachability',
  '241-01-SUMMARY.json',
);

describe('GateProvenanceZ.hostCliIsolation (phase 344)', () => {
  it.each([
    ['codex', CODEX_FLAGS],
    ['claude', CLAUDE_FLAGS],
  ])('344-01/AC-5: accepts the %s flag list as a string array and round-trips it', (_family, flags) => {
    const entry = { gate: 'code-review', status: 'ran', provider: 'host-cli', hostCliIsolation: flags };
    const parsed = GateProvenanceZ.parse(entry);
    expect(parsed.hostCliIsolation).toEqual(flags);
    expect(parsed).toEqual(entry);
    // Serialize, re-parse: the list survives a write/read of the SUMMARY.
    const reparsed = GateProvenanceZ.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(entry);
  });

  it('344-01/AC-5: accepts the field on a deep-verify entry beside observedProvider, and an empty list', () => {
    const parsed = GateProvenanceZ.parse({
      gate: 'deep-verify',
      status: 'ran',
      observedProvider: 'host-cli',
      hostCliIsolation: CODEX_FLAGS,
    });
    expect(parsed.hostCliIsolation).toEqual(['--ignore-user-config']);
    expect(GateProvenanceZ.parse({ gate: 'deep-verify', status: 'ran', hostCliIsolation: [] }).hostCliIsolation).toEqual([]);
  });

  it.each([
    ['a bare string', '--ignore-user-config'],
    ['a boolean', true],
    ['null', null],
    ['an object', { flags: ['--ignore-user-config'] }],
    ['an array holding a number', ['--ignore-user-config', 1]],
    ['an array holding null', [null]],
  ])('344-01/AC-5: rejects %s', (_label, value) => {
    const r = GateProvenanceZ.safeParse({ gate: 'code-review', status: 'ran', hostCliIsolation: value });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]?.path[0]).toBe('hostCliIsolation');
  });

  it('344-01/AC-5: an entry without the field parses with the key absent - optional, no default injected', () => {
    const parsed = GateProvenanceZ.parse({ gate: 'code-review', status: 'ran', provider: 'host-cli' });
    expect(Object.hasOwn(parsed, 'hostCliIsolation')).toBe(false);
    expect(parsed).toEqual({ gate: 'code-review', status: 'ran', provider: 'host-cli' });
    expect('hostCliIsolation' in GateProvenanceZ.shape).toBe(true);
  });

  it('344-01/AC-5: a SUMMARY written before this phase still parses, unchanged and with no such key on any gate entry', () => {
    const before = prePhaseSummary();
    const parsed = SummaryZ.parse(before);
    expect(parsed.gates).toHaveLength(3);
    for (const gate of parsed.gates ?? []) {
      expect(Object.hasOwn(gate, 'hostCliIsolation')).toBe(false);
    }
    expect(parsed.gates).toEqual(before.gates);

    // A real settled SUMMARY from this repo's corpus, predating the phase.
    const real = SummaryZ.safeParse(JSON.parse(readFileSync(FIXTURE_241, 'utf8')));
    expect(real.success).toBe(true);
    if (!real.success) return;
    expect(real.data.gates?.length).toBeGreaterThan(0);
    for (const gate of real.data.gates ?? []) {
      expect(Object.hasOwn(gate, 'hostCliIsolation')).toBe(false);
    }
  });

  it('344-01/AC-5: a SUMMARY whose gate entries carry the field parses and keeps it, with no schemaVersion change', () => {
    const base = prePhaseSummary();
    const parsed = SummaryZ.parse({
      ...base,
      gates: [
        { gate: 'deep-verify', status: 'ran', observedProvider: 'host-cli', hostCliIsolation: CLAUDE_FLAGS },
        { gate: 'code-review', status: 'ran', provider: 'host-cli', hostCliIsolation: CLAUDE_FLAGS },
        { gate: 'security-audit', status: 'ran', provider: 'host-cli', hostCliIsolation: CLAUDE_FLAGS },
      ],
    });
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.gates?.map((g) => g.hostCliIsolation)).toEqual([CLAUDE_FLAGS, CLAUDE_FLAGS, CLAUDE_FLAGS]);
  });
});
