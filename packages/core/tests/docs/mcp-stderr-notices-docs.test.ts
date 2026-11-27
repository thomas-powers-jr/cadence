import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 356 (356-01, T3): docs/mcp.md says stderr notices arrive as a second
// text item; a patch changeset ships it; the records name the phase.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

function toolsSlice(): string {
  const md = read('docs/mcp.md');
  const start = md.indexOf('## Tools');
  const end = md.indexOf('## Resources', start);
  return md.slice(start, end).replace(/\s+/g, ' ');
}

describe('MCP stderr notices docs (phase 356)', () => {
  it('356-01/AC-5: the Tools section says notices follow as a second text item', () => {
    expect(toolsSlice()).toContain('second text item');
  });

  it('356-01/AC-5: the changeset bumps core by patch', () => {
    expect(read('.changeset/mcp-stderr-notices.md')).toMatch(
      /^---\r?\n"@thomas-powers-jr\/cadence-core": patch\r?\n---\r?\n/,
    );
  });

  it('356-01/AC-6: ROADMAP and MILESTONES record phase 356', () => {
    expect(read('.cadence/ROADMAP.md').split('\n').some((l) => l.startsWith('### Phase 356'))).toBe(true);
    expect(read('.cadence/MILESTONES.md').split('\n').some((l) => l.startsWith('- **Phase 356**'))).toBe(true);
  });
});
