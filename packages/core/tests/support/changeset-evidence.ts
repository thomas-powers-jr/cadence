import { existsSync, readFileSync } from 'node:fs';

export interface ChangesetEvidenceInput {
  /** Absolute path to the changeset markdown file (e.g. `.changeset/<slug>.md`). */
  changesetPath: string;
  /** The npm package name expected to be named inside the changeset file. */
  changesetPackage: string;
  /** Absolute path to the package's CHANGELOG.md that would carry the consumed entry. */
  changelogPath: string;
  /** A phrase unique to this fix's changeset/changelog entry. */
  discriminator: string;
}

/**
 * Proves a fix carries release evidence even after `changeset version` has
 * deleted the source `.changeset/*.md` file on release day.
 *
 * Pure: no logic duplicated at call sites. Checks, in order:
 *   1. The changeset file still exists and names `changesetPackage` — true.
 *   2. Otherwise, the changelog exists and contains `discriminator` — true
 *      (this is the post-release-consumption path).
 *   3. Otherwise — false.
 */
export function changesetEvidencePresent({
  changesetPath,
  changesetPackage,
  changelogPath,
  discriminator,
}: ChangesetEvidenceInput): boolean {
  if (existsSync(changesetPath)) {
    const changesetContents = readFileSync(changesetPath, 'utf8');
    if (changesetContents.includes(changesetPackage)) {
      return true;
    }
  }

  if (existsSync(changelogPath)) {
    const changelogContents = readFileSync(changelogPath, 'utf8');
    if (changelogContents.includes(discriminator)) {
      return true;
    }
  }

  return false;
}

export type ChangeType = 'major' | 'minor' | 'patch';

export interface ChangelogEntry {
  /** The `## <version>` heading the entry sits under. */
  version: string;
  /** Read from the enclosing `### Major|Minor|Patch Changes` heading. */
  changeType: ChangeType;
  /** The one bullet: its `- ` line plus every indented continuation line. */
  body: string;
}

const CHANGE_TYPE_HEADING = /^### (Major|Minor|Patch) Changes\s*$/;

/**
 * Finds every bullet entry in a changesets-generated CHANGELOG.md whose text
 * contains `discriminator` — the post-consumption form of a changeset, which
 * `changeset version` deletes after writing its body here.
 *
 * Pure. An entry starts at a column-0 `- ` line under both a `## <version>`
 * and a `### <Type> Changes` heading, and runs through the blank and indented
 * lines after it; any other column-0 line ends it. Text outside such a bullet
 * (titles, release prose) never matches.
 */
export function findChangelogEntries(changelogText: string, discriminator: string): ChangelogEntry[] {
  // An empty discriminator would match every entry and make callers' fallbacks hollow.
  if (discriminator === '') return [];
  const entries: ChangelogEntry[] = [];
  let version: string | undefined;
  let changeType: ChangeType | undefined;
  let current: { version: string; changeType: ChangeType; lines: string[] } | undefined;

  const close = (): void => {
    if (current === undefined) return;
    const body = current.lines.join('\n').trimEnd();
    if (body.includes(discriminator)) {
      entries.push({ version: current.version, changeType: current.changeType, body });
    }
    current = undefined;
  };

  for (const line of changelogText.split(/\r?\n/)) {
    if (current !== undefined && (line.trim() === '' || /^\s/.test(line))) {
      current.lines.push(line);
      continue;
    }
    close();

    const versionHeading = /^## (\S+)/.exec(line);
    if (versionHeading) {
      version = versionHeading[1];
      changeType = undefined;
      continue;
    }
    if (line.startsWith('#')) {
      const typeHeading = CHANGE_TYPE_HEADING.exec(line);
      changeType = typeHeading?.[1] === undefined ? undefined : (typeHeading[1].toLowerCase() as ChangeType);
      continue;
    }
    if (line.startsWith('- ') && version !== undefined && changeType !== undefined) {
      current = { version, changeType, lines: [line] };
    }
  }
  close();

  return entries;
}

export interface PackageChangelog {
  packageName: string;
  text: string;
}

export interface SynthesizedChangeset {
  /** One `"<packageName>": <changeType>` line per matching entry, in package order. */
  frontmatter: string[];
  /** The matching entries' text, blank-line separated; empty when nothing matched. */
  body: string;
  matchCount: number;
}

/**
 * Rebuilds a consumed changeset's `{ frontmatter, body }` from the published
 * packages' CHANGELOG.md texts, so a test written against the changeset file
 * can assert the same facts after `changeset version` deleted it.
 *
 * Pure. No match yields empty frontmatter, so an exact-equality assertion on
 * the frontmatter fails rather than passing vacuously.
 */
export function synthesizeConsumedChangeset(
  changelogs: readonly PackageChangelog[],
  discriminator: string,
): SynthesizedChangeset {
  const frontmatter: string[] = [];
  const bodies: string[] = [];
  for (const { packageName, text } of changelogs) {
    for (const entry of findChangelogEntries(text, discriminator)) {
      frontmatter.push(`"${packageName}": ${entry.changeType}`);
      bodies.push(entry.body);
    }
  }
  return { frontmatter, body: bodies.join('\n\n'), matchCount: frontmatter.length };
}
