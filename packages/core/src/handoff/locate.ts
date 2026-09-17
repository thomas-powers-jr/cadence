// packages/core/src/handoff/locate.ts
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface LocatedHandoff {
  path: string;
  content: string;
  generatedAt: string | null;
  loopPosition: string | null;
  /** Set only when `lastHandoff` named a file that no longer exists and the
   *  code fell back to the freshest-by-`generated_at` glob. Holds the
   *  missing pointer's filename (not its full path). Absent on every other
   *  path — including when `lastHandoff` is `null` or names a file that
   *  does exist. */
  danglingPointer?: string;
  /** Set only when `lastHandoff` named a file that *does* exist on disk but
   *  a different, strictly-fresher-or-tie-winning candidate was returned
   *  instead. Holds the superseded pointer's filename (not its full path).
   *  Absent on every other path — including when `lastHandoff` is `null`,
   *  names a file that does not exist (see `danglingPointer`), or names the
   *  winning candidate itself. */
  supersededPointer?: string;
}

function handoffDir(root: string): string {
  return join(root, '.cadence', 'handoff');
}

export function readKey(content: string, key: string): string | null {
  // [ \t]* (not \s*) so an empty value doesn't let the match spill across the
  // newline and capture the following line's content instead of "".
  const m = content.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  const v = m?.[1]?.trim();
  return v ? v : null;
}

/** Resolve the freshest SESSION doc. Ranks `lastHandoff` (when its file
 *  exists) against every `SESSION-*.md` doc in the dir by generated_at →
 *  filename date → mtime, breaking ties in the pointer's favor; otherwise
 *  (no pointer, or a dangling one) ranks the glob alone the same way. */
export async function locateFreshestHandoff(
  root: string,
  lastHandoff: string | null,
): Promise<LocatedHandoff | null> {
  const dir = handoffDir(root);
  let danglingPointer: string | undefined;
  let pointerExists = false;
  if (lastHandoff) {
    const pointer = join(dir, lastHandoff);
    if (existsSync(pointer)) {
      pointerExists = true;
    } else {
      danglingPointer = lastHandoff;
    }
  }
  if (!existsSync(dir)) return null;

  const globNames = (await readdir(dir)).filter((n) => /^SESSION-.*\.md$/.test(n));
  const nameSet = new Set(globNames);
  // Union in the pointer's own filename even when it fails the SESSION-*.md
  // glob (e.g. a custom-labeled doc) or was already present from the glob —
  // the Set dedupes either way, and the pointer must never be silently
  // dropped from candidacy just because it doesn't match the regex.
  if (pointerExists && lastHandoff) nameSet.add(lastHandoff);
  const names = [...nameSet];
  if (names.length === 0) return null;

  const ranked = await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      const content = await readFile(path, 'utf8');
      const generatedAt = readKey(content, 'generated_at');
      const fileDate = name.match(/SESSION-(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
      const mtimeMs = (await stat(path)).mtimeMs;
      const key = generatedAt ?? fileDate ?? '';
      return { name, path, content, generatedAt, key, mtimeMs };
    }),
  );

  ranked.sort((a, b) => {
    if (a.key !== b.key) return a.key < b.key ? 1 : -1; // desc
    // Same key: the pointer's file wins the tie before mtime ever decides.
    if (pointerExists) {
      if (a.name === lastHandoff) return -1;
      if (b.name === lastHandoff) return 1;
    }
    return b.mtimeMs - a.mtimeMs; // newer mtime first
  });

  const top = ranked[0];
  if (!top) return null;
  const supersededPointer =
    pointerExists && lastHandoff && top.name !== lastHandoff ? lastHandoff : undefined;
  return {
    path: top.path,
    content: top.content,
    generatedAt: top.generatedAt,
    loopPosition: readKey(top.content, 'loop_position'),
    ...(danglingPointer !== undefined ? { danglingPointer } : {}),
    ...(supersededPointer !== undefined ? { supersededPointer } : {}),
  };
}
