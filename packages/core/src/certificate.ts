/**
 * Loading a cash-register certificate (PKCS#12 from CA EET, including the legacy RC2-40/3DES
 * encryption of the playground files) into a non-extractable signing key, and telling which EET
 * environment it belongs to. Passwords and key material are never logged or put into errors.
 */
import { createCryptoKeySigner } from "@finitoapp/eet-client";
import { parsePkcs12, pickPrivateKeyCertificate } from "@finitoapp/eet-client/pkcs12";
import { base64ToBytes, bufferSource } from "./bytes.ts";
import { EET_PATTERNS } from "./schema.ts";
import { TRUST_ANCHORS, type TrustAnchorName } from "./trust-anchors.ts";
import { type Certificate, certificateFingerprint, isIssuedBy, parseCertificate } from "./x509.ts";

export type EetEnvironment = "playground" | "production";

/** Signs the outgoing `<soap:Body>`; shape-compatible with the protocol library's signer. */
export interface Signer {
  getCertificate(): Uint8Array | PromiseLike<Uint8Array>;
  sign(data: Uint8Array): PromiseLike<Uint8Array>;
}

export interface CertificateInfo {
  /** EIČ from the certificate CN (PG §3.1.5, P §3.1.2). */
  readonly eic: string;
  readonly subjectCommonName: string;
  readonly issuerCommonName: string;
  readonly serialNumber: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly fingerprintSha256: string;
}

export interface RegisterCertificate {
  readonly signer: Signer;
  readonly info: CertificateInfo;
  /** Derived from the issuing CA, not from the policy OID (SPEC_NOTES §13, item 11). */
  readonly environment: EetEnvironment | "unknown";
  readonly certificate: Certificate;
}

export class CertificateError extends Error {
  override readonly name = "CertificateError";
}

const anchors = new Map<TrustAnchorName, Certificate>();

/** One of the vendored CA certificates, parsed (see trust-anchors.ts). */
export function trustAnchor(name: TrustAnchorName): Certificate {
  let certificate = anchors.get(name);
  if (certificate === undefined) {
    certificate = parseCertificate(base64ToBytes(TRUST_ANCHORS[name]));
    anchors.set(name, certificate);
  }
  return certificate;
}

/** Playground or production, depending on which CA EET issuing CA signed the certificate. */
export async function detectEnvironment(
  certificate: Certificate,
): Promise<EetEnvironment | "unknown"> {
  if (await isIssuedBy(certificate, trustAnchor("eetPlaygroundSub"))) return "playground";
  if (await isIssuedBy(certificate, trustAnchor("eetProductionSub"))) return "production";
  return "unknown";
}

/**
 * Opens a CA EET `.p12` and returns a signer backed by a non-extractable `CryptoKey`.
 * Throws `CertificateError` for a wrong password, a malformed file or a certificate whose CN is
 * not an EIČ.
 */
export async function loadPkcs12(p12: Uint8Array, password: string): Promise<RegisterCertificate> {
  const parsed = await parsePkcs12(p12, password);
  if (!parsed.ok) {
    throw new CertificateError(
      parsed.error.type === "Pkcs12InvalidMacError"
        ? "PKCS#12 integrity check failed — wrong password or corrupted file"
        : `PKCS#12 could not be read: ${parsed.error.message}`,
    );
  }
  const privateKey = parsed.value.privateKey;
  const leaf = pickPrivateKeyCertificate(parsed.value);
  if (privateKey === undefined || leaf === undefined) {
    throw new CertificateError("PKCS#12 does not contain a private key with its certificate");
  }

  const certificate = parseCertificate(leaf.der);
  const eic = certificate.subject.commonName ?? "";
  if (!EET_PATTERNS.eic.test(eic)) {
    throw new CertificateError(
      `certificate CN "${eic}" is not an EIČ — not a CA EET cash-register certificate`,
    );
  }

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      bufferSource(privateKey.der),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    throw new CertificateError("private key in PKCS#12 is not an RSA key usable for RSA-SHA256");
  }

  return {
    signer: createCryptoKeySigner(leaf.der, key),
    certificate,
    environment: await detectEnvironment(certificate),
    info: {
      eic,
      subjectCommonName: eic,
      issuerCommonName: certificate.issuer.commonName ?? "",
      serialNumber: certificate.serialNumber,
      notBefore: certificate.notBefore,
      notAfter: certificate.notAfter,
      fingerprintSha256: await certificateFingerprint(certificate),
    },
  };
}
