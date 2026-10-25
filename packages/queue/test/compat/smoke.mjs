// Runtime compatibility smoke test for the built queue package (`bun run build:queue` first).
// Runs on Node.js 22.18+ and Deno 2 over `node:sqlite`: a timeout, a resend with
// prvni_zaslani=false and a replay must work without Bun-specific APIs. Exits non-zero on failure.
import { DatabaseSync } from "node:sqlite";
import { createEetQueue, createSqliteStore, QueueWarningCode } from "../../dist/index.js";

const runtime =
  typeof globalThis.Deno !== "undefined"
    ? `deno ${globalThis.Deno.version.deno}`
    : `node ${globalThis.process.version}`;
const fail = (message) => {
  throw new Error(`${runtime}: ${message}`);
};

const requests = [];
const transport = {
  environment: "playground",
  endpoint: "https://pg.example/eet",
  async send(request) {
    requests.push(request);
    const meta = { durationMs: 1 };
    if (requests.length === 1) return { kind: "uncertain", reason: "timeout", message: "t", meta };
    const uuid = request.header.uuid_zpravy;
    const pok = `${uuid}-ff`;
    return {
      kind: "accepted",
      pok,
      uuid_zpravy: uuid,
      dat_prij: "",
      test: true,
      warnings: [],
      meta,
    };
  },
};

let now = Date.parse("2026-10-25T18:00:00+01:00");
const queue = createEetQueue({
  store: createSqliteStore(new DatabaseSync(":memory:")),
  registers: {
    main: {
      transport,
      context: { register: { eic_popl: "CZ00000019", id_jednotky: "11", id_pokl: "P1" } },
    },
  },
  now: () => now,
  random: () => 0.5,
});

const sale = { porad_cis: "N-1", dat_trzby: "2026-10-25T18:00:00+01:00", celk_trzba: "1,50" };
const first = await queue.submit(sale, { idempotencyKey: "k" });
if (first.status !== "uncertain") fail(`first attempt ${first.status}`);
now += 5_000;
await queue.runDue();
const done = await queue.get(first.id);
if (done?.status !== "accepted" || done.attempts !== 2)
  fail(`after resend ${JSON.stringify(done)}`);
if (requests[1].header.prvni_zaslani !== false) fail("resend was a first submission");
if (requests[1].data.celk_trzba !== "1.50") fail(`celk_trzba ${requests[1].data.celk_trzba}`);
const replay = await queue.submit(sale, { idempotencyKey: "k" });
if (!replay.warnings.some((w) => w.code === QueueWarningCode.SALE_REPLAYED)) fail("no replay");
if (requests.length !== 2) fail(`${requests.length} requests`);

console.log(`queue compat ok on ${runtime}`);
