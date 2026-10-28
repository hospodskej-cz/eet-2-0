import { describe, expect, test } from "bun:test";
import {
  DerError,
  decodeOid,
  decodeString,
  decodeTime,
  readChildren,
  readNode,
} from "../src/der.ts";
import { concat, oid, tlv } from "./der-builder.ts";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);
const node = (tag: number, content: Uint8Array) => readNode(tlv(tag, content));

describe("readNode", () => {
  test("reads short and long definite lengths", () => {
    expect(readNode(bytes(0x04, 0x02, 0xaa, 0xbb)).content).toEqual(bytes(0xaa, 0xbb));
    const long = tlv(0x04, new Uint8Array(300));
    expect(readNode(long).content.length).toBe(300);
  });

  test("rejects indefinite length, high tags, truncation and overruns", () => {
    expect(() => readNode(bytes(0x30, 0x80, 0x00, 0x00))).toThrow(DerError);
    expect(() => readNode(bytes(0x1f, 0x01, 0x00))).toThrow(DerError);
    expect(() => readNode(bytes(0x04))).toThrow(DerError);
    expect(() => readNode(bytes(0x04, 0x82, 0x01))).toThrow(DerError);
    expect(() => readNode(bytes(0x04, 0x05, 0x01, 0x02))).toThrow(DerError);
    // 4 GiB claim on a 6-byte buffer: no allocation, no overflow, just an error
    expect(() => readNode(bytes(0x04, 0x84, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00))).toThrow(DerError);
    // five length octets are more than any certificate needs
    expect(() => readNode(bytes(0x04, 0x85, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00))).toThrow(DerError);
  });

  test("a child cannot run past its parent even if the buffer continues", () => {
    // SEQUENCE of length 3 containing an OCTET STRING that claims 5 bytes; the buffer has more.
    const buffer = bytes(0x30, 0x03, 0x04, 0x05, 0x01, 0xaa, 0xbb, 0xcc, 0xdd);
    expect(() => readChildren(readNode(buffer))).toThrow(DerError);
  });

  test("readChildren refuses primitive nodes", () => {
    expect(() => readChildren(readNode(bytes(0x04, 0x00)))).toThrow(DerError);
  });
});

describe("decodeOid", () => {
  test("decodes ordinary OIDs, including arcs above 127 and joint-iso-itu-t", () => {
    expect(decodeOid(readNode(oid("2.5.4.97")))).toBe("2.5.4.97");
    expect(decodeOid(readNode(oid("1.2.840.113549.1.1.11")))).toBe("1.2.840.113549.1.1.11");
    expect(decodeOid(readNode(oid("2.999.3")))).toBe("2.999.3");
  });

  test("an unterminated last arc is an error, not a shorter OID", () => {
    // 2.5.4 followed by a dangling continuation octet would otherwise read as "2.5.4"
    expect(() => decodeOid(node(0x06, bytes(0x55, 0x04, 0x83)))).toThrow(DerError);
  });

  test("non-minimal arc encodings (leading 0x80) are rejected, so they cannot alias 2.5.4.3", () => {
    expect(() => decodeOid(node(0x06, bytes(0x80, 0x55, 0x04, 0x03)))).toThrow(DerError);
    expect(() => decodeOid(node(0x06, bytes(0x55, 0x04, 0x80, 0x03)))).toThrow(DerError);
  });

  test("arcs beyond the exact range of a JS number are rejected", () => {
    const huge = bytes(0x55, 0x04, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f);
    expect(() => decodeOid(node(0x06, huge))).toThrow(DerError);
  });

  test("empty OID and wrong tag", () => {
    expect(() => decodeOid(node(0x06, bytes()))).toThrow(DerError);
    expect(() => decodeOid(node(0x04, bytes(0x55)))).toThrow(DerError);
  });
});

describe("decodeTime", () => {
  const utc = (text: string) => decodeTime(node(0x17, ascii(text)));
  const gen = (text: string) => decodeTime(node(0x18, ascii(text)));

  test("UTCTime pivots at 50 (RFC 5280 §4.1.2.5.1)", () => {
    expect(utc("491231235959Z").toISOString()).toBe("2049-12-31T23:59:59.000Z");
    expect(utc("500101000000Z").toISOString()).toBe("1950-01-01T00:00:00.000Z");
  });

  test("GeneralizedTime", () => {
    expect(gen("20520101000000Z").toISOString()).toBe("2052-01-01T00:00:00.000Z");
    expect(gen("99991231235959Z").toISOString()).toBe("9999-12-31T23:59:59.000Z");
  });

  test("values outside the calendar are rejected instead of rolling over", () => {
    for (const text of [
      "271301000000Z", // month 13 would become January 2028
      "270001000000Z",
      "270230000000Z", // 30 February would become 2 March
      "270100000000Z", // day 0
      "270132000000Z",
      "270101240000Z", // hour 24
      "270101006000Z", // minute 60
      "270101000060Z", // second 60: no leap seconds in certificates
      "270229000000Z", // 2027 is not a leap year
    ]) {
      expect(() => utc(text), text).toThrow(DerError);
    }
    expect(utc("280229000000Z").toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(() => gen("20271301000000Z")).toThrow(DerError);
  });

  test("GeneralizedTime years below 100 are not mapped to 19xx", () => {
    expect(() => gen("00500101000000Z")).toThrow(DerError);
  });

  test("zones, fractions, short forms and junk are rejected", () => {
    for (const text of [
      "270101000000+0100",
      "270101000000",
      "2701010000Z",
      "270101000000.5Z",
      "27010100000Z",
      "27 101000000Z",
      "",
    ]) {
      expect(() => utc(text), text).toThrow(DerError);
    }
    expect(() => gen("20270101000000.0Z")).toThrow(DerError);
  });

  test("a huge time node is a DerError, not a RangeError from argument spreading", () => {
    expect(() => decodeTime(node(0x17, new Uint8Array(500_000).fill(0x30)))).toThrow(DerError);
  });

  test("wrong tag", () => {
    expect(() => decodeTime(node(0x04, ascii("270101000000Z")))).toThrow(DerError);
  });
});

describe("decodeString", () => {
  test("UTF8String, PrintableString, IA5String, BMPString", () => {
    expect(decodeString(node(0x0c, ascii("Správa")))).toBe("Správa");
    expect(decodeString(node(0x13, ascii("NTRCZ-72080043")))).toBe("NTRCZ-72080043");
    expect(decodeString(node(0x16, ascii("a@b.cz")))).toBe("a@b.cz");
    expect(decodeString(node(0x1e, bytes(0x00, 0x41, 0x00, 0x42)))).toBe("AB");
  });

  test("invalid UTF-8 is rejected", () => {
    expect(() => decodeString(node(0x0c, bytes(0xc3, 0x28)))).toThrow(DerError);
  });

  test("a BMPString of odd length is rejected (a stray octet must not vanish)", () => {
    expect(() => decodeString(node(0x1e, bytes(0x00, 0x41, 0x00)))).toThrow(DerError);
  });

  test("PrintableString and IA5String are 7-bit", () => {
    expect(() => decodeString(node(0x13, bytes(0x41, 0xc4)))).toThrow(DerError);
    expect(() => decodeString(node(0x16, bytes(0x41, 0xc4)))).toThrow(DerError);
  });

  test("a huge string is a DerError or a string, never a RangeError", () => {
    const big = node(0x13, new Uint8Array(400_000).fill(0x41));
    expect(decodeString(big).length).toBe(400_000);
  });

  test("unsupported string types are rejected", () => {
    expect(() => decodeString(node(0x04, ascii("x")))).toThrow(DerError);
  });
});

test("concat/tlv helpers produce what readNode expects (self-check of the test builder)", () => {
  const encoded = tlv(0x30, tlv(0x02, bytes(0x01)), tlv(0x02, bytes(0x02)));
  expect(readChildren(readNode(encoded)).map((n) => n.content[0])).toEqual([1, 2]);
  expect(concat(bytes(1), bytes(2, 3))).toEqual(bytes(1, 2, 3));
});
