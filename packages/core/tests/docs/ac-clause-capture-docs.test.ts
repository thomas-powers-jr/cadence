import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 354 (354-01, T3): the unanchored-capture caveat is gone from the
// docs, a patch changeset ships the fix, and the records name the phase.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');
const lines = (rel: string): string[] => read(rel).split('\n');

describe('AC clause capture docs (phase 354)', () => {
  it('354-01/AC-6: CLAUDE.md and commands.md no longer describe the capture as unanchored', () => {
    expect(read('CLAUDE.md')).not.toContain('capture is unanchored');
    expect(read('docs/reference/commands.md')).not.toContain('capture is unanchored');
  });

  it('354-01/AC-6: commands.md keeps the trailing-prose limit', () => {
    expect(read('docs/reference/commands.md')).toContain('trailing prose after the last AC');
  });

  it('354-01/AC-6: the changeset bumps core by patch', () => {
    const rel = '.changeset/ac-clause-capture.md';
    expect(existsSync(join(REPO_ROOT, rel))).toBe(true);
    const front = /^---\n([\s\S]*?)\n---/.exec(read(rel))?.[1] ?? '';
    expect(front.trim()).toBe('"@thomas-powers-jr/cadence-core": patch');
  });

  it('354-01/AC-7: ROADMAP and MILESTONES record phase 354', () => {
    expect(lines('.cadence/ROADMAP.md').some((l) => l.startsWith('### Phase 354'))).toBe(true);
    expect(lines('.cadence/MILESTONES.md').some((l) => l.startsWith('- **Phase 354**'))).toBe(true);
  });
});
