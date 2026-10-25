/**
 * CSV with a header row (RFC 4180 quoting, CRLF or LF). The delimiter (`,` or `;`) is detected
 * from the header line; bytes are decoded as UTF-8 (BOM optional) and fall back to Windows-1250
 * when they are not valid UTF-8 — reported as file-level warning 1061.
 */
import { type IngestIssue, type IngestWarning, issue, WarningCode, warning } from "../codes.ts";

export interface DecodedText {
  readonly text: string;
  readonly encoding: "utf-8" | "windows-1250";
  readonly warnings: IngestWarning[];
}

export function decodeText(bytes: Uint8Array, allowCp1250: boolean): DecodedText | IngestIssue {
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const body = bytes.subarray(start);
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(body),
      encoding: "utf-8",
      warnings: [],
    };
  } catch {
    if (!allowCp1250) return issue("parse_error", "Vstup není platné UTF-8.");
    return {
      text: new TextDecoder("windows-1250").decode(body),
      encoding: "windows-1250",
      warnings: [
        warning(
          WarningCode.ENCODING_CP1250,
          "Soubor není v UTF-8; dekódován jako Windows-1250 (CP1250).",
        ),
      ],
    };
  }
}

export interface CsvRecord {
  /** 1-based physical line where the record starts. */
  readonly line: number;
  readonly fields: string[];
}

export interface CsvTable {
  readonly delimiter: "," | ";";
  readonly header: string[];
  readonly records: CsvRecord[];
}

function detectDelimiter(text: string): "," | ";" {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch === ",") commas++;
    else if (!quoted && ch === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}

export function parseCsv(input: string): CsvTable | IngestIssue {
  const text = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let fieldWasQuoted = false;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    fields.push(field);
    field = "";
    fieldWasQuoted = false;
  };
  const endRecord = () => {
    endField();
    if (!(fields.length === 1 && fields[0] === "")) rows.push({ line: recordLine, fields });
    fields = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field !== "" || fieldWasQuoted) {
        return issue("parse_error", `CSV řádek ${line}: uvozovka uprostřed neuvozeného pole.`);
      }
      quoted = true;
      fieldWasQuoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (quoted) return issue("parse_error", `CSV řádek ${recordLine}: neukončené uvozovky.`);
  if (field !== "" || fields.length > 0 || fieldWasQuoted) endRecord();

  const [header, ...records] = rows;
  if (header === undefined) return issue("parse_error", "CSV neobsahuje hlavičku.");
  return { delimiter, header: header.fields.map((h) => h.trim()), records };
}
