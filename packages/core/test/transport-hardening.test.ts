/**
 * Adversarial tests of the transport: replayed, wrapped, forged, oversized and hostile answers.
 * Uses a synthetic cash-register certificate (the real certificate of the official sample
 * request with a throw-away key), so it runs without the shared playground .p12 files; the
 * request signature is never checked because the server is a stub.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { createCryptoKeySigner } from "@finitoapp/eet-client";
import {
  base64ToBytes,
  type CreateEetTransportOptions,
  createEetTransport,
  detectEnvironment,
  type EetReceiptData,
  parseCertificate,
  type RegisterCertificate,
  redactSignatureValues,
  TransportConfigError,
  type TransportRequest,
} from "../src/index.ts";
import { generateRsaKeyPair } from "./der-builder.ts";
import { fixedClock, repoPath } from "./helpers.ts";

const ACCEPTED = await Bun.file(
  repoPath("test/fixtures/responses/pg-accepted-2026-10-25.xml"),
).text();
const SAMPLE = await Bun.file(repoPath("spec/eet-v4.1/samples/CZ00000019.eet.v4.req.xml")).text();
const FIXTURE_UUID = "016baac6-a5d1-4a6b-b304-8910f1c89d89";

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
    uuid_zpravy: FIXTURE_UUID,
    dat_odesl: "2026-10-25T17:30:04+01:00",
    prvni_zaslani: true,
  },
};
const OTHER_UUID = "f0a1b2c3-d4e5-4f60-8a7b-8c9d0e1f2a3b";
const NOW = "2026-10-25T16:30:05Z";

let certificate: RegisterCertificate;
beforeAll(async () => {
  const token = />([A-Za-z0-9+/=\s]+)<\/wsse:BinarySecurityToken>/.exec(SAMPLE)?.[1] ?? "";
  const der = base64ToBytes(token.replace(/\s+/g, ""));
  const keys = await generateRsaKeyPair();
  const parsed = parseCertificate(der);
  certificate = {
    signer: createCryptoKeySigner(der, keys.privateKey),
    certificate: parsed,
    environment: await detectEnvironment(parsed),
    info: {
      eic: "CZ00000019",
      subjectCommonName: "CZ00000019",
      issuerCommonName: parsed.issuer.commonName ?? "",
      serialNumber: parsed.serialNumber,
      notBefore: parsed.notBefore,
      notAfter: parsed.notAfter,
      fingerprintSha256: "0".repeat(64),
    },
  };
});

function transport(overrides: Partial<CreateEetTransportOptions> = {}) {
  return createEetTransport({
    environment: "playground",
    certificate,
    now: fixedClock(NOW),
    ...overrides,
  });
}

function respond(body: string | Uint8Array, status = 200): typeof fetch {
  return (async () =>
    new Response(body as BodyInit, {
      status,
      headers: { "content-type": "text/xml; charset=UTF-8" },
    })) as unknown as typeof fetch;
}

function chyba(kod: number, uuid: string | undefined, test = true): string {
  const header = uuid === undefined ? "" : `uuid_zpravy="${uuid}" `;
  return `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eet="http://fs.gov.cz/eet/schema/v4"><soapenv:Header/><soapenv:Body><eet:Odpoved><eet:Hlavicka ${header}dat_odmit="2026-10-25T17:30:04+01:00"/><eet:Chyba kod="${kod}" test="${test}">text</eet:Chyba></eet:Odpoved></soapenv:Body></soapenv:Envelope>`;
}

describe("a response answers only the request it was sent for", () => {
  test("a genuine signed confirmation replayed for another uuid_zpravy is not accepted", async () => {
    const outcome = await transport({ fetch: respond(ACCEPTED) }).send({
      ...REQUEST,
      header: { ...REQUEST.header, uuid_zpravy: OTHER_UUID },
    });
    expect(outcome.kind).toBe("uncertain");
    expect(outcome.kind === "uncertain" && outcome.reason).toBe("malformed_response");
  });

  test("an error answer for another uuid_zpravy is not taken as the verdict on this sale", async () => {
    const outcome = await transport({ fetch: respond(chyba(4, OTHER_UUID)) }).send(REQUEST);
    expect(outcome).toMatchObject({ kind: "uncertain", reason: "malformed_response" });
    expect(outcome.kind === "uncertain" && outcome.message).toContain("uuid_zpravy");
  });

  test("an error answer without uuid_zpravy is still a rejection (R §3.5.3: message not analysable)", async () => {
    const outcome = await transport({ fetch: respond(chyba(3, undefined)) }).send(REQUEST);
    expect(outcome).toMatchObject({ kind: "rejected", code: 3 });
  });

  test("an error answer with the matching uuid_zpravy is a rejection", async () => {
    const outcome = await transport({ fetch: respond(chyba(3, FIXTURE_UUID)) }).send(REQUEST);
    expect(outcome).toMatchObject({ kind: "rejected", code: 3 });
  });

  test("the unsigned 'code 0' of the verification mode cannot finish a real sale", async () => {
    // Without this a proxy (or a server bug) turns a live message into a final verification_ok:
    // no POK, no retry, the sale is silently never registered.
    const live = await transport({ fetch: respond(chyba(0, FIXTURE_UUID)) }).send(REQUEST);
    expect(live).toMatchObject({ kind: "uncertain", reason: "malformed_response" });

    const verification = await transport({ fetch: respond(chyba(0, FIXTURE_UUID)) }).send({
      ...REQUEST,
      header: { ...REQUEST.header, overeni: true },
    });
    expect(verification.kind).toBe("verification_ok");
  });
});

describe("signature wrapping and forgery", () => {
  const send = (xml: string) => transport({ fetch: respond(xml) }).send(REQUEST);
  const notAccepted = (outcome: Awaited<ReturnType<typeof send>>) => {
    expect(outcome.kind).toBe("uncertain");
    expect(outcome.kind === "uncertain" && ["signature", "malformed_response"]).toContain(
      outcome.kind === "uncertain" ? outcome.reason : "",
    );
  };

  const body = /<soapenv:Body[\s\S]*<\/soapenv:Body>/.exec(ACCEPTED)?.[0] ?? "";

  test("sanity: the fixture is accepted untouched", async () => {
    expect((await send(ACCEPTED)).kind).toBe("accepted");
  });

  test("a forged Body placed before the signed one", async () => {
    const forged = body.replace(/ wsu:Id="[^"]*"/, "").replace("986a62bc0cc9-ff", "00000000cc9-ff");
    notAccepted(await send(ACCEPTED.replace(body, `${forged}${body}`)));
  });

  test("a forged Body that copies the signed Id", async () => {
    const forged = body.replace("986a62bc0cc9-ff", "986a62bc0cc8-ff");
    notAccepted(await send(ACCEPTED.replace(body, forged)));
  });

  test("the signed Body hidden in the Header and a forged Body after it", async () => {
    const signed = body
      .replace("soapenv:Body", "soapenv:Body")
      .replace(/^<soapenv:Body/, "<hidden");
    const hidden = signed.replace(/<\/soapenv:Body>$/, "</hidden>");
    const forged = `<soapenv:Body><eet:Odpoved><eet:Hlavicka uuid_zpravy="${FIXTURE_UUID}" dat_prij="2026-10-25T17:30:04+01:00"/><eet:Potvrzeni pok="11111111-1111-4111-8111-111111111111-ff" test="true"/></eet:Odpoved></soapenv:Body>`;
    const attack = ACCEPTED.replace(body, forged).replace(
      "</wsse:Security>",
      `</wsse:Security>${hidden}`,
    );
    notAccepted(await send(attack));
  });

  test("a second Odpoved smuggled into the signed Body", async () => {
    const extra = `<eet:Odpoved><eet:Hlavicka uuid_zpravy="${FIXTURE_UUID}" dat_prij="2026-10-25T17:30:04+01:00"/><eet:Potvrzeni pok="11111111-1111-4111-8111-111111111111-ff" test="true"/></eet:Odpoved>`;
    notAccepted(await send(ACCEPTED.replace("<eet:Odpoved>", `${extra}<eet:Odpoved>`)));
  });

  test("a confirmation without any signature header", async () => {
    const stripped = ACCEPTED.replace(
      /<soapenv:Header>[\s\S]*<\/soapenv:Header>/,
      "<soapenv:Header/>",
    );
    expect(stripped).not.toBe(ACCEPTED);
    notAccepted(await send(stripped));
  });

  test("a confirmation whose SignatureValue is blanked or replaced", async () => {
    const replaced = ACCEPTED.replace(/(<SignatureValue>)[\s\S]*?(<\/SignatureValue>)/, "$1AAAA$2");
    expect(replaced).not.toBe(ACCEPTED);
    notAccepted(await send(replaced));
    notAccepted(
      await send(ACCEPTED.replace(/(<SignatureValue>)[\s\S]*?(<\/SignatureValue>)/, "$1$2")),
    );
  });

  test("downgrading the announced signature or digest algorithm", async () => {
    notAccepted(
      await send(
        ACCEPTED.replace(
          "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
          "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
        ),
      ),
    );
    notAccepted(
      await send(
        ACCEPTED.replace(
          "http://www.w3.org/2001/04/xmlenc#sha256",
          "http://www.w3.org/2000/09/xmldsig#sha1",
        ),
      ),
    );
  });

  test("a signer certificate swapped for another one (self-made, same subject)", async () => {
    const other = SAMPLE.match(/>([A-Za-z0-9+/=\s]+)<\/wsse:BinarySecurityToken>/)?.[1] ?? "";
    const swapped = ACCEPTED.replace(
      /(<wsse:BinarySecurityToken[^>]*>)[\s\S]*?(<\/wsse:BinarySecurityToken>)/,
      `$1${other.replace(/\s+/g, "")}$2`,
    );
    expect(swapped).not.toBe(ACCEPTED);
    notAccepted(await send(swapped));
  });

  test("a playground confirmation answered by the production endpoint is an environment mismatch", async () => {
    const production = createEetTransport({
      environment: "production",
      endpoint: "https://example.invalid/eet",
      certificate: { ...certificate, environment: "production" },
      now: fixedClock(NOW),
      fetch: respond(ACCEPTED),
    });
    const outcome = await production.send(REQUEST);
    expect(outcome).toMatchObject({ kind: "uncertain", reason: "environment_mismatch" });
  });
});

describe("hostile answers never end in accepted and never throw", () => {
  const cases: [string, string | Uint8Array][] = [
    ["empty body", ""],
    ["not XML", "\u0000\u0001garbage"],
    ["DOCTYPE with an entity", `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>`],
    [
      "billion laughs",
      `<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]><l>&b;&b;&b;</l>`,
    ],
    ["130 000 nested elements", `${"<a>".repeat(130_000)}${"</a>".repeat(130_000)}`],
    [
      "80 000 attributes",
      `<a ${Array.from({ length: 80_000 }, (_, i) => `x${i}="1"`).join(" ")}/>`,
    ],
    ["invalid UTF-8", new Uint8Array([0x3c, 0x61, 0x3e, 0xc3, 0x28, 0x3c, 0x2f, 0x61, 0x3e])],
    ["many unterminated SignatureValue tags", "<SignatureValue>".repeat(50_000)],
    [
      "a SOAP Fault with a huge faultstring",
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultstring>${"x".repeat(500_000)}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`,
    ],
  ];
  for (const [label, body] of cases) {
    for (const debug of [false, true]) {
      test(`${label}${debug ? " (debug capture on)" : ""}`, async () => {
        const started = performance.now();
        const outcome = await transport({ fetch: respond(body), debug }).send(REQUEST);
        expect(outcome.kind).toBe("uncertain");
        expect(performance.now() - started).toBeLessThan(3_000);
      });
    }
  }

  test("a response above the library's size limit is uncertain: the request already left", async () => {
    // Mapping it to not_sent/too_large would make the queue drop the sale as `invalid` although
    // EET may have registered it.
    for (const debug of [false, true]) {
      const outcome = await transport({ fetch: respond("x".repeat(2_000_000)), debug }).send(
        REQUEST,
      );
      expect(outcome).toMatchObject({ kind: "uncertain", reason: "malformed_response" });
    }
  });

  test("debug capture keeps only a bounded part of an oversized response", async () => {
    const outcome = await transport({ fetch: respond("y".repeat(5_000_000)), debug: true }).send(
      REQUEST,
    );
    expect((outcome.meta.rawResponse ?? "").length).toBeLessThanOrEqual(1_100_000);
  });

  test("redactSignatureValues is linear on unterminated tags and still redacts real ones", () => {
    const started = performance.now();
    redactSignatureValues("<SignatureValue>".repeat(50_000));
    redactSignatureValues("<SignatureValue ".repeat(50_000));
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(redactSignatureValues("<ds:SignatureValue Id='x'>QUJD\nREVG</ds:SignatureValue>")).toBe(
      "<ds:SignatureValue Id='x'>[redacted]</ds:SignatureValue>",
    );
  });
});

describe("what leaves the machine", () => {
  test("redirects are never followed: the signed message is not re-posted elsewhere", async () => {
    let seen: RequestInit | undefined;
    const spy = (async (_input: unknown, init?: RequestInit) => {
      seen = init;
      return new Response(chyba(3, FIXTURE_UUID), { status: 200 });
    }) as unknown as typeof fetch;
    await transport({ fetch: spy }).send(REQUEST);
    expect(seen?.redirect).toBe("error");
  });

  test("a redirect answer is uncertain (the request was delivered), not a rejection", async () => {
    const redirecting = (async (_input: unknown, init?: RequestInit) => {
      if (init?.redirect === "error")
        throw new TypeError("fetch failed: redirect mode is set to error");
      return new Response("", { status: 307, headers: { location: "http://evil.example/" } });
    }) as unknown as typeof fetch;
    const outcome = await transport({ fetch: redirecting }).send(REQUEST);
    expect(outcome).toMatchObject({ kind: "uncertain", reason: "network" });
  });

  test("with the real fetch: a 307 to another server is not followed", async () => {
    let hits = 0;
    const target = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        hits++;
        return new Response(chyba(3, FIXTURE_UUID));
      },
    });
    const redirector = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        new Response(null, {
          status: 307,
          headers: { location: `http://127.0.0.1:${target.port}/` },
        }),
    });
    try {
      const outcome = await transport({ endpoint: `http://127.0.0.1:${redirector.port}/eet` }).send(
        REQUEST,
      );
      expect(outcome.kind).toBe("uncertain");
      expect(hits).toBe(0);
    } finally {
      await target.stop(true);
      await redirector.stop(true);
    }
  });

  test("production and playground endpoints must be https; plain http only on loopback", () => {
    const production = { ...certificate, environment: "production" as const };
    const make = (environment: "production" | "playground", endpoint: string) =>
      transport({
        environment,
        endpoint,
        certificate: environment === "production" ? production : certificate,
      });
    expect(() => make("production", "http://trzbyeet.example/eet")).toThrow(TransportConfigError);
    expect(() => make("production", "http://127.0.0.1:8080/eet")).toThrow(TransportConfigError);
    expect(() => make("playground", "http://pg.example/eet")).toThrow(TransportConfigError);
    expect(() => make("playground", "ftp://pg.example/eet")).toThrow(TransportConfigError);
    expect(() => make("playground", "not a url")).toThrow(TransportConfigError);
    expect(() => make("production", "https://trzbyeet.example/eet")).not.toThrow();
    expect(() => make("playground", "http://127.0.0.1:8080/eet")).not.toThrow();
    expect(() => make("playground", "http://localhost:8080/eet")).not.toThrow();
    expect(() => make("playground", "http://[::1]:8080/eet")).not.toThrow();
  });
});
