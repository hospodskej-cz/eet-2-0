/**
 * Golden files: every input in test/fixtures/ingest/input/ is parsed with a fixed clock (plus an
 * optional context/<name>.json) and compared with expected/<name>.json. Regenerate after an
 * intended change with `UPDATE_GOLDEN=1 bun test packages/ingest` and review the diff.
 *
 * Every successfully ingested row is also turned into a `<Trzba>` by the protocol library and
 * validated against the official XSD — ingest output must always be sendable.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serializeUnsignedRequest } from "@finitoapp/eet-client";
import { parseEetReceiptData, parseHeader } from "@finitoapp/eet-client/builtin";
import { extractTrzba, validateAgainstXsd } from "../../../test/contract/xmllint.ts";
import { type BatchFormat, type IngestContext, parseSales } from "../src/index.ts";

const DIR = fileURLToPath(new URL("../../../test/fixtures/ingest/", import.meta.url));
const NOW = "2026-11-15T12:00:00+01:00";
const FORMATS: Record<string, BatchFormat> = {
  csv: "csv",
  json: "json",
  ndjson: "ndjson",
  xml: "xml",
};
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

async function contextFor(name: string): Promise<IngestContext> {
  const file = Bun.file(`${DIR}context/${name}.json`);
  const extra = (await file.exists()) ? ((await file.json()) as IngestContext) : {};
  return { ...extra, now: () => new Date(NOW) };
}

function toTrzbaXml(
  data: Record<string, unknown>,
  overeni: boolean,
  prvni_zaslani: boolean,
): string {
  const parsed = parseEetReceiptData(data as never);
  const header = parseHeader({
    uuid: "e23e5a5a-08d7-4a08-844d-2b6c6b60621d",
    sentAt: "2026-11-15T12:00:00+01:00",
    firstSubmission: prvni_zaslani,
    verification: overeni,
  });
  if (!parsed.ok || !header.ok) throw new Error("protocol library rejected ingest output");
  return extractTrzba(serializeUnsignedRequest(parsed.value, header.value));
}

describe("golden files", () => {
  for (const name of readdirSync(`${DIR}input`).sort()) {
    const format = FORMATS[name.split(".").pop() ?? ""];
    if (format === undefined) continue;

    test(name, async () => {
      const bytes = new Uint8Array(await Bun.file(`${DIR}input/${name}`).arrayBuffer());
      const result = parseSales(bytes, format, await contextFor(name));
      const actual = `${JSON.stringify(result, null, 2)}\n`;
      const expectedFile = Bun.file(`${DIR}expected/${name}.json`);
      if (UPDATE || !(await expectedFile.exists())) await Bun.write(expectedFile, actual);
      expect(actual).toBe(await expectedFile.text());

      for (const row of result.rows) {
        if (!row.result.ok) continue;
        const { data, overeni, prvni_zaslani } = row.result.sale;
        const xsd = validateAgainstXsd(toTrzbaXml(data, overeni, prvni_zaslani));
        expect({ row: row.row, ...xsd }).toMatchObject({ row: row.row, valid: true });
      }
    });
  }
});
