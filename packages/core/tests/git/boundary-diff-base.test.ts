import { describe, it, expect } from 'vitest';
import { resolveMergeBase } from '../../src/git/boundary-diff.js';

/**
 * A scripted fake git runner: each call's args are recorded, and the answer
 * comes from `script[args.join(' ')]`. A key whose value is an array is
 * consumed in order across repeated calls; a missing key (or an exhausted
 * array) answers `''`, as `gitBestEffort` does on any failure.
 */
function scriptedRunner(script: Record<string, string | string[]>): {
  git: (root: string, args: string[]) => Promise<string>;
  calls: string[];
} {
  const calls: string[] = [];
  const queues = new Map<string, string[]>();
  for (const [key, value] of Object.entries(script)) {
    queues.set(key, Array.isArray(value) ? [...value] : [value]);
  }
  const git = (_root: string, args: string[]): Promise<string> => {
    const key = args.join(' ');
    calls.push(key);
    const queue = queues.get(key);
    const answer = queue && queue.length > 0 ? queue.shift() : '';
    return Promise.resolve(answer ?? '');
  };
  return { git, calls };
}

const UPSTREAM_MB = 'merge-base origin/main HEAD';
const UPSTREAM_REF = 'rev-parse --verify --quiet refs/remotes/origin/main';
const SHALLOW = 'rev-parse --is-shallow-repository';
const LOCAL_MB = 'merge-base main HEAD';

describe('resolveMergeBase', () => {
  it('351-01/AC-1 (a): the upstream merge-base answers on the first call', async () => {
    const { git, calls } = scriptedRunner({ [UPSTREAM_MB]: ['aaa\n'] });
    expect(await resolveMergeBase('/repo', 'main', git)).toStrictEqual({ base: 'aaa', source: 'upstream' });
    expect(calls).toStrictEqual([UPSTREAM_MB]);
  });

  it('351-01/AC-1 (b): an empty first upstream answer is retried once', async () => {
    const { git, calls } = scriptedRunner({ [UPSTREAM_MB]: ['', 'aaa\n'] });
    expect(await resolveMergeBase('/repo', 'main', git)).toStrictEqual({ base: 'aaa', source: 'upstream' });
    expect(calls).toStrictEqual([UPSTREAM_MB, UPSTREAM_MB]);
  });

  it('351-01/AC-1 (c): upstream ref resolves but merge-base fails, not shallow — upstream-failed, no local call', async () => {
    const { git, calls } = scriptedRunner({
      [UPSTREAM_MB]: ['', ''],
      [UPSTREAM_REF]: ['bbb\n'],
      [SHALLOW]: ['false\n'],
      [LOCAL_MB]: ['ccc\n'],
    });
    expect(await resolveMergeBase('/repo', 'main', git)).toStrictEqual({
      base: null,
      source: 'upstream-failed',
      shallow: false,
    });
    expect(calls).toStrictEqual([UPSTREAM_MB, UPSTREAM_MB, UPSTREAM_REF, SHALLOW]);
  });

  it('351-01/AC-1 (d): upstream ref resolves but merge-base fails in a shallow clone — upstream-failed, shallow', async () => {
    const { git, calls } = scriptedRunner({
      [UPSTREAM_MB]: ['', ''],
      [UPSTREAM_REF]: ['bbb\n'],
      [SHALLOW]: ['true\n'],
      [LOCAL_MB]: ['ccc\n'],
    });
    expect(await resolveMergeBase('/repo', 'main', git)).toStrictEqual({
      base: null,
      source: 'upstream-failed',
      shallow: true,
    });
    expect(calls).toStrictEqual([UPSTREAM_MB, UPSTREAM_MB, UPSTREAM_REF, SHALLOW]);
  });

  it('351-01/AC-1 (e): upstream ref does not resolve — falls back to the local merge-base', async () => {
    const { git, calls } = scriptedRunner({
      [UPSTREAM_MB]: ['', ''],
      [UPSTREAM_REF]: [''],
      [LOCAL_MB]: ['ccc\n'],
    });
    expect(await resolveMergeBase('/repo', 'main', git)).toStrictEqual({ base: 'ccc', source: 'local' });
    expect(calls).toStrictEqual([UPSTREAM_MB, UPSTREAM_MB, UPSTREAM_REF, LOCAL_MB]);
  });

  it('351-01/AC-1: a whitespace-only upstream-ref answer is trimmed to empty and reads as not resolving', async () => {
    const { git, calls } = scriptedRunner({ [UPSTREAM_MB]: ['', ''], [UPSTREAM_REF]: ['\n'], [LOCAL_MB]: ['ccc\n'] });
    expect(await resolveMergeBase('/repo', 'main', git)).toStrictEqual({ base: 'ccc', source: 'local' });
    expect(calls).toStrictEqual([UPSTREAM_MB, UPSTREAM_MB, UPSTREAM_REF, LOCAL_MB]);
  });

  it('351-01/AC-1 (f): every call answers empty — none', async () => {
    const { git, calls } = scriptedRunner({});
    expect(await resolveMergeBase('/repo', 'main', git)).toStrictEqual({ base: null, source: 'none' });
    expect(calls).toStrictEqual([UPSTREAM_MB, UPSTREAM_MB, UPSTREAM_REF, LOCAL_MB]);
  });
});
