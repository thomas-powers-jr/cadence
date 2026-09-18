import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('313-01 — distributed skills gap recorded in docs/packs-design.md', () => {
  it('313-01/AC-5: the design record states why the pack cannot declare this skill', async () => {
    const doc = await readFile(join(REPO_ROOT, 'docs/packs-design.md'), 'utf8');

    expect(doc).toContain('Distributed skills');
    expect(doc).toContain('rec-20260917-003');
    expect(doc).toContain('systematic-debugging');
    // The gap must be framed as a missing manifest slot, not as a defect —
    // and the gate must be described as one the skill honors, never as
    // something CADENCE enforces.
    expect(doc).toMatch(/has no (way|slot) to say/i);
    expect(doc).toMatch(/nothing in the engine refuses a conclusion/i);
  });
});
