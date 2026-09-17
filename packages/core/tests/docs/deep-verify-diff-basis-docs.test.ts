import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..', '..');

function lineContaining(file: string, marker: string): string {
  const line = readFileSync(join(repoRoot, file), 'utf8')
    .split(/\r?\n/)
    .find((l) => l.includes(marker));
  if (!line) throw new Error(`${file}: no line contains ${marker}`);
  return line;
}

// Issue #501 / phase 307: the verifier's diff is taken against the merge-base
// with the integration ref, so committed phase work is included.
describe('deep-verify diff basis docs (phase 307)', () => {
  it('307-01/AC-5: concepts.md deep-verify row and config.md diffCapBytes row describe the merge-base basis, not git diff HEAD', () => {
    const concepts = lineContaining('docs/concepts.md', '| `deep-verify` |');
    const config = lineContaining('docs/reference/config.md', '| `verifier.diffCapBytes` |');
    for (const row of [concepts, config]) {
      expect(row).not.toContain('git diff HEAD');
      expect(row).toMatch(/merge-base/);
      expect(row).toMatch(/integrationRef/);
      expect(row).toMatch(/committed/);
    }
  });
});
