/**
 * Live round trips against the EET playground (opt-in: EET_TEST_LIVE=1). Each run sends three
 * made-up sales with the shared test certificate CZ00000019; the playground registers nothing
 * and its POKs are not valid (rozhraní §2.2.2). CI: .github/workflows/live-playground.yml.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import {
  createEetTransport,
  createHeader,
  type EetReceiptData,
  type EetTransport,
  formatEetDateTime,
} from "../../src/index.ts";
import { loadPlaygroundCertificate } from "../helpers.ts";

const LIVE = process.env["EET_TEST_LIVE"] === "1";
if (!LIVE) console.info("playground live tests skipped — set EET_TEST_LIVE=1 to run them");

function sale(overrides: Partial<EetReceiptData> = {}): EetReceiptData {
  const now = new Date();
  return {
    eic_popl: "CZ00000019",
    id_jednotky: "11",
    id_pokl: "eet2-lib-live",
    porad_cis: `live-${now.getTime()}`,
    dat_trzby: formatEetDateTime(now),
    celk_trzba: "1.00",
    ...overrides,
  };
}

describe.skipIf(!LIVE)("EET playground (live)", () => {
  let transport: EetTransport;
  beforeAll(async () => {
    transport = createEetTransport({
      environment: "playground",
      certificate: await loadPlaygroundCertificate("CZ00000019"),
      timeoutMs: 15_000,
    });
  });

  test("production mode → accepted, playground POK, trusted signature", async () => {
    const header = createHeader({ prvni_zaslani: true });
    const outcome = await transport.send({ data: sale(), header });
    expect(outcome).toMatchObject({
      kind: "accepted",
      test: true,
      uuid_zpravy: header.uuid_zpravy,
      warnings: [],
    });
    expect(outcome.kind === "accepted" && outcome.pok).toMatch(/-ff$/);
    expect(outcome.meta.globalTransactionId).toBeString();
  });

  test("verification mode → verification_ok", async () => {
    const outcome = await transport.send({
      data: sale(),
      header: createHeader({ prvni_zaslani: true, overeni: true }),
    });
    expect(outcome).toMatchObject({ kind: "verification_ok", test: true });
  });

  test("id_jednotky not ending in 1–4 → warning 6 (rozhraní §2.2.4)", async () => {
    const outcome = await transport.send({
      data: sale({ id_jednotky: "10" }),
      header: createHeader({ prvni_zaslani: true }),
    });
    expect(outcome.kind).toBe("accepted");
    expect(outcome.kind === "accepted" && outcome.warnings.map((w) => w.code)).toEqual([6]);
  });
});
