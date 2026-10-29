import { parseDraftMd } from './draft-parser.js';
import { CadenceError } from '../errors.js';
import { normalizeText, applyTextStyle, foldLineEndings as lf } from './text-normalize.js';

/**
 * Phase 151 — pure DRAFT.md mutation helpers. Each function takes the raw
 * DRAFT.md text and a payload, and returns updated raw text with exactly one
 * section spliced in the same byte format `renderDraftBody`/`parseDraftMd`
 * already round-trip (see draft-scaffold.ts's locked-format comment). These
 * are an *additive* write path — hand-editing DRAFT.md remains fully
 * supported and untouched by these helpers.
 *
 * Phase 339: each helper splices on normalized LF text (BOM stripped, CRLF
 * and lone CR folded) and writes the result back in the input's detected
 * style, so a CRLF or BOM draft keeps its encoding (rec-20260918-006).
 * Payload strings fold only their line endings (`lf`): a payload's leading
 * U+FEFF is content, so an LF draft edited with a \r-free payload is written
 * exactly as before.
 */

function highestNumericSuffix(ids: string[], re: RegExp): number {
  let max = 0;
  for (const id of ids) {
    const m = re.exec(id);
    if (!m) continue;
    const n = Number.parseInt(m[1]!, 10);
    if (n > max) max = n;
  }
  return max;
}

/** Replace only the `## Objective` section body with `text`. */
export function setObjective(rawInput: string, text: string): string {
  const { text: raw, ...style } = normalizeText(rawInput);
  const re = /(## Objective\n\n)([\s\S]*?)(\n\n## )/;
  if (!re.test(raw)) {
    throw new CadenceError('DRAFT.md missing a ## Objective section');
  }
  const out = raw.replace(re, (_m, pre: string, _body: string, post: string) => `${pre}${lf(text)}${post}`);
  return applyTextStyle(out, style);
}

export interface AddAcceptanceCriterionInput {
  given: string;
  when: string;
  then: string;
  name?: string;
}

/** Append a sequentially-numbered `### AC-N:` block to `## Acceptance Criteria`. */
export function addAcceptanceCriterion(rawInput: string, input: AddAcceptanceCriterionInput): string {
  const { text: raw, ...style } = normalizeText(rawInput);
  const draft = parseDraftMd(raw);
  const maxNum = highestNumericSuffix(
    draft.acceptanceCriteria.map((ac) => ac.id),
    /^AC-(\d+)$/,
  );
  const id = `AC-${maxNum + 1}`;
  const name = lf(input.name ?? '');
  const block = `### ${id}: ${name}\nGiven ${lf(input.given)}\nWhen ${lf(input.when)}\nThen ${lf(input.then)}`;

  const re = /(## Acceptance Criteria\n\n)([\s\S]*?)(\n\n## Tasks)/;
  if (!re.test(raw)) {
    throw new CadenceError('DRAFT.md missing a ## Acceptance Criteria section');
  }
  const out = raw.replace(
    re,
    (_m, pre: string, body: string, post: string) => `${pre}${body}\n\n${block}${post}`,
  );
  return applyTextStyle(out, style);
}

export interface AddTaskInput {
  files: string[];
  action: string;
  verify: string;
  /** AC ids this task's `done:` line references; each must already exist in the draft. */
  done: string[];
}

/**
 * Append a sequentially-numbered `### TN:` block to `## Tasks`. Throws
 * (leaving `rawInput` unmodified) if any `done` AC id is not present among the
 * draft's current acceptance criteria.
 */
export function addTask(rawInput: string, input: AddTaskInput): string {
  const { text: raw, ...style } = normalizeText(rawInput);
  const draft = parseDraftMd(raw);
  const knownAcIds = new Set(draft.acceptanceCriteria.map((ac) => ac.id));
  const unknown = input.done.filter((id) => !knownAcIds.has(id));
  if (unknown.length > 0) {
    throw new CadenceError(
      `add-task refused: unknown AC id(s) in --done: ${unknown.join(', ')}`,
    );
  }

  const maxNum = highestNumericSuffix(
    draft.tasks.map((t) => t.id),
    /^T(\d+)$/,
  );
  const id = `T${maxNum + 1}`;
  const filesStr = input.files.map((f) => `\`${lf(f)}\``).join(', ');
  const doneStr = input.done.join(', ');
  const block = `### ${id}: \n- files: ${filesStr}\n- action: ${lf(input.action)}\n- verify: ${lf(input.verify)}\n- done: ${doneStr}`;

  const re = /(## Tasks\n\n)([\s\S]*?)(\n\n## Boundaries)/;
  if (!re.test(raw)) {
    throw new CadenceError('DRAFT.md missing a ## Tasks section');
  }
  const out = raw.replace(
    re,
    (_m, pre: string, body: string, post: string) => `${pre}${body}\n\n${block}${post}`,
  );
  return applyTextStyle(out, style);
}
