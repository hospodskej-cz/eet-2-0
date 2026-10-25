import { describe, expect, spyOn, test } from "bun:test";
import {
  CertificateError,
  detectEnvironment,
  importRsaPublicKey,
  loadPkcs12,
  trustAnchor,
} from "../src/index.ts";
import { loadPlaygroundCertificate, PLAYGROUND_EICS, repoPath } from "./helpers.ts";

describe("loadPkcs12 with the shared playground certificates (legacy RC2-40/3DES)", () => {
  for (const eic of PLAYGROUND_EICS) {
    test(eic, async () => {
      const certificate = await loadPlaygroundCertificate(eic);
      expect(certificate.info.eic).toBe(eic);
      expect(certificate.environment).toBe("playground");
      expect(certificate.info.issuerCommonName).toBe("playground EETv2 NCA SubCA RSA 05/2026");
      expect(certificate.info.notAfter.getTime()).toBeGreaterThan(
        certificate.info.notBefore.getTime(),
      );
    });
  }

  test("CZ00000019 is the certificate used in the official sample request", async () => {
    const { info } = await loadPlaygroundCertificate("CZ00000019");
    expect(info.fingerprintSha256).toBe(
      "7ec806e61e00a9d9851cb9073dbba66da0ae0604a62d62cd02a93c8edc061c05",
    );
    expect(info.notAfter.toISOString()).toBe("2027-05-14T09:40:23.000Z");
  });

  test("the private key is imported as non-extractable and signs RSA-SHA256", async () => {
    const importKey = spyOn(crypto.subtle, "importKey");
    try {
      const certificate = await loadPlaygroundCertificate("CZ00000019");
      const pkcs8Call = importKey.mock.calls.find((call) => call[0] === "pkcs8");
      expect(pkcs8Call?.[3]).toBe(false);
      expect(pkcs8Call?.[4]).toEqual(["sign"]);

      const data = new TextEncoder().encode("<SignedInfo/>");
      const signature = await certificate.signer.sign(data);
      const publicKey = await importRsaPublicKey(certificate.certificate.spki, "SHA-256");
      expect(
        await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, new Uint8Array(signature), data),
      ).toBe(true);
    } finally {
      importKey.mockRestore();
    }
  });

  test("a wrong password is reported without echoing it", async () => {
    const p12 = new Uint8Array(
      await Bun.file(repoPath(".cache/playground/CA_EET-Playground-CZ00000019.p12")).arrayBuffer(),
    );
    const promise = loadPkcs12(p12, "Wrong-Pa55word");
    await expect(promise).rejects.toBeInstanceOf(CertificateError);
    await expect(promise).rejects.toThrow(/wrong password/);
    await expect(promise).rejects.not.toThrow(/Wrong-Pa55word/);
  });
});

test("detectEnvironment uses the issuing CA, not the policy OID", async () => {
  expect(await detectEnvironment(trustAnchor("icaPublicCa2022"))).toBe("unknown");
  expect((await loadPlaygroundCertificate()).environment).toBe("playground");
});
