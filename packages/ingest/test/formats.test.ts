import { describe, expect, test } from "bun:test";
import { parseCsv } from "../src/formats/csv.ts";
import { readXmlSales } from "../src/formats/xml.ts";
import { formatFromContentType, parseSales } from "../src/index.ts";

describe("parseCsv", () => {
  test("doubled quotes, delimiters and line breaks inside quotes", () => {
    const table = parseCsv('a;b\r\n"x;""y""";"1\n2"\r\nz;w');
    expect("code" in table).toBe(false);
    if ("code" in table) return;
    expect(table.delimiter).toBe(";");
    expect(table.records).toEqual([
      { line: 2, fields: ['x;"y"', "1\n2"] },
      { line: 4, fields: ["z", "w"] },
    ]);
  });

  test("broken quoting is a parse error with the line", () => {
    expect(parseCsv('a,b\n1,x"y')).toMatchObject({ code: "parse_error" });
    expect(parseCsv('a,b\n1,"open')).toMatchObject({
      code: "parse_error",
      message: expect.stringContaining("2"),
    });
  });

  test("empty input has no header", () => {
    expect(parseCsv("")).toMatchObject({ code: "parse_error" });
  });
});

describe("readXmlSales", () => {
  test("skips comments and CDATA, decodes predefined and numeric entities", () => {
    const sales = readXmlSales(
      `<r><!-- <Data porad_cis="no"/> --><![CDATA[<Data/>]]><Data porad_cis="a&amp;b&#x2F;c"/></r>`,
    );
    expect(sales).toEqual([{ line: 1, data: { porad_cis: "a&b/c" } }]);
  });

  test("unknown entities, DOCTYPE and unclosed Trzba are refused", () => {
    expect(readXmlSales(`<Data a="&nbsp;"/>`)).toMatchObject({ code: "parse_error" });
    expect(readXmlSales(`<!DOCTYPE x><Data/>`)).toMatchObject({ code: "unsupported_format" });
    expect(readXmlSales(`<Trzba><Data/>`)).toMatchObject({ code: "parse_error" });
  });

  test("Trzba without Data is reported per row", () => {
    const result = parseSales("<Trzba><Hlavicka prvni_zaslani='true'/></Trzba>", "xml");
    expect(result.rows[0]?.result).toMatchObject({ ok: false, issues: [{ code: "required" }] });
  });
});

describe("parseSales", () => {
  test("JSON and XML bytes must be UTF-8; only CSV falls back to CP1250", () => {
    const cp1250 = new Uint8Array([0x7b, 0x22, 0x9a, 0x22, 0x3a, 0x31, 0x7d]); // {"š":1}
    expect(parseSales(cp1250, "json").issues).toMatchObject([{ code: "parse_error" }]);
  });

  test("an unknown format is refused", () => {
    expect(parseSales("x", "yaml" as never).issues).toMatchObject([{ code: "unsupported_format" }]);
  });
});

test("formatFromContentType", () => {
  expect(formatFromContentType("application/json; charset=utf-8")).toBe("json");
  expect(formatFromContentType("application/x-ndjson")).toBe("ndjson");
  expect(formatFromContentType("TEXT/CSV")).toBe("csv");
  expect(formatFromContentType("text/xml")).toBe("xml");
  expect(formatFromContentType("application/pdf")).toBeUndefined();
});
