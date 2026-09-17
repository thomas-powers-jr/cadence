// packages/core/tests/handoff/locate.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import { locateFreshestHandoff } from '../../src/handoff/locate.js';

let active: Fixture | null = null;
afterEach(async () => { if (active) { await active.cleanup(); active = null; } });

async function writeSession(root: string, name: string, generatedAt: string, loopPosition = 'IDLE'): Promise<void> {
  const dir = join(root, '.cadence', 'handoff');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name),
    `---\ncadence_handoff: 1\ngenerated_at: ${generatedAt}\nloop_position: ${loopPosition}\n---\n# x\n`);
}

// No generated_at line at all -- used by 309-01/AC-3 to prove a pointer
// target with neither a parseable generated_at nor a SESSION-YYYY-MM-DD
// filename date still participates in ranking instead of vanishing.
async function writeSessionNoKey(root: string, name: string, loopPosition = 'IDLE'): Promise<void> {
  const dir = join(root, '.cadence', 'handoff');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name),
    `---\ncadence_handoff: 1\nloop_position: ${loopPosition}\n---\n# x\n`);
}

describe('locateFreshestHandoff', () => {
  it('AC-9: returns null when the handoff dir is empty', async () => {
    active = await tempRepo({ initialized: true });
    expect(await locateFreshestHandoff(active.root, null)).toBeNull();
  });

  it('AC-10: picks the newest by generated_at when no pointer is given', async () => {
    active = await tempRepo({ initialized: true });
    await writeSession(active.root, 'SESSION-2026-06-01.md', '2026-06-01T10:00:00.000Z');
    await writeSession(active.root, 'SESSION-2026-06-03.md', '2026-06-03T10:00:00.000Z', 'BUILD');
    const found = await locateFreshestHandoff(active.root, null);
    expect(found?.path.endsWith('SESSION-2026-06-03.md')).toBe(true);
    expect(found?.loopPosition).toBe('BUILD');
  });

  it('AC-11: honors the lastHandoff pointer when it names the freshest doc', async () => {
    active = await tempRepo({ initialized: true });
    await writeSession(active.root, 'SESSION-2026-06-01.md', '2026-06-01T10:00:00.000Z');
    await writeSession(active.root, 'SESSION-2026-06-03.md', '2026-06-03T10:00:00.000Z');
    const found = await locateFreshestHandoff(active.root, 'SESSION-2026-06-03.md');
    expect(found?.path.endsWith('SESSION-2026-06-03.md')).toBe(true);
  });

  it('AC-12: falls back to globbing when the pointer file is missing', async () => {
    active = await tempRepo({ initialized: true });
    await writeSession(active.root, 'SESSION-2026-06-03.md', '2026-06-03T10:00:00.000Z');
    const found = await locateFreshestHandoff(active.root, 'SESSION-gone.md');
    expect(found?.path.endsWith('SESSION-2026-06-03.md')).toBe(true);
  });

  // Phase 273 task 1: the pre-existing AC-12 test above proves the fallback
  // *ranking* is correct, but asserts nothing about the fact that a fallback
  // happened at all. Today `LocatedHandoff` carries no field distinguishing
  // "resume served the pointer's actual target" from "resume silently
  // guessed via fallback because the pointer was broken" — this test proves
  // that gap. `danglingPointer` is the field name T2 (phase 273-01) is
  // expected to add.
  it('273-01/AC-1: exposes which pointer target was missing when lastHandoff names a nonexistent SESSION doc', async () => {
    active = await tempRepo({ initialized: true });
    await writeSession(active.root, 'SESSION-2026-06-03.md', '2026-06-03T10:00:00.000Z');
    const found = await locateFreshestHandoff(active.root, 'SESSION-does-not-exist.md');
    // The fallback ranking itself still works (same assertion as AC-12).
    expect(found?.path.endsWith('SESSION-2026-06-03.md')).toBe(true);
    // The gap: nothing today records that the pointer was dangling.
    expect((found as { danglingPointer?: string } | null)?.danglingPointer).toBe(
      'SESSION-does-not-exist.md',
    );
  });

  // 273-01/AC-2: the new field must stay absent on both normal resolution
  // paths — no pointer given, and a pointer that names a file that exists.
  it('273-01/AC-2: danglingPointer is absent when lastHandoff is null', async () => {
    active = await tempRepo({ initialized: true });
    await writeSession(active.root, 'SESSION-2026-06-03.md', '2026-06-03T10:00:00.000Z');
    const found = await locateFreshestHandoff(active.root, null);
    expect(found?.path.endsWith('SESSION-2026-06-03.md')).toBe(true);
    expect((found as { danglingPointer?: string } | null)?.danglingPointer).toBeUndefined();
    expect(found && 'danglingPointer' in found).toBe(false);
  });

  it('273-01/AC-2: danglingPointer is absent when lastHandoff names a file that exists', async () => {
    active = await tempRepo({ initialized: true });
    await writeSession(active.root, 'SESSION-2026-06-01.md', '2026-06-01T10:00:00.000Z');
    await writeSession(active.root, 'SESSION-2026-06-03.md', '2026-06-03T10:00:00.000Z');
    const found = await locateFreshestHandoff(active.root, 'SESSION-2026-06-03.md');
    expect(found?.path.endsWith('SESSION-2026-06-03.md')).toBe(true);
    expect((found as { danglingPointer?: string } | null)?.danglingPointer).toBeUndefined();
    expect(found && 'danglingPointer' in found).toBe(false);
  });

  // Phase 309 task 1: locateFreshestHandoff() currently returns the
  // lastHandoff pointer's file unconditionally whenever it exists on disk,
  // without ever comparing it against other SESSION-*.md docs in the same
  // dir. Since state.json (and therefore the pointer) is gitignored and
  // per-checkout, a newer SESSION doc can land (e.g. merged from another
  // branch/session) without the local pointer being rewritten, and resume
  // silently keeps serving the stale doc forever (rec-20260917-001). These
  // three tests prove the ranking gap; T2 (locate.ts) is expected to fix it.
  it('309-01/AC-1: stale pointer is superseded by a strictly newer doc', async () => {
    active = await tempRepo({ initialized: true });
    await writeSession(active.root, 'SESSION-2026-06-01.md', '2026-06-01T10:00:00.000Z');
    await writeSession(active.root, 'SESSION-2026-06-03.md', '2026-06-03T10:00:00.000Z');
    const found = await locateFreshestHandoff(active.root, 'SESSION-2026-06-01.md');
    // The bug: today this returns the pointer's (older) file unconditionally.
    expect(found?.path.endsWith('SESSION-2026-06-03.md')).toBe(true);
    expect((found as { supersededPointer?: string } | null)?.supersededPointer).toBe(
      'SESSION-2026-06-01.md',
    );
  });

  it('309-01/AC-2: a tied pointer wins over a doc with a newer mtime, not by mtime', async () => {
    active = await tempRepo({ initialized: true });
    const tie = '2026-06-03T10:00:00.000Z';
    await writeSession(active.root, 'SESSION-2026-06-03-a.md', tie);
    await writeSession(active.root, 'SESSION-2026-06-03-b.md', tie);
    const dir = join(active.root, '.cadence', 'handoff');
    // Force the sibling's mtime strictly newer than the pointer's file, so a
    // tie-break that (incorrectly) falls through to mtime would pick the
    // sibling instead of the pointer -- proving ties favor the pointer.
    await utimes(join(dir, 'SESSION-2026-06-03-a.md'), new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'));
    await utimes(join(dir, 'SESSION-2026-06-03-b.md'), new Date('2030-01-01T00:00:00.000Z'), new Date('2030-01-01T00:00:00.000Z'));
    const found = await locateFreshestHandoff(active.root, 'SESSION-2026-06-03-a.md');
    expect(found?.path.endsWith('SESSION-2026-06-03-a.md')).toBe(true);
    expect((found as { supersededPointer?: string } | null)?.supersededPointer).toBeUndefined();
  });

  it('309-01/AC-3: pointer file failing the SESSION-*.md glob is still a candidate, not silently dropped', async () => {
    active = await tempRepo({ initialized: true });
    // Deliberately NOT "SESSION-...": the underscore makes this fail the
    // /^SESSION-.*\.md$/ glob filter used to list fallback candidates, and
    // it has no generated_at frontmatter and no SESSION-YYYY-MM-DD date in
    // its name either. AC-3 requires the pointer's file still be considered
    // as a candidate rather than silently excluded -- do not "fix" this
    // filename to start with "SESSION-", that would delete the coverage.
    await writeSessionNoKey(active.root, 'SESSION_custom-label.md');
    await writeSession(active.root, 'SESSION-2026-06-03.md', '2026-06-03T10:00:00.000Z');
    const found = await locateFreshestHandoff(active.root, 'SESSION_custom-label.md');
    // The bug: today this returns the pointer's file unconditionally,
    // without ever comparing it to SESSION-2026-06-03.md.
    expect(found?.path.endsWith('SESSION-2026-06-03.md')).toBe(true);
    expect((found as { supersededPointer?: string } | null)?.supersededPointer).toBe(
      'SESSION_custom-label.md',
    );
  });
});
