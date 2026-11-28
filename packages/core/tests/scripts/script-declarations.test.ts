import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 357 (357-01, T1): each repo-root script that core's tests import has
// a hand-written `<name>.d.mts` beside it, and the declaration names exactly
// the script's exports (rec-20261127-001). Interfaces and type aliases a
// declaration adds are not counted.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPTS = ['check-audit-exceptions', 'check-lockfile-overrides', 'publish-proof', 'release-integrity'] as const;

function namesFrom(text: string, declaration: boolean): string[] {
  const names = new Set<string>();
  const decl = declaration ? '(?:declare\\s+)?' : '';
  const single = new RegExp(`^export\\s+${decl}(?:async\\s+)?(?:function\\*?|class|const)\\s+([A-Za-z_$][\\w$]*)`, 'gm');
  for (const m of text.matchAll(single)) names.add(m[1]!);
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

describe('scripts/*.d.mts declarations (phase 357)', () => {
  for (const script of SCRIPTS) {
    it(`357-01/AC-1: ${script}.d.mts declares exactly the script's exported names`, () => {
      const exported = namesFrom(read(`scripts/${script}.mjs`), false);
      expect(exported.length).toBeGreaterThan(0);
      expect(namesFrom(read(`scripts/${script}.d.mts`), true)).toStrictEqual(exported);
    });
  }

  it('357-01/AC-1: publish-proof exports must, exerciseLoopSteps and withUnconditionalTeardown', () => {
    expect(namesFrom(read('scripts/publish-proof.mjs'), false)).toStrictEqual([
      'exerciseLoopSteps',
      'must',
      'withUnconditionalTeardown',
    ]);
  });
});
