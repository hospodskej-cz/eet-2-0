/**
 * Trust in signed EET confirmations (`<Potvrzeni>`), docs/ADR-002-response-trust.md.
 *
 * The response is signed by a GFŘ certificate issued by I.CA, not by CA EET (PG/P §3.3). Its
 * leaf rotates yearly (the playground one expires 2027-06-08), so trust is anchored in the
 * pinned issuing CA plus a subject check; pinning leaves is an optional, stricter extra.
 */
import { bufferSource, certificateToDer } from "./bytes.ts";
import { trustAnchor } from "./certificate.ts";
import {
  type Certificate,
  certificateFingerprint,
  importRsaPublicKey,
  isIssuedBy,
  isValidAt,
  parseCertificate,
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

/** What the protocol library hands to a response verifier (structural subset). */
export interface ResponseSignatureInput {
  readonly signature: {
    readonly certificates: readonly Uint8Array[];
    readonly signedInfoCanonical: Uint8Array;
    readonly signatureValue: Uint8Array;
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
