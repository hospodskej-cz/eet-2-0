import { beforeAll, describe, expect, test } from "bun:test";
import {
  type CreateEetTransportOptions,
  createEetTransport,
  type EetReceiptData,
  type RegisterCertificate,
  redactSignatureValues,
  TransportConfigError,
  type TransportRequest,
} from "../src/index.ts";
import { fixedClock, loadPlaygroundCertificate, repoPath } from "./helpers.ts";

const ACCEPTED = await Bun.file(
  repoPath("test/fixtures/responses/pg-accepted-2026-10-25.xml"),
).text();

/** The sale and header that produced the captured confirmation (SPEC_NOTES §15). */
const DATA: EetReceiptData = {
  eic_popl: "CZ00000019",
  id_jednotky: "11",
  id_pokl: "eet2-lib-probe",
  porad_cis: "probe-1792945804148",
  dat_trzby: "2026-10-25T17:30:04+01:00",
  celk_trzba: "1.00",
};
const REQUEST: TransportRequest = {
  data: DATA,
  header: {
    uuid_zpravy: "016baac6-a5d1-4a6b-b304-8910f1c89d89",
    dat_odesl: "2026-10-25T17:30:04+01:00",
    prvni_zaslani: true,
  },
};

function errorEnvelope(options: {
  kod: number;
  text: string;
  test?: boolean;
  warnings?: [number, string][];
}): string {
  const test = options.test === undefined ? "" : ` test="${options.test}"`;
  const warnings = (options.warnings ?? [])
    .map(([code, text]) => `<eet:Varovani kod_varov="${code}">\n      ${text}\n    </eet:Varovani>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eet="http://fs.gov.cz/eet/schema/v4"><soapenv:Header/><soapenv:Body><eet:Odpoved><eet:Hlavicka uuid_zpravy="${REQUEST.header.uuid_zpravy}" dat_odmit="2026-10-25T17:30:04+01:00"/><eet:Chyba kod="${options.kod}"${test}>\n      ${options.text}\n    </eet:Chyba>${warnings}</eet:Odpoved></soapenv:Body></soapenv:Envelope>`;
}

function respond(body: string, status = 200): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "content-type": "text/xml; charset=UTF-8", "x-global-transaction-id": "abc123" },
    })) as unknown as typeof fetch;
}

function throwing(error: unknown): typeof fetch {
  return (async () => {
    throw error;
  }) as unknown as typeof fetch;
}

/** A fetch that never answers until its signal aborts. */
const hanging = ((_input: unknown, init?: RequestInit) =>
  new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as unknown as typeof fetch;

let certificate: RegisterCertificate;
beforeAll(async () => {
  certificate = await loadPlaygroundCertificate("CZ00000019");
});

function transport(overrides: Partial<CreateEetTransportOptions> = {}) {
  return createEetTransport({
    environment: "playground",
    certificate,
    now: fixedClock("2026-10-25T16:30:05Z"),
    ...overrides,
  });
}

describe("answers from EET", () => {
  test("signed confirmation → accepted", async () => {
    const outcome = await transport({ fetch: respond(ACCEPTED) }).send(REQUEST);
    expect(outcome).toMatchObject({
      kind: "accepted",
      pok: "8b925c37-737a-4242-86a7-986a62bc0cc9-ff",
      uuid_zpravy: REQUEST.header.uuid_zpravy,
      dat_prij: "2026-10-25T17:30:04+01:00",
      test: true,
      warnings: [],
      meta: { httpStatus: 200, globalTransactionId: "abc123" },
    });
    expect(outcome.meta.rawRequest).toBeUndefined();
  });

  test("debug captures both messages with SignatureValue redacted", async () => {
    const outcome = await transport({ fetch: respond(ACCEPTED), debug: true }).send(REQUEST);
    const { rawRequest = "", rawResponse = "" } = outcome.meta;
    expect(rawRequest).toContain('celk_trzba="1.00"');
    expect(rawRequest).toMatch(/<ds:SignatureValue>\[redacted\]<\/ds:SignatureValue>/);
    expect(rawResponse).toContain("Potvrzeni");
    expect(rawResponse).toMatch(/SignatureValue[^>]*>\[redacted\]</);
    expect(`${rawRequest}${rawResponse}`).not.toMatch(/SignatureValue[^>]*>[A-Za-z0-9+/]{20}/);
  });

  test("code 0 in verification mode → verification_ok with warnings", async () => {
    const body = errorEnvelope({
      kod: 0,
      text: "Datovou zpravu evidovane trzby v overovacim modu se podarilo zpracovat",
      test: true,
      warnings: [[6, "id_jednotky neodpovida formatem pridelenemu c. evidencni jednotky"]],
    });
    const outcome = await transport({ fetch: respond(body) }).send({
      ...REQUEST,
      header: { ...REQUEST.header, overeni: true },
    });
    expect(outcome).toMatchObject({
      kind: "verification_ok",
      test: true,
      warnings: [
        { code: 6, message: "id_jednotky neodpovida formatem pridelenemu c. evidencni jednotky" },
      ],
    });
  });

  for (const [kod, text] of [
    [-1, "Docasna technicka chyba zpracovani – odeslete prosim datovou zpravu pozdeji"],
    [3, "XML zprava nevyhovela kontrole XML schematu"],
  ] as const) {
    test(`error code ${kod} → rejected`, async () => {
      const outcome = await transport({
        fetch: respond(errorEnvelope({ kod, text, test: true })),
      }).send(REQUEST);
      expect(outcome).toMatchObject({ kind: "rejected", code: kod, message: text, test: true });
    });
  }

  test("SOAP Fault → uncertain/soap_fault", async () => {
    const fault = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>soapenv:Client</faultcode><faultstring>Kodovani XML neni platne</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;
    const outcome = await transport({ fetch: respond(fault, 500) }).send(REQUEST);
    expect(outcome).toMatchObject({ kind: "uncertain", reason: "soap_fault" });
  });

  test("proxy error page → uncertain/http", async () => {
    const outcome = await transport({
      fetch: respond("<html>503 Service Unavailable</html>", 503),
    }).send(REQUEST);
    expect(outcome).toMatchObject({ kind: "uncertain", reason: "http", meta: { httpStatus: 503 } });
  });

  test("untrusted signature → uncertain/signature with the reason", async () => {
    const outcome = await transport({
      fetch: respond(ACCEPTED),
      now: fixedClock("2027-07-01T00:00:00Z"),
    }).send(REQUEST);
    expect(outcome).toMatchObject({ kind: "uncertain", reason: "signature" });
    expect(outcome.kind === "uncertain" && outcome.message).toContain("valid");
  });
});

describe("network failures", () => {
  const cases: [string, unknown, string, string][] = [
    [
      "DNS failure (Bun)",
      Object.assign(new TypeError("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
      "not_sent",
      "network",
    ],
    [
      "connection refused (Bun)",
      Object.assign(new TypeError("Unable to connect"), { code: "ECONNREFUSED" }),
      "not_sent",
      "network",
    ],
    [
      "DNS failure (Node)",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("x"), { code: "EAI_AGAIN" }),
      }),
      "not_sent",
      "network",
    ],
    [
      "TLS handshake",
      Object.assign(new TypeError("self signed certificate"), {
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
      }),
      "not_sent",
      "network",
    ],
    [
      "connection reset",
      Object.assign(new TypeError("socket hang up"), { code: "ECONNRESET" }),
      "uncertain",
      "network",
    ],
    ["unknown error", new TypeError("fetch failed"), "uncertain", "network"],
  ];
  for (const [label, error, kind, reason] of cases) {
    test(`${label} → ${kind}/${reason}`, async () => {
      const outcome = await transport({ fetch: throwing(error) }).send(REQUEST);
      expect(outcome).toMatchObject({ kind, reason });
    });
  }

  test("no answer within timeoutMs → uncertain/timeout", async () => {
    const outcome = await transport({ fetch: hanging, timeoutMs: 2_000 }).send(REQUEST);
    expect(outcome).toMatchObject({ kind: "uncertain", reason: "timeout" });
    expect(outcome.meta.durationMs).toBeGreaterThanOrEqual(1_900);
  });

  test("caller abort before and during the request", async () => {
    const before = new AbortController();
    before.abort();
    expect(
      await transport({ fetch: hanging }).send(REQUEST, { signal: before.signal }),
    ).toMatchObject({
      kind: "not_sent",
      reason: "aborted",
    });

    const during = new AbortController();
    setTimeout(() => during.abort(), 50);
    expect(
      await transport({ fetch: hanging }).send(REQUEST, { signal: during.signal }),
    ).toMatchObject({
      kind: "uncertain",
      reason: "aborted",
    });
  });
});

describe("guards", () => {
  test("a playground certificate cannot be used for production", () => {
    expect(() =>
      transport({
        environment: "production",
        endpoint: "https://trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4",
      }),
    ).toThrow(TransportConfigError);
  });

  test("production needs an explicit endpoint", () => {
    const production = { ...certificate, environment: "production" as const };
    expect(() => transport({ environment: "production", certificate: production })).toThrow(
      /endpoint/,
    );
  });

  test("certificates from an unknown CA need an explicit opt-in", () => {
    const unknown = { ...certificate, environment: "unknown" as const };
    expect(() => transport({ certificate: unknown })).toThrow(TransportConfigError);
    expect(() =>
      transport({ certificate: unknown, allowUnknownCertificateIssuer: true }),
    ).not.toThrow();
  });

  test("timeoutMs below 2 s is refused (ZoET §19)", () => {
    expect(() => transport({ timeoutMs: 1_999 })).toThrow(/2000/);
  });

  test("a playground answer from a production endpoint is not 'accepted'", async () => {
    const production = { ...certificate, environment: "production" as const };
    const outcome = await transport({
      environment: "production",
      endpoint: "https://example.invalid/eet",
      certificate: production,
      fetch: respond(ACCEPTED),
    }).send(REQUEST);
    expect(outcome).toMatchObject({ kind: "uncertain", reason: "environment_mismatch" });
  });

  test("invalid request data is a programming error", async () => {
    const send = transport({ fetch: respond(ACCEPTED) }).send({
      ...REQUEST,
      data: { ...DATA, celk_trzba: "1" },
    });
    await expect(send).rejects.toThrow(/celk_trzba/);
  });
});

test("redactSignatureValues handles prefixes, attributes and line breaks", () => {
  expect(redactSignatureValues('<SignatureValue Id="x">AB\nCD==</SignatureValue>')).toBe(
    '<SignatureValue Id="x">[redacted]</SignatureValue>',
  );
  expect(redactSignatureValues("<ds:SignatureValue>QUJD</ds:SignatureValue>")).toBe(
    "<ds:SignatureValue>[redacted]</ds:SignatureValue>",
  );
});
