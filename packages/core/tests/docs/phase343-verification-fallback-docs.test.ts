import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CadenceConfigZ, defaultConfig } from '@thomas-powers-jr/cadence-types';
import { VERIFIER_SEAMS } from '../../src/activate/assess.js';

// 343-01 (phase 343) — `verification.fallback: "mock" | "refuse"`. The config
// reference documents the key, its values, its default, the seven seams it
// governs and the bypass flags that still apply; providers.md gains a
// "Refusing instead of falling back" section; the commands reference's doctor
// check table lists the new `verification-fallback` check. Values and seam
// names are derived from code truth, not hardcoded.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const configMd = readFileSync(join(ROOT, 'docs', 'reference', 'config.md'), 'utf8');
const providersMd = readFileSync(join(ROOT, 'docs', 'providers.md'), 'utf8');
const commandsMd = readFileSync(join(ROOT, 'docs', 'reference', 'commands.md'), 'utf8');

/** Slice from `start` to the first `end` after it; '' when either is missing. */
function slice(md: string, start: string, end: string): string {
  const from = md.indexOf(start);
  if (from < 0) return '';
  const to = md.indexOf(end, from + start.length);
  return to > from ? md.slice(from, to) : '';
}

/** Collapse line wrapping so a phrase split across lines still matches. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** The `verification.fallback` enum's options, read from the live schema. */
function fallbackValues(): string[] {
  const verification = CadenceConfigZ.shape.verification.unwrap();
  const fallback = verification.shape.fallback.unwrap();
  return [...fallback.options];
}

const fallbackSection = flat(slice(configMd, '\n### Verification fallback\n', '\n## '));
const fallbackRow = configMd.split(/\r?\n/).find((line) => line.startsWith('| `verification.fallback` |')) ?? '';
const providersSection = flat(slice(providersMd, '\n## Refusing instead of falling back\n', '\n## '));

describe('docs: verification.fallback (343-01)', () => {
  it('343-01/AC-6: the schema enum is exactly mock | refuse and the key is absent by default (code truth)', () => {
    expect(fallbackValues().sort()).toEqual(['mock', 'refuse']);
    const parsed = CadenceConfigZ.parse(defaultConfig);
    expect(parsed.verification.fallback).toBeUndefined();
    expect('fallback' in defaultConfig.verification).toBe(false);
  });

  it('343-01/AC-6: config.md has a verification.fallback field row naming every schema value and the mock default', () => {
    expect(fallbackRow).not.toBe('');
    for (const value of fallbackValues()) {
      expect(fallbackRow).toContain(`\`"${value}"\``);
    }
    expect(fallbackRow).toMatch(/absent, which behaves as `"mock"`/);
    expect(fallbackRow).toMatch(/`cadence init` does not write the key/);
  });

  it('343-01/AC-6: config.md\'s Verification fallback section names both values, the default and all seven verifier seams', () => {
    expect(fallbackSection).not.toBe('');
    expect(fallbackSection).toContain('verification.fallback');
    for (const value of fallbackValues()) {
      expect(fallbackSection).toContain(`\`"${value}"\``);
    }
    expect(fallbackSection).toMatch(/behavior when the key is absent, which is the default/);
    expect(VERIFIER_SEAMS).toHaveLength(7);
    expect(fallbackSection).toMatch(/all seven verifier seams/);
    for (const seam of VERIFIER_SEAMS) {
      expect(fallbackSection).toContain(`| \`${seam}\` |`);
    }
  });

  it('343-01/AC-6: config.md says refusal is lazy and an explicitly configured mock is unaffected', () => {
    expect(fallbackSection).toMatch(/Refusal is lazy/);
    expect(fallbackSection).toMatch(/explicit `mock` is a choice, not a fallback/);
  });

  it('343-01/AC-6: config.md names the bypass flags that still apply and says the other four seams have no bypass', () => {
    for (const flag of [
      '--allow-verifier-failure',
      '--allow-code-review-failure',
      '--allow-security-audit-failure',
      '--force',
    ]) {
      expect(fallbackSection).toContain(`\`${flag}\``);
    }
    expect(fallbackSection).toMatch(
      /`per-task-verify`, `plan-review`, `spec-review`, `ui-spec-review`\) have no gate failure path[^.]*no flag bypasses it/,
    );
    // The per-seam flags that do NOT bypass a refused call must not be offered as a bypass here.
    expect(fallbackSection).not.toContain('--allow-per-task-failure');
    expect(fallbackSection).not.toContain('--allow-plan-review-failure');
  });

  it('343-01/AC-6: providers.md has a Refusing instead of falling back section naming the key and both values', () => {
    expect(providersSection).not.toBe('');
    expect(providersMd).toContain('- [Refusing instead of falling back](#refusing-instead-of-falling-back)');
    expect(providersSection).toContain('verification.fallback');
    for (const value of fallbackValues()) {
      expect(providersSection).toContain(`"${value}"`);
    }
    expect(providersSection).toMatch(/verification\.fallback is refuse/);
    expect(providersSection).toMatch(/must never settle on a mock by accident/);
  });

  it('343-01/AC-6: commands.md doctor table lists verification-fallback as never (info), and not in the --fix table', () => {
    const lines = commandsMd.split(/\r?\n/);
    const row = lines.find((line) => line.startsWith('| `verification-fallback` |')) ?? '';
    expect(row).not.toBe('');
    expect(row).toMatch(/\| never \(info\) \|$/);
    expect(row).toContain('verification.fallback');
    const fixRows = lines.filter((line) => /^\| \*\*(auto|wire-host|manual)\*\* \|/.test(line));
    expect(fixRows.length).toBeGreaterThan(0);
    for (const fixRow of fixRows) {
      expect(fixRow).not.toContain('`verification-fallback`');
    }
  });

  it('343-01/AC-6: commands.md verification-readiness row notes the refuse wording under verification.fallback "refuse"', () => {
    const row = commandsMd.split(/\r?\n/).find((line) => line.startsWith('| `verification-readiness` |')) ?? '';
    expect(row).not.toBe('');
    expect(row).toMatch(/\*\(phase 343\)\*[^|]*verification\.fallback: "refuse"[^|]*will refuse[^|]*instead of falling back to mock/);
  });
});
