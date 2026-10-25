/**
 * Batches: JSON (object or array), NDJSON, CSV and XML → one result per row, numbered so callers
 * can point users at the offending line. A broken row never hides the others; only a source that
 * cannot be read at all fails as a whole (`issues`).
 *
 * `readSales` only reads rows into plain input objects; `parseSales` also normalizes them.
 */
import { type IngestIssue, type IngestWarning, issue, WarningCode, warning } from "./codes.ts";
import { decodeText, parseCsv } from "./formats/csv.ts";
import { readXmlSales } from "./formats/xml.ts";
import { type IngestContext, type IngestResult, normalizeSale } from "./sale.ts";

export type BatchFormat = "json" | "ndjson" | "csv" | "xml";

export interface BatchRow {
  /** JSON array: 1-based position; NDJSON, CSV, XML: 1-based line in the source. */
  readonly row: number;
  readonly result: IngestResult;
}

export interface BatchResult {
  readonly rows: BatchRow[];
  /** About the whole source, e.g. CP1250 decoding. */
  readonly warnings: IngestWarning[];
  /** Non-empty when the source could not be read at all; `rows` is then empty. */
  readonly issues: IngestIssue[];
}

/** One row as read from the source, before normalization. */
export interface ReadRow {
  /** Same numbering as `BatchRow.row`. */
  readonly row: number;
  /** The sale as a plain object (or whatever a JSON row holds); absent when `issues` is not empty. */
  readonly input?: unknown;
  /** About this row's source, e.g. ignored `Hlavicka` attributes. */
  readonly warnings: IngestWarning[];
  /** The row could not be read (e.g. broken NDJSON line). */
  readonly issues: IngestIssue[];
}

export interface ReadResult {
  readonly rows: ReadRow[];
  readonly warnings: IngestWarning[];
  readonly issues: IngestIssue[];
}

const failed = (problem: IngestIssue, warnings: IngestWarning[] = []): ReadResult => ({
  rows: [],
  warnings,
  issues: [problem],
});
const readRow = (row: number, input: unknown, warnings: IngestWarning[] = []): ReadRow => ({
  row,
  input,
  warnings,
  issues: [],
});
const brokenRow = (row: number, problem: IngestIssue): ReadRow => ({
  row,
  warnings: [],
  issues: [problem],
});

/** Maps a `Content-Type` (parameters and case ignored) to a batch format. */
export function formatFromContentType(contentType: string): BatchFormat | undefined {
  const type = contentType.split(";")[0]?.trim().toLowerCase();
  switch (type) {
    case "application/json":
      return "json";
    case "application/x-ndjson":
    case "application/ndjson":
    case "application/jsonl":
      return "ndjson";
    case "text/csv":
      return "csv";
    case "application/xml":
    case "text/xml":
      return "xml";
    default:
      return undefined;
  }
}

/**
 * Reads a batch in one of the supported formats into plain input objects, without normalizing
 * them. `source` may be text or raw bytes; bytes must be UTF-8, except CSV which also accepts
 * Windows-1250.
 */
export function readSales(source: string | Uint8Array, format: BatchFormat): ReadResult {
  let text: string;
  const warnings: IngestWarning[] = [];
  if (typeof source === "string") {
    text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  } else {
    const decoded = decodeText(source, format === "csv");
    if ("code" in decoded) return failed(decoded);
    text = decoded.text;
    warnings.push(...decoded.warnings);
  }
  switch (format) {
    case "json":
      return readJsonRows(text);
    case "ndjson":
      return readNdjsonRows(text);
    case "csv":
      return readCsvRows(text, warnings);
    case "xml":
      return readXmlRows(text);
    default:
      return failed(issue("unsupported_format", `Nepodporovaný formát "${String(format)}".`));
  }
}

/** `readSales` + `normalizeSale` for every row. */
export function parseSales(
  source: string | Uint8Array,
  format: BatchFormat,
  context: IngestContext = {},
): BatchResult {
  const read = readSales(source, format);
  return {
    rows: read.rows.map(({ row, input, warnings, issues }) => {
      if (issues.length > 0) return { row, result: { ok: false, issues, warnings } };
      const result = normalizeSale(input, context);
      return { row, result: { ...result, warnings: [...warnings, ...result.warnings] } };
    }),
    warnings: read.warnings,
    issues: read.issues,
  };
}

function readJsonRows(text: string): ReadResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return failed(issue("parse_error", `JSON: ${(error as Error).message}`));
  }
  const items = Array.isArray(value) ? value : [value];
  return { rows: items.map((item, index) => readRow(index + 1, item)), warnings: [], issues: [] };
}

function readNdjsonRows(text: string): ReadResult {
  const rows: ReadRow[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return;
    try {
      rows.push(readRow(index + 1, JSON.parse(line)));
    } catch (error) {
      rows.push(brokenRow(index + 1, issue("parse_error", `NDJSON: ${(error as Error).message}`)));
    }
  });
  return { rows, warnings: [], issues: [] };
}

function readCsvRows(text: string, warnings: IngestWarning[]): ReadResult {
  const table = parseCsv(text);
  if ("code" in table) return failed(table, warnings);
  const rows = table.records.map((record): ReadRow => {
    if (record.fields.length > table.header.length) {
      return brokenRow(
        record.line,
        issue(
          "parse_error",
          `CSV řádek ${record.line}: ${record.fields.length} polí, hlavička má ${table.header.length} (oddělovač "${table.delimiter}").`,
        ),
      );
    }
    const object: Record<string, string> = {};
    table.header.forEach((name, i) => {
      if (name !== "") object[name] = record.fields[i] ?? "";
    });
    return readRow(record.line, object);
  });
  return { rows, warnings, issues: [] };
}

function readXmlRows(text: string): ReadResult {
  const sales = readXmlSales(text);
  if ("code" in sales) return failed(sales);
  const rows = sales.map((sale): ReadRow => {
    if (sale.data === undefined)
      return brokenRow(sale.line, issue("required", "Element Trzba neobsahuje Data."));
    const input: Record<string, string> = { ...sale.data };
    const headerWarnings: IngestWarning[] = [];
    if (sale.header !== undefined) {
      const { overeni, prvni_zaslani, ...rest } = sale.header;
      if (overeni !== undefined) input["overeni"] = overeni;
      if (prvni_zaslani !== undefined) input["prvni_zaslani"] = prvni_zaslani;
      const ignored = Object.keys(rest);
      if (ignored.length > 0) {
        headerWarnings.push(
          warning(
            WarningCode.HEADER_FIELD_IGNORED,
            `Hlavicka: ${ignored.join(", ")} se generuje znovu pro každý pokus o odeslání; hodnota ze vstupu ignorována.`,
          ),
        );
      }
    }
    return readRow(sale.line, input, headerWarnings);
  });
  return { rows, warnings: [], issues: [] };
}
