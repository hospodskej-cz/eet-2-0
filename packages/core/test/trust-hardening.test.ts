/**
 * Adversarial tests of the response trust policy (ADR-002) and the X.509 reader, using
 * throw-away CAs and leaves built in der-builder.ts. Nothing here needs network or the shared
 * playground certificates.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { bufferSource } from "../src/bytes.ts";
import {
  createResponseVerifier,
  DerError,
  GFR_ORGANIZATION_IDENTIFIER,
  parseCertificate,
  type ResponseSignatureInput,
  type ResponseTrust,
  responseTrustFrom,
} from "../src/index.ts";
import {
  basicConstraints,
  generateRsaKeyPair,
  issueCertificate,
  keyUsage,
  type NameSpec,
  OID,
} from "./der-builder.ts";

const NOW = new Date("2026-10-28T12:00:00Z");
const CA_NAME: NameSpec = [[OID.commonName, "Test CA"]];
const GFR: NameSpec = [
  [OID.commonName, "NEOSTRE - test"],
  [OID.organizationIdentifier, GFR_ORGANIZATION_IDENTIFIER],
];
const SIGNED_INFO = new TextEncoder().encode("<SignedInfo>canonical form</SignedInfo>");

let ca: CryptoKeyPair;
let otherCa: CryptoKeyPair;
let leafKeys: CryptoKeyPair;
let trust: ResponseTrust;
let otherCaDer: Uint8Array;

beforeAll(async () => {
  [ca, otherCa, leafKeys] = await Promise.all([
    generateRsaKeyPair(),
    generateRsaKeyPair(),
    generateRsaKeyPair(),
  ]);
  const caDer = await issueCertificate({
    subject: CA_NAME,
    issuer: CA_NAME,
    subjectKey: ca.publicKey,
    issuerKey: ca.privateKey,
    extensions: [basicConstraints(true)],
  });
  otherCaDer = await issueCertificate({
    subject: CA_NAME,
    issuer: CA_NAME,
    subjectKey: otherCa.publicKey,
    issuerKey: otherCa.privateKey,
  });
  trust = responseTrustFrom({ issuers: [caDer] });
});

async function leaf(options: {
  subject?: NameSpec;
  extensions?: Uint8Array[];
  issuerKey?: CryptoKey;
  notBefore?: Date;
  notAfter?: Date;
  innerAlgorithm?: string;
  outerAlgorithm?: string;
}): Promise<Uint8Array> {
  return issueCertificate({
    subject: options.subject ?? GFR,
    issuer: CA_NAME,
    subjectKey: leafKeys.publicKey,
    issuerKey: options.issuerKey ?? ca.privateKey,
    ...(options.extensions ? { extensions: options.extensions } : {}),
    ...(options.notBefore ? { notBefore: options.notBefore } : {}),
    ...(options.notAfter ? { notAfter: options.notAfter } : {}),
    ...(options.innerAlgorithm ? { innerAlgorithm: options.innerAlgorithm } : {}),
    ...(options.outerAlgorithm ? { outerAlgorithm: options.outerAlgorithm } : {}),
  });
}

async function input(
  certificateDer: Uint8Array,
  extra: Partial<ResponseSignatureInput["signature"]> = {},
): Promise<ResponseSignatureInput> {
  const signatureValue = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", leafKeys.privateKey, SIGNED_INFO),
  );
  return {
    signature: {
      certificates: [certificateDer],
      signedInfoCanonical: SIGNED_INFO,
      signatureValue,
      ...extra,
    },
  };
}

async function check(
  certificateDer: Uint8Array,
  policy: ResponseTrust = trust,
  extra: Partial<ResponseSignatureInput["signature"]> = {},
) {
  const failures: string[] = [];
  const verifier = createResponseVerifier(policy, {
    now: () => NOW,
    onFailure: (reason) => failures.push(reason),
  });
  const ok = await verifier.verify(await input(certificateDer, extra));
  return { ok, failures };
}

const SIGNING = keyUsage(0xc0); // digitalSignature + nonRepudiation, like the real GFŘ signer

describe("baseline", () => {
  test("a leaf from the pinned CA with the right subject verifies", async () => {
    expect((await check(await leaf({ extensions: [basicConstraints(false), SIGNING] }))).ok).toBe(
      true,
    );
  });

  test("a certificate without keyUsage is tolerated (RFC 5280: no restriction)", async () => {
    expect((await check(await leaf({}))).ok).toBe(true);
  });

  test("a leaf from another CA, a bad signature and a bad validity period fail", async () => {
    const foreign = await check(await leaf({ issuerKey: otherCa.privateKey }));
    expect(foreign.ok).toBe(false);
    expect(foreign.failures[0]).toContain("pinned CA");

    const good = await leaf({});
    const forged = await input(good);
    const wrong = new Uint8Array(forged.signature.signatureValue);
    wrong[10] = (wrong[10] as number) ^ 1;
    const verifier = createResponseVerifier(trust, { now: () => NOW });
    expect(
      await verifier.verify({ signature: { ...forged.signature, signatureValue: wrong } }),
    ).toBe(false);

    expect((await check(await leaf({ notAfter: new Date("2026-10-01T00:00:00Z") }))).ok).toBe(
      false,
    );
    expect((await check(await leaf({ notBefore: new Date("2026-11-01T00:00:00Z") }))).ok).toBe(
      false,
    );
  });

  test("a different CA with the same subject name does not pass as the pinned one", async () => {
    const pinnedOther = responseTrustFrom({ issuers: [otherCaDer] });
    expect((await check(await leaf({}), pinnedOther)).ok).toBe(false);
  });
});

describe("what the signer certificate may be used for", () => {
  test("a CA certificate cannot sign responses even if it carries the GFŘ subject", async () => {
    const result = await check(await leaf({ extensions: [basicConstraints(true), SIGNING] }));
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("CA");
  });

  test("a key reserved for encryption cannot sign responses", async () => {
    const result = await check(await leaf({ extensions: [keyUsage(0x20)] }));
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("key usage");
  });

  test("nonRepudiation alone is enough (qualified eSeal profiles)", async () => {
    expect((await check(await leaf({ extensions: [keyUsage(0x40)] }))).ok).toBe(true);
  });

  test("duplicate extensions are malformed", async () => {
    const result = await check(await leaf({ extensions: [keyUsage(0xc0), keyUsage(0x20)] }));
    expect(result.ok).toBe(false);
  });
});

describe("subject policy cannot be configured away", () => {
  const noOrganization: NameSpec = [[OID.commonName, "Some other I.CA customer"]];

  test("a leaf without organizationIdentifier is refused", async () => {
    const result = await check(await leaf({ subject: noOrganization }));
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("organizationIdentifier");
  });

  for (const [label, value] of [
    ["undefined", undefined],
    ["empty", ""],
    ["null", null],
  ] as const) {
    test(`a ResponseTrust with ${label} subjectOrganizationIdentifier fails closed`, async () => {
      // `undefined !== undefined` is false: an unchecked config would trust any I.CA leaf.
      const sloppy = { ...trust, subjectOrganizationIdentifier: value } as unknown as ResponseTrust;
      const result = await check(await leaf({ subject: noOrganization }), sloppy);
      expect(result.ok).toBe(false);
      expect((await check(await leaf({}), sloppy)).ok).toBe(false);
    });
  }

  test("a ResponseTrust without issuers trusts nothing", async () => {
    expect((await check(await leaf({}), { ...trust, issuers: [] })).ok).toBe(false);
  });

  test("responseTrustFrom normalises pins; an empty pin list pins nothing", async () => {
    const der = await leaf({});
    const withEmpty = { ...trust, leafPins: [] };
    expect((await check(der, withEmpty)).ok).toBe(true);
    const wrongPin = { ...trust, leafPins: ["00".repeat(32)] };
    expect((await check(der, wrongPin)).ok).toBe(false);
  });
});

describe("certificate parsing is strict where trust depends on it", () => {
  test("the algorithm inside TBSCertificate must equal the outer signatureAlgorithm", async () => {
    // RFC 5280 §4.1.1.2. A mismatch is how algorithm-substitution attacks start.
    const der = await leaf({
      innerAlgorithm: OID.sha512WithRsa,
      outerAlgorithm: OID.sha256WithRsa,
    });
    expect(() => parseCertificate(der)).toThrow(DerError);
    expect((await check(der)).ok).toBe(false);
  });

  test("trailing bytes after the certificate are refused", async () => {
    const der = await leaf({});
    const padded = new Uint8Array(der.length + 1);
    padded.set(der);
    expect(() => parseCertificate(padded)).toThrow(DerError);
  });

  test("a calendar-invalid notAfter cannot be smuggled in as a later date", async () => {
    const der = await leaf({ notAfter: new Date("2030-01-01T00:00:00Z") });
    // 300101000000Z → 301301000000Z (month 13). Same length, so only the content differs.
    const text = new TextEncoder().encode("300101000000Z");
    const bad = new TextEncoder().encode("301301000000Z");
    const at = indexOf(der, text);
    expect(at).toBeGreaterThan(0);
    const mutated = new Uint8Array(der);
    mutated.set(bad, at);
    expect(() => parseCertificate(mutated)).toThrow(DerError);
  });

  test("a certificate whose serialNumber is empty is refused", async () => {
    const der = await issueCertificate({
      subject: GFR,
      issuer: CA_NAME,
      subjectKey: leafKeys.publicKey,
      issuerKey: ca.privateKey,
      serial: new Uint8Array(),
    });
    expect(() => parseCertificate(der)).toThrow(DerError);
  });
});

describe("defence in depth against a protocol library that skips a check", () => {
  const body = new TextEncoder().encode("<soap:Body>signed</soap:Body>");
  const digestOf = async (data: Uint8Array) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", bufferSource(data)));

  test("a matching body digest and the expected algorithms pass", async () => {
    const result = await check(await leaf({}), trust, {
      signedBodyCanonical: body,
      digestValue: await digestOf(body),
      signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    });
    expect(result.ok).toBe(true);
  });

  test("a body that does not hash to DigestValue is refused even with a valid SignedInfo", async () => {
    const result = await check(await leaf({}), trust, {
      signedBodyCanonical: new TextEncoder().encode("<soap:Body>swapped</soap:Body>"),
      digestValue: await digestOf(body),
    });
    expect(result.ok).toBe(false);
    expect(result.failures[0]).toContain("DigestValue");
  });

  test("a digest or signature algorithm other than SHA-256 / RSA-SHA256 is refused", async () => {
    expect(
      (
        await check(await leaf({}), trust, {
          digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await check(await leaf({}), trust, {
          signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#hmac-sha1",
        })
      ).ok,
    ).toBe(false);
  });
});

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
