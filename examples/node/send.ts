// The gateway as a library: load the register's certificate, open a SQLite queue and submit a
// sale — no HTTP service involved. Runs on Node.js 22.18+ and Bun.
//   EET_P12=kasa.p12 EET_P12_PASSWORD=… bun examples/node/send.ts
// Sends to the EET playground (nothing is registered there); for production pass
// environment: "production" and the production endpoint from your configuration.
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { createEetTransport, loadPkcs12 } from "@eet-gateway/core";
import { createEetQueue, createSqliteStore, type SqliteDatabase } from "@eet-gateway/queue";

const p12Path = process.env["EET_P12"] ?? "kasa.p12";
const password = process.env["EET_P12_PASSWORD"];
if (password === undefined) throw new Error("set EET_P12_PASSWORD (never put it in code)");

const certificate = await loadPkcs12(new Uint8Array(await readFile(p12Path)), password);
const queue = createEetQueue({
  // Every sale is stored here before it is sent; keep the file on persistent storage.
  store: createSqliteStore(
    new DatabaseSync(process.env["EET_DB"] ?? "eet-queue.db") as SqliteDatabase,
  ),
  registers: {
    "kasa-1": {
      transport: createEetTransport({ environment: "playground", certificate }),
      context: {
        register: { eic_popl: certificate.info.eic, id_jednotky: "11", id_pokl: "KASA-1" },
      },
    },
  },
  onEvent: (event) => console.error(JSON.stringify(event)), // to your logs
});
queue.start(); // resends what could not be sent (outage, lost answer) in the background

// Your own unique receipt id doubles as the idempotency key.
const receipt = `NODE-${Date.now()}`;
const result = await queue.submit(
  { porad_cis: receipt, dat_trzby: new Date(), celk_trzba: "123,50" },
  { idempotencyKey: receipt },
);
console.log(`${result.id}  ${result.status}  POK ${result.pok ?? "-"}`);
for (const warning of result.warnings)
  console.log(`  warning ${warning.code} (${warning.source}): ${warning.message}`);

await queue.stop(); // on shutdown: waits for attempts in flight
process.exitCode = result.status === "accepted" || result.status === "verification_ok" ? 0 : 1;
