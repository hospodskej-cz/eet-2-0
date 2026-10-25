/**
 * Live round trip through the HTTP API against the EET playground (opt-in: EET_TEST_LIVE=1).
 * Sends one made-up sale with the shared test certificate CZ00000019; nothing is registered.
 */
import { expect, setDefaultTimeout, test } from "bun:test";
import { formatEetDateTime } from "@eet-gateway/core";
import { createEetQueue, createMemoryStore } from "@eet-gateway/queue";
import { createApp } from "../../src/app.ts";
import { parseConfig } from "../../src/config.ts";
import { loadRegisters, registerStatus } from "../../src/registers.ts";
import { API_KEY, pgConfig } from "../helpers.ts";

const LIVE = process.env["EET_TEST_LIVE"] === "1";
setDefaultTimeout(30_000);

test.skipIf(!LIVE)("POST /v1/sales → accepted with a playground POK", async () => {
  const config = parseConfig(pgConfig(), { baseDir: "/" });
  const registers = await loadRegisters(config.registers);
  const queue = createEetQueue({
    store: createMemoryStore(),
    registers: Object.fromEntries(
      registers.map((r) => [r.id, { transport: r.transport, context: r.context }]),
    ),
  });
  const app = createApp({
    queue,
    apiKeys: config.apiKeys,
    registers: () => registers.map((r) => registerStatus(r, new Date())),
  });
  const now = new Date();
  const response = await app.request("/v1/sales", {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      porad_cis: `api-live-${now.getTime()}`,
      dat_trzby: formatEetDateTime(now),
      celk_trzba: "1,00",
    }),
  });
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body).toMatchObject({ status: "accepted", test: true, attempts: 1, register: "kasa-1" });
  expect(body.pok).toMatch(/-ff$/);
  console.info(`API POK ${body.pok}`);
});
