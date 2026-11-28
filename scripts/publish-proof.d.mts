// Hand-written declarations for publish-proof.mjs (phase 357).
// Keep in step with the script: the parity test in
// packages/core/tests/scripts/script-declarations.test.ts compares export names.

/** The parts of a `spawnSync` result that `must` reads. */
export interface StepResult {
  status: number | null;
  stdout?: string | null | undefined;
  stderr?: string | null | undefined;
}

/** One step of the smoke loop: `[cmd, args, label, opts]`. */
export type LoopStep = [cmd: string, args: string[], label: string, opts: { cwd: string }];

/** Throws `Error(label)` (after printing the output to stderr) unless `r.status` is 0. */
export declare function must(r: StepResult | null | undefined, label: string): void;

export declare function exerciseLoopSteps(proj: string): LoopStep[];

/** Awaits `fn`, then always awaits `teardown`, even when `fn` throws. */
export declare function withUnconditionalTeardown<T>(
  fn: () => T | PromiseLike<T>,
  teardown: () => unknown,
): Promise<Awaited<T>>;
