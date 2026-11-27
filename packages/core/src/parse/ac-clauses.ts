/**
 * Phase 354 (rec-20261124-001): capture an AC block's Given, When and Then
 * clauses by the clause rule, shared by `parseDraftMd` and `parseSpecMd`.
 *
 * The legacy capture ran three unanchored regexes over the whole block, so a
 * capitalised `Then ` in the `### AC-N:` heading (or earlier in the Given
 * text) started the Then-text there. The clause rule:
 *
 * - the block's first line (the heading) is never searched;
 * - Given is found first, from the body's first character;
 * - When is found from one character past Given's start (or from the body's
 *   first character when there is no Given);
 * - Then is found from one character past When's start, else past Given's,
 *   else from the body's first character;
 * - each label prefers its first line-start occurrence within that range and
 *   falls back to its first inline occurrence, so a one-line
 *   `Given …, When …, Then …` AC parses as it always has;
 * - each clause is captured from its label with the legacy terminators and
 *   trimmed.
 *
 * A label is the word followed by one whitespace character, with no word
 * boundary required before it (as the legacy regexes matched). Input is
 * already LF-normalised by the callers.
 */
export interface AcClauses {
  given: string;
  when: string;
  then: string;
}

type Label = 'Given' | 'When' | 'Then';

const LINE_START: Record<Label, RegExp> = {
  Given: /(^|\n)Given\s/,
  When: /(^|\n)When\s/,
  Then: /(^|\n)Then\s/,
};
const INLINE: Record<Label, RegExp> = {
  Given: /Given\s/,
  When: /When\s/,
  Then: /Then\s/,
};

/** Index of `label` in `body` at or after `from`, by the clause rule; -1 if absent. */
function findLabel(body: string, label: Label, from: number): number {
  const tail = body.slice(from);
  const line = LINE_START[label].exec(tail);
  if (line) return from + line.index + (line[1] ?? '').length;
  const inline = INLINE[label].exec(tail);
  return inline ? from + inline.index : -1;
}

function capture(body: string, start: number, re: RegExp): string {
  if (start < 0) return '';
  return re.exec(body.slice(start))?.[1]?.trim() ?? '';
}

export function parseAcClauses(block: string): AcClauses {
  const nl = block.indexOf('\n');
  const body = nl < 0 ? '' : block.slice(nl + 1);
  const given = findLabel(body, 'Given', 0);
  const when = findLabel(body, 'When', given >= 0 ? given + 1 : 0);
  const thenFrom = when >= 0 ? when + 1 : given >= 0 ? given + 1 : 0;
  const then = findLabel(body, 'Then', thenFrom);
  return {
    given: capture(body, given, /^Given\s+([\s\S]+?)(?=\nWhen\s|\nThen\s|$)/),
    when: capture(body, when, /^When\s+([\s\S]+?)(?=\nThen\s|$)/),
    then: capture(body, then, /^Then\s+([\s\S]+)/),
  };
}
