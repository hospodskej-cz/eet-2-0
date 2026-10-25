// Runtime compatibility smoke test for the built core (`bun run build:core` first).
// Runs on Node.js 22.18+ (`node smoke.mjs`) and Deno 2 (`deno run smoke.mjs`) to prove the core
// bundle loads without Bun-specific APIs. Exits non-zero on any mismatch.
import {
  EET_INTERFACE_VERSION,
  EET_MAX_MESSAGE_BYTES,
  EET_NAMESPACE,
  EET_SOAP_ACTION,
  EetReceiptDataSchema,
  formatEetDateTime,
  isIssuedBy,
  trustAnchor,
} from "../../dist/index.js";

const runtime =
  typeof globalThis.Deno !== "undefined"
    ? `deno ${globalThis.Deno.version.deno}`
    : `node ${globalThis.process.version}`;

const checks = [
  ["EET_INTERFACE_VERSION", EET_INTERFACE_VERSION, "4.1"],
  ["EET_NAMESPACE", EET_NAMESPACE, "http://fs.gov.cz/eet/schema/v4"],
  ["EET_SOAP_ACTION", EET_SOAP_ACTION, "http://fs.gov.cz/eet/OdeslaniTrzby"],
  ["EET_MAX_MESSAGE_BYTES", EET_MAX_MESSAGE_BYTES, 12_000],
];

for (const [name, actual, expected] of checks) {
  if (actual !== expected) {
    throw new Error(`${runtime}: ${name} is ${JSON.stringify(actual)}, expected ${expected}`);
  }
}
if (
  typeof globalThis.crypto?.subtle?.sign !== "function" ||
  typeof globalThis.fetch !== "function"
) {
  throw new Error(`${runtime}: Web Crypto or fetch missing — required by the protocol core`);
}

// Intl time zones, the DER/X.509 reader, Web Crypto signature checks and zod, without network.
const formatted = formatEetDateTime(new Date("2026-10-25T01:30:00Z"));
if (formatted !== "2026-10-25T02:30:00+01:00") {
  throw new Error(`${runtime}: formatEetDateTime gave ${formatted}`);
}
const sub = trustAnchor("eetPlaygroundSub");
if (sub.subject.commonName !== "playground EETv2 NCA SubCA RSA 05/2026") {
  throw new Error(`${runtime}: unexpected trust anchor ${sub.subject.commonName}`);
}
if (!(await isIssuedBy(sub, trustAnchor("eetPlaygroundRoot")))) {
  throw new Error(`${runtime}: CA EET playground chain does not verify`);
}
const parsed = EetReceiptDataSchema.safeParse({
  eic_popl: "CZ00000019",
  id_jednotky: "11",
  id_pokl: "1",
  porad_cis: "1",
  dat_trzby: formatted,
  celk_trzba: "-0.00",
});
if (parsed.success) throw new Error(`${runtime}: schema accepted -0.00`);

console.log(`core compat ok on ${runtime}`);
