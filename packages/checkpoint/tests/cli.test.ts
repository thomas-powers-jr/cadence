import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const CLI = join(__dirname, '..', 'bin', 'checkpoint.cjs');

function run(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout, stderr: e.stderr };
  }
}

describe('checkpoint validate CLI', () => {
  it('exits 0 on a valid handoff', () => {
    const result = run(['validate', join(__dirname, 'fixtures', 'valid.md')]);
    expect(result.status).toBe(0);
  });

  it('exits 2 and prints diagnostics on stderr for an invalid handoff', () => {
    const result = run(['validate', join(__dirname, 'fixtures', 'ac-empty.md')]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('AC_LIST_EMPTY');
  });

  it('316-01/AC-1 (real v1 half): exits 0 on the tracked 2026-09-22 SESSION doc copied verbatim', () => {
    const result = run(['validate', join(__dirname, 'fixtures', 'real-v1-session-2026-09-22.md')]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('316-01/AC-2: exits 2 with a single HANDOFF_VERSION_UNSUPPORTED line for an unsupported cadence_handoff version', () => {
    const result = run(['validate', join(__dirname, 'fixtures', 'version-unsupported.md')]);
    expect(result.status).toBe(2);
    const lines = result.stderr.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('HANDOFF_VERSION_UNSUPPORTED');
  });

  it('exits 2 with NON_UTF8_INPUT for genuinely invalid UTF-8 bytes', () => {
    const result = run(['validate', join(__dirname, 'fixtures', 'non-utf8.md')]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('NON_UTF8_INPUT');
  });
});
