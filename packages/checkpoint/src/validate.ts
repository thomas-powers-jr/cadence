import type { Diagnostic, ValidateOptions, ValidateResult } from './types.js';

const REQUIRED_SECTIONS = [
  'TL;DR for the next session',
  'State on handoff',
  'CADENCE context',
  'Acceptance criteria touched',
  'What landed this session',
  'Carry-forward gotchas',
  'Open decisions',
  'Next action',
] as const;

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

function looksNonUtf8(input: string): boolean {
  // A round-trip through the Buffer UTF-8 codec replaces invalid sequences
  // with U+FFFD; if that happens, the input wasn't valid UTF-8 text.
  return input.includes('�');
}

function splitLines(markdown: string): string[] {
  return markdown.split(/\r\n|\r|\n/);
}

function stripHeaderDecoration(rawLabel: string): string {
  const separatorIndex = rawLabel.indexOf(' · ');
  return separatorIndex === -1 ? rawLabel.trim() : rawLabel.slice(0, separatorIndex).trim();
}

function parseHeaders(lines: string[]): ParsedHeader[] {
  const headers: ParsedHeader[] = [];
  let inFence = false;

  lines.forEach((line, idx) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      headers.push({ raw: match[1] as string, label: stripHeaderDecoration(match[1] as string), line: idx + 1 });
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

function checkHeaders(headers: ParsedHeader[]): { diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const requiredSet = new Set<string>(REQUIRED_SECTIONS);

  for (const required of REQUIRED_SECTIONS) {
    const present = headers.some((h) => h.label === required);
    if (present) continue;

    const caseInsensitiveMatch = headers.find((h) => h.label.toLowerCase() === required.toLowerCase());
    if (caseInsensitiveMatch) {
      diagnostics.push({
        code: 'SECTION_HEADER_MISMATCH',
        section: required,
        line: caseInsensitiveMatch.line,
        message: `Header "## ${caseInsensitiveMatch.raw}" does not exactly match required text "## ${required}".`,
      });
    } else {
      diagnostics.push({
        code: 'SECTION_MISSING',
        section: required,
        message: `Required section "## ${required}" is missing.`,
      });
    }
  }

  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  const requiredHeaders = headers.filter((h) => requiredSet.has(h.label));
  const observedOrder = requiredHeaders.map((h) => h.label);
  const expectedOrder = REQUIRED_SECTIONS.filter((name) => observedOrder.includes(name));

  for (let i = 0; i < observedOrder.length; i++) {
    const actual = observedOrder[i];
    if (actual !== undefined && actual !== expectedOrder[i]) {
      const line = requiredHeaders[i]?.line;
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
  section.bodyLines.forEach((line, idx) => {
    const match = /^[-*]\s*(?:\*\*)?AC-(\S+?)(?:\*\*)?:/.exec(line.trim());
    if (match) {
      ids.push({ id: match[1] as string, line: section.headerLine + 1 + idx });
    }
  });

  const diagnostics: Diagnostic[] = [];

  if (ids.length === 0) {
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

    const hasCommand = /`[^`]+`/.test(line) && /\$|cadence|git|node|curl/.test(line);
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

export function validate(markdown: string, _opts?: ValidateOptions): ValidateResult {
  if (markdown.length === 0) {
    return {
      ok: false,
      diagnostics: [{ code: 'EMPTY_FILE', message: 'Input is empty.' }],
    };
  }

  if (looksNonUtf8(markdown)) {
    return {
      ok: false,
      diagnostics: [{ code: 'NON_UTF8_INPUT', message: 'Input contains invalid UTF-8 byte sequences.' }],
    };
  }

  const lines = splitLines(markdown);
  const headers = parseHeaders(lines);
  const { diagnostics: headerDiagnostics } = checkHeaders(headers);

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
