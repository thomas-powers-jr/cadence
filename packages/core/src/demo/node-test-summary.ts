/**
 * Phase 306 — one-line summary of a `node --test` run, shared by the
 * `cadence demo` and `cadence tutorial` walkthroughs.
 *
 * Node 22 prints TAP when stdout is piped (`# tests 1`); Node 24 prints its
 * spec reporter there too (`ℹ tests 1`). Both prefixes are recognised. When
 * neither matches, the result says the summary could not be read — never that
 * no test files exist, which this parser has no evidence for.
 */

const COUNT_LINE_RE = /^(?:#|ℹ)\s*((?:tests|pass|fail) \d+)\s*$/;

/** SGR color sequences Node's spec reporter emits when `FORCE_COLOR` is set. */
// eslint-disable-next-line no-control-regex
const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;

export const UNREADABLE_TEST_SUMMARY = '(could not read a test summary from node --test output)';

export function summarizeNodeTestOutput(stdout: string): string {
  const counts: string[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const m = COUNT_LINE_RE.exec(raw.replace(ANSI_SGR_RE, '').trim());
    if (m?.[1]) counts.push(m[1]);
  }
  return counts.length > 0 ? counts.join('  ·  ') : UNREADABLE_TEST_SUMMARY;
}
