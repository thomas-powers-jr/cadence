import type { Diagnostic, SectionSpec, ValidateOptions, ValidateResult } from './types.js';

/**
 * Schema v1 (`cadence_handoff: 1`): the six sections `cadence handoff`
 * emitted before phase 316, frozen. "Acceptance criteria touched" is
 * optional — the generator never emitted it — but keeps its slot.
 */
export const SECTIONS_V1: readonly SectionSpec[] = Object.freeze([
  { name: 'TL;DR for the next session', required: true },
  { name: 'State on handoff', required: true },
  { name: 'CADENCE context', required: true },
  { name: 'Acceptance criteria touched', required: false },
  { name: 'What landed this session', required: true },
  { name: 'Carry-forward gotchas', required: true },
  { name: 'Next action', required: true },
]);

/**
 * Schema v2 (`cadence_handoff: 2`, and the latest version — used for
 * documents with no frontmatter or no `cadence_handoff` key): v1 plus a
 * required "Open decisions" between "Carry-forward gotchas" and "Next action".
 */
export const SECTIONS_V2: readonly SectionSpec[] = Object.freeze([
  { name: 'TL;DR for the next session', required: true },
  { name: 'State on handoff', required: true },
  { name: 'CADENCE context', required: true },
  { name: 'Acceptance criteria touched', required: false },
  { name: 'What landed this session', required: true },
  { name: 'Carry-forward gotchas', required: true },
  { name: 'Open decisions', required: true },
  { name: 'Next action', required: true },
]);

function requiredNames(spec: readonly SectionSpec[]): readonly string[] {
  return Object.freeze(spec.filter((s) => s.required).map((s) => s.name));
}

export const REQUIRED_SECTIONS_V1: readonly string[] = requiredNames(SECTIONS_V1);
export const REQUIRED_SECTIONS_V2: readonly string[] = requiredNames(SECTIONS_V2);

/**
 * Section schema per supported `cadence_handoff:` frontmatter value, keyed by
 * the exact trimmed value text (so `01`, `"1"`, `1.0` are all unsupported).
 * A Map, not an object literal, so a value like `constructor` can never hit
 * an inherited property.
 */
export const HANDOFF_SCHEMAS: ReadonlyMap<string, readonly SectionSpec[]> = new Map([
  ['1', SECTIONS_V1],
  ['2', SECTIONS_V2],
]);

/** The version a document with no `cadence_handoff` value is read as. */
export const LATEST_HANDOFF_VERSION = '2';

const RESUME_CORE_BUDGET = 10_000;
const RESUME_CORE_SECTIONS = ['TL;DR for the next session', 'Next action'];

interface ParsedSection {
  name: string;
  headerLine: number;
  bodyLines: string[];
}

interface ParsedHeader {
  raw: string;
  label: string;
  line: number;
}

interface Frontmatter {
  /** Index of the first line after the closing `---` (0 when there is no frontmatter). */
  bodyStart: number;
  /** Trimmed raw `cadence_handoff:` value and its 1-based line, when the key is present. */
  version?: { value: string; line: number };
}

function splitLines(markdown: string): string[] {
  return markdown.split(/\r\n|\r|\n/);
}

/**
 * Reads a leading `---` … `---` YAML frontmatter block. Only a block that
 * opens on the very first line and is properly closed counts; anything else
 * is ordinary body text. Only the top-level `cadence_handoff:` key is read.
 */
function parseFrontmatter(lines: string[]): Frontmatter {
  if (lines[0]?.trimEnd() !== '---') return { bodyStart: 0 };
  const close = lines.findIndex((line, idx) => idx > 0 && line.trimEnd() === '---');
  if (close === -1) return { bodyStart: 0 };

  for (let idx = 1; idx < close; idx++) {
    const match = /^cadence_handoff:(.*)$/.exec(lines[idx] as string);
    if (match) {
      return { bodyStart: close + 1, version: { value: (match[1] as string).trim(), line: idx + 1 } };
    }
  }
  return { bodyStart: close + 1 };
}

/**
 * The generator decorates some headers ("## State on handoff   ·  pre-filled
 * — verify, don't retype"); the section's label is the text before " · ".
 */
export function stripHeaderDecoration(rawLabel: string): string {
  const separatorIndex = rawLabel.indexOf(' · ');
  return separatorIndex === -1 ? rawLabel.trim() : rawLabel.slice(0, separatorIndex).trim();
}

/**
 * The `## ` section labels of a handoff document, in document order, exactly
 * as the validator sees them: leading frontmatter skipped, headers inside
 * fenced code blocks ignored, and " · " decoration stripped.
 */
export function extractHeaderLabels(markdown: string): string[] {
  const lines = splitLines(markdown);
  return parseHeaders(lines, parseFrontmatter(lines).bodyStart).map((h) => h.label);
}

function parseHeaders(lines: string[], startIdx = 0): ParsedHeader[] {
  const headers: ParsedHeader[] = [];
  let fenceChar: string | null = null;
  let fenceLen = 0;

  lines.forEach((line, idx) => {
    // Frontmatter is skipped by index, not sliced off, so reported line
    // numbers stay absolute to the file.
    if (idx < startIdx) return;
    const fenceMatch = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] as string;
      const rest = fenceMatch[2] as string;
      const char = marker[0] as string;
      const len = marker.length;
      if (fenceChar === null) {
        // An info string (```typescript) is legal on an opener.
        fenceChar = char;
        fenceLen = len;
      } else if (char === fenceChar && len >= fenceLen && rest.trim().length === 0) {
        // Closes only on a same-character run at least as long as the
        // opener, with nothing but whitespace after it — CommonMark never
        // treats a marker with an info string (```typescript) as a closer,
        // so a differently-charactered, shorter, or info-string-suffixed
        // marker nested inside an open fence is just fence content, not a
        // state change.
        fenceChar = null;
        fenceLen = 0;
      }
      return;
    }
    if (fenceChar !== null) return;

    // A single greedy \s+ followed by a single greedy .* to end-of-line —
    // not the lazy-middle + greedy-trailing-\s* shape CodeQL flags as a
    // polynomial ReDoS risk (overlapping quantifiers over \s create
    // exponential backtracking paths on adversarial input). trimEnd()
    // replaces the old trailing \s*.
    const match = /^##\s+(.*)$/.exec(line);
    if (match) {
      const raw = (match[1] as string).trimEnd();
      headers.push({ raw, label: stripHeaderDecoration(raw), line: idx + 1 });
    }
  });

  return headers;
}

function parseSections(lines: string[], headers: ParsedHeader[]): ParsedSection[] {
  return headers.map((header, i) => {
    const nextHeaderLine = headers[i + 1]?.line ?? lines.length + 1;
    const bodyLines = lines.slice(header.line, nextHeaderLine - 1);
    return { name: header.label, headerLine: header.line, bodyLines };
  });
}

function checkHeaders(headers: ParsedHeader[], spec: readonly SectionSpec[]): { diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const specNames = spec.map((s) => s.name);
  const specSet = new Set<string>(specNames);

  for (const { name, required } of spec) {
    const present = headers.some((h) => h.label === name);
    if (present) continue;

    // A near-miss header (wrong case) is reported for optional sections too:
    // "## acceptance criteria touched" is clearly an attempt at the section,
    // and silently treating it as an unknown section would skip its checks.
    const caseInsensitiveMatch = headers.find((h) => h.label.toLowerCase() === name.toLowerCase());
    if (caseInsensitiveMatch) {
      diagnostics.push({
        code: 'SECTION_HEADER_MISMATCH',
        section: name,
        line: caseInsensitiveMatch.line,
        message: `Header "## ${caseInsensitiveMatch.raw}" does not exactly match ${required ? 'required' : 'section'} text "## ${name}".`,
      });
    } else if (required) {
      diagnostics.push({
        code: 'SECTION_MISSING',
        section: name,
        message: `Required section "## ${name}" is missing.`,
      });
    }
  }

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  // Order is checked across every known section that is present — required
  // and optional alike — so an optional section still has to sit in its slot.
  const knownHeaders = headers.filter((h) => specSet.has(h.label));
  const observedOrder = knownHeaders.map((h) => h.label);
  const expectedOrder = specNames.filter((name) => observedOrder.includes(name));

  for (let i = 0; i < observedOrder.length; i++) {
    const actual = observedOrder[i];
    if (actual !== undefined && actual !== expectedOrder[i]) {
      const line = knownHeaders[i]?.line;
      diagnostics.push({
        code: 'SECTION_OUT_OF_ORDER',
        section: actual,
        message: `Section "## ${actual}" is out of order.`,
        ...(line !== undefined ? { line } : {}),
      });
      break;
    }
  }

  return { diagnostics };
}

function checkAcceptanceCriteria(sections: ParsedSection[]): Diagnostic[] {
  const section = sections.find((s) => s.name === 'Acceptance criteria touched');
  if (!section) return [];

  const ids: { id: string; line: number }[] = [];
  const diagnostics: Diagnostic[] = [];
  section.bodyLines.forEach((line, idx) => {
    const trimmed = line.trim();
    const lineNumber = section.headerLine + 1 + idx;
    // Bold is a matched pair: `**AC-1**:` or `**AC-1:**`, else plain `AC-1:`.
    // Two independent optional `**` groups used to read `AC-1**:` (a lone
    // closing bold) as id `1`. `*` is excluded from the id so a stray bold
    // marker can never be absorbed into it either.
    const match = /^[-*]\s*(?:\*\*AC-([^\s*]+?)(?:\*\*:|:\*\*)|AC-([^\s*]+?):)/.exec(trimmed);
    if (match) {
      ids.push({ id: (match[1] ?? match[2]) as string, line: lineNumber });
      return;
    }
    // A bullet that opens like an AC entry but that the id regex above could
    // not even read (`- AC-: x`, `- AC-1 : x`) used to be skipped silently.
    // Flag it instead — the same fail-loud rule core's parseDraftMd applies to
    // a malformed `### AC-` heading (phase 288). Bullets the regex does read
    // are left to the id checks below, so one bullet never gets two AC codes.
    if (/^[-*]\s*(?:\*\*)?AC-/.test(trimmed)) {
      diagnostics.push({
        code: 'AC_ID_MALFORMED',
        section: 'Acceptance criteria touched',
        line: lineNumber,
        message: `AC bullet "${trimmed}" does not match the form "- AC-<number>: <text>".`,
      });
    }
  });

  // A malformed AC bullet is still an attempt at an entry, so the list is only
  // "empty" when there is no AC-looking bullet at all.
  if (ids.length === 0 && diagnostics.length === 0) {
    diagnostics.push({
      code: 'AC_LIST_EMPTY',
      section: 'Acceptance criteria touched',
      message: 'No AC-N entries found under "Acceptance criteria touched".',
    });
    return diagnostics;
  }

  const seen = new Set<string>();
  for (const { id, line } of ids) {
    if (!/^\d+$/.test(id)) {
      diagnostics.push({
        code: 'AC_ID_NON_NUMERIC',
        section: 'Acceptance criteria touched',
        line,
        message: `AC id "AC-${id}" contains non-numeric characters; AC ids must be numeric only.`,
      });
      continue;
    }
    if (seen.has(id)) {
      diagnostics.push({
        code: 'AC_ID_DUPLICATE',
        section: 'Acceptance criteria touched',
        line,
        message: `AC id "AC-${id}" appears more than once.`,
      });
      continue;
    }
    seen.add(id);
  }

  return diagnostics;
}

function hasProducingCommand(line: string): boolean {
  // The command indicator must sit inside a code span, not just anywhere on
  // the line — otherwise unrelated prose text ("cadence note: 42% (see
  // `details`)") satisfies the check without ever naming a real command.
  const spanPattern = /`([^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = spanPattern.exec(line)) !== null) {
    if (/\$|cadence|git|node|curl/.test(match[1] as string)) return true;
  }
  return false;
}

function checkMeasuredContext(sections: ParsedSection[]): Diagnostic[] {
  const section = sections.find((s) => s.name === 'State on handoff');
  if (!section) return [];

  const diagnostics: Diagnostic[] = [];
  section.bodyLines.forEach((line, idx) => {
    // Narrow on purpose: only bare percentage figures, not any number. An
    // earlier version matched any 2+ digit number and false-fired on years
    // and phase numbers ("2026", "phase 311") in every real handoff.
    const percentageMatch = /\b\d+%/.exec(line);
    if (!percentageMatch) return;

    const hasCommand = hasProducingCommand(line);
    if (!hasCommand) {
      diagnostics.push({
        code: 'MEASURED_CONTEXT_MISSING_COMMAND',
        section: 'State on handoff',
        line: section.headerLine + 1 + idx,
        message: `Measured figure "${line.trim()}" has no producing command attached.`,
      });
    }
  });

  return diagnostics;
}

function checkOpenDecisions(sections: ParsedSection[]): Diagnostic[] {
  const section = sections.find((s) => s.name === 'Open decisions');
  if (!section) return [];

  const content = section.bodyLines.join('\n').trim();
  if (content.length === 0) {
    return [
      {
        code: 'OPEN_DECISIONS_EMPTY_NOT_EXPLICIT',
        section: 'Open decisions',
        line: section.headerLine,
        message: 'The "Open decisions" section is empty; write "None" explicitly if there are no open decisions.',
      },
    ];
  }

  return [];
}

function checkResumeCoreBudget(sections: ParsedSection[]): Diagnostic[] {
  const core = sections
    .filter((s) => RESUME_CORE_SECTIONS.includes(s.name))
    .map((s) => s.bodyLines.join('\n'))
    .join('\n');

  const length = Array.from(core).length; // count Unicode code points, not UTF-16 units

  if (length > RESUME_CORE_BUDGET) {
    return [
      {
        code: 'RESUME_CORE_OVER_BUDGET',
        message: `Resume core (TL;DR for the next session + Next action) is ${length} characters, over the ${RESUME_CORE_BUDGET}-character budget.`,
      },
    ];
  }

  return [];
}

export function validate(markdown: string | Buffer, _opts?: ValidateOptions): ValidateResult {
  let text: string;
  if (Buffer.isBuffer(markdown)) {
    // Only raw bytes can actually prove an encoding failure. A caller that
    // already decoded to a string may have done so permissively (Node's
    // default `.toString('utf8')` silently substitutes U+FFFD for bad
    // bytes) — by then, malformed input and a document that legitimately
    // quotes a literal "�" character are indistinguishable, so a string is
    // trusted as-is and never flagged NON_UTF8_INPUT.
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(markdown);
    } catch {
      return {
        ok: false,
        diagnostics: [{ code: 'NON_UTF8_INPUT', message: 'Input contains invalid UTF-8 byte sequences.' }],
      };
    }
  } else {
    text = markdown;
  }

  if (text.length === 0) {
    return {
      ok: false,
      diagnostics: [{ code: 'EMPTY_FILE', message: 'Input is empty.' }],
    };
  }

  const lines = splitLines(text);
  const frontmatter = parseFrontmatter(lines);

  // No frontmatter, or frontmatter without the key, reads as the latest
  // version. A value this validator doesn't know is refused outright rather
  // than validated against a guessed schema.
  const versionValue = frontmatter.version?.value ?? LATEST_HANDOFF_VERSION;
  const spec = HANDOFF_SCHEMAS.get(versionValue);
  if (spec === undefined) {
    const line = frontmatter.version?.line;
    return {
      ok: false,
      diagnostics: [
        {
          code: 'HANDOFF_VERSION_UNSUPPORTED',
          message: `Unsupported handoff schema version: cadence_handoff is "${versionValue}" (supported: ${[...HANDOFF_SCHEMAS.keys()].join(', ')}); sections were not validated.`,
          ...(line !== undefined ? { line } : {}),
        },
      ],
    };
  }

  const headers = parseHeaders(lines, frontmatter.bodyStart);
  const { diagnostics: headerDiagnostics } = checkHeaders(headers, spec);

  if (headerDiagnostics.length > 0) {
    return { ok: false, diagnostics: headerDiagnostics };
  }

  const sections = parseSections(lines, headers);

  const diagnostics: Diagnostic[] = [
    ...checkAcceptanceCriteria(sections),
    ...checkMeasuredContext(sections),
    ...checkOpenDecisions(sections),
    ...checkResumeCoreBudget(sections),
  ];

  return { ok: diagnostics.length === 0, diagnostics };
}
