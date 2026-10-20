// THROWAWAY PROBE for slice 331-02 (branch probe/331-02-timing; never merged).
//
// One instrumented `runStatusline` run in a fresh Node process, so it pays the
// same cold-start costs as the real wrapper. The record deadline is raised to
// 60 s so the full recording time is observed instead of being cut off at
// 250 ms. Prints one JSON line of timings (ms, relative to this process's
// performance.timeOrigin) to its own stdout.
//
// argv: <projectDir> <payloadPath> <innerPath>
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

const t0 = performance.now();
const [projectDir, payloadPath, innerPath] = process.argv.slice(2);
const { runStatusline } = await import(new URL('../dist/sensor.js', import.meta.url));
const { atomicWriteText } = await import('@thomas-powers-jr/cadence-core');
const tImported = performance.now();

const input = readFileSync(payloadPath);
const m = { notices: [] };
const tRun = performance.now();
const code = await runStatusline({
  argv: [process.execPath, innerPath],
  stdin: [input],
  stdout: {
    write: () => {
      m.innerClosed ??= performance.now();
      return true;
    },
  },
  stderr: {
    write: (s) => {
      m.notices.push(String(s).trim());
      return true;
    },
  },
  cwdFallback: projectDir,
  recordDeadlineMs: 60000,
  writeReading: async (path, text) => {
    m.writeEnter = performance.now();
    await mkdir(dirname(path), { recursive: true });
    m.mkdirDone = performance.now();
    await atomicWriteText(path, text);
    m.writeDone = performance.now();
  },
});
const tResolved = performance.now();

const rel = (x) => (x === undefined ? null : Math.round((x - tRun) * 10) / 10);
const r1 = (x) => Math.round(x * 10) / 10;
process.stdout.write(
  JSON.stringify({
    code,
    // performance.now() at the first line = time since this process began.
    nodeStartupMs: r1(t0),
    importMs: r1(tImported - t0),
    innerClosedMs: rel(m.innerClosed),
    parseWalkMs: rel(m.writeEnter),
    mkdirMs: m.mkdirDone !== undefined && m.writeEnter !== undefined ? r1(m.mkdirDone - m.writeEnter) : null,
    atomicWriteMs: m.writeDone !== undefined && m.mkdirDone !== undefined ? r1(m.writeDone - m.mkdirDone) : null,
    writeDoneMs: rel(m.writeDone),
    exitToWrittenMs:
      m.writeDone !== undefined && m.innerClosed !== undefined ? r1(m.writeDone - m.innerClosed) : null,
    resolvedMs: rel(tResolved),
    notices: m.notices,
  }) + '\n',
);
