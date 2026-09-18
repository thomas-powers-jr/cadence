import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../../..');
const SKILLS_ROOT = join(REPO_ROOT, '.claude/skills');
const SKILL_DIR = join(SKILLS_ROOT, 'systematic-debugging');
const SKILL_PATH = join(SKILL_DIR, 'SKILL.md');

describe('313-01 — systematic-debugging skill is discoverable', () => {
  it('313-01/AC-6: the skill lives at the expected path with frontmatter the Skill tool can resolve', async () => {
    // Correct path: derive the directory from an independent listing of
    // `.claude/skills` rather than comparing the hardcoded path constant to
    // itself — this is the part of the claim that "the file lives at the
    // expected path" actually needs to prove.
    const entries = await readdir(SKILLS_ROOT, { withFileTypes: true });
    expect(entries.some((e) => e.isDirectory() && e.name === 'systematic-debugging')).toBe(true);

    const skill = await readFile(SKILL_PATH, 'utf8');

    // Valid frontmatter carrying both fields the Skill tool needs.
    expect(skill.startsWith('---\n')).toBe(true);
    const nameMatch = /^name: (.+)$/m.exec(skill);
    const descriptionMatch = /^description: (.+)$/m.exec(skill);
    expect(nameMatch?.[1]).toBeDefined();
    expect(descriptionMatch?.[1]).toBeDefined();

    // The frontmatter `name` must match the directory exactly — a mismatch
    // is exactly the kind of thing that makes a skill unreachable by its
    // bare name.
    expect(nameMatch?.[1]).toBe(basename(SKILL_DIR));
  });
});
