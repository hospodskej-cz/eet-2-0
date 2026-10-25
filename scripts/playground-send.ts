/**
 * Sends ONE made-up sale to the EET playground through @eet-gateway/core and prints the outcome.
 * Uses the shared test certificates (run `bun run certs:playground` first). The playground
 * registers nothing and its POKs are not valid (rozhraní §2.2.2).
 *
 *   bun run playground:send                      # production mode → POK ending in -ff
 *   bun run playground:send --verify             # verification mode → verification_ok
 *   bun run playground:send --eic CZ8551015704 --amount 250.00 --debug
 */
import { parseArgs } from "node:util";
import {
  createEetTransport,
  createHeader,
  formatEetDateTime,
  loadPkcs12,
} from "../packages/core/src/index.ts";
import { repoPath } from "./lib/sources.ts";

const { values } = parseArgs({
  options: {
    verify: { type: "boolean", default: false },
    debug: { type: "boolean", default: false },
    eic: { type: "string", default: "CZ00000019" },
    amount: { type: "string", default: "1.00" },
    unit: { type: "string", default: "11" },
  },
});

const dir = repoPath(".cache/playground/");
const p12 = Bun.file(`${dir}CA_EET-Playground-${values.eic}.p12`);
if (!(await p12.exists())) {
  console.error(
    `missing ${p12.name} — run: bun run certs:playground (EIČ: CZ00000019, CZ683555118, CZ8551015704)`,
  );
  process.exit(1);
}
const password = (await Bun.file(`${dir}password_pokladni_cert_playground.txt`).text()).trim();
const certificate = await loadPkcs12(new Uint8Array(await p12.arrayBuffer()), password);
const transport = createEetTransport({
  environment: "playground",
  certificate,
  debug: values.debug,
});

const now = new Date();
const request = {
  data: {
    eic_popl: certificate.info.eic,
    id_jednotky: values.unit,
    id_pokl: "playground-send",
    porad_cis: `try-${now.getTime()}`,
    dat_trzby: formatEetDateTime(now),
    celk_trzba: values.amount,
  },
  header: createHeader({ prvni_zaslani: true, overeni: values.verify, now }),
};

const outcome = await transport.send(request);
console.log(JSON.stringify({ endpoint: transport.endpoint, request, outcome }, null, 2));
process.exit(outcome.kind === "accepted" || outcome.kind === "verification_ok" ? 0 : 1);
