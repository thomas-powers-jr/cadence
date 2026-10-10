import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempRepo } from '@thomas-powers-jr/cadence-testkit';
import type { Summary } from '@thomas-powers-jr/cadence-types';
import {
  loadAssuranceCorpus,
  parseSummaryRecord,
} from '../../src/services/assurance-report.js';

// Phase 327 T1 — the assurance report's corpus loader. Every test builds its
// own ephemeral `tempRepo()` corpus; nothing here reads this repo's own
// `.cadence/phases/` tree. This repo runs `coverageScheme: 'phase-qualified'`,
// so each asserting `it()` title carries the `327-01/AC-N` token.

function validSummary(draftId: string): Summary {
  return {
    schemaVersion: 1,
    draftId,
    completedAt: '2026-01-01T00:00:00.000Z',
    acResults: [],
    taskResults: [],
    decisions: [],
    deferred: [],
    skillAudit: { required: [], invoked: [] },
  };
}

async function writeRepoFile(root: string, relPath: string, body: string): Promise<void> {
  const abs = join(root, relPath);
  await mkdir(join(abs, '..'), { recursive: true });
  await writeFile(abs, body, 'utf8');
}

describe('parseSummaryRecord', () => {
  it('327-01/AC-6: parses a valid record and derives phase, phase number, id and path from the repo-relative path', () => {
    const res = parseSummaryRecord(
      '.cadence/phases/140-summary-gate-provenance/140-01-SUMMARY.json',
      JSON.stringify(validSummary('140-01')),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.phase).toBe('140-summary-gate-provenance');
    expect(res.record.phaseNumber).toBe(140);
    expect(res.record.id).toBe('140-01');
    expect(res.record.path).toBe('.cadence/phases/140-summary-gate-provenance/140-01-SUMMARY.json');
    expect(res.record.summary.draftId).toBe('140-01');
  });

  it('327-01/AC-6: reports malformed JSON as unreadable with a reason instead of throwing', () => {
    const res = parseSummaryRecord('.cadence/phases/7-x/7-01-SUMMARY.json', '{ not json');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.unreadable.path).toBe('.cadence/phases/7-x/7-01-SUMMARY.json');
    expect(res.unreadable.phase).toBe('7-x');
    expect(res.unreadable.id).toBe('7-01');
    expect(res.unreadable.reason).toMatch(/not valid JSON/);
  });

  it('327-01/AC-6: reports a record that fails SummaryZ as unreadable with a schema reason', () => {
    const res = parseSummaryRecord('.cadence/phases/8-x/8-01-SUMMARY.json', JSON.stringify({ draftId: 8 }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.unreadable.reason).toMatch(/does not match the expected SUMMARY schema/);
  });

  it('327-01/AC-6: reports a phase directory with no leading integer as unreadable, never a NaN phase number', () => {
    const res = parseSummaryRecord(
      '.cadence/phases/untitled/untitled-01-SUMMARY.json',
      JSON.stringify(validSummary('untitled-01')),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.unreadable.phase).toBe('untitled');
    expect(res.unreadable.reason).toMatch(/no leading phase number/);
  });

  it('327-01/AC-6: normalizes a backslash-separated path to forward slashes', () => {
    const res = parseSummaryRecord(
      '.cadence\\phases\\9-x\\9-01-SUMMARY.json',
      JSON.stringify(validSummary('9-01')),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.path).toBe('.cadence/phases/9-x/9-01-SUMMARY.json');
    expect(res.record.phaseNumber).toBe(9);
  });
});

describe('loadAssuranceCorpus', () => {
  it('327-01/AC-6: lists malformed and schema-violating records by repo-relative path and still loads the rest', async () => {
    const repo = await tempRepo();
    try {
      await writeRepoFile(
        repo.root,
        '.cadence/phases/10-good/10-01-SUMMARY.json',
        JSON.stringify(validSummary('10-01')),
      );
      await writeRepoFile(repo.root, '.cadence/phases/11-bad-json/11-01-SUMMARY.json', '{"schemaVersion": 1,');
      await writeRepoFile(
        repo.root,
        '.cadence/phases/12-bad-schema/12-01-SUMMARY.json',
        JSON.stringify({ schemaVersion: 1 }),
      );
      // Snapshot siblings and non-SUMMARY files are not corpus records.
      await writeRepoFile(
        repo.root,
        '.cadence/phases/10-good/10-01-refused-2026-01-01T00-00-00-000Z-SUMMARY-snapshot.json',
        '{ not even json',
      );
      await writeRepoFile(repo.root, '.cadence/phases/10-good/10-01-DRAFT.md', '# draft\n');

      const corpus = loadAssuranceCorpus(repo.root);

      expect(corpus.records.map((r) => r.path)).toEqual(['.cadence/phases/10-good/10-01-SUMMARY.json']);
      expect(corpus.unreadable.map((u) => u.path)).toEqual([
        '.cadence/phases/11-bad-json/11-01-SUMMARY.json',
        '.cadence/phases/12-bad-schema/12-01-SUMMARY.json',
      ]);
      expect(corpus.unreadable[0]!.reason).toMatch(/not valid JSON/);
      expect(corpus.unreadable[1]!.reason).toMatch(/does not match the expected SUMMARY schema/);
    } finally {
      await repo.cleanup();
    }
  });

  it('327-01/AC-6: a file that cannot be read is an unreadable entry with its path and reason, never a throw', async () => {
    const repo = await tempRepo();
    try {
      await writeRepoFile(repo.root, '.cadence/phases/13-a/13-01-SUMMARY.json', JSON.stringify(validSummary('13-01')));
      await writeRepoFile(repo.root, '.cadence/phases/14-b/14-01-SUMMARY.json', JSON.stringify(validSummary('14-01')));
      // Node's real fs errors embed the absolute path; the reason must not.
      const corpus = loadAssuranceCorpus(repo.root, (absPath) => {
        if (absPath.includes('14-01')) throw new Error(`EACCES: permission denied, open '${absPath}'`);
        return readFileSync(absPath, 'utf8');
      });
      expect(corpus.records.map((r) => r.id)).toEqual(['13-01']);
      expect(corpus.unreadable).toEqual([
        {
          phase: '14-b',
          id: '14-01',
          path: '.cadence/phases/14-b/14-01-SUMMARY.json',
          reason:
            "could not read SUMMARY.json: EACCES: permission denied, open '.cadence/phases/14-b/14-01-SUMMARY.json'",
        },
      ]);
      expect(corpus.unreadable[0]?.reason).not.toContain(repo.root);
    } finally {
      await repo.cleanup();
    }
  });

  it('327-01/AC-6: a SUMMARY.json directly under .cadence/phases is unreadable, not a phase record', async () => {
    const repo = await tempRepo();
    try {
      await writeRepoFile(repo.root, '.cadence/phases/12-01-SUMMARY.json', JSON.stringify(validSummary('12-01')));
      const corpus = loadAssuranceCorpus(repo.root);
      expect(corpus.records).toEqual([]);
      expect(corpus.unreadable[0]?.reason).toMatch(/not inside a phase directory/);
      // No phase directory, so no phase: its file name's digits never place it in a window.
      expect(corpus.unreadable[0]?.phase).toBe('');
    } finally {
      await repo.cleanup();
    }
  });

  it('327-01/AC-6: returns an empty corpus, without throwing, when .cadence/phases is missing', async () => {
    const repo = await tempRepo();
    try {
      const corpus = loadAssuranceCorpus(repo.root);
      expect(corpus).toEqual({ records: [], unreadable: [] });
    } finally {
      await repo.cleanup();
    }
  });
});
