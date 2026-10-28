/**
 * Trust in signed EET confirmations (`<Potvrzeni>`), docs/ADR-002-response-trust.md.
 *
 * The response is signed by a GFŘ certificate issued by I.CA, not by CA EET (PG/P §3.3). Its
 * leaf rotates yearly (the playground one expires 2027-06-08), so trust is anchored in the
 * pinned issuing CA plus a subject check; pinning leaves is an optional, stricter extra.
 */
import { bufferSource, bytesEqual, certificateToDer } from "./bytes.ts";
import { trustAnchor } from "./certificate.ts";
import {
  type Certificate,
  certificateFingerprint,
  importRsaPublicKey,
  isIssuedBy,
  isValidAt,
  parseCertificate,
  signerCertificateProblem,
} from "./x509.ts";

export interface ResponseTrust {
  /** Pinned CA certificates allowed to issue the response-signing certificate. */
  readonly issuers: readonly Certificate[];
  /** Required `organizationIdentifier` (2.5.4.97) in the signer's subject. */
  readonly subjectOrganizationIdentifier: string;
  /** Optional SHA-256 fingerprints (hex) of allowed leaf certificates; checked in addition. */
  readonly leafPins?: readonly string[] | undefined;
}

/** GFŘ (Generální finanční ředitelství), NTRCZ-72080043 — subject of the signer seen on PG. */
export const GFR_ORGANIZATION_IDENTIFIER = "NTRCZ-72080043";

/** Verified live on 2026-10-25 (SPEC_NOTES §15). */
export function playgroundResponseTrust(): ResponseTrust {
  return {
    issuers: [trustAnchor("icaPublicCa2022")],
    subjectOrganizationIdentifier: GFR_ORGANIZATION_IDENTIFIER,
  };
}

/**
 * Same issuer per P §3.3. NOT yet verified against a real production response — the production
 * signer's subject is assumed to be GFŘ as on the playground (SPEC_NOTES §15, ADR-002).
 */
export function productionResponseTrust(): ResponseTrust {
  return playgroundResponseTrust();
}

/** Builds a `ResponseTrust` from configuration (PEM or DER issuer certificates). */
export function responseTrustFrom(options: {
  issuers: readonly (Uint8Array | string)[];
  subjectOrganizationIdentifier?: string;
  leafPins?: readonly string[];
}): ResponseTrust {
  return {
    issuers: options.issuers.map((issuer) => parseCertificate(certificateToDer(issuer))),
    subjectOrganizationIdentifier:
      options.subjectOrganizationIdentifier ?? GFR_ORGANIZATION_IDENTIFIER,
    leafPins: options.leafPins?.map((pin) => pin.replaceAll(":", "").toLowerCase()),
  };
}

const RSA_SHA256_ALGORITHM = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256_DIGEST_ALGORITHM = "http://www.w3.org/2001/04/xmlenc#sha256";

/** What the protocol library hands to a response verifier (structural subset). */
export interface ResponseSignatureInput {
  readonly signature: {
    readonly certificates: readonly Uint8Array[];
    readonly signedInfoCanonical: Uint8Array;
    readonly signatureValue: Uint8Array;
    /**
     * Optional and checked when present (the protocol library always supplies them): the canonical
     * `soap:Body`, its `DigestValue` and the announced algorithms. Re-checking them here means a
     * regression in the library's digest comparison cannot let a swapped body ride on a genuine
     * signature over `SignedInfo`.
     */
    readonly signedBodyCanonical?: Uint8Array | undefined;
    readonly digestValue?: Uint8Array | undefined;
    readonly signatureAlgorithm?: string | undefined;
    readonly digestAlgorithm?: string | undefined;
  };
}

export interface ResponseVerifierOptions {
  /** Clock used for the validity check; defaults to the current time. */
  readonly now?: (() => Date) | undefined;
  /** Receives the reason whenever verification fails (for diagnostics, never secrets). */
  readonly onFailure?: ((reason: string) => void) | undefined;
}

export function createResponseVerifier(
  trust: ResponseTrust,
  options: ResponseVerifierOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const fail = (reason: string): false => {
    options.onFailure?.(reason);
    return false;
  };

  return {
    async verify(input: ResponseSignatureInput): Promise<boolean> {
      // A policy without a subject would compare `undefined !== undefined` and trust every
      // certificate the pinned CA ever issued to anybody.
      if (
        typeof trust.subjectOrganizationIdentifier !== "string" ||
        trust.subjectOrganizationIdentifier === ""
      ) {
        return fail("trust policy has no subjectOrganizationIdentifier");
      }
      const { signature } = input;
      if (
        (signature.signatureAlgorithm !== undefined &&
          signature.signatureAlgorithm !== RSA_SHA256_ALGORITHM) ||
        (signature.digestAlgorithm !== undefined &&
          signature.digestAlgorithm !== SHA256_DIGEST_ALGORITHM)
      ) {
        return fail("response uses a signature or digest algorithm other than RSA-SHA256/SHA-256");
      }
      if (signature.signedBodyCanonical !== undefined && signature.digestValue !== undefined) {
        const digest = new Uint8Array(
          await crypto.subtle.digest("SHA-256", bufferSource(signature.signedBodyCanonical)),
        );
        if (!bytesEqual(digest, signature.digestValue)) {
          return fail("soap:Body does not hash to the signed DigestValue");
        }
      }
      const leafDer = input.signature.certificates[0];
      if (leafDer === undefined) return fail("response carries no signing certificate");
      let leaf: Certificate;
      try {
        leaf = parseCertificate(leafDer);
      } catch (error) {
        return fail(`signing certificate unreadable: ${(error as Error).message}`);
      }

      const fingerprint = await certificateFingerprint(leaf);
      if (
        trust.leafPins !== undefined &&
        trust.leafPins.length > 0 &&
        !trust.leafPins.includes(fingerprint)
      ) {
        return fail(`signing certificate ${fingerprint} is not among the pinned leaves`);
      }

      let issued = false;
      for (const issuer of trust.issuers) {
        if (await isIssuedBy(leaf, issuer)) {
          issued = true;
          break;
        }
      }
      if (!issued) {
        return fail(
          `signing certificate "${leaf.subject.commonName}" was not issued by a pinned CA (issuer "${leaf.issuer.commonName}")`,
        );
      }

      const at = now();
      if (!isValidAt(leaf, at)) {
        return fail(
          `signing certificate valid ${leaf.notBefore.toISOString()}–${leaf.notAfter.toISOString()}, not at ${at.toISOString()}`,
        );
      }

      const problem = signerCertificateProblem(leaf);
      if (problem !== undefined) return fail(`signing certificate unusable: ${problem}`);

      if (leaf.subject.organizationIdentifier !== trust.subjectOrganizationIdentifier) {
        return fail(
          `signing certificate subject organizationIdentifier "${leaf.subject.organizationIdentifier}" ≠ "${trust.subjectOrganizationIdentifier}"`,
        );
      }

      try {
        const key = await importRsaPublicKey(leaf.spki, "SHA-256");
        const valid = await crypto.subtle.verify(
          "RSASSA-PKCS1-v1_5",
          key,
          bufferSource(input.signature.signatureValue),
          bufferSource(input.signature.signedInfoCanonical),
        );
        return valid || fail("RSA-SHA256 signature over SignedInfo does not verify");
      } catch (error) {
        return fail(`signature check failed: ${(error as Error).message}`);
      }
    },
  };
}
