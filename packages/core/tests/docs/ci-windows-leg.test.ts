import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the repo-root CI workflow from this test file's location:
// packages/core/tests/docs → ../../../../.github/workflows/ci.yml
const CI_YML = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'ci.yml',
);

// Phase 317-01 / AC-8: the `windows-latest` leg is where the PowerShell hook
// fixtures actually run, so the CI config itself must not be able to silently
// skip or soften that leg. No YAML parser is a dependency of core (js-yaml is
// only a root-level override target, not resolvable from this package), and
// adding one is out of bounds — so this is a focused, indentation-aware
// reader of just the `jobs.test` block. Comments are stripped before any
// matching so a commented-out key can neither satisfy nor trip a check.

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Strip a YAML comment: `#` at line start or preceded by whitespace. */
const stripComment = (line: string): string => {
  const m = /(^|\s)#/.exec(line);
  return m ? line.slice(0, m.index).trimEnd() : line.trimEnd();
};

const unquote = (s: string): string => s.trim().replace(/^(['"])(.*)\1$/, '$2');

/** Comment-stripped lines of `jobs.<name>` (header excluded), or null. */
function extractJobBlock(yml: string, name: string): string[] | null {
  const lines = yml.split(/\r?\n/).map(stripComment);
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsIdx === -1) return null;

  let childIndent = -1;
  for (let i = jobsIdx + 1; i < lines.length; i++) {
    const l = lines[i] ?? '';
    if (l.trim() === '') continue;
    childIndent = indentOf(l);
    break;
  }
  if (childIndent <= 0) return null;

  const header = new RegExp(`^ {${childIndent}}['"]?${name}['"]?:\\s*$`);
  for (let i = jobsIdx + 1; i < lines.length; i++) {
    const l = lines[i] ?? '';
    if (l.trim() === '') continue;
    if (indentOf(l) < childIndent) break; // left the jobs mapping
    if (!header.test(l)) continue;
    const block: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j] ?? '';
      if (b.trim() !== '' && indentOf(b) <= childIndent) break;
      block.push(b);
    }
    return block;
  }
  return null;
}

/** Values of `strategy.matrix.os` within a job block (flow or block list). */
function matrixOs(block: string[]): string[] | null {
  const matrixIdx = block.findIndex((l) => /^\s*matrix:\s*$/.test(l));
  if (matrixIdx === -1) return null;
  const matrixIndent = indentOf(block[matrixIdx] ?? '');
  for (let i = matrixIdx + 1; i < block.length; i++) {
    const l = block[i] ?? '';
    if (l.trim() === '') continue;
    if (indentOf(l) <= matrixIndent) break;
    const m = /^\s*os:\s*(.*)$/.exec(l);
    if (!m) continue;
    const rest = (m[1] ?? '').trim();
    if (rest.startsWith('[')) {
      return rest
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(unquote)
        .filter((v) => v !== '');
    }
    if (rest !== '') return [unquote(rest)];
    const osIndent = indentOf(l);
    const values: string[] = [];
    for (let j = i + 1; j < block.length; j++) {
      const item = block[j] ?? '';
      if (item.trim() === '') continue;
      if (indentOf(item) <= osIndent && !/^\s*-\s/.test(item)) break;
      const im = /^\s*-\s+(.*)$/.exec(item);
      if (!im) break;
      values.push(unquote(im[1] ?? ''));
    }
    return values;
  }
  return null;
}

/**
 * Every reason the CI config could silently skip or soften the Windows leg.
 * Empty array means the leg is guaranteed to run and to count.
 */
function checkWindowsLeg(yml: string): string[] {
  const block = extractJobBlock(yml, 'test');
  if (block === null) return ['test job not found'];

  const violations: string[] = [];
  const os = matrixOs(block);
  if (os === null) violations.push('test job has no strategy.matrix.os');
  else if (!os.includes('windows-latest')) {
    violations.push(`matrix.os lacks windows-latest (got: ${os.join(', ')})`);
  }

  const runsOn = block.find((l) => /^\s*runs-on:/.test(l));
  if (runsOn === undefined || !/\$\{\{\s*matrix\.os\s*\}\}/.test(runsOn)) {
    violations.push('test job runs-on does not use matrix.os');
  }

  const coe = block.filter((l) => /['"]?continue-on-error['"]?\s*:/.test(l));
  for (const l of coe) violations.push(`continue-on-error set: ${l.trim()}`);

  // An `if:` on the job or any of its steps, or a matrix `exclude:`, can skip
  // the Windows leg just as silently as continue-on-error can soften it.
  const conditions = block.filter((l) => /^\s*(-\s+)?['"]?if['"]?\s*:/.test(l));
  for (const l of conditions) violations.push(`if condition set: ${l.trim()}`);
  const excludes = block.filter((l) => /^\s*['"]?exclude['"]?\s*:/.test(l));
  for (const l of excludes) violations.push(`matrix exclude set: ${l.trim()}`);
  return violations;
}

describe('CI windows-latest leg cannot be silently skipped (317-01/AC-8)', () => {
  const yml = readFileSync(CI_YML, 'utf8');

  it('317-01/AC-8: the real ci.yml test job matrix includes windows-latest', () => {
    const block = extractJobBlock(yml, 'test');
    expect(block).not.toBeNull();
    expect(matrixOs(block ?? [])).toContain('windows-latest');
  });

  it('317-01/AC-8: the real ci.yml test job and its steps set no continue-on-error', () => {
    const block = extractJobBlock(yml, 'test');
    expect(block).not.toBeNull();
    expect((block ?? []).some((l) => l.includes('continue-on-error'))).toBe(false);
    // The block must actually contain the steps, or the check above is vacuous.
    expect((block ?? []).some((l) => /^\s*-\s+run:\s*pnpm test\s*$/.test(l))).toBe(true);
  });

  it('317-01/AC-8: the real ci.yml has no Windows-leg violations at all', () => {
    expect(checkWindowsLeg(yml)).toEqual([]);
  });

  // --- negative cases: the check must fail on mutated copies of the real file

  it('317-01/AC-8: flags windows-latest removed from the matrix', () => {
    const mutated = yml.replace(', windows-latest]', ']');
    expect(mutated).not.toBe(yml);
    const v = checkWindowsLeg(mutated);
    expect(v.some((s) => s.startsWith('matrix.os lacks windows-latest'))).toBe(true);
  });

  it('317-01/AC-8: flags a job-level continue-on-error: true', () => {
    const mutated = yml.replace(
      /^( {2}test:\r?\n)/m,
      '$1    continue-on-error: true\n',
    );
    expect(mutated).not.toBe(yml);
    const v = checkWindowsLeg(mutated);
    expect(v).toContain('continue-on-error set: continue-on-error: true');
  });

  it('317-01/AC-8: flags a step-level continue-on-error of any value (false)', () => {
    const mutated = yml.replace(
      /^( {6}- run: pnpm test)(\r?\n)/m,
      '$1$2        continue-on-error: false$2',
    );
    expect(mutated).not.toBe(yml);
    const v = checkWindowsLeg(mutated);
    expect(v).toContain('continue-on-error set: continue-on-error: false');
  });

  it('317-01/AC-8: flags a step that opens with - continue-on-error', () => {
    const mutated = yml.replace(
      /^( {6}- run: pnpm test)(\r?\n)/m,
      '      - continue-on-error: ${{ matrix.os == \'windows-latest\' }}$2        run: pnpm test$2',
    );
    expect(mutated).not.toBe(yml);
    expect(checkWindowsLeg(mutated).some((s) => s.startsWith('continue-on-error set:'))).toBe(true);
  });

  it('317-01/AC-8: fails (not passes) when the test job is renamed', () => {
    const mutated = yml.replace(/^ {2}test:(\r?\n)/m, '  tests:$1');
    expect(mutated).not.toBe(yml);
    expect(checkWindowsLeg(mutated)).toEqual(['test job not found']);
  });

  it('317-01/AC-8: flags an if: condition on the pnpm test step', () => {
    const mutated = yml.replace(
      /^( {6}- run: pnpm test)(\r?\n)/m,
      "$1$2        if: matrix.os != 'windows-latest'$2",
    );
    expect(mutated).not.toBe(yml);
    expect(checkWindowsLeg(mutated).some((s) => s.startsWith('if condition set:'))).toBe(true);
  });

  it('317-01/AC-8: flags a job-level if: condition', () => {
    const mutated = yml.replace(/^( {2}test:\r?\n)/m, "$1    if: github.event_name == 'push'\n");
    expect(mutated).not.toBe(yml);
    expect(checkWindowsLeg(mutated).some((s) => s.startsWith('if condition set:'))).toBe(true);
  });

  it('317-01/AC-8: flags a matrix exclude that could drop the windows leg', () => {
    const mutated = yml.replace(
      /^( +)node: \[22\](\r?\n)/m,
      '$1node: [22]$2$1exclude:$2$1  - os: windows-latest$2',
    );
    expect(mutated).not.toBe(yml);
    expect(checkWindowsLeg(mutated).some((s) => s.startsWith('matrix exclude set:'))).toBe(true);
  });

  it('317-01/AC-8: flags runs-on no longer driven by matrix.os', () => {
    const mutated = yml.replace('runs-on: ${{ matrix.os }}', 'runs-on: ubuntu-latest');
    expect(mutated).not.toBe(yml);
    expect(checkWindowsLeg(mutated)).toContain('test job runs-on does not use matrix.os');
  });

  it('317-01/AC-8: ignores commented-out keys and a windows-latest that only appears in a comment', () => {
    const commentedOut = yml
      .replace(/^( {2}test:\r?\n)/m, '$1    # continue-on-error: true\n')
      .replace(', windows-latest]', '] # windows-latest');
    expect(commentedOut).not.toBe(yml);
    const v = checkWindowsLeg(commentedOut);
    expect(v.some((s) => s.startsWith('continue-on-error set:'))).toBe(false);
    expect(v.some((s) => s.startsWith('matrix.os lacks windows-latest'))).toBe(true);
  });

  it('317-01/AC-8: accepts the block-list form of matrix.os', () => {
    const blockList = yml.replace(
      /^( +)os: \[ubuntu-latest, macos-latest, windows-latest\]/m,
      '$1os:\n$1  - ubuntu-latest\n$1  - macos-latest\n$1  - "windows-latest"',
    );
    expect(blockList).not.toBe(yml);
    expect(checkWindowsLeg(blockList)).toEqual([]);
  });

  it('317-01/AC-8: does not attribute another job\'s continue-on-error to the test job', () => {
    const mutated = yml.replace(
      /^( {2}ci-success:\r?\n)/m,
      '$1    continue-on-error: true\n',
    );
    expect(mutated).not.toBe(yml);
    expect(checkWindowsLeg(mutated)).toEqual([]);
  });
});
