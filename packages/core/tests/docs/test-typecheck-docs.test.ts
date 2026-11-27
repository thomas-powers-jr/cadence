import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 353 (353-01, T3): CLAUDE.md names the test typecheck and core's
// ratchet; ROADMAP and MILESTONES record the phase.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

function section(md: string, heading: string): string {
  const start = md.indexOf(`\n${heading}`);
  if (start < 0) return '';
  const next = md.indexOf('\n## ', start + heading.length + 1);
  return next < 0 ? md.slice(start) : md.slice(start, next);
}

describe('test typecheck docs (phase 353)', () => {
  const claude = read('CLAUDE.md');

  it('353-01/AC-5: the Common commands typecheck line covers src and tests', () => {
    expect(claude.split('\n')).toContain('pnpm typecheck            # tsc --noEmit over src and tests, all packages');
  });

  it('353-01/AC-5: Enforcement layers names tsconfig.test.json and the ratchet test', () => {
    const layers = section(claude, '## Enforcement layers');
    expect(layers).toContain('tsconfig.test.json');
    expect(layers).toContain('packages/core/tests/docs/test-typecheck-ratchet.test.ts');
  });

  it('353-01/AC-6: ROADMAP and MILESTONES record phase 353', () => {
    expect(read('.cadence/ROADMAP.md').split('\n').some((l) => l.startsWith('### Phase 353'))).toBe(true);
    expect(read('.cadence/MILESTONES.md').split('\n').some((l) => l.startsWith('- **Phase 353**'))).toBe(true);
  });
});
