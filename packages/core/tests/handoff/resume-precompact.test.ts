// packages/core/tests/handoff/resume-precompact.test.ts
//
// Phase 345 (T5, AC-7): `cadence resume` points at a pre-compaction record
// that is newer than the freshest SESSION doc, and is otherwise byte-identical
// to its pre-phase-345 output.
//
// The BEFORE_* fixtures below were captured from the built CLI *before* this
// task changed any code (scratch capture script run against the pre-T5 dist,
// in temp repos holding exactly the files `makeRepo` writes). The only edit to
// the captured strings is replacing the temp root's absolute handoff path with
// `<HANDOFF>`, so the comparison is portable across temp dirs and path
// separators.
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { defaultConfig, emptyState, ResumeResultZ } from '@thomas-powers-jr/cadence-types';
import { runResume, isPrecompactRecordNewer, renderPrecompactPointerLine } from '../../src/handoff/run-resume.js';
import { planPrecompactRecord } from '../../src/handoff/precompact.js';
import { bufferIO } from '../../src/services/io.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');
const SESSION_NAME = 'SESSION-2026-11-01-fixture.md';
const SESSION = [
  '---',
  'cadence_handoff: 2',
  'generated_at: 2026-11-01T10:00:00.000Z',
  'label: fixture',
  'loop_position: IDLE',
  'active_phase: none',
  '---',
  '',
  '# Session Handoff — fixture',
  '',
  '## TL;DR',
  'Fixture session.',
  '',
  '## Next action',
  '**Action:** keep going.',
  '',
].join('\n');

// ---- captured BEFORE the change (see header) ----
const NO_HANDOFF_LINE = 'resume: no handoff found — run `cadence handoff` to create one.\n';
const BEFORE_NOT_FOUND_TEXT = NO_HANDOFF_LINE;
const BEFORE_NOT_FOUND_JSON = '{"found":false}\n';
const BEFORE_FOUND_TEXT =
  'note: could not verify freshness against origin (not-a-repo)\n\n--- narrative from <HANDOFF> ---\n\n## TL;DR\nFixture session.\n\n## Next action\n**Action:** keep going.\n\nbrief mode; run `cadence resume --full` (or `cadence context handoff`) for the full doc + live context\n';
const BEFORE_FOUND_TEXT_OFFLINE =
  '--- narrative from <HANDOFF> ---\n\n## TL;DR\nFixture session.\n\n## Next action\n**Action:** keep going.\n\nbrief mode; run `cadence resume --full` (or `cadence context handoff`) for the full doc + live context\n';
const BEFORE_FOUND_JSON =
  '{"found":true,"handoffPath":"<HANDOFF>","generatedAt":"2026-11-01T10:00:00.000Z","doc":"## TL;DR\\nFixture session.\\n\\n## Next action\\n**Action:** keep going.\\n","context":null,"drift":null,"mode":"brief","remote":{"checked":false,"reason":"not-a-repo"}}\n';
const BEFORE_FOUND_JSON_OFFLINE =
  '{"found":true,"handoffPath":"<HANDOFF>","generatedAt":"2026-11-01T10:00:00.000Z","doc":"## TL;DR\\nFixture session.\\n\\n## Next action\\n**Action:** keep going.\\n","context":null,"drift":null,"mode":"brief"}\n';

const roots: string[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
});

async function makeRepo(opts: { session?: { name: string; content: string } | null } = {}): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cadence-345-resume-')));
  roots.push(root);
  await mkdir(join(root, '.cadence', 'handoff'), { recursive: true });
  await mkdir(join(root, '.cadence', 'phases'), { recursive: true });
  await writeFile(join(root, '.cadence', 'config.json'), JSON.stringify(defaultConfig, null, 2));
  await writeFile(join(root, '.cadence', 'state.json'), JSON.stringify(emptyState('fixture'), null, 2));
  const session = opts.session === undefined ? { name: SESSION_NAME, content: SESSION } : opts.session;
  if (session) await writeFile(join(root, '.cadence', 'handoff', session.name), session.content);
  return root;
}

async function writeRecord(root: string, iso: string, trigger = 'auto'): Promise<string> {
  const plan = planPrecompactRecord({ now: new Date(iso), trigger, payloadKeys: ['trigger'], loop: null, git: null });
  await mkdir(join(root, '.cadence', 'local', 'precompact'), { recursive: true });
  await writeFile(join(root, '.cadence', 'local', 'precompact', plan.fileName), plan.content);
  return `.cadence/local/precompact/${plan.fileName}`;
}

function run(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d.toString()));
    p.stderr.on('data', (d) => (stderr += d.toString()));
    p.on('exit', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

/** Replace the temp repo's absolute handoff path (raw and JSON-escaped) with `<HANDOFF>`. */
function norm(out: string, root: string, name = SESSION_NAME): string {
  const p = join(root, '.cadence', 'handoff', name);
  return out.split(JSON.stringify(p).slice(1, -1)).join('<HANDOFF>').split(p).join('<HANDOFF>');
}

describe('345-01 AC-7: resume output is byte-identical when no record is newer', () => {
  for (const variant of ['no record', 'an older record'] as const) {
    it(`345-01/AC-7: found, ${variant}: text/JSON, with and without --offline, match the pre-change fixtures`, async () => {
      const root = await makeRepo();
      if (variant === 'an older record') await writeRecord(root, '2026-11-01T09:59:59.999Z');
      expect(norm((await run(['resume'], root)).stdout, root)).toBe(BEFORE_FOUND_TEXT);
      expect(norm((await run(['resume', '--offline'], root)).stdout, root)).toBe(BEFORE_FOUND_TEXT_OFFLINE);
      expect(norm((await run(['resume', '--json'], root)).stdout, root)).toBe(BEFORE_FOUND_JSON);
      expect(norm((await run(['resume', '--json', '--offline'], root)).stdout, root)).toBe(BEFORE_FOUND_JSON_OFFLINE);
    });
  }

  it('345-01/AC-7: not found, no record: text and JSON match the pre-change fixtures', async () => {
    const root = await makeRepo({ session: null });
    expect((await run(['resume'], root)).stdout).toBe(BEFORE_NOT_FOUND_TEXT);
    expect((await run(['resume', '--offline'], root)).stdout).toBe(BEFORE_NOT_FOUND_TEXT);
    expect((await run(['resume', '--json'], root)).stdout).toBe(BEFORE_NOT_FOUND_JSON);
    expect((await run(['resume', '--json', '--offline'], root)).stdout).toBe(BEFORE_NOT_FOUND_JSON);
  });

  it('345-01/AC-7: a record at exactly the SESSION doc\'s generated_at is not newer', async () => {
    const root = await makeRepo();
    await writeRecord(root, '2026-11-01T10:00:00.000Z');
    expect(norm((await run(['resume', '--offline'], root)).stdout, root)).toBe(BEFORE_FOUND_TEXT_OFFLINE);
    expect(norm((await run(['resume', '--json', '--offline'], root)).stdout, root)).toBe(BEFORE_FOUND_JSON_OFFLINE);
  });
});

describe('345-01 AC-7: resume points at a newer record', () => {
  it('345-01/AC-7: found + newer record: the pointer line precedes the narrative; JSON carries precompactRecord', async () => {
    const root = await makeRepo();
    const path = await writeRecord(root, '2026-11-02T18:19:23.456Z', 'auto');
    const pointer = `Pre-compaction record: ${path} (trigger: auto, 2026-11-02T18:19:23.456Z) — newer than any SESSION handoff\n`;

    const text = norm((await run(['resume', '--offline'], root)).stdout, root);
    expect(text).toBe(`${pointer}\n${BEFORE_FOUND_TEXT_OFFLINE}`);

    const withRemote = norm((await run(['resume'], root)).stdout, root);
    const idx = withRemote.indexOf(pointer);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(withRemote.indexOf('--- narrative from'));
    expect(withRemote.split(pointer).length).toBe(2);

    const json = JSON.parse((await run(['resume', '--json', '--offline'], root)).stdout);
    expect(json.precompactRecord).toEqual({ path, trigger: 'auto', generatedAt: '2026-11-02T18:19:23.456Z' });
    expect(ResumeResultZ.safeParse(json).success).toBe(true);
  });

  it('345-01/AC-7: no SESSION doc + any record: the pointer line follows the "no handoff found" line; JSON carries it', async () => {
    const root = await makeRepo({ session: null });
    const path = await writeRecord(root, '2020-01-01T00:00:00.000Z', 'manual');
    const pointer = `Pre-compaction record: ${path} (trigger: manual, 2020-01-01T00:00:00.000Z) — newer than any SESSION handoff\n`;
    expect((await run(['resume'], root)).stdout).toBe(`${NO_HANDOFF_LINE}${pointer}`);
    const json = JSON.parse((await run(['resume', '--json'], root)).stdout);
    expect(json).toEqual({ found: false, precompactRecord: { path, trigger: 'manual', generatedAt: '2020-01-01T00:00:00.000Z' } });
    expect(ResumeResultZ.safeParse(json).success).toBe(true);
  });

  it('345-01/AC-7: a SESSION doc without generated_at counts as the end of its file-name date', async () => {
    const name = 'SESSION-2026-11-01-undated.md';
    const undated = SESSION.replace('generated_at: 2026-11-01T10:00:00.000Z\n', '');
    const sameDay = await makeRepo({ session: { name, content: undated } });
    await writeRecord(sameDay, '2026-11-01T23:59:59.999Z');
    const same = await runResume(sameDay, { offline: true }, new Date(), bufferIO());
    expect(same).not.toHaveProperty('precompactRecord');

    const nextDay = await makeRepo({ session: { name, content: undated } });
    const path = await writeRecord(nextDay, '2026-11-02T00:00:00.000Z');
    const res = await runResume(nextDay, { offline: true }, new Date(), bufferIO());
    expect(res.precompactRecord).toEqual({ path, trigger: 'auto', generatedAt: '2026-11-02T00:00:00.000Z' });
  });

  it('345-01/AC-7: --list and --pick never carry the pointer', async () => {
    const root = await makeRepo();
    await writeRecord(root, '2026-11-02T18:19:23.456Z');
    const listed = await runResume(root, { list: true, offline: true }, new Date(), bufferIO());
    expect(listed).not.toHaveProperty('precompactRecord');
    const picked = await runResume(root, { pick: 1, offline: true }, new Date(), bufferIO());
    expect(picked.found).toBe(true);
    expect(picked).not.toHaveProperty('precompactRecord');
    const plain = await runResume(root, { offline: true }, new Date(), bufferIO());
    expect(plain).toHaveProperty('precompactRecord');
  });

  it('345-01/AC-7: a lookup failure (unreadable record dir, malformed record) contributes nothing', async () => {
    const asFile = await makeRepo();
    await mkdir(join(asFile, '.cadence', 'local'), { recursive: true });
    await writeFile(join(asFile, '.cadence', 'local', 'precompact'), 'not a directory');
    expect(norm((await run(['resume', '--json', '--offline'], asFile)).stdout, asFile)).toBe(BEFORE_FOUND_JSON_OFFLINE);

    const malformed = await makeRepo({ session: null });
    await mkdir(join(malformed, '.cadence', 'local', 'precompact'), { recursive: true });
    await writeFile(join(malformed, '.cadence', 'local', 'precompact', 'PRECOMPACT-20261102T181923.456Z.md'), 'no front matter');
    expect((await run(['resume'], malformed)).stdout).toBe(BEFORE_NOT_FOUND_TEXT);
    expect((await run(['resume', '--json'], malformed)).stdout).toBe(BEFORE_NOT_FOUND_JSON);
  });
});

describe('345-01 AC-7: the pure comparison rule', () => {
  it('345-01/AC-7: isPrecompactRecordNewer follows generated_at, the end-of-file-date fallback, and the no-SESSION rule', () => {
    const dated = { generatedAt: '2026-11-01T10:00:00.000Z', path: '/x/.cadence/handoff/SESSION-2026-11-01-a.md' };
    const undated = { generatedAt: null, path: '/x/.cadence/handoff/SESSION-2026-11-01-a.md' };
    expect(isPrecompactRecordNewer('2026-11-01T10:00:00.001Z', dated)).toBe(true);
    expect(isPrecompactRecordNewer('2026-11-01T10:00:00.000Z', dated)).toBe(false);
    expect(isPrecompactRecordNewer('2026-11-01T23:59:59.999Z', undated)).toBe(false);
    expect(isPrecompactRecordNewer('2026-11-02T00:00:00.000Z', undated)).toBe(true);
    expect(isPrecompactRecordNewer('2000-01-01T00:00:00.000Z', null)).toBe(true);
    expect(isPrecompactRecordNewer('not a date', null)).toBe(false);
    expect(isPrecompactRecordNewer('2026-11-02T00:00:00.000Z', { generatedAt: null, path: 'custom.md' })).toBe(false);
  });

  it('345-01/AC-7: renderPrecompactPointerLine names path, trigger and time on one line', () => {
    const line = renderPrecompactPointerLine({ path: '.cadence/local/precompact/P.md', trigger: 'au\nto', generatedAt: '2026-11-02T18:19:23.456Z' });
    expect(line).toBe('Pre-compaction record: .cadence/local/precompact/P.md (trigger: au to, 2026-11-02T18:19:23.456Z) — newer than any SESSION handoff');
    expect(line).not.toContain('\n');
  });
});
