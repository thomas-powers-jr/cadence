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
