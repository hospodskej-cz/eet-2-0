/** Reading sales from a file or stdin and telling their format. */
import type { BatchFormat } from "@eet-gateway/ingest";
import { type CliIO, UsageError } from "./context.ts";

const FORMATS: readonly BatchFormat[] = ["csv", "json", "ndjson", "xml"];
const EXTENSIONS: Readonly<Record<string, BatchFormat>> = {
  csv: "csv",
  json: "json",
  ndjson: "ndjson",
  jsonl: "ndjson",
  xml: "xml",
};

export async function readInput(
  io: CliIO,
  path: string | undefined,
  format: string | undefined,
): Promise<{ source: Uint8Array; format: BatchFormat }> {
  if (path === undefined) throw new UsageError("chybí soubor s tržbami (nebo - pro stdin)");
  let chosen: BatchFormat | undefined;
  if (format !== undefined) {
    if (!(FORMATS as readonly string[]).includes(format))
      throw new UsageError(`--format: ${FORMATS.join(", ")}`);
    chosen = format as BatchFormat;
  } else if (path !== "-") {
    chosen = EXTENSIONS[path.split(".").pop()?.toLowerCase() ?? ""];
  }
  if (chosen === undefined)
    throw new UsageError(
      path === "-"
        ? "pro stdin uveď --format csv|json|ndjson|xml"
        : `formát souboru ${path} nepoznám; uveď --format csv|json|ndjson|xml`,
    );
  const source = path === "-" ? await io.readStdin() : await io.readFile(path);
  return { source, format: chosen };
}
