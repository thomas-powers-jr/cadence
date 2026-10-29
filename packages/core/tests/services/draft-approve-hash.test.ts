// Phase 340 (340-01, T2) — `draft approve` stamps `draftReadHash` (sha256 of
// the normalized DRAFT text) beside `draftReadAt` in the same state commit,
// and a refused approve leaves it untouched. Direct-call style against the
// service, matching draft-approve-packs.test.ts — no `dist` dependency.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyState, defaultConfig } from '@thomas-powers-jr/cadence-types';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { draftApproveService } from '../../src/services/draft-approve.js';
import { draftContentHash } from '../../src/parse/draft-content-hash.js';
import { SimpleStateBackend } from '../../src/state/simple.js';
import type { CommandIO } from '../../src/services/io.js';

const silentIO: CommandIO = { out: () => {}, err: () => {} };

let fx: Fixture | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (fx) {
    await fx.cleanup();
    fx = undefined;
  }
});

const PHASE = '01-foundation';
const DRAFT_ID = '01-01';

function draftMd(tier: 'standard' | 'complex' = 'standard'): string {
  return `---
phase: ${PHASE}
id: ${DRAFT_ID}
tier: ${tier}
status: PENDING
---

# ${DRAFT_ID} — Draft read hash fixture

## Objective

Prove approve stamps a content hash.

## Acceptance Criteria

### AC-1: It stamps
Given a draft When approve runs Then the hash is stamped.

## Tasks

### T1: Do the thing
- files: \`src/foo.ts\`
- action: do the thing
- verify: run the test
- stop: the test is green
- done: AC-1

## Boundaries

- DO NOT touch anything else.
`;
}

/** An initialized tempRepo in DRAFT position, profile auto (no manual approve gate). */
async function setup(draft: string, seedHash: string | null = null): Promise<string> {
  fx = await tempRepo({ initialized: true, projectName: 'draft-hash-test' });
  const root = fx.root;
  await mkdir(join(root, '.cadence', 'phases', PHASE), { recursive: true });
  const state = emptyState('draft-hash-test');
  state.loopPosition = 'DRAFT';
  state.draftReadHash = seedHash;
  await new SimpleStateBackend(root).commit(state);
  await writeFile(join(root, '.cadence', 'phases', PHASE, `${DRAFT_ID}-DRAFT.md`), draft, 'utf8');
  await writeFile(
    join(root, '.cadence', 'config.json'),
    JSON.stringify({ ...defaultConfig, profile: 'auto' }, null, 2),
    'utf8',
  );
  // Never consumed when the manual approve gate is off; answers "no" if it fires.
  vi.stubEnv('CADENCE_PROMPTER_SCRIPT', 'n\n');
  return root;
}

async function rawState(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, '.cadence', 'state.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('draft approve stamps draftReadHash', () => {
  it('340-01/AC-1: a successful approve writes draftReadHash = draftContentHash(DRAFT on disk) beside draftReadAt', async () => {
    const root = await setup(draftMd());
    const res = await draftApproveService(root, { phase: PHASE, num: '01' }, silentIO);
    expect(res.exitCode).toBe(0);

    const onDisk = await readFile(
      join(root, '.cadence', 'phases', PHASE, `${DRAFT_ID}-DRAFT.md`),
      'utf8',
    );
    const st = await rawState(root);
    expect(st.loopPosition).toBe('BUILD');
    expect(typeof st.draftReadAt).toBe('string');
    expect(st.draftReadHash).toBe(draftContentHash(onDisk));
    expect(st.draftReadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('340-01/AC-1: a CRLF+BOM copy of the same DRAFT stamps the same draftReadHash', async () => {
    const lf = draftMd();
    const root = await setup('\uFEFF' + lf.replace(/\n/g, '\r\n'));
    const res = await draftApproveService(root, { phase: PHASE, num: '01' }, silentIO);
    expect(res.exitCode).toBe(0);
    expect((await rawState(root)).draftReadHash).toBe(draftContentHash(lf));
  });

  it('340-01/AC-1: a refused approve (auto × complex soft cap) leaves a prior draftReadHash untouched', async () => {
    // auto profile × complex tier without --allow-auto-complex is refused
    // before any state mutation (DESIGN.md §4 M2). A seeded stamp proves the
    // field is left alone, not reset; the stderr match proves the soft cap
    // (not the catch path, which also exits 1) is what refused.
    const prior = 'a'.repeat(64);
    const root = await setup(draftMd('complex'), prior);
    const errs: string[] = [];
    const res = await draftApproveService(
      root,
      { phase: PHASE, num: '01' },
      { out: () => {}, err: (s) => errs.push(s) },
    );
    expect(res.exitCode).toBe(1);
    expect(errs.join('')).toMatch(/soft-capped/);
    const st = await rawState(root);
    expect(st.loopPosition).toBe('DRAFT');
    expect(st.draftReadHash).toBe(prior);
  });
});
