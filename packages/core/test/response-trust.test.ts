import { describe, expect, test } from "bun:test";
import { parseAndVerifyResponse } from "@finitoapp/eet-client";
import {
  createResponseVerifier,
  playgroundResponseTrust,
  type ResponseTrust,
  responseTrustFrom,
  TRUST_ANCHORS,
  trustAnchor,
} from "../src/index.ts";
import { fixedClock, repoPath } from "./helpers.ts";

const FIXTURE = "test/fixtures/responses/pg-accepted-2026-10-25.xml";
const SIGNER_SHA256 = "b810009edeaf22f6004fb5951e4a10a17ee71e41ab207f912c086ef4cafbf93b";
const raw = await Bun.file(repoPath(FIXTURE)).text();

async function verify(trust: ResponseTrust, now: string, xml = raw) {
  const failures: string[] = [];
  const verifier = createResponseVerifier(trust, {
    now: fixedClock(now),
    onFailure: (reason) => failures.push(reason),
  });
  const result = await parseAndVerifyResponse(xml, {
    httpStatus: 200,
    responseSignatureVerifier: verifier,
  });
  return { result, failures };
}

describe("response trust on the captured playground confirmation", () => {
  test("default playground trust accepts it", async () => {
    const { result, failures } = await verify(playgroundResponseTrust(), "2026-10-25T16:30:05Z");
    expect(failures).toEqual([]);
    expect(result.ok && result.value.status).toBe("accepted");
    if (result.ok && result.value.status === "accepted") {
      expect(result.value.pok).toBe("8b925c37-737a-4242-86a7-986a62bc0cc9-ff");
      expect(result.value.test).toBe(true);
    }
  });

  test("signer outside its validity is rejected", async () => {
    for (const now of ["2027-06-09T00:00:00Z", "2026-06-01T00:00:00Z"]) {
      const { result, failures } = await verify(playgroundResponseTrust(), now);
      expect(result.ok).toBe(false);
      expect(failures[0]).toContain("valid");
    }
  });

  test("a modified confirmation fails the digest check", async () => {
    const tampered = raw.replace("986a62bc0cc9-ff", "986a62bc0cc8-ff");
    expect(tampered).not.toBe(raw);
    const { result } = await verify(playgroundResponseTrust(), "2026-10-25T16:30:05Z", tampered);
    expect(result.ok ? result.value.status : result.error.type).toBe("EetSignatureError");
  });

  test("a different pinned issuer is rejected", async () => {
    const trust = { ...playgroundResponseTrust(), issuers: [trustAnchor("eetPlaygroundSub")] };
    const { result, failures } = await verify(trust, "2026-10-25T16:30:05Z");
    expect(result.ok).toBe(false);
    expect(failures[0]).toContain("not issued by a pinned CA");
  });

  test("the signer must belong to GFŘ", async () => {
    const trust = { ...playgroundResponseTrust(), subjectOrganizationIdentifier: "NTRCZ-00000000" };
    const { result, failures } = await verify(trust, "2026-10-25T16:30:05Z");
    expect(result.ok).toBe(false);
    expect(failures[0]).toContain("organizationIdentifier");
  });

  test("optional leaf pins are enforced in addition", async () => {
    const pinned = { ...playgroundResponseTrust(), leafPins: [SIGNER_SHA256] };
    expect((await verify(pinned, "2026-10-25T16:30:05Z")).result.ok).toBe(true);
    const other = { ...playgroundResponseTrust(), leafPins: ["00".repeat(32)] };
    const { result, failures } = await verify(other, "2026-10-25T16:30:05Z");
    expect(result.ok).toBe(false);
    expect(failures[0]).toContain("pinned leaves");
  });

  test("responseTrustFrom accepts PEM issuers and colon-separated pins", async () => {
    const pem = `-----BEGIN CERTIFICATE-----\n${TRUST_ANCHORS.icaPublicCa2022.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----\n`;
    const trust = responseTrustFrom({
      issuers: [pem],
      leafPins: [SIGNER_SHA256.toUpperCase().match(/../g)?.join(":") ?? ""],
    });
    expect((await verify(trust, "2026-10-25T16:30:05Z")).result.ok).toBe(true);
  });
});
