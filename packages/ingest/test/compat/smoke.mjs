// Runtime compatibility smoke test for the built ingest package (`bun run build:ingest` first).
// Runs on Node.js 22.18+ and Deno 2: Windows-1250 decoding, Intl time zones and zod must work
// without Bun-specific APIs. Exits non-zero on any mismatch.
import { normalizeSale, parseSales, WarningCode } from "../../dist/index.js";

const runtime =
  typeof globalThis.Deno !== "undefined"
    ? `deno ${globalThis.Deno.version.deno}`
    : `node ${globalThis.process.version}`;
const fail = (message) => {
  throw new Error(`${runtime}: ${message}`);
};

// "U-1;25.10.2026 2:30;1 234,50;Žluťoučký" in Windows-1250, semicolon-separated.
const header = new TextEncoder().encode("porad_cis;dat_trzby;celk_trzba;poznamka\r\n");
const row = new Uint8Array([
  ...new TextEncoder().encode("U-1;25.10.2026 2:30;1 234,50;"),
  0x8e,
  0x6c,
  0x75,
  0x9d,
  0x6f,
  0x75,
  0xe8,
  0x6b,
  0xfd,
  0x0d,
  0x0a,
]);
const batch = parseSales(new Uint8Array([...header, ...row]), "csv", {
  register: { eic_popl: "CZ00000019", id_jednotky: "11", id_pokl: "P1" },
  now: () => new Date("2026-10-25T02:31:00+01:00"),
});
if (batch.warnings[0]?.code !== WarningCode.ENCODING_CP1250) fail("CP1250 not detected");
const result = batch.rows[0]?.result;
if (!result?.ok) fail(`row rejected: ${JSON.stringify(result)}`);
// 2:30 on 2026-10-25 happens twice in Prague; the first occurrence is summer time.
if (result.sale.data.dat_trzby !== "2026-10-25T02:30:00+02:00")
  fail(`dat_trzby ${result.sale.data.dat_trzby}`);
if (result.sale.data.celk_trzba !== "1234.50") fail(`celk_trzba ${result.sale.data.celk_trzba}`);
if (!result.warnings.some((w) => w.code === WarningCode.DATETIME_AMBIGUOUS))
  fail("ambiguous time not reported");

const invalid = normalizeSale({ porad_cis: "Účtenka", celk_trzba: 0.1 + 0.2 });
if (invalid.ok) fail("invalid sale accepted");

console.log(`ingest compat ok on ${runtime}`);
