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
});
