/**
 * Tiny DER encoder and X.509 issuer for tests. It builds hostile and unusual certificates (CA
 * leaves, missing key usage, inconsistent algorithms …) that no real CA would hand out, and
 * signs them with throw-away keys. Test code only: never imported by `src`.
 */

const encoder = new TextEncoder();

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function tlv(tag: number, ...content: Uint8Array[]): Uint8Array {
  const body = concat(...content);
  const n = body.length;
  const length =
    n < 0x80
      ? [n]
      : n < 0x100
        ? [0x81, n]
        : n < 0x10000
          ? [0x82, n >> 8, n & 0xff]
          : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff];
  return concat(new Uint8Array([tag, ...length]), body);
}

export const seq = (...parts: Uint8Array[]) => tlv(0x30, ...parts);
export const set = (...parts: Uint8Array[]) => tlv(0x31, ...parts);
export const octets = (bytes: Uint8Array) => tlv(0x04, bytes);
export const bool = (value: boolean) => tlv(0x01, new Uint8Array([value ? 0xff : 0x00]));
export const integer = (...bytes: number[]) => tlv(0x02, new Uint8Array(bytes));
export const utf8 = (text: string) => tlv(0x0c, encoder.encode(text));
export const nul = () => new Uint8Array([0x05, 0x00]);
export const bitString = (bytes: Uint8Array, unused = 0) =>
  tlv(0x03, new Uint8Array([unused]), bytes);
export const explicit = (n: number, ...parts: Uint8Array[]) => tlv(0xa0 | n, ...parts);

export function oid(dotted: string): Uint8Array {
  const arcs = dotted.split(".").map(Number);
  const body: number[] = [];
  const push = (value: number) => {
    const chunk = [value & 0x7f];
    for (let v = Math.floor(value / 128); v > 0; v = Math.floor(v / 128))
      chunk.unshift((v & 0x7f) | 0x80);
    body.push(...chunk);
  };
  push((arcs[0] as number) * 40 + (arcs[1] as number));
  for (const arc of arcs.slice(2)) push(arc);
  return tlv(0x06, new Uint8Array(body));
}

export function utcTime(date: Date): Uint8Array {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const text = `${p(date.getUTCFullYear() % 100)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return tlv(0x17, encoder.encode(text));
}

export const OID = {
  commonName: "2.5.4.3",
  organization: "2.5.4.10",
  organizationIdentifier: "2.5.4.97",
  sha256WithRsa: "1.2.840.113549.1.1.11",
  sha512WithRsa: "1.2.840.113549.1.1.13",
  rsaEncryption: "1.2.840.113549.1.1.1",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
} as const;

export type NameSpec = readonly (readonly [string, string])[];

export function name(attributes: NameSpec): Uint8Array {
  return seq(...attributes.map(([type, value]) => set(seq(oid(type), utf8(value)))));
}

export function extension(id: string, value: Uint8Array, critical = false): Uint8Array {
  return seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
}

export const basicConstraints = (ca: boolean) =>
  extension(OID.basicConstraints, seq(...(ca ? [bool(true)] : [])), true);

/** KeyUsage bits as a single octet (`0x80` digitalSignature, `0x40` nonRepudiation, `0x20` keyEncipherment …). */
export const keyUsage = (bits: number) =>
  extension(OID.keyUsage, bitString(new Uint8Array([bits]), 5), true);

export async function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
}

export async function spkiOf(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("spki", key));
}

export interface IssueOptions {
  readonly subject: NameSpec;
  readonly issuer: NameSpec;
  readonly subjectKey: CryptoKey;
  readonly issuerKey: CryptoKey;
  readonly notBefore?: Date;
  readonly notAfter?: Date;
  readonly serial?: Uint8Array;
  readonly extensions?: readonly Uint8Array[];
  /** Algorithm OID used inside the TBSCertificate (defaults to sha256WithRSA). */
  readonly innerAlgorithm?: string;
  /** Algorithm OID of the outer `signatureAlgorithm` (defaults to the inner one). */
  readonly outerAlgorithm?: string;
}

export async function issueCertificate(options: IssueOptions): Promise<Uint8Array> {
  const inner = options.innerAlgorithm ?? OID.sha256WithRsa;
  const outer = options.outerAlgorithm ?? inner;
  const tbs = seq(
    explicit(0, integer(2)),
    tlv(0x02, options.serial ?? new Uint8Array([0x01])),
    seq(oid(inner), nul()),
    name(options.issuer),
    seq(
      utcTime(options.notBefore ?? new Date("2026-01-01T00:00:00Z")),
      utcTime(options.notAfter ?? new Date("2030-01-01T00:00:00Z")),
    ),
    name(options.subject),
    await spkiOf(options.subjectKey),
    ...(options.extensions && options.extensions.length > 0
      ? [explicit(3, seq(...options.extensions))]
      : []),
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      options.issuerKey,
      tbs as Uint8Array<ArrayBuffer>,
    ),
  );
  return seq(tbs, seq(oid(outer), nul()), bitString(signature));
}
