import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changesetEvidencePresent } from './changeset-evidence.js';

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
