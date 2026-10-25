/**
 * The slice of X.509 (RFC 5280) the gateway needs: identity fields, validity, the public key and
 * "was this certificate signed by that one". No path building, revocation or extension policy —
 * trust decisions are made explicitly by certificate.ts and response-trust.ts.
 */
import { bufferSource, bytesEqual, bytesToHex, sha256Hex } from "./bytes.ts";
import {
  DerError,
  type DerNode,
  DerTag,
  decodeBitString,
  decodeOid,
  decodeString,
  decodeTime,
  expectTag,
  readChildren,
  readNode,
} from "./der.ts";

export interface DistinguishedName {
  readonly commonName?: string | undefined;
  readonly organization?: string | undefined;
  /** OID 2.5.4.97, e.g. `NTRCZ-72080043` for GFŘ. */
  readonly organizationIdentifier?: string | undefined;
  readonly serialNumber?: string | undefined;
  readonly country?: string | undefined;
  readonly description?: string | undefined;
  /** DER of the whole Name, for exact issuer/subject matching. */
  readonly der: Uint8Array;
}

export interface Certificate {
  readonly der: Uint8Array;
  readonly tbs: Uint8Array;
  readonly serialNumber: string;
  readonly issuer: DistinguishedName;
  readonly subject: DistinguishedName;
  readonly notBefore: Date;
  readonly notAfter: Date;
  /** DER SubjectPublicKeyInfo, importable with `crypto.subtle.importKey("spki", …)`. */
  readonly spki: Uint8Array;
  readonly signatureAlgorithm: string;
  readonly signature: Uint8Array;
}

const NAME_ATTRIBUTES: Record<string, keyof Omit<DistinguishedName, "der">> = {
  "2.5.4.3": "commonName",
  "2.5.4.10": "organization",
  "2.5.4.97": "organizationIdentifier",
  "2.5.4.5": "serialNumber",
  "2.5.4.6": "country",
  "2.5.4.13": "description",
};

/** RSA PKCS#1 v1.5 signature algorithms → Web Crypto hash. RSASSA-PSS is not used by EET or I.CA. */
const RSA_SIGNATURE_HASHES: Record<string, "SHA-256" | "SHA-384" | "SHA-512"> = {
  "1.2.840.113549.1.1.11": "SHA-256",
  "1.2.840.113549.1.1.12": "SHA-384",
  "1.2.840.113549.1.1.13": "SHA-512",
};

function parseName(node: DerNode): DistinguishedName {
  const name: Record<string, string> = {};
  for (const rdn of readChildren(expectTag(node, DerTag.sequence, "Name"))) {
    for (const attribute of readChildren(expectTag(rdn, DerTag.set, "RDN"))) {
      const [type, value] = readChildren(
        expectTag(attribute, DerTag.sequence, "AttributeTypeAndValue"),
      );
      const key = NAME_ATTRIBUTES[decodeOid(expectTag(type, DerTag.oid, "attribute type"))];
      if (key !== undefined && value !== undefined) name[key] = decodeString(value);
    }
  }
  return { ...name, der: node.bytes };
}

export function parseCertificate(der: Uint8Array): Certificate {
  try {
    const root = expectTag(readNode(der), DerTag.sequence, "Certificate");
    if (root.bytes.length !== der.length) throw new DerError("trailing data after Certificate");
    const [tbsNode, algNode, sigNode] = readChildren(root);
    const tbs = expectTag(tbsNode, DerTag.sequence, "TBSCertificate");
    const fields = readChildren(tbs);
    // version is the optional [0] EXPLICIT field; everything else is positional after it.
    const start = fields[0]?.tag === 0xa0 ? 1 : 0;
    const [serial, , issuer, validity, subject, spki] = fields.slice(start);
    const [notBefore, notAfter] = readChildren(expectTag(validity, DerTag.sequence, "Validity"));
    const [alg] = readChildren(expectTag(algNode, DerTag.sequence, "signatureAlgorithm"));
    if (notBefore === undefined || notAfter === undefined)
      throw new DerError("incomplete Validity");
    return {
      der,
      tbs: tbs.bytes,
      serialNumber: bytesToHex(expectTag(serial, DerTag.integer, "serialNumber").content),
      issuer: parseName(expectTag(issuer, DerTag.sequence, "issuer")),
      subject: parseName(expectTag(subject, DerTag.sequence, "subject")),
      notBefore: decodeTime(notBefore),
      notAfter: decodeTime(notAfter),
      spki: expectTag(spki, DerTag.sequence, "subjectPublicKeyInfo").bytes,
      signatureAlgorithm: decodeOid(expectTag(alg, DerTag.oid, "algorithm")),
      signature: decodeBitString(expectTag(sigNode, DerTag.bitString, "signatureValue")),
    };
  } catch (error) {
    if (error instanceof DerError)
      throw new DerError(`not a valid X.509 certificate: ${error.message}`);
    throw error;
  }
}

export function certificateFingerprint(certificate: Certificate): Promise<string> {
  return sha256Hex(certificate.der);
}

export function isValidAt(certificate: Certificate, at: Date): boolean {
  const t = at.getTime();
  return certificate.notBefore.getTime() <= t && t <= certificate.notAfter.getTime();
}

export function importRsaPublicKey(
  spki: Uint8Array,
  hash: "SHA-256" | "SHA-384" | "SHA-512",
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    bufferSource(spki),
    { name: "RSASSA-PKCS1-v1_5", hash },
    false,
    ["verify"],
  );
}

/**
 * True when `certificate` names `issuer` as its issuer (exact DER match of the Names) and its
 * signature verifies with the issuer's public key. Only RSA PKCS#1 v1.5 signatures are supported.
 */
export async function isIssuedBy(certificate: Certificate, issuer: Certificate): Promise<boolean> {
  const hash = RSA_SIGNATURE_HASHES[certificate.signatureAlgorithm];
  if (hash === undefined) return false;
  if (!bytesEqual(certificate.issuer.der, issuer.subject.der)) return false;
  try {
    const key = await importRsaPublicKey(issuer.spki, hash);
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      bufferSource(certificate.signature),
      bufferSource(certificate.tbs),
    );
  } catch {
    return false;
  }
}
