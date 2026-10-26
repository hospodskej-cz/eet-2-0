// The real HTTP API (createApp + queue) over a fake EET, for running examples/ without sending
// anything: the first attempt of every sale "times out" (202 uncertain), the automatic resend
// half a second later is accepted — so examples exercise their polling path too.
//   bun scripts/examples-server.ts [port]     API key: examples-key-0123456789
import type { EetTransport } from "@eet-gateway/core";
import { createEetQueue, createMemoryStore } from "@eet-gateway/queue";
import { createApp } from "@eet-gateway/server";

const API_KEY = "examples-key-0123456789";
const port = Number(process.argv[2] ?? 8080);

const transport: EetTransport = {
  environment: "playground",
  endpoint: "https://fake-eet.invalid/v4",
  async send({ header }) {
    const meta = { durationMs: 1 };
    if (header.prvni_zaslani)
      return { kind: "uncertain", reason: "timeout", message: "fake timeout", meta };
    if (header.overeni) return { kind: "verification_ok", test: true, warnings: [], meta };
    const { uuid_zpravy } = header;
    return {
      kind: "accepted",
      pok: `${uuid_zpravy}-ff`,
      uuid_zpravy,
      dat_prij: header.dat_odesl,
      test: true,
      warnings: [],
      meta,
    };
  },
};
const queue = createEetQueue({
  store: createMemoryStore(),
  registers: {
    "kasa-1": {
      transport,
      context: { register: { eic_popl: "CZ00000019", id_jednotky: "11", id_pokl: "KASA-1" } },
    },
  },
  retry: { initialDelayMs: 500, jitter: 0 },
  pollIntervalMs: 200,
});
queue.start();
const app = createApp({ queue, apiKeys: [API_KEY], registers: () => [] });
const server = Bun.serve({ port, fetch: app.fetch });
console.log(JSON.stringify({ msg: "examples server", url: server.url.href, apiKey: API_KEY }));
