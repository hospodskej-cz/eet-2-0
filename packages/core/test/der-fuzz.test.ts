/**
 * Property and fuzz tests of the DER/X.509 reader. Everything is seeded: a failure reproduces
 * with the same indices. Corpus: the real CA certificates vendored in spec/ca, the real
 * playground signer and cash-register certificates, and a synthetic certificate.
 */
import { describe, expect, test } from "bun:test";
import { bytesEqual } from "../src/bytes.ts";
import { decodeOid, decodeString, decodeTime, readChildren, readNode } from "../src/der.ts";
import {
  base64ToBytes,
  DerError,
  isIssuedBy,
  parseCertificate,
  TRUST_ANCHORS,
  trustAnchor,
} from "../src/index.ts";
import { concat, tlv } from "./der-builder.ts";
import { repoPath } from "./helpers.ts";

/** mulberry32: tiny deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function tokenFrom(relative: string): Promise<Uint8Array> {
  const xml = await Bun.file(repoPath(relative)).text();
  const token = />([A-Za-z0-9+/=\s]+)<\/wsse:BinarySecurityToken>/.exec(xml)?.[1];
  if (token === undefined) throw new Error(`no BinarySecurityToken in ${relative}`);
  return base64ToBytes(token.replace(/\s+/g, ""));
}

interface Sample {
  readonly name: string;
  readonly der: Uint8Array;
  /** The certificate that really issued it, so mutations can be checked cryptographically. */
  readonly issuer: ReturnType<typeof trustAnchor>;
}

const samples: Sample[] = [
  {
    name: "playground sub CA",
    der: base64ToBytes(TRUST_ANCHORS.eetPlaygroundSub),
    issuer: trustAnchor("eetPlaygroundRoot"),
  },
  {
    name: "production sub CA",
    der: base64ToBytes(TRUST_ANCHORS.eetProductionSub),
    issuer: trustAnchor("eetProductionRoot"),
  },
  {
    name: "playground cash register",
    der: await tokenFrom("spec/eet-v4.1/samples/CZ00000019.eet.v4.req.xml"),
    issuer: trustAnchor("eetPlaygroundSub"),
  },
  {
    name: "response signer",
    der: await tokenFrom("test/fixtures/responses/pg-accepted-2026-10-25.xml"),
    issuer: trustAnchor("icaPublicCa2022"),
  },
];

function mutate(original: Uint8Array, random: () => number): Uint8Array {
  const out = Array.from(original);
  const edits = 1 + Math.floor(random() * 4);
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(random() * out.length);
    switch (Math.floor(random() * 6)) {
      case 0: // flip one bit
        out[at] = (out[at] as number) ^ (1 << Math.floor(random() * 8));
        break;
      case 1: // random byte
        out[at] = Math.floor(random() * 256);
        break;
      case 2: // interesting byte
        out[at] = [0x00, 0x7f, 0x80, 0x81, 0x82, 0xff, 0x30, 0x06][
          Math.floor(random() * 8)
        ] as number;
        break;
      case 3: // delete a short run
        out.splice(at, 1 + Math.floor(random() * 4));
        break;
      case 4: // insert a short run
        out.splice(
          at,
          0,
          ...Array.from({ length: 1 + Math.floor(random() * 4) }, () => Math.floor(random() * 256)),
        );
        break;
      default: // duplicate a chunk
        out.splice(at, 0, ...out.slice(at, at + 1 + Math.floor(random() * 16)));
    }
  }
  return new Uint8Array(out);
}

describe("pristine corpus", () => {
  for (const sample of samples) {
    test(`${sample.name} parses and verifies against its issuer`, async () => {
      expect(await isIssuedBy(parseCertificate(sample.der), sample.issuer)).toBe(true);
    });
  }
});

describe("truncation and extension", () => {
  for (const sample of samples) {
    test(`every strict prefix of ${sample.name} is a DerError`, () => {
      for (let length = 0; length < sample.der.length; length++) {
        try {
          parseCertificate(sample.der.subarray(0, length));
          throw new Error(`prefix of ${length} bytes was accepted`);
        } catch (error) {
          expect(error, `prefix ${length}`).toBeInstanceOf(DerError);
        }
      }
    });

    test(`trailing bytes after ${sample.name} are a DerError`, () => {
      const random = prng(7);
      for (let i = 0; i < 50; i++) {
        const extra = Uint8Array.from({ length: 1 + Math.floor(random() * 8) }, () =>
          Math.floor(random() * 256),
        );
        expect(() => parseCertificate(concat(sample.der, extra))).toThrow(DerError);
      }
    });
  }
});

describe("random mutation (seeded)", () => {
  for (const [index, sample] of samples.entries()) {
    test(`${sample.name}: only DerError, and a changed signed part never verifies`, async () => {
      const random = prng(1000 + index);
      const original = parseCertificate(sample.der);
      let parsed = 0;
      for (let i = 0; i < 1500; i++) {
        const input = mutate(sample.der, random);
        let certificate: ReturnType<typeof parseCertificate>;
        try {
          certificate = parseCertificate(input);
        } catch (error) {
          expect(error, `mutation #${i}`).toBeInstanceOf(DerError);
          continue;
        }
        parsed++;
        // Whatever parses must describe real instants, never NaN or rolled-over dates.
        expect(Number.isNaN(certificate.notBefore.getTime()), `#${i} notBefore`).toBe(false);
        expect(Number.isNaN(certificate.notAfter.getTime()), `#${i} notAfter`).toBe(false);
        // Slices stay inside the input.
        expect(certificate.tbs.byteLength).toBeLessThanOrEqual(input.length);
        const verified = await isIssuedBy(certificate, sample.issuer);
        const signedPartsUnchanged =
          bytesEqual(certificate.tbs, original.tbs) &&
          bytesEqual(certificate.signature, original.signature) &&
          certificate.signatureAlgorithm === original.signatureAlgorithm;
        if (!signedPartsUnchanged) {
          expect(verified, `mutation #${i} changed the signed data but still verifies`).toBe(false);
        }
      }
      // The mutator must not be so destructive that nothing ever reaches the verifier.
      expect(parsed).toBeGreaterThan(0);
    });
  }
});

describe("random garbage (seeded)", () => {
  test("random buffers, with and without a plausible SEQUENCE header, only raise DerError", () => {
    const random = prng(42);
    for (let i = 0; i < 4000; i++) {
      const body = Uint8Array.from({ length: Math.floor(random() * 400) }, () =>
        Math.floor(random() * 256),
      );
      const input = random() < 0.5 ? body : tlv(0x30, body);
      try {
        parseCertificate(input);
      } catch (error) {
        expect(error, `buffer #${i}`).toBeInstanceOf(DerError);
      }
    }
  });

  test("primitive decoders only raise DerError on arbitrary content", () => {
    const random = prng(43);
    const tags = [0x06, 0x0c, 0x13, 0x14, 0x16, 0x17, 0x18, 0x1e, 0x04, 0x02];
    for (let i = 0; i < 6000; i++) {
      const content = Uint8Array.from({ length: Math.floor(random() * 24) }, () =>
        random() < 0.7 ? 0x30 + Math.floor(random() * 10) : Math.floor(random() * 256),
      );
      const node = readNode(tlv(tags[Math.floor(random() * tags.length)] as number, content));
      for (const decode of [decodeOid, decodeString, decodeTime]) {
        try {
          decode(node);
        } catch (error) {
          expect(error, `${decode.name} #${i}`).toBeInstanceOf(DerError);
        }
      }
    }
  });
});

describe("resource limits", () => {
  test("20 000 nested SEQUENCEs neither overflow the stack nor take long", () => {
    let nested: Uint8Array = tlv(0x05, new Uint8Array());
    for (let depth = 0; depth < 20_000; depth++) nested = tlv(0x30, nested);
    const started = performance.now();
    expect(() => parseCertificate(nested)).toThrow(DerError);
    // readChildren is not recursive: walking the whole chain iteratively must also be cheap.
    let node = readNode(nested);
    let levels = 0;
    while ((node.tag & 0x20) !== 0 && node.content.length > 0) {
      node = readChildren(node)[0] as typeof node;
      levels++;
    }
    expect(levels).toBe(20_000);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  test("a SEQUENCE of 300 000 empty elements is read in linear time", () => {
    const children = new Uint8Array(600_000);
    for (let i = 0; i < children.length; i += 2) children[i] = 0x05;
    const started = performance.now();
    expect(readChildren(readNode(tlv(0x30, children))).length).toBe(300_000);
    expect(() => parseCertificate(tlv(0x30, children))).toThrow(DerError);
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  test("a length claiming 4 GiB is refused without allocating", () => {
    const started = performance.now();
    expect(() =>
      parseCertificate(new Uint8Array([0x30, 0x84, 0xff, 0xff, 0xff, 0xff, 1, 2, 3])),
    ).toThrow(DerError);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
