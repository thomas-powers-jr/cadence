import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  changesetEvidencePresent,
  findChangelogEntries,
  synthesizeConsumedChangeset,
} from './changeset-evidence.js';

describe('changesetEvidencePresent', () => {
  it('303-01/AC-1: returns true when the changeset file exists and names the package', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cadence-changeset-evidence-'));
    try {
      const changesetPath = join(dir, 'some-fix.md');
      await writeFile(
        changesetPath,
        '---\n"@thomas-powers-jr/cadence-core": patch\n---\n\nFix: something.\n',
        'utf8',
      );
      const changelogPath = join(dir, 'CHANGELOG.md');

      const result = changesetEvidencePresent({
        changesetPath,
        changesetPackage: '@thomas-powers-jr/cadence-core',
        changelogPath,
        discriminator: 'never seen',
      });

      expect(result).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('303-01/AC-1: returns true when the changeset file has been deleted but CHANGELOG.md contains the discriminator (post-release consumption)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cadence-changeset-evidence-'));
    try {
      // changesetPath is never created — simulates `changeset version` having deleted it.
      const changesetPath = join(dir, 'some-fix.md');
      const changelogPath = join(dir, 'CHANGELOG.md');
      await writeFile(
        changelogPath,
        '## 1.68.0\n\n### Patch Changes\n\n- abc1234: Fix: a very specific discriminator phrase that only this fix uses.\n',
        'utf8',
      );

      const result = changesetEvidencePresent({
        changesetPath,
        changesetPackage: '@thomas-powers-jr/cadence-core',
        changelogPath,
        discriminator: 'a very specific discriminator phrase that only this fix uses',
      });

      expect(result).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('303-01/AC-2: returns false when neither the changeset file nor a matching CHANGELOG.md entry exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cadence-changeset-evidence-'));
    try {
      const changesetPath = join(dir, 'some-fix.md');
      const changelogPath = join(dir, 'CHANGELOG.md');
      await writeFile(
        changelogPath,
        '## 1.68.0\n\n### Patch Changes\n\n- abc1234: An unrelated fix.\n',
        'utf8',
      );

      const result = changesetEvidencePresent({
        changesetPath,
        changesetPackage: '@thomas-powers-jr/cadence-core',
        changelogPath,
        discriminator: 'a very specific discriminator phrase that only this fix uses',
      });

      expect(result).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('303-01/AC-2: returns false when nothing exists at all (no changeset file, no CHANGELOG.md)', () => {
    const missingDir = join(tmpdir(), 'cadence-changeset-evidence-missing-dir');

    const result = changesetEvidencePresent({
      changesetPath: join(missingDir, 'nonexistent.md'),
      changesetPackage: '@thomas-powers-jr/cadence-core',
      changelogPath: join(missingDir, 'CHANGELOG.md'),
      discriminator: 'whatever',
    });

    expect(result).toBe(false);
  });
});

// A changesets-generated CHANGELOG.md in the shape `changeset version` writes:
// `## <version>`, a `### <Type> Changes` subsection, `- <sha>: ` bullets whose
// continuation paragraphs, sub-bullets and dependency lines are indented.
const RELEASE_SHAPED_CORE = [
  '# @thomas-powers-jr/cadence-core',
  '',
  '## 1.69.1',
  '',
  '### Patch Changes',
  '',
  '- d6f5c5f: Security: first paragraph of the bumped dependency fix.',
  '',
  '  - `GHSA-aaaa-bbbb-cccc` (high, a nested sub-bullet of the same entry).',
  '',
  '  Second paragraph carrying the fixture discriminator phrase for this entry.',
  '',
  '- 0160f4d: An unrelated release-workflow fix.',
  '  - @thomas-powers-jr/cadence-types@1.69.1',
  '',
  '## 1.69.0',
  '',
  '### Minor Changes',
  '',
  '- 1234567: An older minor feature.',
  '',
  '### Major Changes',
  '',
  '- 89abcde: A breaking change from long ago.',
  '',
].join('\n');

const DEPENDENCY_ONLY = [
  '# @thomas-powers-jr/cadence-host-codex',
  '',
  '## 1.69.1',
  '',
  '### Patch Changes',
  '',
  '- Updated dependencies [d6f5c5f]',
  '- Updated dependencies [0160f4d]',
  '  - @thomas-powers-jr/cadence-core@1.69.1',
  '',
].join('\n');

const FIXTURE_DISCRIMINATOR = 'the fixture discriminator phrase for this entry';

describe('findChangelogEntries', () => {
  it('325-01/AC-1: returns the patch entry containing the discriminator, with its indented sub-bullet and continuation paragraph', () => {
    const entries = findChangelogEntries(RELEASE_SHAPED_CORE, FIXTURE_DISCRIMINATOR);

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.version).toBe('1.69.1');
    expect(entry?.changeType).toBe('patch');
    expect(entry?.body).toContain('Security: first paragraph of the bumped dependency fix.');
    expect(entry?.body).toContain('GHSA-aaaa-bbbb-cccc');
    expect(entry?.body).toContain(FIXTURE_DISCRIMINATOR);
    expect(entry?.body).not.toContain('An unrelated release-workflow fix.');
  });

  it('325-01/AC-1: keeps an entry to its own bullet when a neighbour in the same subsection does not match', () => {
    const entries = findChangelogEntries(RELEASE_SHAPED_CORE, 'An unrelated release-workflow fix.');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.body).toContain('@thomas-powers-jr/cadence-types@1.69.1');
    expect(entries[0]?.body).not.toContain('Security:');
    expect(entries[0]?.body).not.toContain('## 1.69.0');
  });

  it('325-01/AC-1: reads the change type from the enclosing Minor and Major Changes headings', () => {
    expect(findChangelogEntries(RELEASE_SHAPED_CORE, 'An older minor feature.')).toEqual([
      { version: '1.69.0', changeType: 'minor', body: '- 1234567: An older minor feature.' },
    ]);
    expect(findChangelogEntries(RELEASE_SHAPED_CORE, 'A breaking change from long ago.')).toEqual([
      { version: '1.69.0', changeType: 'major', body: '- 89abcde: A breaking change from long ago.' },
    ]);
  });

  it('325-01/AC-1: returns every matching entry when the discriminator appears under two versions', () => {
    const text = [
      '## 1.70.0',
      '',
      '### Patch Changes',
      '',
      '- 1111111: Follow-up that repeats the shared phrase.',
      '',
      '## 1.69.1',
      '',
      '### Patch Changes',
      '',
      '- 2222222: Original that introduced the shared phrase.',
      '',
    ].join('\n');

    const entries = findChangelogEntries(text, 'the shared phrase');

    expect(entries.map((entry) => entry.version)).toEqual(['1.70.0', '1.69.1']);
  });

  it('325-01/AC-3: returns an empty array when no entry contains the discriminator', () => {
    expect(findChangelogEntries(RELEASE_SHAPED_CORE, 'a phrase no changelog entry carries')).toEqual([]);
  });

  it('325-01/AC-3: returns an empty array for an empty discriminator rather than matching every entry', () => {
    expect(findChangelogEntries(RELEASE_SHAPED_CORE, '')).toEqual([]);
  });

  it('325-01/AC-3: ignores the discriminator when it appears only in prose outside a Changes bullet', () => {
    const text = [
      '# Title mentioning the lonely phrase',
      '',
      '## 1.0.0',
      '',
      'Release prose mentioning the lonely phrase.',
      '',
      '### Patch Changes',
      '',
      '- 3333333: Something else entirely.',
      '',
      'Column-zero prose after the bullet, also mentioning the lonely phrase.',
      '',
    ].join('\n');

    expect(findChangelogEntries(text, 'the lonely phrase')).toEqual([]);
  });
});

describe('synthesizeConsumedChangeset', () => {
  it('325-01/AC-2: release-shaped core text plus dependency-only package texts synthesizes cadence-core alone, as a patch', () => {
    const result = synthesizeConsumedChangeset(
      [
        { packageName: '@thomas-powers-jr/cadence-core', text: RELEASE_SHAPED_CORE },
        { packageName: '@thomas-powers-jr/cadence-types', text: '# @thomas-powers-jr/cadence-types\n\n## 1.69.1\n' },
        { packageName: '@thomas-powers-jr/cadence-host-codex', text: DEPENDENCY_ONLY },
      ],
      FIXTURE_DISCRIMINATOR,
    );

    expect(result.frontmatter).toEqual(['"@thomas-powers-jr/cadence-core": patch']);
    expect(result.matchCount).toBe(1);
    expect(result.body).toContain(FIXTURE_DISCRIMINATOR);
    expect(result.body).toContain('GHSA-aaaa-bbbb-cccc');
  });

  it('325-01/AC-2: names one frontmatter line per matching package when two packages carry the entry', () => {
    const result = synthesizeConsumedChangeset(
      [
        { packageName: '@thomas-powers-jr/cadence-core', text: RELEASE_SHAPED_CORE },
        {
          packageName: '@thomas-powers-jr/cadence-types',
          text: `## 1.69.1\n\n### Minor Changes\n\n- d6f5c5f: Also here: ${FIXTURE_DISCRIMINATOR}.\n`,
        },
      ],
      FIXTURE_DISCRIMINATOR,
    );

    expect(result.frontmatter).toEqual([
      '"@thomas-powers-jr/cadence-core": patch',
      '"@thomas-powers-jr/cadence-types": minor',
    ]);
    expect(result.matchCount).toBe(2);
  });

  it('325-01/AC-3: synthesizes empty frontmatter, an empty body and matchCount 0 when no package carries the entry', () => {
    const result = synthesizeConsumedChangeset(
      [
        { packageName: '@thomas-powers-jr/cadence-core', text: RELEASE_SHAPED_CORE },
        { packageName: '@thomas-powers-jr/cadence-host-codex', text: DEPENDENCY_ONLY },
      ],
      'a phrase no changelog entry carries',
    );

    expect(result).toEqual({ frontmatter: [], body: '', matchCount: 0 });
  });
});
