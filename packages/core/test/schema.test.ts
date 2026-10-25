import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { extractTrzba, validateAgainstXsd } from "../../../test/contract/xmllint.ts";
import { EetHeaderSchema, EetReceiptDataSchema, isEetDateTime, saleKey } from "../src/index.ts";
import { repoPath, xmlAttributes, xsdBooleans } from "./helpers.ts";

const HEADER_ATTRIBUTES = new Set(["uuid_zpravy", "dat_odesl", "prvni_zaslani", "overeni"]);

function parseTrzba(xml: string) {
  const header = xsdBooleans(xmlAttributes(xml, "Hlavicka") ?? {}, ["prvni_zaslani", "overeni"]);
  const data = xsdBooleans(xmlAttributes(xml, "Data") ?? {}, ["povereni_vice_popl"]);
  return { header: EetHeaderSchema.safeParse(header), data: EetReceiptDataSchema.safeParse(data) };
}

const dir = (relative: string) => repoPath(relative);
const xmlFiles = (relative: string) => readdirSync(dir(relative)).filter((f) => f.endsWith(".xml"));

describe("zod schemas agree with EETXMLSchema.xsd on the shared fixtures", () => {
  for (const name of xmlFiles("spec/eet-v4.1/samples/")) {
    test(`sample ${name} is valid`, async () => {
      const xml = extractTrzba(await Bun.file(dir(`spec/eet-v4.1/samples/${name}`)).text());
      const { header, data } = parseTrzba(xml);
      expect(header.error?.issues).toBeUndefined();
      expect(data.error?.issues).toBeUndefined();
    });
  }

  for (const name of xmlFiles("test/fixtures/xsd/valid/")) {
    test(`valid/${name}`, async () => {
      const { header, data } = parseTrzba(
        await Bun.file(dir(`test/fixtures/xsd/valid/${name}`)).text(),
      );
      expect(header.error?.issues).toBeUndefined();
      expect(data.error?.issues).toBeUndefined();
    });
  }

  for (const name of xmlFiles("test/fixtures/xsd/invalid/")) {
    const attribute = name.split("--")[0] ?? "";
    test(`invalid/${name} fails on ${attribute}`, async () => {
      const { header, data } = parseTrzba(
        await Bun.file(dir(`test/fixtures/xsd/invalid/${name}`)).text(),
      );
      const result = HEADER_ATTRIBUTES.has(attribute) ? header : data;
      const other = HEADER_ATTRIBUTES.has(attribute) ? data : header;
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((i) => i.path.join("."))).toEqual([attribute]);
      expect(other.success).toBe(true);
    });
  }
});

describe("isEetDateTime checks the xs:dateTime value space like xmllint does", () => {
  const cases: [value: string, expected: boolean, xsd?: boolean][] = [
    ["2027-01-09T04:25:28+01:00", true],
    ["2027-06-09T05:25:28+02:00", true],
    ["2026-07-01T09:02:18Z", true],
    ["2028-02-29T12:00:00+01:00", true],
    ["2027-02-29T12:00:00+01:00", false],
    ["2027-13-01T00:00:00+01:00", false],
    ["2027-04-31T00:00:00+02:00", false],
    // xs:dateTime allows 24:00:00 (= next day 00:00:00) and xmllint accepts it; we reject it on
    // purpose so one instant has one spelling in the uniqueness key (SPEC_NOTES §10).
    ["2027-01-01T24:00:00+01:00", false, true],
    ["2027-01-01T23:60:00+01:00", false],
    ["2027-01-01T00:00:00+14:30", false],
    ["2027-01-01T00:00:00.5+01:00", false],
    ["2027-01-01 00:00:00+01:00", false],
  ];
  for (const [value, expected, xsd = expected] of cases) {
    test(`${value} → ${expected}`, () => {
      expect(isEetDateTime(value)).toBe(expected);
      const xml = `<v4:Trzba xmlns:v4="http://fs.gov.cz/eet/schema/v4"><v4:Hlavicka uuid_zpravy="e23e5a5a-08d7-4a08-844d-2b6c6b60621d" dat_odesl="2027-01-08T21:19:40+01:00" prvni_zaslani="true"/><v4:Data eic_popl="CZ00000019" id_jednotky="11" id_pokl="1" porad_cis="1" dat_trzby="${value}" celk_trzba="1.00"/></v4:Trzba>`;
      expect(validateAgainstXsd(xml).valid).toBe(xsd);
    });
  }
});

test("schemas reject unknown fields instead of dropping them", () => {
  const result = EetReceiptDataSchema.safeParse({
    eic_popl: "CZ00000019",
    id_jednotky: "11",
    id_pokl: "1",
    porad_cis: "1",
    dat_trzby: "2027-01-09T04:25:28+01:00",
    celk_trzba: "1.00",
    totalAmount: "1.00",
  });
  expect(result.success).toBe(false);
});

test("saleKey joins the six identifying values in the order of rozhraní §4", () => {
  const key = saleKey({
    eic_popl: "CZ00000019",
    id_jednotky: "243",
    id_pokl: "24/A-6/Brno_2",
    porad_cis: "#135433c/11/2027",
    dat_trzby: "2027-01-09T16:45:36+01:00",
    celk_trzba: "3264.50",
    urceno_cerp_zuct: "100.00",
  });
  expect(key).toBe(
    "CZ00000019|243|24/A-6/Brno_2|#135433c/11/2027|2027-01-09T16:45:36+01:00|3264.50",
  );
});
