import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 357 (357-01, T3): the records name the first test-typecheck
// burn-down batch.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const lines = (rel: string): string[] => readFileSync(join(REPO_ROOT, rel), 'utf8').split('\n');

describe('typecheck burn-down batch 1 records (phase 357)', () => {
  it('357-01/AC-4: ROADMAP and MILESTONES record phase 357', () => {
    expect(lines('.cadence/ROADMAP.md').some((l) => l.startsWith('### Phase 357'))).toBe(true);
    expect(lines('.cadence/MILESTONES.md').some((l) => l.startsWith('- **Phase 357**'))).toBe(true);
  });
});
