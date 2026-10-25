import { describe, expect, test } from "bun:test";
import { normalizeDateTime } from "../src/datetime.ts";
import { type IssueCode, WarningCode } from "../src/index.ts";

const PRAGUE = "Europe/Prague";
const run = (value: unknown, timeZone = PRAGUE) => normalizeDateTime(value, timeZone, "dat_trzby");
const codes = (r: ReturnType<typeof run>) => r.warnings.map((w) => w.code);

describe("normalizeDateTime", () => {
  const ok: [input: unknown, expected: string, warnings: number[]][] = [
    // Already canonical in the register's zone: no warning.
    ["2027-01-09T04:25:28+01:00", "2027-01-09T04:25:28+01:00", []],
    ["2027-06-09T05:25:28+02:00", "2027-06-09T05:25:28+02:00", []],
    // Same instant, other offset → re-expressed in Europe/Prague (OQ4).
    [
      "2026-07-01T09:02:18Z",
      "2026-07-01T11:02:18+02:00",
      [WarningCode.DATETIME_CONVERTED_TIME_ZONE],
    ],
    [
      "2027-01-09T00:25:28-03:00",
      "2027-01-09T04:25:28+01:00",
      [WarningCode.DATETIME_CONVERTED_TIME_ZONE],
    ],
    // Without offset: local time in the register's zone, summer time included.
    ["2027-01-09T04:25:28", "2027-01-09T04:25:28+01:00", [WarningCode.DATETIME_ASSUMED_TIME_ZONE]],
    ["2027-06-09T05:25:28", "2027-06-09T05:25:28+02:00", [WarningCode.DATETIME_ASSUMED_TIME_ZONE]],
    // Fractional seconds are truncated, never rounded.
    [
      "2027-01-09T04:25:28.999+01:00",
      "2027-01-09T04:25:28+01:00",
      [WarningCode.DATETIME_FRACTION_TRUNCATED],
    ],
    // Reformatting: space separator, missing seconds, offset without colon.
    [
      "2027-01-09 04:25",
      "2027-01-09T04:25:00+01:00",
      [WarningCode.DATETIME_REFORMATTED, WarningCode.DATETIME_ASSUMED_TIME_ZONE],
    ],
    ["2027-01-09T04:25:28+0100", "2027-01-09T04:25:28+01:00", [WarningCode.DATETIME_REFORMATTED]],
    // Czech notation.
    ["9.1.2027 4:25:28", "2027-01-09T04:25:28+01:00", [WarningCode.DATETIME_FROM_CZECH_FORMAT]],
    ["25. 10. 2026 14:30", "2026-10-25T14:30:00+01:00", [WarningCode.DATETIME_FROM_CZECH_FORMAT]],
    // Epoch seconds / milliseconds, as number or text.
    [1799465128, "2027-01-09T04:25:28+01:00", [WarningCode.DATETIME_FROM_EPOCH]],
    [1799465128000, "2027-01-09T04:25:28+01:00", [WarningCode.DATETIME_FROM_EPOCH]],
    ["1799465128", "2027-01-09T04:25:28+01:00", [WarningCode.DATETIME_FROM_EPOCH]],
    [
      "1799465128123",
      "2027-01-09T04:25:28+01:00",
      [WarningCode.DATETIME_FROM_EPOCH, WarningCode.DATETIME_FRACTION_TRUNCATED],
    ],
    // Date objects.
    [
      new Date("2027-01-09T03:25:28Z"),
      "2027-01-09T04:25:28+01:00",
      [WarningCode.DATETIME_FROM_DATE],
    ],
  ];
  for (const [input, expected, warnings] of ok) {
    test(`${input instanceof Date ? "Date" : JSON.stringify(input)} → ${expected}`, () => {
      const result = run(input);
      expect(result.issues).toEqual([]);
      expect(result.value).toBe(expected);
      expect(codes(result)).toEqual(warnings);
    });
  }

  test("spring-forward gap does not exist", () => {
    expect(run("2026-03-29T02:30:00").issues.map((i) => i.code)).toEqual([
      "nonexistent_local_time",
    ]);
    expect(run("29.3.2026 2:15").issues.map((i) => i.code)).toEqual(["nonexistent_local_time"]);
  });

  test("fall-back hour is ambiguous: first occurrence plus a warning", () => {
    const result = run("2026-10-25T02:30:00");
    expect(result.value).toBe("2026-10-25T02:30:00+02:00");
    expect(codes(result)).toEqual([
      WarningCode.DATETIME_ASSUMED_TIME_ZONE,
      WarningCode.DATETIME_AMBIGUOUS,
    ]);
    // With an explicit offset there is nothing to guess.
    expect(run("2026-10-25T02:30:00+01:00").value).toBe("2026-10-25T02:30:00+01:00");
    expect(codes(run("2026-10-25T02:30:00+01:00"))).toEqual([]);
  });

  test("other register time zones", () => {
    expect(run("2027-01-09T04:25:28", "UTC").value).toBe("2027-01-09T04:25:28+00:00");
    expect(run("2027-01-09T04:25:28+01:00", "UTC").value).toBe("2027-01-09T03:25:28+00:00");
  });

  const bad: [input: unknown, issue: IssueCode][] = [
    ["2027-02-29T10:00:00+01:00", "invalid_format"],
    ["31.4.2027 10:00", "invalid_format"],
    ["2027-01-09T24:00:00", "invalid_format"],
    ["2027-01-09T04:25:28+15:00", "invalid_format"],
    ["9.1.2027", "invalid_format"],
    ["yesterday", "invalid_format"],
    [1799465128.5, "invalid_format"],
    [new Date("nope"), "invalid_format"],
    [{}, "invalid_type"],
  ];
  for (const [input, code] of bad) {
    test(`${JSON.stringify(input)} → ${code}`, () => {
      const result = run(input);
      expect(result.value).toBeUndefined();
      expect(result.issues.map((i) => i.code)).toEqual([code]);
    });
  }
});
