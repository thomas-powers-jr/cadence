import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tempRepo, type Fixture } from '@thomas-powers-jr/cadence-testkit';
import type { GitFacts } from '@thomas-powers-jr/cadence-types';
import {
  PRECOMPACT_ADAPTER_KEYS,
  findNewestPrecompactRecord,
  payloadFieldNames,
  planPrecompactRecord,
  precompactDir,
  precompactFileStem,
  selectPrunablePrecompact,
  writePrecompactRecord,
  type PrecompactLoopFacts,
} from '../../src/handoff/precompact.js';

const NOW = new Date('2026-11-02T18:19:23.456Z');
const LOOP: PrecompactLoopFacts = {
  loopPosition: 'BUILD',
  activePhase: '345-precompact-record',
  activeDraft: '345-01',
  activeSpec: null,
};
const GIT: GitFacts = {
  available: true,
  branch: 'claude/zen-keller-cp16ug',
  dirty: true,
  ahead: 1,
  behind: 0,
  head: 'abc1234',
  recentCommits: 'abc1234 subject',
  diffStat: '',
  fetched: false,
};

const fixtures: Fixture[] = [];
async function repo(initialized = true): Promise<Fixture> {
  const f = await tempRepo({ initialized });
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  while (fixtures.length > 0) await fixtures.pop()?.cleanup();
});

/** Snapshot every file under .cadence/ except the precompact record directory. */
async function snapshotCadence(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (p.startsWith(precompactDir(root))) continue;
      if (e.isDirectory()) await walk(p);
      else out.set(p, await readFile(p, 'utf8'));
    }
  }
  await walk(join(root, '.cadence'));
  return out;
}

describe('precompactFileStem / planPrecompactRecord (pure)', () => {
  it('345-01/AC-3: names the record PRECOMPACT-<YYYYMMDDTHHMMSS.mmmZ>.md with no colons', () => {
    expect(precompactFileStem(NOW)).toBe('PRECOMPACT-20261102T181923.456Z');
    const { fileName } = planPrecompactRecord({
      now: NOW,
      trigger: 'auto',
      payloadKeys: [],
      loop: LOOP,
      git: GIT,
    });
    expect(fileName).toBe('PRECOMPACT-20261102T181923.456Z.md');
    expect(fileName).not.toContain(':');
  });

  it('345-01/AC-3: carries generated_at, a JSON-quoted trigger, loop facts and git facts', () => {
    const { content } = planPrecompactRecord({
      now: NOW,
      trigger: 'auto',
      payloadKeys: ['session_id', 'trigger'],
      loop: LOOP,
      git: GIT,
    });
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('generated_at: 2026-11-02T18:19:23.456Z\n');
    expect(content).toContain('trigger: "auto"\n');
    expect(content).toContain('loop_position: BUILD\n');
    expect(content).toContain('active_phase: 345-precompact-record\n');
    expect(content).toContain('active_draft: 345-01\n');
    expect(content).toContain('active_spec: none\n');
    expect(content).toContain('git_branch: claude/zen-keller-cp16ug\n');
    expect(content).toContain('git_head: abc1234\n');
    expect(content).toContain('git_dirty: true\n');
    expect(content).toContain('- session_id\n');
    expect(content).toContain('- trigger\n');
  });

  it('345-01/AC-3: the trigger value appears only in the front matter, never in the body', () => {
    const { content } = planPrecompactRecord({
      now: NOW,
      trigger: 'auto-UNIQUE-7f3a',
      payloadKeys: ['trigger', 'session_id'],
      loop: LOOP,
      git: GIT,
    });
    const [, frontMatter = '', body = ''] = content.split(/^---\n/m);
    expect(frontMatter).toContain('trigger: "auto-UNIQUE-7f3a"\n');
    expect(body).not.toContain('auto-UNIQUE-7f3a');
    expect(body).toContain('- trigger\n');
  });

  it('345-01/AC-3: a hostile trigger cannot inject front matter (JSON-quoted, one line)', () => {
    const { content } = planPrecompactRecord({
      now: NOW,
      trigger: 'auto\n---\ngenerated_at: 2099-01-01T00:00:00.000Z',
      payloadKeys: [],
      loop: LOOP,
      git: GIT,
    });
    const frontMatter = content.split('\n---\n')[0] ?? '';
    expect(frontMatter.match(/^generated_at: /gm)?.length).toBe(1);
    expect(content).toContain('generated_at: 2026-11-02T18:19:23.456Z\n');
    expect(content).toContain(
      'trigger: "auto\\n---\\ngenerated_at: 2099-01-01T00:00:00.000Z"\n',
    );
  });

  it('345-01/AC-3: a missing trigger is recorded as "unknown"; missing loop and git facts as unavailable', () => {
    const { content } = planPrecompactRecord({
      now: NOW,
      payloadKeys: [],
      loop: null,
      git: { available: false },
    });
    expect(content).toContain('trigger: "unknown"\n');
    expect(content).toContain('loop_position: unavailable\n');
    expect(content).toContain('active_draft: unavailable\n');
    expect(content).toContain('git: unavailable\n');
    expect(content).not.toContain('git_branch:');
  });
});

describe('payloadFieldNames (pure)', () => {
  it('345-01/AC-3: lists top-level host field names only, never values, minus adapter-added keys', () => {
    const raw = {
      session_id: 's-1',
      transcript_path: '/home/someone/.claude/x.jsonl',
      hook_event_name: 'PreCompact',
      trigger: 'auto',
      custom_instructions: 'secret user text',
      compactTrigger: 'auto',
      files: ['a.ts'],
      skill: 'x',
      agentId: 'a',
      agentType: 'b',
    };
    const names = payloadFieldNames(raw);
    expect(names).toEqual([
      'custom_instructions',
      'hook_event_name',
      'session_id',
      'transcript_path',
      'trigger',
    ]);
    for (const k of PRECOMPACT_ADAPTER_KEYS) expect(names).not.toContain(k);
    const { content } = planPrecompactRecord({
      now: NOW,
      trigger: 'auto',
      payloadKeys: names,
      loop: LOOP,
      git: GIT,
    });
    expect(content).not.toContain('secret user text');
    expect(content).not.toContain('/home/someone');
  });

  it('345-01/AC-3: a non-object payload yields no field names', () => {
    expect(payloadFieldNames(undefined)).toEqual([]);
    expect(payloadFieldNames('text')).toEqual([]);
    expect(payloadFieldNames([1, 2])).toEqual([]);
  });
});

describe('selectPrunablePrecompact (pure)', () => {
  it('345-01/AC-5: keeps the newest five records by file name and ignores other files', () => {
    const names = [
      'PRECOMPACT-20261101T000000.000Z.md',
      'PRECOMPACT-20261102T000000.000Z.md',
      'PRECOMPACT-20261103T000000.000Z.md',
      'PRECOMPACT-20261104T000000.000Z.md',
      'PRECOMPACT-20261105T000000.000Z.md',
      'PRECOMPACT-20261106T000000.000Z.md',
      'PRECOMPACT-20261106T000000.000Z-2.md',
      'SESSION-2026-11-01.md',
      'notes.txt',
    ];
    expect(selectPrunablePrecompact(names).sort()).toEqual([
      'PRECOMPACT-20261101T000000.000Z.md',
      'PRECOMPACT-20261102T000000.000Z.md',
    ]);
    expect(selectPrunablePrecompact(names.slice(0, 5))).toEqual([]);
  });

  it('345-01/AC-5: orders same-millisecond records by numeric suffix (base, -2, ..., -10)', () => {
    const base = 'PRECOMPACT-20261106T000000.000Z';
    const names = [`${base}-10.md`, `${base}.md`, `${base}-2.md`, `${base}-3.md`];
    expect(selectPrunablePrecompact(names, 2).sort()).toEqual([`${base}-2.md`, `${base}.md`]);
    expect(selectPrunablePrecompact(names, 1)).toEqual([`${base}-3.md`, `${base}-2.md`, `${base}.md`]);
  });
});

describe('writePrecompactRecord (impure shell)', () => {
  it('345-01/AC-3: writes exactly one record under .cadence/local/precompact/ (created if missing) and touches nothing else', async () => {
    const f = await repo();
    await writeFile(join(f.root, '.cadence', 'handoff', 'SESSION-2026-11-01.md'), '---\ngenerated_at: 2026-11-01T00:00:00.000Z\n---\n# s\n');
    await mkdir(join(f.root, '.cadence', 'intelligence'), { recursive: true });
    await writeFile(join(f.root, '.cadence', 'intelligence', 'recommendations.json'), '{"recommendations":[]}\n');
    const before = await snapshotCadence(f.root);
    expect([...before.keys()].some((k) => k.endsWith('SESSION-2026-11-01.md'))).toBe(true);
    expect([...before.keys()].some((k) => k.endsWith('recommendations.json'))).toBe(true);
    expect([...before.keys()].some((k) => k.endsWith('state.json'))).toBe(true);
    const res = await writePrecompactRecord(
      f.root,
      { trigger: 'manual', raw: { session_id: 's', trigger: 'manual' } },
      { now: () => NOW, readGit: async () => GIT },
    );
    expect(res).toEqual({
      ok: true,
      path: '.cadence/local/precompact/PRECOMPACT-20261102T181923.456Z.md',
    });
    const files = await readdir(precompactDir(f.root));
    expect(files).toEqual(['PRECOMPACT-20261102T181923.456Z.md']);
    const content = await readFile(join(precompactDir(f.root), files[0] ?? ''), 'utf8');
    expect(content).toContain('trigger: "manual"\n');
    expect(content).toContain('loop_position: IDLE\n');
    expect(await snapshotCadence(f.root)).toEqual(before);
  });

  it('345-01/AC-3: a same-millisecond collision gets a -2 suffix and never overwrites', async () => {
    const f = await repo();
    const deps = { now: () => NOW, readGit: async (): Promise<GitFacts> => ({ available: false }) };
    const a = await writePrecompactRecord(f.root, { trigger: 'auto' }, deps);
    const b = await writePrecompactRecord(f.root, { trigger: 'manual' }, deps);
    expect(a).toEqual({ ok: true, path: '.cadence/local/precompact/PRECOMPACT-20261102T181923.456Z.md' });
    expect(b).toEqual({ ok: true, path: '.cadence/local/precompact/PRECOMPACT-20261102T181923.456Z-2.md' });
    const first = await readFile(join(precompactDir(f.root), 'PRECOMPACT-20261102T181923.456Z.md'), 'utf8');
    expect(first).toContain('trigger: "auto"\n');
  });

  it('345-01/AC-4: never creates .cadence/ — returns ok:false when it does not exist', async () => {
    const f = await repo(false);
    const res = await writePrecompactRecord(f.root, { trigger: 'auto' }, { now: () => NOW });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/\.cadence/);
    await expect(stat(join(f.root, '.cadence'))).rejects.toThrow();
  });

  it('345-01/AC-4: unreadable state still writes the record, with loop fields unavailable', async () => {
    const f = await repo();
    await writeFile(join(f.root, '.cadence', 'state.json'), '{ not json');
    const res = await writePrecompactRecord(
      f.root,
      { trigger: 'auto' },
      { now: () => NOW, readGit: async () => ({ available: false }) },
    );
    expect(res.ok).toBe(true);
    const content = await readFile(
      join(precompactDir(f.root), 'PRECOMPACT-20261102T181923.456Z.md'),
      'utf8',
    );
    expect(content).toContain('loop_position: unavailable\n');
    expect(await readFile(join(f.root, '.cadence', 'state.json'), 'utf8')).toBe('{ not json');
  });

  it('345-01/AC-4: an unwritable record directory and a throwing git reader return ok:false or degrade, never throw', async () => {
    const f = await repo();
    const unwritable = await writePrecompactRecord(
      f.root,
      { trigger: 'auto' },
      {
        now: () => NOW,
        readGit: async () => {
          throw new Error('git exploded');
        },
        fs: {
          mkdir: async () => {
            throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
          },
        },
      },
    );
    expect(unwritable.ok).toBe(false);
    if (!unwritable.ok) expect(unwritable.reason).toMatch(/EACCES/);

    const gitBroken = await writePrecompactRecord(
      f.root,
      { trigger: 'auto' },
      {
        now: () => NOW,
        readGit: async () => {
          throw new Error('git exploded');
        },
      },
    );
    expect(gitBroken.ok).toBe(true);
    const content = await readFile(
      join(precompactDir(f.root), 'PRECOMPACT-20261102T181923.456Z.md'),
      'utf8',
    );
    expect(content).toContain('git: unavailable\n');
  });

  it('345-01/AC-5: prunes untracked records beyond the newest five, silently, leaving other files alone', async () => {
    const f = await repo();
    const dir = precompactDir(f.root);
    await mkdir(dir, { recursive: true });
    for (let d = 1; d <= 6; d++) {
      await writeFile(join(dir, `PRECOMPACT-202610${String(d).padStart(2, '0')}T000000.000Z.md`), 'old\n');
    }
    await writeFile(join(dir, 'keep-me.txt'), 'x');
    const errs: string[] = [];
    const outs: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    const origOut = process.stdout.write.bind(process.stdout);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      outs.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const res = await writePrecompactRecord(
        f.root,
        { trigger: 'auto' },
        { now: () => NOW, readGit: async () => ({ available: false }) },
      );
      expect(res.ok).toBe(true);
    } finally {
      process.stderr.write = origWrite;
      process.stdout.write = origOut;
    }
    expect(errs).toEqual([]);
    expect(outs).toEqual([]);
    const left = (await readdir(dir)).sort();
    expect(left).toEqual([
      'PRECOMPACT-20261003T000000.000Z.md',
      'PRECOMPACT-20261004T000000.000Z.md',
      'PRECOMPACT-20261005T000000.000Z.md',
      'PRECOMPACT-20261006T000000.000Z.md',
      'PRECOMPACT-20261102T181923.456Z.md',
      'keep-me.txt',
    ]);
  });

  it('345-01/AC-3: has no suffix limit — with 60 same-millisecond records on disk the next write is -61 and nothing is overwritten', async () => {
    const f = await repo();
    const dir = precompactDir(f.root);
    await mkdir(dir, { recursive: true });
    const base = 'PRECOMPACT-20261102T181923.456Z';
    await writeFile(join(dir, `${base}.md`), 'base\n');
    for (let n = 2; n <= 60; n++) await writeFile(join(dir, `${base}-${n}.md`), `old ${n}\n`);
    const res = await writePrecompactRecord(
      f.root,
      { trigger: 'auto' },
      { now: () => NOW, readGit: async () => ({ available: false }), fs: { unlink: async () => {} } },
    );
    expect(res).toEqual({ ok: true, path: `.cadence/local/precompact/${base}-61.md` });
    expect(await readFile(join(dir, `${base}.md`), 'utf8')).toBe('base\n');
    expect(await readFile(join(dir, `${base}-60.md`), 'utf8')).toBe('old 60\n');
    expect(await readFile(join(dir, `${base}-61.md`), 'utf8')).toContain('trigger: "auto"\n');
  });

  it('345-01/AC-3: a name lost to a concurrent writer is retried with the next free suffix', async () => {
    const f = await repo();
    let calls = 0;
    const res = await writePrecompactRecord(
      f.root,
      { trigger: 'auto' },
      {
        now: () => NOW,
        readGit: async () => ({ available: false }),
        fs: {
          writeFileExclusive: async (p: string, c: string) => {
            calls++;
            if (calls === 1) {
              // A concurrent writer takes the base name between our check and write.
              await writeFile(p, 'other\n');
              throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
            }
            await writeFile(p, c, { flag: 'wx' });
          },
        },
      },
    );
    expect(res).toEqual({
      ok: true,
      path: '.cadence/local/precompact/PRECOMPACT-20261102T181923.456Z-2.md',
    });
  });

  it('345-01/AC-3: a collision whose directory cannot then be listed returns ok:false naming the cause', async () => {
    const f = await repo();
    const res = await writePrecompactRecord(
      f.root,
      { trigger: 'auto' },
      {
        now: () => NOW,
        readGit: async () => ({ available: false }),
        fs: {
          writeFileExclusive: async () => {
            throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
          },
          readdir: async () => {
            throw new Error('EIO: i/o error');
          },
        },
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/cannot list .*EIO/);
  });

  it('345-01/AC-3: a non-EEXIST write failure after mkdir returns ok:false naming the cause', async () => {
    const f = await repo();
    const res = await writePrecompactRecord(
      f.root,
      { trigger: 'auto' },
      {
        now: () => NOW,
        readGit: async () => ({ available: false }),
        fs: {
          writeFileExclusive: async () => {
            throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
          },
        },
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/ENOSPC/);
  });

  it('345-01/AC-5: a prune failure does not fail the write', async () => {
    const f = await repo();
    const dir = precompactDir(f.root);
    await mkdir(dir, { recursive: true });
    for (let d = 1; d <= 6; d++) {
      await writeFile(join(dir, `PRECOMPACT-202610${String(d).padStart(2, '0')}T000000.000Z.md`), 'old\n');
    }
    const res = await writePrecompactRecord(
      f.root,
      { trigger: 'auto' },
      {
        now: () => NOW,
        readGit: async () => ({ available: false }),
        fs: {
          unlink: async () => {
            throw new Error('EPERM');
          },
        },
      },
    );
    expect(res.ok).toBe(true);
  });
});

describe('findNewestPrecompactRecord', () => {
  it('345-01/AC-7: returns the newest record with its trigger and generated_at, or null', async () => {
    const f = await repo();
    expect(await findNewestPrecompactRecord(f.root)).toBeNull();
    const deps = { readGit: async (): Promise<GitFacts> => ({ available: false }) };
    await writePrecompactRecord(f.root, { trigger: 'manual' }, { ...deps, now: () => new Date('2026-11-01T00:00:00.000Z') });
    await writePrecompactRecord(f.root, { trigger: 'auto' }, { ...deps, now: () => NOW });
    expect(await findNewestPrecompactRecord(f.root)).toEqual({
      path: '.cadence/local/precompact/PRECOMPACT-20261102T181923.456Z.md',
      trigger: 'auto',
      generatedAt: '2026-11-02T18:19:23.456Z',
    });
  });

  it('345-01/AC-7: a same-millisecond -2 record is the newest; CRLF records and U+2028 triggers read back', async () => {
    const f = await repo();
    const deps = { now: () => NOW, readGit: async (): Promise<GitFacts> => ({ available: false }) };
    await writePrecompactRecord(f.root, { trigger: 'manual' }, deps);
    await writePrecompactRecord(f.root, { trigger: 'auto\u2028x' }, deps);
    expect(await findNewestPrecompactRecord(f.root)).toEqual({
      path: '.cadence/local/precompact/PRECOMPACT-20261102T181923.456Z-2.md',
      trigger: 'auto\u2028x',
      generatedAt: '2026-11-02T18:19:23.456Z',
    });
    const g = await repo();
    await mkdir(precompactDir(g.root), { recursive: true });
    await writeFile(
      join(precompactDir(g.root), 'PRECOMPACT-20261102T000000.000Z.md'),
      '---\r\ngenerated_at: 2026-11-02T00:00:00.000Z\r\ntrigger: "auto"\r\n---\r\nbody\r\n',
    );
    expect(await findNewestPrecompactRecord(g.root)).toEqual({
      path: '.cadence/local/precompact/PRECOMPACT-20261102T000000.000Z.md',
      trigger: 'auto',
      generatedAt: '2026-11-02T00:00:00.000Z',
    });
  });

  it('345-01/AC-7: never throws when the directory or record is unreadable', async () => {
    const f = await repo(false);
    expect(await findNewestPrecompactRecord(f.root)).toBeNull();
    const g = await repo();
    await mkdir(precompactDir(g.root), { recursive: true });
    await writeFile(join(precompactDir(g.root), 'PRECOMPACT-20261102T000000.000Z.md'), 'no front matter');
    expect(await findNewestPrecompactRecord(g.root)).toBeNull();
  });
});
