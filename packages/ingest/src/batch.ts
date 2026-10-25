/**
 * Batches: JSON (object or array), NDJSON, CSV and XML → one `IngestResult` per row, numbered
 * so callers can point users at the offending line. A broken row never hides the others; only a
 * source that cannot be read at all fails as a whole (`issues`).
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

const failed = (problem: IngestIssue, warnings: IngestWarning[] = []): BatchResult => ({
  rows: [],
  warnings,
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

function parseJsonRows(text: string, context: IngestContext): BatchResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return failed(issue("parse_error", `JSON: ${(error as Error).message}`));
  }
  const items = Array.isArray(value) ? value : [value];
  return {
    rows: items.map((item, index) => ({ row: index + 1, result: normalizeSale(item, context) })),
    warnings: [],
    issues: [],
  };
}

function parseNdjsonRows(text: string, context: IngestContext): BatchResult {
  const rows: BatchRow[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      rows.push({
        row: index + 1,
        result: {
          ok: false,
          issues: [issue("parse_error", `NDJSON: ${(error as Error).message}`)],
          warnings: [],
        },
      });
      return;
    }
    rows.push({ row: index + 1, result: normalizeSale(value, context) });
  });
  return { rows, warnings: [], issues: [] };
}

function parseCsvRows(
  text: string,
  context: IngestContext,
  warnings: IngestWarning[],
): BatchResult {
  const table = parseCsv(text);
  if ("code" in table) return failed(table, warnings);
  const rows = table.records.map((record): BatchRow => {
    if (record.fields.length > table.header.length) {
      return {
        row: record.line,
        result: {
          ok: false,
          issues: [
            issue(
              "parse_error",
              `CSV řádek ${record.line}: ${record.fields.length} polí, hlavička má ${table.header.length} (oddělovač "${table.delimiter}").`,
            ),
          ],
          warnings: [],
        },
      };
    }
    const object: Record<string, string> = {};
    table.header.forEach((name, i) => {
      if (name !== "") object[name] = record.fields[i] ?? "";
    });
    return { row: record.line, result: normalizeSale(object, context) };
  });
  return { rows, warnings, issues: [] };
}

function parseXmlRows(text: string, context: IngestContext): BatchResult {
  const sales = readXmlSales(text);
  if ("code" in sales) return failed(sales);
  const rows = sales.map((sale): BatchRow => {
    if (sale.data === undefined) {
      return {
        row: sale.line,
        result: {
          ok: false,
          issues: [issue("required", "Element Trzba neobsahuje Data.")],
          warnings: [],
        },
      };
    }
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
    const result = normalizeSale(input, context);
    return {
      row: sale.line,
      result: { ...result, warnings: [...headerWarnings, ...result.warnings] },
    };
  });
  return { rows, warnings: [], issues: [] };
}

/**
 * Parses a batch in one of the supported formats. `source` may be text or raw bytes; bytes must
 * be UTF-8, except CSV which also accepts Windows-1250.
 */
export function parseSales(
  source: string | Uint8Array,
  format: BatchFormat,
  context: IngestContext = {},
): BatchResult {
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
      return parseJsonRows(text, context);
    case "ndjson":
      return parseNdjsonRows(text, context);
    case "csv":
      return parseCsvRows(text, context, warnings);
    case "xml":
      return parseXmlRows(text, context);
    default:
      return failed(issue("unsupported_format", `Nepodporovaný formát "${String(format)}".`));
  }
}
