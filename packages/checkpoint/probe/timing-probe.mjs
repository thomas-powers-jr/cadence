// THROWAWAY PROBE for slice 331-02 (branch probe/331-02-timing; never merged).
//
// Measures, on whatever machine runs it, how long the checkpoint statusline
// sensor takes, so 331-02's recording deadline (or a redesign) is set from
// data rather than a guess. Scenarios (each run is a fresh process, in order,
// so the cold first runs are visible by index):
//   inner     the inner statusline alone (baseline wall time)
//   wrapper   the real built wrapper, `bin/checkpoint.cjs statusline -- node
//             inner`, at the shipped 250 ms deadline: wall time, whether the
//             deadline notice fired, whether the reading actually landed
//   instr     probe-child.mjs: in-process runStatusline at a 60 s deadline,
//             split into parse+walk / mkdir / atomic write, and the key
//             number exitToWrittenMs (inner exit -> reading written)
//   conc      AC-5's shape: 2 concurrent writers x 15 wrapper invocations,
//             per-invocation wall time and total elapsed
//
// Output: one `[probe-331-02] {json}` line per run and one
// `[probe-331-02-summary] {json}` line per scenario, all on stdout.
//
// argv: <label> [runs=30] [scenarios=inner,wrapper,instr,conc]
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const BIN = join(PKG, 'bin', 'checkpoint.cjs');
const CHILD = join(HERE, 'probe-child.mjs');
const INNER = join(PKG, 'tests', 'fixtures', 'statusline', 'inner-statusline.cjs');
const PAYLOAD_SRC = join(PKG, 'tests', 'fixtures', 'statusline', 'payload-42.json');

const label = process.argv[2] ?? 'unlabelled';
const runs = Number.parseInt(process.argv[3] ?? '30', 10);
const scenarios = (process.argv[4] ?? 'inner,wrapper,instr,conc').split(',');
const meta = { label, platform: process.platform, node: process.versions.node, runs };

const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'probe-331-02-')));
const project = join(tmp, 'project');
mkdirSync(join(project, '.cadence'), { recursive: true });
const readingPath = join(project, '.cadence', 'checkpoint', 'reading.json');
const payload = JSON.parse(readFileSync(PAYLOAD_SRC, 'utf8'));
payload.cwd = project;
payload.workspace = { current_dir: project, project_dir: project };
const payloadPath = join(tmp, 'payload.json');
writeFileSync(payloadPath, JSON.stringify(payload));
const input = readFileSync(payloadPath);

function run(argv) {
  return new Promise((resolveRun, reject) => {
    const start = performance.now();
    const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out = [];
    const err = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('error', reject);
    child.on('close', (status) => {
      resolveRun({
        status,
        wallMs: Math.round((performance.now() - start) * 10) / 10,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8').trim(),
      });
    });
    child.stdin.end(input);
  });
}

function readingMtimeMs() {
  try {
    return statSync(readingPath).mtimeMs;
  } catch {
    return null;
  }
}

function emit(scenario, i, data) {
  process.stdout.write(`[probe-331-02] ${JSON.stringify({ ...meta, scenario, i, ...data })}\n`);
}

function stats(values) {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (v.length === 0) return { n: 0 };
  const rank = (p) => v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
  return { n: v.length, min: v[0], p50: rank(50), p90: rank(90), p99: rank(99), max: v[v.length - 1] };
}

function summary(scenario, fields, extra = {}) {
  process.stdout.write(`[probe-331-02-summary] ${JSON.stringify({ ...meta, scenario, ...fields, ...extra })}\n`);
}

if (scenarios.includes('inner')) {
  const wall = [];
  for (let i = 0; i < runs; i++) {
    const r = await run([process.execPath, INNER]);
    wall.push(r.wallMs);
    emit('inner', i, { status: r.status, wallMs: r.wallMs });
  }
  summary('inner', { wallMs: stats(wall), first5: wall.slice(0, 5) });
}

if (scenarios.includes('wrapper')) {
  const wall = [];
  let notices = 0;
  let missed = 0;
  for (let i = 0; i < runs; i++) {
    const before = readingMtimeMs();
    const r = await run([process.execPath, BIN, 'statusline', '--', process.execPath, INNER]);
    const after = readingMtimeMs();
    const notice = r.stderr.length > 0;
    const landed = after !== null && after !== before;
    if (notice) notices++;
    if (!landed) missed++;
    wall.push(r.wallMs);
    emit('wrapper', i, { status: r.status, wallMs: r.wallMs, notice, landed, stderr: r.stderr || undefined });
  }
  summary('wrapper', { wallMs: stats(wall), first5: wall.slice(0, 5) }, { deadlineNotices: notices, readingsNotLanded: missed });
}

if (scenarios.includes('instr')) {
  const cols = ['nodeStartupMs', 'importMs', 'innerClosedMs', 'parseWalkMs', 'mkdirMs', 'atomicWriteMs', 'writeDoneMs', 'exitToWrittenMs', 'resolvedMs'];
  const acc = Object.fromEntries(cols.map((c) => [c, []]));
  const wall = [];
  for (let i = 0; i < runs; i++) {
    const r = await run([process.execPath, CHILD, project, payloadPath, INNER]);
    let row = null;
    try {
      row = JSON.parse(r.stdout.trim().split('\n').pop());
    } catch {
      row = { parseError: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 400) };
    }
    for (const c of cols) if (row && typeof row[c] === 'number') acc[c].push(row[c]);
    wall.push(r.wallMs);
    emit('instr', i, { status: r.status, wallMs: r.wallMs, ...row });
  }
  const fields = Object.fromEntries(cols.map((c) => [c, stats(acc[c])]));
  summary('instr', { ...fields, wallMs: stats(wall), exitToWrittenFirst5: acc.exitToWrittenMs.slice(0, 5) });
}

if (scenarios.includes('conc')) {
  const per = [];
  let notices = 0;
  const writers = 2;
  const perWriter = 15;
  const start = performance.now();
  await Promise.all(
    Array.from({ length: writers }, async (_, w) => {
      for (let i = 0; i < perWriter; i++) {
        const r = await run([process.execPath, BIN, 'statusline', '--', process.execPath, INNER]);
        if (r.stderr.length > 0) notices++;
        per.push(r.wallMs);
        emit('conc', w * perWriter + i, { writer: w, status: r.status, wallMs: r.wallMs, notice: r.stderr.length > 0 });
      }
    }),
  );
  const totalMs = Math.round(performance.now() - start);
  summary('conc', { wallMs: stats(per) }, { totalMs, deadlineNotices: notices, invocations: writers * perWriter });
}

rmSync(tmp, { recursive: true, force: true });
