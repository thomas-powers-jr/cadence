import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Phase 349 (349-01, AC-5): the host-hook liveness behavior is documented —
 * DESIGN.md §11 names the `lastHookEventAt` stamp, config.md's skillAudit
 * section names `hooksObserved`, and commands.md documents the doctor
 * `host-hooks-liveness` check and the `state load` reset of `lastHookEventAt`.
 */

// packages/core/tests/docs → ../../../../<asset>
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

describe('phase 349 host-hook liveness docs', () => {
  it('349-01/AC-5: DESIGN.md documents the lastHookEventAt stamp', () => {
    expect(read('DESIGN.md')).toContain('lastHookEventAt');
  });

  it('349-01/AC-5: docs/reference/config.md documents hooksObserved', () => {
    expect(read('docs', 'reference', 'config.md')).toContain('hooksObserved');
  });

  it('349-01/AC-5: docs/reference/commands.md documents host-hooks-liveness and lastHookEventAt', () => {
    const md = read('docs', 'reference', 'commands.md');
    expect(md).toContain('host-hooks-liveness');
    expect(md).toContain('lastHookEventAt');
  });
});
