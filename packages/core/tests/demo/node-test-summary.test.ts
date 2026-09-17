import { describe, it, expect } from 'vitest';
import { summarizeNodeTestOutput } from '../../src/demo/node-test-summary.js';

// Literal `node --test` stdout shapes. Node 22 prints TAP when stdout is piped;
// Node 24 prints its spec reporter there too (phase 306).
const TAP = [
  'TAP version 13',
  '# Subtest: x',
  'ok 1 - x',
  '  ---',
  '  duration_ms: 0.4',
  '  ...',
  '1..1',
  '# tests 1',
  '# suites 0',
  '# pass 1',
  '# fail 0',
  '# cancelled 0',
  '# skipped 0',
  '# todo 0',
  '# duration_ms 53.1',
  '',
].join('\n');

const SPEC = [
  '✔ x (0.3955ms)',
  'ℹ tests 1',
  'ℹ suites 0',
  'ℹ pass 1',
  'ℹ fail 0',
  'ℹ cancelled 0',
  'ℹ skipped 0',
  'ℹ todo 0',
  'ℹ duration_ms 53.0853',
  '',
].join('\n');

describe('summarizeNodeTestOutput (phase 306)', () => {
  it('306-01/AC-1: reads TAP count lines, LF and CRLF', () => {
    expect(summarizeNodeTestOutput(TAP)).toBe('tests 1  ·  pass 1  ·  fail 0');
    expect(summarizeNodeTestOutput(TAP.replace(/\n/g, '\r\n'))).toBe('tests 1  ·  pass 1  ·  fail 0');
  });

  it('306-01/AC-1: reads Node 24 spec-reporter count lines, LF and CRLF, ignoring other ℹ lines', () => {
    expect(summarizeNodeTestOutput(SPEC)).toBe('tests 1  ·  pass 1  ·  fail 0');
    expect(summarizeNodeTestOutput(SPEC.replace(/\n/g, '\r\n'))).toBe('tests 1  ·  pass 1  ·  fail 0');
  });

  it('306-01/AC-1: reads spec-reporter count lines wrapped in ANSI color codes (FORCE_COLOR set)', () => {
    const colored = SPEC.split('\n')
      .map((l) => (l ? `\x1b[34m${l}\x1b[39m` : l))
      .join('\n');
    expect(summarizeNodeTestOutput(colored)).toBe('tests 1  ·  pass 1  ·  fail 0');
  });

  it('306-01/AC-1: does not match a count word that is only a prefix of another word', () => {
    expect(summarizeNodeTestOutput('ℹ testsuite 3\nℹ passed 2\n# failures 1\nℹ tests 0\n')).toBe('tests 0');
  });

  it('306-01/AC-2: reports an unreadable summary honestly instead of claiming no test files exist', () => {
    for (const out of ['', 'some unknown reporter format\nall good\n']) {
      const summary = summarizeNodeTestOutput(out);
      expect(summary).toMatch(/could not read a test summary/);
      expect(summary).not.toContain('no test files found');
    }
  });
});
