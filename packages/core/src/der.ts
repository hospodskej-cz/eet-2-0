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
  // Every arc must end on an octet with the high bit clear, must not start with 0x80 (X.690
  // §8.19.2: that would let several encodings alias one OID) and must stay an exact JS integer.
  if ((bytes[bytes.length - 1] as number) & 0x80) throw new DerError("unterminated OID arc");
  const parts: number[] = [];
  let value = 0;
  let arcLength = 0;
  for (const byte of bytes) {
    if (arcLength === 0 && byte === 0x80) throw new DerError("non-minimal OID arc");
    value = value * 128 + (byte & 0x7f);
    arcLength++;
    if (!Number.isSafeInteger(value)) throw new DerError("OID arc too large");
    if ((byte & 0x80) === 0) {
      if (parts.length === 0) {
        const first = value < 80 ? Math.floor(value / 40) : 2;
        parts.push(first, value - first * 40);
      } else {
        parts.push(value);
      }
      value = 0;
      arcLength = 0;
    }
  }
  return parts.join(".");
}

/** One char per octet. A loop instead of `String.fromCharCode(...bytes)`, which overflows the stack. */
function latin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

export function decodeString(node: DerNode): string {
  switch (node.tag) {
    case DerTag.utf8String:
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(node.content);
      } catch {
        throw new DerError("UTF8String is not valid UTF-8");
      }
    case DerTag.printableString:
    case DerTag.ia5String:
      if (node.content.some((byte) => byte > 0x7f)) {
        throw new DerError(`string tag 0x${node.tag.toString(16)} holds a non-ASCII octet`);
      }
      return latin1(node.content);
    case DerTag.teletexString:
      return latin1(node.content);
    case DerTag.bmpString: {
      if (node.content.length % 2 !== 0) throw new DerError("BMPString of odd length");
      let out = "";
      for (let i = 0; i < node.content.length; i += 2) {
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

/**
 * UTCTime (`YYMMDDHHMMSSZ`) or GeneralizedTime (`YYYYMMDDHHMMSSZ`), as used by RFC 5280. Only
 * real calendar instants are accepted: `Date.UTC` would silently roll month 13 or 30 February
 * over to the next period, and map years 0–99 to 1900–1999.
 */
export function decodeTime(node: DerNode): Date {
  // 15 octets at most; checking first keeps hostile input away from the string conversion.
  if (node.content.length > 15) throw new DerError("time value too long");
  const text = latin1(node.content);
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
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 100) throw new DerError(`implausible year in time ${text}`);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    throw new DerError(`time ${text} is not a valid calendar instant`);
  }
  return date;
}

/** BIT STRING content without the leading "unused bits" octet (must be 0 here). */
export function decodeBitString(node: DerNode): Uint8Array {
  const content = expectTag(node, DerTag.bitString, "BIT STRING").content;
  if (content[0] !== 0) throw new DerError("BIT STRING with unused bits is not supported");
  return content.subarray(1);
}
