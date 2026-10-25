// Runtime compatibility smoke test for the built core (`bun run build:core` first).
// Runs on Node.js 22.18+ (`node smoke.mjs`) and Deno 2 (`deno run smoke.mjs`) to prove the core
// bundle loads without Bun-specific APIs. Exits non-zero on any mismatch.
import {
  EET_INTERFACE_VERSION,
  EET_MAX_MESSAGE_BYTES,
  EET_NAMESPACE,
  EET_SOAP_ACTION,
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

console.log(`core compat ok on ${runtime}`);
