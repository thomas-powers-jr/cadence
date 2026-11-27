import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 355 (355-01, T3): config.md's Diff base paragraph describes build
// task's upstream-failed notice; a patch changeset ships it; the records
// name the phase.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

function diffBaseSlice(): string {
  const md = read('docs/reference/config.md');
  const start = md.indexOf('**Diff base**');
  const end = md.indexOf('**Dispatch-scoped auto-escalation', start);
  return md.slice(start, end).replace(/\s+/g, ' ');
}

describe('build task base notice docs (phase 355)', () => {
  it('355-01/AC-5: the Diff base paragraph names the merge-base failure and the working-tree-only check', () => {
    const slice = diffBaseSlice();
    expect(slice).toContain('the merge-base of origin/<integrationRef> and HEAD could not be computed');
    expect(slice).toContain('sees working-tree changes only');
    expect(slice).not.toContain('treats `upstream-failed` like an unresolved base');
  });

  it('355-01/AC-5: the changeset bumps core by patch', () => {
    expect(read('.changeset/build-task-upstream-failed-notice.md')).toMatch(
      /^---\r?\n"@thomas-powers-jr\/cadence-core": patch\r?\n---\r?\n/,
    );
  });

  it('355-01/AC-6: ROADMAP and MILESTONES record phase 355', () => {
    expect(read('.cadence/ROADMAP.md').split('\n').some((l) => l.startsWith('### Phase 355'))).toBe(true);
    expect(read('.cadence/MILESTONES.md').split('\n').some((l) => l.startsWith('- **Phase 355**'))).toBe(true);
  });
});
