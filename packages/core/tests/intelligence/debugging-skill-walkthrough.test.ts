import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';

/**
 * Phase 313 (313-01). Drives the REAL CLI through the full pipeline the
 * `systematic-debugging` skill prescribes, against an ephemeral repo, and
 * asserts the resulting ledger state from `--format json` output rather than
 * from prose.
 *
 * What this file deliberately does NOT assert: that a model reading
 * `SKILL.md` actually stops when the gate query is non-empty. That is a claim
 * about whether prose is obeyed, and a test pretending to prove it would be
 * exactly the self-report trust this repo exists to refuse. What is checkable
 * — and is checked here — is that the gate query is deterministic, that it
 * discriminates open from closed, and that the SKILL.md's own framing is
 * honest about which of the two it is.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const CADENCE_CLI = join(HERE, '..', '..', 'dist', 'cli', 'index.js');
const REPO_ROOT = join(HERE, '../../../..');
const SKILL_PATH = join(REPO_ROOT, '.claude/skills/systematic-debugging/SKILL.md');

function run(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CADENCE_CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

/** `assumption list --format json` rows, narrowed to what this file asserts. */
interface AssumptionRow {
  id: string;
  recommendationId: string;
  text: string;
  status: 'open' | 'validated' | 'rejected';
}

async function listAssumptions(
  root: string,
  extra: string[] = [],
): Promise<AssumptionRow[]> {
  const r = await run(['assumption', 'list', '--format', 'json', ...extra], root);
  expect(r.code).toBe(0);
  const parsed: unknown = JSON.parse(r.stdout);
  return (Array.isArray(parsed) ? parsed : []) as AssumptionRow[];
}

/** Pull `<id>` out of `Added <id>: <text>` / `Added <id> to <rec>: ...`. */
function addedId(stdout: string): string {
  const m = /Added (\S+?)[: ]/.exec(stdout);
  if (!m?.[1]) throw new Error(`could not parse an id from: ${stdout}`);
  return m[1];
}

let active: Fixture | null = null;
afterEach(async () => {
  if (active) {
    await active.cleanup();
    active = null;
  }
});

describe('313-01 — the systematic-debugging skill and its ledger substrate', () => {
  it('313-01/AC-2: a full debugging session leaves every hypothesis tied to one anchor and terminally closed', async () => {
    active = await tempRepo({ initialized: true, projectName: 'debug-walkthrough' });
    const root = active.root;

    // Step 1 — the anchor, with the reproduction as its first evidence.
    const rec = await run(
      ['recommendation', 'add',
        '--title', 'bug: settle exits 0 but writes no SUMMARY',
        '--summary', 'Observed on a clean tree; reproduced 3/3.',
        '--priority', 'medium', '--readiness', 'needs-evidence'],
      root,
    );
    expect(rec.code).toBe(0);
    const recId = addedId(rec.stdout);

    const ev = await run(
      ['recommendation', 'evidence', 'add', recId,
        '--note', 'Reproduction: cadence settle run --auto on a clean tree -> exit 0, no SUMMARY.json'],
      root,
    );
    expect(ev.code).toBe(0);

    // Step 2/3 — two hypotheses, one at a time, each closed by an observation.
    const h1 = await run(
      ['assumption', 'add', '--rec', recId,
        '--text', 'The SUMMARY write is skipped because the phase directory does not exist'],
      root,
    );
    expect(h1.code).toBe(0);
    const a1 = addedId(h1.stdout);

    const h2 = await run(
      ['assumption', 'add', '--rec', recId,
        '--text', 'The SUMMARY write happens but targets a path outside the phase directory'],
      root,
    );
    expect(h2.code).toBe(0);
    const a2 = addedId(h2.stdout);

    // The first is contradicted by observation; the second survives its
    // rejection test.
    expect((await run(['assumption', 'reject', a1], root)).code).toBe(0);
    expect((await run(['assumption', 'validate', a2], root)).code).toBe(0);

    // Every hypothesis hangs off the one anchor, and none is left open.
    const rows = await listAssumptions(root, ['--filter-rec', recId]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.recommendationId === recId)).toBe(true);
    expect(rows.find((r) => r.id === a1)?.status).toBe('rejected');
    expect(rows.find((r) => r.id === a2)?.status).toBe('validated');
    expect(rows.some((r) => r.status === 'open')).toBe(false);
  });

  it('313-01/AC-3: the conclusion gate query discriminates open from closed', async () => {
    active = await tempRepo({ initialized: true, projectName: 'debug-gate' });
    const root = active.root;

    const rec = await run(
      ['recommendation', 'add', '--title', 'bug: gate probe', '--summary', 's',
        '--priority', 'low', '--readiness', 'needs-evidence'],
      root,
    );
    const recId = addedId(rec.stdout);

    const h = await run(
      ['assumption', 'add', '--rec', recId, '--text', 'A falsifiable statement'],
      root,
    );
    const aId = addedId(h.stdout);

    // While a hypothesis is open the gate query returns it — "non-empty means
    // stop" is a real signal, not a formality.
    const whileOpen = await listAssumptions(root, [
      '--filter-rec', recId, '--filter-status', 'open',
    ]);
    expect(whileOpen).toHaveLength(1);
    expect(whileOpen[0]?.id).toBe(aId);

    // Once closed it returns nothing, so the gate actually clears.
    expect((await run(['assumption', 'validate', aId], root)).code).toBe(0);
    const whenClosed = await listAssumptions(root, [
      '--filter-rec', recId, '--filter-status', 'open',
    ]);
    expect(whenClosed).toHaveLength(0);
  });

  it('313-01/AC-4: concluding advances the anchor on both exits — false alarm and root cause found', async () => {
    // Exit 1: false alarm. No bug after all, closed with its trail intact.
    active = await tempRepo({ initialized: true, projectName: 'debug-anchor-false-alarm' });
    const root = active.root;

    const rec = await run(
      ['recommendation', 'add', '--title', 'bug: anchor lifecycle', '--summary', 's',
        '--priority', 'low', '--readiness', 'needs-evidence'],
      root,
    );
    const recId = addedId(rec.stdout);

    const listed = await run(['recommendation', 'list', '--format', 'json'], root);
    const before = (JSON.parse(listed.stdout) as { id: string; status: string }[])
      .find((r) => r.id === recId);
    expect(before?.status).toBe('candidate');

    const promoted = await run(
      ['recommendation', 'promote', recId, '--status=rejected'],
      root,
    );
    expect(promoted.code).toBe(0);

    const after = await run(['recommendation', 'list', '--format', 'json'], root);
    const stillActive = (JSON.parse(after.stdout) as { id: string; status: string }[])
      .find((r) => r.id === recId);
    // Terminal-status recs leave the active ledger, so nothing dangles.
    expect(stillActive).toBeUndefined();
    await active.cleanup();

    // Exit 2: root cause found. `accepted` recs stay in the active list (they
    // become real queued work, not an abandoned row) — so the assertion here
    // is the AC-literal claim, not "removed from the list": the anchor must
    // no longer sit at `candidate`, which is what "no dead ledger entry"
    // actually requires for this branch.
    active = await tempRepo({ initialized: true, projectName: 'debug-anchor-root-cause' });
    const root2 = active.root;

    const rec2 = await run(
      ['recommendation', 'add', '--title', 'bug: anchor lifecycle (root cause)', '--summary', 's',
        '--priority', 'low', '--readiness', 'needs-evidence'],
      root2,
    );
    const recId2 = addedId(rec2.stdout);

    const listed2 = await run(['recommendation', 'list', '--format', 'json'], root2);
    const before2 = (JSON.parse(listed2.stdout) as { id: string; status: string }[])
      .find((r) => r.id === recId2);
    expect(before2?.status).toBe('candidate');

    const promoted2 = await run(
      ['recommendation', 'promote', recId2, '--status=accepted', '--readiness=ready-for-cadence-spec'],
      root2,
    );
    expect(promoted2.code).toBe(0);

    const after2 = await run(['recommendation', 'list', '--format', 'json'], root2);
    const advanced = (JSON.parse(after2.stdout) as { id: string; status: string }[])
      .find((r) => r.id === recId2);
    expect(advanced).toBeDefined();
    expect(advanced?.status).not.toBe('candidate');
    expect(advanced?.status).toBe('accepted');
  });

  it('313-01/AC-1: the skill matches the house template shape and names real trigger phrases', async () => {
    const skill = await readFile(SKILL_PATH, 'utf8');

    // Frontmatter, then the four sections phase-build established, in order.
    expect(skill.startsWith('---\n')).toBe(true);
    expect(skill).toMatch(/^name: systematic-debugging$/m);
    const order = ['\n# ', '\n## Preconditions', '\n## Pipeline', '\n## Known failure modes to actively watch'];
    let cursor = 0;
    for (const marker of order) {
      const at = skill.indexOf(marker, cursor);
      expect(at, `expected ${marker.trim()} after index ${cursor}`).toBeGreaterThan(-1);
      cursor = at;
    }

    // The description is what the host matches on, so generic wording would
    // make the skill unreachable. Require concrete debugging triggers.
    const description = /^description: (.+)$/m.exec(skill)?.[1] ?? '';
    expect(description.length).toBeGreaterThan(80);
    for (const trigger of ['test fails', 'ci goes red', 'a bug is reported', 'fix did not work']) {
      expect(description.toLowerCase()).toContain(trigger.toLowerCase());
    }
  });

  it('313-01/AC-3: the skill states its gate is one it honors, not one CADENCE enforces', async () => {
    const skill = await readFile(SKILL_PATH, 'utf8');

    // The exact gate query, so the prose and the tested command cannot drift.
    expect(skill).toContain('--filter-status open');
    expect(skill).toContain('--format json');
    expect(skill).toContain('Non-empty means stop');

    // The honesty clause is the point of this phase: no enforcement claim.
    expect(skill).toMatch(/gate you\s*\n?\s*honor, not one the engine enforces/);
    expect(skill).toMatch(/CADENCE does not\s*\n?\s*refuse a conclusion/);
    // And it must warn against the overclaim explicitly.
    expect(skill.toLowerCase()).toContain('enforcing debugging discipline');
  });
});
