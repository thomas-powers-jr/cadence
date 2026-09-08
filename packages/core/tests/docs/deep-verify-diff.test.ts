import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function doc(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

// AC-3 (Phase 71): docs describe diff-aware deep-verify + diffCapBytes.

describe('deep-verify diff docs (AC-3)', () => {
  it('config.md documents verifier.diffCapBytes with its default', () => {
    const md = doc('docs/reference/config.md');
    expect(md).toContain('verifier.diffCapBytes');
    expect(md).toContain('262144');
  });

  it('concepts.md states deep-verify is sent the actual diff', () => {
    const md = doc('docs/concepts.md');
    expect(md).toMatch(/deep-verify[\s\S]*diff/i);
    expect(md).toContain('diffCapBytes');
  });

  it('DESIGN.md records the deep-verify-reads-the-diff decision', () => {
    const md = doc('DESIGN.md');
    expect(md).toContain('deep-verify` reads the actual diff');
    expect(md).toContain('deepVerifyMeta');
  });
});

// AC-7 (Phase 296): the prompt travels on stdin, so diffCapBytes is a
// context-and-cost budget, not a dodge around an operating-system limit.
// Operators who lowered the cap to stay under the 32,767-character Windows
// command-line ceiling need to be told they can raise it again.
describe('deep-verify prompt delivery docs (Phase 296 AC-7)', () => {
  const md = doc('docs/reference/config.md');

  it('config.md says the prompt is delivered on stdin', () => {
    expect(md).toMatch(/prompt is delivered to the host CLI on \*\*stdin\*\*/);
  });

  it('config.md says the cap bounds context and cost, not an OS limit', () => {
    expect(md).toContain("not about any operating-system limit");
  });

  it('config.md records the ENAMETOOLONG failure mode the cap used to hide', () => {
    expect(md).toContain('ENAMETOOLONG');
    expect(md).toContain('32,767');
  });

  it('config.md keeps the standing warning to check deepVerifyMeta.provider', () => {
    expect(md).toContain('deepVerifyMeta.provider');
    expect(md).toMatch(/`mock` means nothing was verified/);
  });
});
