/**
 * Stable warning and issue codes of @eet-gateway/ingest — public API that integrators branch on,
 * documented in docs/INGEST.md. Never renumber; add new codes instead.
 *
 * Warnings 1–7 predict the pass-through warnings EET itself would return (rozhraní §2.2.4,
 * §3.4.4) and keep EET's numbers; `source: "ingest"` tells them apart from real EET answers.
 * Warnings 1001+ report a conversion ingest made to the caller's input.
 */

export const WarningCode = {
  /** Predicted EET warning 1: eic_popl differs from the EIČ in the register's certificate. */
  EET_EIC_CERTIFICATE_MISMATCH: 1,
  /** Predicted EET warning 4: dat_trzby is more than 2 hours in the future. */
  EET_SALE_IN_FUTURE: 4,
  /** Predicted EET warning 5: dat_trzby more than 2 years old or before the environment minimum. */
  EET_SALE_TOO_OLD: 5,
  /** Predicted EET warning 6: id_jednotky not shaped like a DIS+ unit number. */
  EET_UNIT_FORMAT: 6,
  /** Predicted EET warning 7: eic_poverujiciho equals eic_popl. */
  EET_SAME_EIC: 7,

  AMOUNT_FROM_NUMBER: 1001,
  AMOUNT_DECIMAL_COMMA: 1002,
  AMOUNT_REFORMATTED: 1003,
  DATETIME_ASSUMED_TIME_ZONE: 1011,
  DATETIME_CONVERTED_TIME_ZONE: 1012,
  DATETIME_FRACTION_TRUNCATED: 1013,
  DATETIME_FROM_EPOCH: 1014,
  DATETIME_FROM_CZECH_FORMAT: 1015,
  DATETIME_FROM_DATE: 1016,
  DATETIME_AMBIGUOUS: 1017,
  DATETIME_REFORMATTED: 1018,
  DEFAULT_APPLIED: 1021,
  VALUE_TRIMMED: 1031,
  BOOLEAN_INTERPRETED: 1032,
  UNKNOWN_FIELD_IGNORED: 1041,
  HEADER_FIELD_IGNORED: 1042,
  LATE_FIRST_SUBMISSION: 1051,
  ENCODING_CP1250: 1061,
} as const;

export type WarningCodeValue = (typeof WarningCode)[keyof typeof WarningCode];

export type IssueCode =
  /** A mandatory field is missing (and no register default exists). */
  | "required"
  /** The value has an unusable type (e.g. an object where text is expected). */
  | "invalid_type"
  /** The value does not match the EET format of the field. */
  | "invalid_format"
  /** Characters outside the ASCII subset EET allows (rozhraní §3.1), typically diacritics. */
  | "non_ascii"
  /** An amount with more than two decimal places; ingest never rounds. */
  | "too_many_decimals"
  /** An amount or number outside the range allowed by the XSD. */
  | "out_of_range"
  /** A local time skipped by the switch to summer time. */
  | "nonexistent_local_time"
  /** Two input fields map to the same EET field with different values. */
  | "conflicting_fields"
  /** The CSV/JSON/NDJSON/XML source (or one of its rows) could not be parsed. */
  | "parse_error"
  /** The input format or construct is not supported (e.g. XML DOCTYPE). */
  | "unsupported_format";

export interface IngestWarning {
  readonly code: number;
  readonly message: string;
  readonly source: "ingest";
  readonly field?: string;
}

export interface IngestIssue {
  readonly code: IssueCode;
  readonly message: string;
  readonly field?: string;
}

export function warning(code: number, message: string, field?: string): IngestWarning {
  return field === undefined
    ? { code, message, source: "ingest" }
    : { code, message, source: "ingest", field };
}

export function issue(code: IssueCode, message: string, field?: string): IngestIssue {
  return field === undefined ? { code, message } : { code, message, field };
}

/** Result of normalizing one value: the canonical text, or issues — plus any warnings. */
export interface ValueResult {
  readonly value?: string;
  readonly warnings: IngestWarning[];
  readonly issues: IngestIssue[];
}
