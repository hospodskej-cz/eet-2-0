import { describe, expect, test } from "bun:test";
import {
  createHeader,
  EET_PATTERNS,
  EetHeaderSchema,
  formatEetDateTime,
  isEetDateTime,
} from "../src/index.ts";

describe("formatEetDateTime (Europe/Prague by default)", () => {
  const cases: [instant: string, expected: string][] = [
    // Examples from rozhraní §3.3.3.2.
    ["2027-01-09T03:25:28Z", "2027-01-09T04:25:28+01:00"],
    ["2027-06-09T03:25:28Z", "2027-06-09T05:25:28+02:00"],
    // Spring forward 2026-03-29: 02:00 CET → 03:00 CEST.
    ["2026-03-29T00:59:59Z", "2026-03-29T01:59:59+01:00"],
    ["2026-03-29T01:00:00Z", "2026-03-29T03:00:00+02:00"],
    // Fall back 2026-10-25: 02:30 happens twice, the offset tells them apart.
    ["2026-10-25T00:30:00Z", "2026-10-25T02:30:00+02:00"],
    ["2026-10-25T01:30:00Z", "2026-10-25T02:30:00+01:00"],
    // Fractional seconds are truncated, never rounded up.
    ["2027-01-09T03:25:28.999Z", "2027-01-09T04:25:28+01:00"],
  ];
  for (const [instant, expected] of cases) {
    test(`${instant} → ${expected}`, () => {
      const formatted = formatEetDateTime(new Date(instant));
      expect(formatted).toBe(expected);
      expect(isEetDateTime(formatted)).toBe(true);
    });
  }

  test("other time zones keep an explicit offset", () => {
    expect(formatEetDateTime(new Date("2027-01-09T03:25:28Z"), "UTC")).toBe(
      "2027-01-09T03:25:28+00:00",
    );
    expect(formatEetDateTime(new Date("2027-01-09T03:25:28Z"), "America/Sao_Paulo")).toBe(
      "2027-01-09T00:25:28-03:00",
    );
  });

  test("rejects an invalid Date", () => {
    expect(() => formatEetDateTime(new Date("nope"))).toThrow(RangeError);
  });
});

describe("createHeader", () => {
  test("fresh UUID v4 and current dat_odesl on every call", () => {
    const now = new Date("2026-10-25T16:30:04Z");
    const a = createHeader({ prvni_zaslani: true, now });
    const b = createHeader({ prvni_zaslani: false, now });
    expect(a.uuid_zpravy).not.toBe(b.uuid_zpravy);
    expect(a.uuid_zpravy).toMatch(EET_PATTERNS.uuid);
    expect(a.uuid_zpravy[14]).toBe("4");
    expect(a.dat_odesl).toBe("2026-10-25T17:30:04+01:00");
    expect(a.prvni_zaslani).toBe(true);
    expect(b.prvni_zaslani).toBe(false);
    expect("overeni" in a).toBe(false);
    expect(EetHeaderSchema.safeParse(a).success).toBe(true);
  });

  test("verification mode", () => {
    expect(createHeader({ prvni_zaslani: true, overeni: true }).overeni).toBe(true);
  });
});
