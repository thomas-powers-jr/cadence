import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const BIN = join(__dirname, '..', 'bin', 'checkpoint.cjs');
const FIXTURES = join(__dirname, 'fixtures', 'statusline');
const INNER = join(FIXTURES, 'inner-statusline.cjs');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
// Each writer's invocations run one after another, so this test takes about
// INVOCATIONS_PER_WRITER x one invocation's wall time. 331-02 cut it from 15
// to 8: on PR #571 run 39461022835 (macos-latest, under suite load, after the
// process-hop cut) one invocation measured p50 999 ms / p90 1446 ms, and
// 15 x 1446 ms is 21.7 s, over macOS's shared 20 s budget; 8 x 1446 ms is
// 11.6 s. Both payloads were still observed thousands of times per run.
const INVOCATIONS_PER_WRITER = 8;
const TRANSIENT_READ_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOENT']);

type Json = Record<string, unknown>;

let tmp: string;
let project: string;

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'checkpoint-sensor-concurrency-')));
  project = join(tmp, 'project');
  mkdirSync(join(project, '.cadence'), { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function payloadWith(usedPercentage: number, totalInput: number): Json {
  const payload = JSON.parse(readFileSync(join(FIXTURES, 'payload-42.json'), 'utf8')) as Json;
  payload['cwd'] = project;
  payload['workspace'] = { current_dir: project, project_dir: project };
  const cw = payload['context_window'] as Json;
  cw['used_percentage'] = usedPercentage;
  cw['remaining_percentage'] = 100 - usedPercentage;
  cw['total_input_tokens'] = totalInput;
  return payload;
}

/** What the sensor must record for a payload, minus the per-write ts. */
function expectedShape(payload: Json): Json {
  const cw = payload['context_window'] as Json;
  return {
    used_percentage: cw['used_percentage'],
    unknown: false,
    absolute: {
      total_input_tokens: cw['total_input_tokens'],
      total_output_tokens: cw['total_output_tokens'],
      context_window_size: cw['context_window_size'],
      current_usage: cw['current_usage'],
    },
    exceeds_200k_tokens: payload['exceeds_200k_tokens'],
    current_dir: project,
    project_dir: project,
  };
}

interface Invocation {
  status: number | null;
  stdout: Buffer;
  stderr: string;
  /** Spawn-to-close wall time of this one wrapper invocation. */
  wallMs: number;
}

/** Nearest-rank percentile of an ascending-sorted, non-empty list. */
function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? Number.NaN;
}

function invokeWrapper(input: Buffer): Promise<Invocation> {
  return new Promise((resolvePromise, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, [BIN, 'statusline', '--', process.execPath, INNER], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', reject);
    child.on('close', (status) => {
      resolvePromise({
        status,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8'),
        wallMs: performance.now() - started,
      });
    });
    child.stdin.end(input);
  });
}

async function writerLoop(input: Buffer): Promise<Invocation[]> {
  const results: Invocation[] = [];
  for (let i = 0; i < INVOCATIONS_PER_WRITER; i++) results.push(await invokeWrapper(input));
  return results;
}

describe('checkpoint statusline under concurrent writers', () => {
  it('331-01/AC-5 and 331-02/AC-4: concurrent wrapper invocations never leave a torn reading.json, no .tmp sibling remains unless a deadline notice accounts for it, and per-invocation wall time is reported', async () => {
    const payloadA = payloadWith(42, 15500);
    const payloadB = payloadWith(17, 99999);
    const shapeA = expectedShape(payloadA);
    const shapeB = expectedShape(payloadB);
    const readingPath = join(project, '.cadence', 'checkpoint', 'reading.json');

    let done = false;
    let parsesA = 0;
    let parsesB = 0;
    const transient: Record<string, number> = {};
    const torn: string[] = [];
    const mismatched: string[] = [];

    const reader = (async (): Promise<void> => {
      while (!done) {
        let text: string | null = null;
        try {
          text = readFileSync(readingPath, 'utf8');
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code ?? 'UNKNOWN';
          if (!TRANSIENT_READ_CODES.has(code)) throw e;
          transient[code] = (transient[code] ?? 0) + 1;
        }
        if (text !== null) {
          // A read that succeeded but does not parse is a torn file: it is
          // recorded as a failure, never retried.
          let parsed: Json | null = null;
          try {
            parsed = JSON.parse(text) as Json;
          } catch {
            torn.push(text);
          }
          if (parsed !== null) {
            const { ts, ...shape } = parsed;
            const isA = isDeepStrictEqual(shape, shapeA);
            const isB = isDeepStrictEqual(shape, shapeB);
            if (typeof ts !== 'string' || !ISO.test(ts) || (!isA && !isB)) mismatched.push(text);
            if (isA) parsesA++;
            if (isB) parsesB++;
          }
        }
        await new Promise((r) => setTimeout(r, 1));
      }
    })();

    const [resultsA, resultsB] = await Promise.all([
      writerLoop(Buffer.from(JSON.stringify(payloadA))),
      writerLoop(Buffer.from(JSON.stringify(payloadB))),
    ]).finally(() => {
      done = true;
    });
    await reader;

    const all = [...resultsA, ...resultsB];
    const writeNotices = all.filter((r) => r.stderr.length > 0).map((r) => r.stderr.trim());
    const wall = all.map((r) => r.wallMs).sort((a, b) => a - b);
    const wallP50 = Math.round(percentile(wall, 50));
    const wallP90 = Math.round(percentile(wall, 90));
    // Measured evidence for the phase report (stderr, not stdout). The
    // per-invocation wall time is what sets this test's duration: each writer
    // runs its invocations one after another (331-02).
    process.stderr.write(
      `[331-01/AC-5] parsesA=${parsesA} parsesB=${parsesB} transient=${JSON.stringify(transient)} ` +
        `torn=${torn.length} writeNotices=${writeNotices.length} wallP50Ms=${wallP50} wallP90Ms=${wallP90} ` +
        `invocations=${all.length}${writeNotices.length > 0 ? ` first=${JSON.stringify(writeNotices[0])}` : ''}\n`,
    );
    expect(Number.isFinite(wallP50) && wallP50 > 0).toBe(true);
    expect(wallP90).toBeGreaterThanOrEqual(wallP50);

    expect(all).toHaveLength(2 * INVOCATIONS_PER_WRITER);
    for (const r of all) expect(r.status).toBe(0);
    expect(torn).toEqual([]);
    expect(mismatched).toEqual([]);
    expect(parsesA).toBeGreaterThan(0);
    expect(parsesB).toBeGreaterThan(0);
    // A write that loses the rename race is a reported notice, never a torn file.
    for (const notice of writeNotices) expect(notice).toMatch(/^checkpoint statusline: /);

    // As built: a write abandoned at the record deadline may leave its temp
    // sibling, and always says so; any other leftover is a failure.
    const deadlineNotices = writeNotices.filter((n) => /reading not recorded within \d+ ms/.test(n)).length;
    const leftovers = readdirSync(join(project, '.cadence', 'checkpoint')).filter((n) => n.endsWith('.tmp'));
    expect(leftovers.length).toBeLessThanOrEqual(deadlineNotices);
    for (const name of leftovers) expect(name).toMatch(/^reading\.json\.\d+\.[0-9a-f]+\.tmp$/);
    const final = JSON.parse(readFileSync(readingPath, 'utf8')) as Json;
    const { ts: _ts, ...finalShape } = final;
    expect(isDeepStrictEqual(finalShape, shapeA) || isDeepStrictEqual(finalShape, shapeB)).toBe(true);
  });
});
