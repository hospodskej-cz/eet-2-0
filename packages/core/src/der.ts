/**
 * Minimal read-only DER decoder — just enough ASN.1 to read X.509 certificates (x509.ts).
 * Rejects indefinite lengths and anything running past its parent, so malformed input fails
 * loudly instead of being half-read. See docs/ADR-002-response-trust.md for why this is not a
 * third-party library.
 */

export class DerError extends Error {
  override readonly name = "DerError";
}

export const DerTag = {
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  oid: 0x06,
  utf8String: 0x0c,
  printableString: 0x13,
  teletexString: 0x14,
  ia5String: 0x16,
  utcTime: 0x17,
  generalizedTime: 0x18,
  bmpString: 0x1e,
  sequence: 0x30,
  set: 0x31,
} as const;

export interface DerNode {
  /** Full identifier octet, e.g. 0x30 for SEQUENCE or 0xa0 for `[0]` constructed. */
  readonly tag: number;
  /** The whole TLV (header + content). */
  readonly bytes: Uint8Array;
  /** Content octets only. */
  readonly content: Uint8Array;
}

/** Reads one TLV starting at `offset` of `input`. */
export function readNode(input: Uint8Array, offset = 0): DerNode {
  if (offset + 2 > input.length) throw new DerError("truncated TLV header");
  const tag = input[offset] as number;
  if ((tag & 0x1f) === 0x1f) throw new DerError("high-tag-number form is not supported");
  let length = input[offset + 1] as number;
  let headerLength = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0) throw new DerError("indefinite length is not allowed in DER");
    if (count > 4) throw new DerError("length too large");
    if (offset + 2 + count > input.length) throw new DerError("truncated length");
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + (input[offset + 2 + i] as number);
    headerLength += count;
  }
  const end = offset + headerLength + length;
  if (end > input.length) throw new DerError("content runs past the end of its parent");
  return {
    tag,
    bytes: input.subarray(offset, end),
    content: input.subarray(offset + headerLength, end),
  };
}

/** Decodes the children of a constructed node. */
export function readChildren(node: DerNode): DerNode[] {
  if ((node.tag & 0x20) === 0) throw new DerError(`tag 0x${node.tag.toString(16)} is primitive`);
  const children: DerNode[] = [];
  let offset = 0;
  while (offset < node.content.length) {
    const child = readNode(node.content, offset);
    children.push(child);
    offset += child.bytes.length;
  }
  return children;
}

export function expectTag(node: DerNode | undefined, tag: number, what: string): DerNode {
  if (node === undefined) throw new DerError(`missing ${what}`);
  if (node.tag !== tag) {
    throw new DerError(
      `${what}: expected tag 0x${tag.toString(16)}, got 0x${node.tag.toString(16)}`,
    );
  }
  return node;
}

export function decodeOid(node: DerNode): string {
  const bytes = expectTag(node, DerTag.oid, "OBJECT IDENTIFIER").content;
  if (bytes.length === 0) throw new DerError("empty OID");
  const parts: number[] = [];
  let value = 0;
  for (const byte of bytes) {
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      if (parts.length === 0) {
        const first = value < 80 ? Math.floor(value / 40) : 2;
        parts.push(first, value - first * 40);
      } else {
        parts.push(value);
      }
      value = 0;
    }
  }
  return parts.join(".");
}

export function decodeString(node: DerNode): string {
  switch (node.tag) {
    case DerTag.utf8String:
      return new TextDecoder("utf-8", { fatal: true }).decode(node.content);
    case DerTag.printableString:
    case DerTag.ia5String:
    case DerTag.teletexString:
      return String.fromCharCode(...node.content);
    case DerTag.bmpString: {
      let out = "";
      for (let i = 0; i + 1 < node.content.length; i += 2) {
        out += String.fromCharCode(
          ((node.content[i] as number) << 8) | (node.content[i + 1] as number),
        );
      }
      return out;
    }
    default:
      throw new DerError(`unsupported string tag 0x${node.tag.toString(16)}`);
  }
}

/** UTCTime (`YYMMDDHHMMSSZ`) or GeneralizedTime (`YYYYMMDDHHMMSSZ`), as used by RFC 5280. */
export function decodeTime(node: DerNode): Date {
  const text = String.fromCharCode(...node.content);
  let m: RegExpExecArray | null;
  if (node.tag === DerTag.utcTime) {
    m = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(text);
    if (m === null) throw new DerError(`bad UTCTime ${text}`);
    const yy = Number(m[1]);
    m[1] = String(yy < 50 ? 2000 + yy : 1900 + yy);
  } else if (node.tag === DerTag.generalizedTime) {
    m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(text);
    if (m === null) throw new DerError(`bad GeneralizedTime ${text}`);
  } else {
    throw new DerError(`expected a time, got tag 0x${node.tag.toString(16)}`);
  }
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as number[];
  return new Date(Date.UTC(year as number, (month as number) - 1, day, hour, minute, second));
}

/** BIT STRING content without the leading "unused bits" octet (must be 0 here). */
export function decodeBitString(node: DerNode): Uint8Array {
  const content = expectTag(node, DerTag.bitString, "BIT STRING").content;
  if (content[0] !== 0) throw new DerError("BIT STRING with unused bits is not supported");
  return content.subarray(1);
}
