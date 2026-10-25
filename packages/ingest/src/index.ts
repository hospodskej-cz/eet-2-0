/**
 * @eet-gateway/ingest — turns sales in any common shape (JS object, JSON, NDJSON, CSV, XML) into
 * validated EET data, reporting every conversion as a warning. Pure functions without I/O; runs
 * on Node 22+, Bun and Deno. Rules, aliases and codes: docs/INGEST.md.
 */

export {
  type BatchFormat,
  type BatchResult,
  type BatchRow,
  formatFromContentType,
  parseSales,
} from "./batch.ts";
export { type IngestIssue, type IngestWarning, type IssueCode, WarningCode } from "./codes.ts";
export {
  type CanonicalField,
  DATA_FIELDS,
  FIELD_ALIASES,
  type FieldMap,
  normalizeKey,
  OPTION_FIELDS,
} from "./fields.ts";
export {
  type IngestContext,
  type IngestResult,
  type NormalizedSale,
  normalizeSale,
  type RegisterDefaults,
  type SaleInput,
  SaleInputSchema,
} from "./sale.ts";

export const VERSION = "0.0.0";
