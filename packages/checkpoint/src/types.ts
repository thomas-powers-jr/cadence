export type DiagnosticCode =
  | 'SECTION_MISSING'
  | 'SECTION_OUT_OF_ORDER'
  | 'SECTION_HEADER_MISMATCH'
  | 'AC_ID_NON_NUMERIC'
  | 'AC_ID_DUPLICATE'
  | 'AC_LIST_EMPTY'
  | 'MEASURED_CONTEXT_MISSING_COMMAND'
  | 'OPEN_DECISIONS_EMPTY_NOT_EXPLICIT'
  | 'RESUME_CORE_OVER_BUDGET'
  | 'EMPTY_FILE'
  | 'NON_UTF8_INPUT';

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

export interface ValidateResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}
