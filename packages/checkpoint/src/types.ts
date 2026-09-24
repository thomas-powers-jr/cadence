export type DiagnosticCode =
  | 'SECTION_MISSING'
  | 'SECTION_OUT_OF_ORDER'
  | 'SECTION_HEADER_MISMATCH'
  | 'AC_ID_NON_NUMERIC'
  | 'AC_ID_MALFORMED'
  | 'AC_ID_DUPLICATE'
  | 'AC_LIST_EMPTY'
  | 'MEASURED_CONTEXT_MISSING_COMMAND'
  | 'OPEN_DECISIONS_EMPTY_NOT_EXPLICIT'
  | 'RESUME_CORE_OVER_BUDGET'
  | 'EMPTY_FILE'
  | 'NON_UTF8_INPUT'
  | 'HANDOFF_VERSION_UNSUPPORTED';

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  section?: string;
  line?: number;
}

// Reserved for future options (e.g. a custom resume-core budget); empty today.
// Record<string, never> (not `interface ValidateOptions {}`) so an empty
// object type isn't accidentally wide enough to accept any non-nullish value.
export type ValidateOptions = Record<string, never>;

/**
 * One entry in a handoff schema version's ordered section list. A required
 * section must be present; an optional one may be absent, but when present
 * it must still sit in its slot and still gets its section-specific checks.
 */
export interface SectionSpec {
  readonly name: string;
  readonly required: boolean;
}

export interface ValidateResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}
