import { describe, expect, test } from "bun:test";
import {
  base64ToBytes,
  certificateToDer,
  DerError,
  isIssuedBy,
  parseCertificate,
  sha256Hex,
  TRUST_ANCHORS,
  type TrustAnchorName,
  trustAnchor,
} from "../src/index.ts";
import { repoBytes, repoPath } from "./helpers.ts";

/** First `<wsse:BinarySecurityToken>` of a SOAP message, as DER. */
async function tokenFrom(relative: string): Promise<Uint8Array> {
  const xml = await Bun.file(repoPath(relative)).text();
  const token = />([A-Za-z0-9+/=\s]+)<\/wsse:BinarySecurityToken>/.exec(xml)?.[1];
  if (token === undefined) throw new Error(`no BinarySecurityToken in ${relative}`);
  return base64ToBytes(token.replace(/\s+/g, ""));
}

// Expected values below were read with `openssl x509` (SPEC_NOTES §12, §15).
describe("parseCertificate", () => {
  test("playground cash-register certificate from the official sample request", async () => {
    const cert = parseCertificate(
      await tokenFrom("spec/eet-v4.1/samples/CZ00000019.eet.v4.req.xml"),
    );
    expect(cert.subject.commonName).toBe("CZ00000019");
    expect(cert.subject.description).toBe("pravnicka osoba");
    expect(cert.subject.country).toBe("CZ");
    expect(cert.issuer.commonName).toBe("playground EETv2 NCA SubCA RSA 05/2026");
    expect(cert.issuer.organization).toBe("Správa státních služeb vytvářejících důvěru");
    expect(cert.issuer.organizationIdentifier).toBe("NTRCZ-19122063");
    expect(cert.notBefore.toISOString()).toBe("2026-05-13T09:40:23.000Z");
    expect(cert.notAfter.toISOString()).toBe("2027-05-14T09:40:23.000Z");
    expect(cert.signatureAlgorithm).toBe("1.2.840.113549.1.1.11");
    expect(await sha256Hex(cert.der)).toBe(
      "7ec806e61e00a9d9851cb9073dbba66da0ae0604a62d62cd02a93c8edc061c05",
    );
  });

  test("response-signing certificate from the captured playground answer", async () => {
    const cert = parseCertificate(
      await tokenFrom("test/fixtures/responses/pg-accepted-2026-10-25.xml"),
    );
    expect(cert.subject.commonName).toBe("NEOSTRE - playground prostredi EET");
    expect(cert.subject.organization).toBe("Generální finanční ředitelství");
    expect(cert.subject.organizationIdentifier).toBe("NTRCZ-72080043");
    expect(cert.subject.serialNumber).toBe("ICA - 1275853");
    expect(cert.issuer.commonName).toBe("I.CA Public CA/RSA 06/2022");
    expect(cert.serialNumber).toBe("010429c2770700194e");
    expect(cert.notAfter.toISOString()).toBe("2027-06-08T14:06:41.000Z");
    expect(cert.signatureAlgorithm).toBe("1.2.840.113549.1.1.13");
    expect(await sha256Hex(cert.der)).toBe(
      "b810009edeaf22f6004fb5951e4a10a17ee71e41ab207f912c086ef4cafbf93b",
    );
    expect(await sha256Hex(cert.spki)).toBe(
      "5ec0940f35be2f7c79100030ad381aa9cc20fc0558530f510be7b71a87596f16",
    );
  });

  const anchors: [TrustAnchorName, string, string, string][] = [
    [
      "eetPlaygroundRoot",
      "spec/ca/ca_eet-root_cert-playground.crt",
      "playground EETv2 NCA RootCA RSA 05/2026",
      "61c1e3c7229e9d3289f56d5293db2d7909b849ffce871b5ea01c690a7c604619",
    ],
    [
      "eetPlaygroundSub",
      "spec/ca/ca_eet-sub_cert-playground.crt",
      "playground EETv2 NCA SubCA RSA 05/2026",
      "464ffc1fc4810caef379310c857b163be1ca3288ebbe3a5de3413e24d60627ca",
    ],
    ["eetProductionRoot", "spec/ca/ca_eet-root_prod.pem", "EETv2 NCA Root CA RSA 09/2026", ""],
    ["eetProductionSub", "spec/ca/ca_eet-sub_prod.pem", "EETv2 NCA SubCA RSA 10/2026", ""],
    [
      "icaPublicCa2022",
      "spec/ca/ica/pca22_rsa.cer",
      "I.CA Public CA/RSA 06/2022",
      "df5baf6d7e1a7d14e9911c5b8c676ec6ebcad9354a74f4ac7314e133e07a94de",
    ],
  ];
  for (const [name, path, commonName, fingerprint] of anchors) {
    test(`trust anchor ${name} matches ${path}`, async () => {
      const fromFile = certificateToDer(await repoBytes(path));
      const embedded = base64ToBytes(TRUST_ANCHORS[name]);
      // Fails when spec/ca changed without `bun scripts/gen-trust-anchors.ts`.
      expect(embedded).toEqual(fromFile);
      expect(trustAnchor(name).subject.commonName).toBe(commonName);
      if (fingerprint !== "") expect(await sha256Hex(embedded)).toBe(fingerprint);
    });
  }

  test("malformed input fails loudly", () => {
    const der = base64ToBytes(TRUST_ANCHORS.icaPublicCa2022);
    expect(() => parseCertificate(der.subarray(0, 200))).toThrow(DerError);
    expect(() => parseCertificate(new Uint8Array([0x30, 0x80, 0x00, 0x00]))).toThrow(DerError);
  });
});

describe("isIssuedBy", () => {
  test("follows the real issuers, including SHA-512 signatures by I.CA", async () => {
    const pgLeaf = parseCertificate(
      await tokenFrom("spec/eet-v4.1/samples/CZ00000019.eet.v4.req.xml"),
    );
    const signer = parseCertificate(
      await tokenFrom("test/fixtures/responses/pg-accepted-2026-10-25.xml"),
    );
    expect(await isIssuedBy(pgLeaf, trustAnchor("eetPlaygroundSub"))).toBe(true);
    expect(
      await isIssuedBy(trustAnchor("eetPlaygroundSub"), trustAnchor("eetPlaygroundRoot")),
    ).toBe(true);
    expect(
      await isIssuedBy(trustAnchor("eetProductionSub"), trustAnchor("eetProductionRoot")),
    ).toBe(true);
    expect(await isIssuedBy(signer, trustAnchor("icaPublicCa2022"))).toBe(true);
  });

  test("rejects the wrong issuer", async () => {
    const pgLeaf = parseCertificate(
      await tokenFrom("spec/eet-v4.1/samples/CZ00000019.eet.v4.req.xml"),
    );
    expect(await isIssuedBy(pgLeaf, trustAnchor("eetProductionSub"))).toBe(false);
    expect(await isIssuedBy(pgLeaf, trustAnchor("icaPublicCa2022"))).toBe(false);
  });
});
