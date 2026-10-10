/**
 * `cadence assurance report` (phase 327, T3) — the renderer and the CLI
 * wiring over `computeAssuranceReport` (whose numbers
 * `tests/services/assurance-report.test.ts` pins against the frozen corpus).
 * This suite covers the rendered and `--json` shapes, the `--since`
 * contract, determinism, read-only behavior and the exit codes. Every
 * asserting `it()` title carries this phase's qualified AC token (this
 * repo runs `coverageScheme: "phase-qualified"`); none is spelled out in
 * this comment (rec-20260730-002).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { Command } from 'commander';
import { tempRepo } from '@thomas-powers-jr/cadence-testkit';
import type { Summary } from '@thomas-powers-jr/cadence-types';
import {
  computeAssuranceReport,
  parseSummaryRecord,
  type AssuranceCorpusRecord,
} from '../../src/services/assurance-report.js';
import { renderAssuranceReport } from '../../src/parse/render-assurance-report.js';
import { runAssuranceReport } from '../../src/cli/commands/assurance.js';
import { registerAllCommands } from '../../src/cli/register.js';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/assurance-corpus/corpus-7d96650.json.gz',
);

function fixtureRecords(): AssuranceCorpusRecord[] {
  const fixture = JSON.parse(gunzipSync(readFileSync(FIXTURE)).toString('utf8')) as {
    records: { path: string; text: string }[];
  };
  const out: AssuranceCorpusRecord[] = [];
  for (const r of fixture.records) {
    const res = parseSummaryRecord(r.path, r.text);
    if (res.ok) out.push(res.record);
  }
  return out;
}

const records = fixtureRecords();

function makeIo() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
}

function summary(draftId: string, overrides: Partial<Summary> = {}): Summary {
  return {
    schemaVersion: 2,
    draftId,
    completedAt: '2026-01-01T00:00:00.000Z',
    acResults: [],
    taskResults: [],
    decisions: [],
    deferred: [],
    skillAudit: { required: [], invoked: [] },
    ...overrides,
  };
}

async function writeRepoFile(root: string, relPath: string, body: string): Promise<void> {
  const abs = join(root, relPath);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, body, 'utf8');
}

/** A small corpus: one un-gradable, one never-graded, one graded, one malformed. */
async function seedCorpus(root: string): Promise<void> {
  await writeRepoFile(root, '.cadence/phases/5-old/5-01-SUMMARY.json', JSON.stringify(summary('5-01')));
  await writeRepoFile(
    root,
    '.cadence/phases/150-mid/150-01-SUMMARY.json',
    JSON.stringify(summary('150-01', { gates: [{ gate: 'deep-verify', status: 'skipped' }] })),
  );
  await writeRepoFile(
    root,
    '.cadence/phases/300-new/300-01-SUMMARY.json',
    JSON.stringify(
      summary('300-01', {
        gates: [{ gate: 'deep-verify', status: 'ran' }],
        gateBypasses: [],
        assurance: {
          overall: 'unverified',
          verifierRollup: [],
          evidenceTally: { 'ai-verified': 0, executed: 0, assertion: 0, mention: 0, unverified: 0 },
        },
      }),
    ),
  );
  await writeRepoFile(root, '.cadence/phases/301-broken/301-01-SUMMARY.json', '{"schemaVersion": 2,');
  await writeRepoFile(root, '.cadence/state.json', '{"loopPosition":"IDLE"}\n');
}

function hashTree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.set(full, createHash('sha256').update(readFileSync(full)).digest('hex'));
    }
  };
  walk(dir);
  return out;
}

/** Every object key path in a JSON value. Lists are leaves (`[]`): an empty
 *  list in one window and a full one in another are the same shape. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return [`${prefix}[]`];
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [`${prefix}.${k}`, ...keyPaths(v, `${prefix}.${k}`)]);
  }
  return [];
}

function numericTokens(s: string): Set<string> {
  return new Set((s.match(/\d+/g) ?? []).map((t) => String(Number(t))));
}

describe('renderAssuranceReport', () => {
  it('327-01/AC-5: every number in the rendered text also appears in the JSON report', () => {
    for (const since of [undefined, 283, 1000]) {
      const report = computeAssuranceReport(records, [], since === undefined ? {} : { since });
      const text = renderAssuranceReport(report);
      const jsonTokens = numericTokens(JSON.stringify(report));
      const missing = [...numericTokens(text)].filter((t) => !jsonTokens.has(t));
      expect(missing).toEqual([]);
    }
  });

  it('327-01/AC-5: every number in the text is a numeric field of the report, never a list length or a computed value', () => {
    // Every numeric field gets a distinct sentinel (9001, 9002, ...) and every
    // list has a length that is no sentinel, so a renderer printing
    // `delta.length`, a row count or a sum would print a number found nowhere
    // in the report's numeric fields.
    const base = computeAssuranceReport(records, [], {});
    let next = 9001;
    const sentinels = new Set<number>();
    const stamp = (v: unknown): unknown => {
      if (typeof v === 'number') {
        sentinels.add(next);
        return next++;
      }
      if (Array.isArray(v)) return v.map(stamp);
      if (v !== null && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stamp(x)]));
      }
      return v;
    };
    const stamped = stamp(base) as typeof base;
    const text = renderAssuranceReport(stamped);
    const stringTokens = new Set<string>();
    const collectStrings = (v: unknown): void => {
      if (typeof v === 'string') for (const t of v.match(/\d+/g) ?? []) stringTokens.add(t);
      else if (Array.isArray(v)) v.forEach(collectStrings);
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(collectStrings);
    };
    collectStrings(stamped);
    const stray = (text.match(/\d+/g) ?? []).filter((t) => !sentinels.has(Number(t)) && !stringTokens.has(t));
    expect(stray).toEqual([]);
  });

  it('327-01/AC-5: the JSON key set and gate/grade/provider rows are the same whatever the window', () => {
    const full = computeAssuranceReport(records, [], {});
    const windowed = computeAssuranceReport(records, [], { since: 300 });
    const empty = computeAssuranceReport(records, [], { since: 100000 });
    const shape = (r: typeof full) => [...new Set(keyPaths(r))].sort();
    expect(shape(windowed)).toEqual(shape(full));
    expect(Object.keys(empty.grades.stored)).toEqual(Object.keys(full.grades.stored));
    expect(Object.keys(empty.providerSelection)).toEqual(Object.keys(full.providerSelection));
    expect(Object.keys(empty.evidenceTally)).toEqual(Object.keys(full.evidenceTally));
    expect(empty.gates.map((g) => g.gate)).toEqual(full.gates.map((g) => g.gate));
    expect(typeof full.schemaVersion).toBe('number');
  });

  it('327-01/AC-5: the text leads with the three categories, their phase boundaries and reasons', () => {
    const report = computeAssuranceReport(records, [], {});
    const text = renderAssuranceReport(report);
    const categoriesAt = text.indexOf('Un-gradable');
    expect(categoriesAt).toBeGreaterThan(-1);
    expect(categoriesAt).toBeLessThan(text.indexOf('Stored'));
    expect(text).toContain('Un-gradable: 155 (phases 2–139)');
    expect(text).toContain('Gradable but never graded: 96 (phases 140–243)');
    expect(text).toContain('Graded: 86 (phases 235–326)');
    expect(text).toContain(report.categories.unGradable.reason);
    expect(text).toContain('238-01, 239-01, 240-01, 243-01');
    expect(text).toContain('272-01: strong → mixed');
  });

  it('327-01/AC-7: rendering the same report twice gives byte-identical text', () => {
    const a = renderAssuranceReport(computeAssuranceReport(records, [], {}));
    const b = renderAssuranceReport(computeAssuranceReport([...records].reverse(), [], {}));
    expect(b).toBe(a);
  });
});

describe('runAssuranceReport', () => {
  it('327-01/AC-6: a malformed record is listed by path, counted as unreadable, and the command still exits 0', async () => {
    const repo = await tempRepo();
    try {
      await seedCorpus(repo.root);
      const json = makeIo();
      const res = await runAssuranceReport({ cwd: repo.root, json: true }, json.io);
      expect(res.exitCode).toBe(0);
      const report = JSON.parse(json.out.join('')) as ReturnType<typeof computeAssuranceReport>;
      expect(report.totals).toEqual({ files: 4, settled: 3, refused: 0, unreadable: 1 });
      expect(report.unreadable.map((u) => u.path)).toEqual(['.cadence/phases/301-broken/301-01-SUMMARY.json']);
      const text = makeIo();
      expect((await runAssuranceReport({ cwd: repo.root }, text.io)).exitCode).toBe(0);
      expect(text.out.join('')).toContain('.cadence/phases/301-broken/301-01-SUMMARY.json');
    } finally {
      await repo.cleanup();
    }
  });

  it('327-01/AC-4: --since keeps only records at or after the phase number', async () => {
    const repo = await tempRepo();
    try {
      await seedCorpus(repo.root);
      const io = makeIo();
      const res = await runAssuranceReport({ cwd: repo.root, json: true, since: '150' }, io.io);
      expect(res.exitCode).toBe(0);
      const report = JSON.parse(io.out.join('')) as ReturnType<typeof computeAssuranceReport>;
      expect(report.window).toEqual({ since: 150 });
      expect(report.categories.unGradable.count).toBe(0);
      expect(report.categories.neverGraded.count).toBe(1);
      expect(report.categories.graded.count).toBe(1);
    } finally {
      await repo.cleanup();
    }
  });

  it('327-01/AC-4: a --since that is not a non-negative integer exits 1 with a stderr message and no stdout', async () => {
    const repo = await tempRepo();
    try {
      for (const bad of ['abc', '-1', '1.5', '', '12x', ' 283', '9007199254740993']) {
        const io = makeIo();
        const res = await runAssuranceReport({ cwd: repo.root, since: bad }, io.io);
        expect(res.exitCode).toBe(1);
        expect(io.out).toEqual([]);
        expect(io.err.join('')).toMatch(/--since must be a non-negative integer/);
      }
    } finally {
      await repo.cleanup();
    }
  });

  it('327-01/AC-7: running the command twice gives byte-identical stdout', async () => {
    const repo = await tempRepo();
    try {
      await seedCorpus(repo.root);
      for (const json of [true, false]) {
        const a = makeIo();
        const b = makeIo();
        await runAssuranceReport({ cwd: repo.root, json }, a.io);
        await runAssuranceReport({ cwd: repo.root, json }, b.io);
        expect(b.out.join('')).toBe(a.out.join(''));
        expect(a.out.join('')).not.toContain(repo.root);
        expect(a.out.join('')).not.toContain(JSON.stringify(repo.root).slice(1, -1));
      }
    } finally {
      await repo.cleanup();
    }
  });

  it('327-01/AC-8: a run, with and without --json, leaves every file under .cadence/ byte-identical', async () => {
    const repo = await tempRepo();
    try {
      await seedCorpus(repo.root);
      const before = hashTree(join(repo.root, '.cadence'));
      await runAssuranceReport({ cwd: repo.root }, makeIo().io);
      await runAssuranceReport({ cwd: repo.root, json: true }, makeIo().io);
      await runAssuranceReport({ cwd: repo.root, json: true, since: '200' }, makeIo().io);
      const after = hashTree(join(repo.root, '.cadence'));
      expect([...after.entries()]).toEqual([...before.entries()]);
    } finally {
      await repo.cleanup();
    }
  });

  it('327-01/AC-6: with no .cadence/phases in the working directory it says so on stderr and still exits 0', async () => {
    const repo = await tempRepo();
    try {
      const io = makeIo();
      const res = await runAssuranceReport({ cwd: repo.root, json: true }, io.io);
      expect(res.exitCode).toBe(0);
      expect(io.err.join('')).toMatch(/no \.cadence\/phases directory under .*Run it from the repository root/);
      const report = JSON.parse(io.out.join('')) as ReturnType<typeof computeAssuranceReport>;
      expect(report.totals.files).toBe(0);

      await seedCorpus(repo.root);
      const seeded = makeIo();
      await runAssuranceReport({ cwd: repo.root, json: true }, seeded.io);
      expect(seeded.err).toEqual([]);
    } finally {
      await repo.cleanup();
    }
  });

  it('327-01/AC-5: `assurance report` is registered with --json and --since', () => {
    const program = new Command();
    registerAllCommands(program);
    const assurance = program.commands.find((c) => c.name() === 'assurance');
    const report = assurance?.commands.find((c) => c.name() === 'report');
    expect(report?.options.map((o) => o.long)).toEqual(['--json', '--since']);
  });
});
