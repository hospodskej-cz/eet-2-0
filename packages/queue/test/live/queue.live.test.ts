/**
 * Live resend against the EET playground (opt-in: EET_TEST_LIVE=1). Sends two made-up messages
 * for one sale with the shared test certificate CZ00000019; the playground registers nothing.
 *
 * The first message really reaches EET, but its answer is "lost" (the queue is told timeout) —
 * the case metodika 1.3 describes. The queue must resend it as prvni_zaslani=false with a new
 * UUID, and EET must issue a POK for the resend too (rozhraní §2.1, §4).
 */
import { Database } from "bun:sqlite";
import { expect, setDefaultTimeout, test } from "bun:test";
import {
  createEetTransport,
  type EetTransport,
  formatEetDateTime,
  type TransportOutcome,
} from "@eet-gateway/core";
import { loadPlaygroundCertificate } from "../../../core/test/helpers.ts";
import { createEetQueue, createSqliteStore } from "../../src/index.ts";

const LIVE = process.env["EET_TEST_LIVE"] === "1";
const TRANSPORT_TIMEOUT_MS = 15_000;
setDefaultTimeout(2 * TRANSPORT_TIMEOUT_MS + 10_000);

test.skipIf(!LIVE)("a sale whose answer was lost is resent and gets its own POK", async () => {
  const real = createEetTransport({
    environment: "playground",
    certificate: await loadPlaygroundCertificate("CZ00000019"),
    timeoutMs: TRANSPORT_TIMEOUT_MS,
  });
  const delivered: TransportOutcome[] = [];
  const losingFirstAnswer: EetTransport = {
    environment: real.environment,
    endpoint: real.endpoint,
    async send(request, options) {
      const outcome = await real.send(request, options);
      delivered.push(outcome);
      if (delivered.length > 1) return outcome;
      return {
        kind: "uncertain",
        reason: "timeout",
        message: "answer lost (test)",
        meta: outcome.meta,
      };
    },
  };
  const queue = createEetQueue({
    store: createSqliteStore(new Database(":memory:")),
    registers: {
      pg: {
        transport: losingFirstAnswer,
        context: {
          register: { eic_popl: "CZ00000019", id_jednotky: "11", id_pokl: "eet2-lib-live" },
        },
      },
    },
    retry: { initialDelayMs: 1, jitter: 0 },
    leaseMs: 4 * TRANSPORT_TIMEOUT_MS,
  });

  const now = new Date();
  const first = await queue.submit({
    porad_cis: `queue-live-${now.getTime()}`,
    dat_trzby: formatEetDateTime(now),
    celk_trzba: "1.00",
  });
  expect(first).toMatchObject({ status: "uncertain", reason: "timeout", attempts: 1 });
  expect(delivered[0]?.kind).toBe("accepted"); // EET did get it

  await Bun.sleep(10);
  await queue.runDue();
  const done = await queue.get(first.id as string);
  expect(done).toMatchObject({ status: "accepted", attempts: 2, test: true });

  const hiddenPok = delivered[0]?.kind === "accepted" ? delivered[0].pok : "";
  expect(done?.pok).toMatch(/-ff$/);
  expect(done?.pok).not.toBe(hiddenPok);
  const attempts = await queue.attempts(first.id as string);
  expect(attempts.map((a) => [a.prvni_zaslani, a.outcome])).toEqual([
    [true, "uncertain"],
    [false, "accepted"],
  ]);
  console.info(`resend POK ${done?.pok} (first, lost: ${hiddenPok})`);
});
