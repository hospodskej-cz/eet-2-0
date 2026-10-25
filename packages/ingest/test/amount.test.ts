import { describe, expect, test } from "bun:test";
import { normalizeAmount } from "../src/amount.ts";
import { type IssueCode, WarningCode } from "../src/index.ts";

const codes = (r: ReturnType<typeof normalizeAmount>) => r.warnings.map((w) => w.code);
const problem = (r: ReturnType<typeof normalizeAmount>) => r.issues.map((i) => i.code);

describe("normalizeAmount", () => {
  const ok: [input: unknown, expected: string, warnings: number[]][] = [
    ["87988.50", "87988.50", []],
    ["-187.20", "-187.20", []],
    ["0.00", "0.00", []],
    ["87988,50", "87988.50", [WarningCode.AMOUNT_DECIMAL_COMMA]],
    ["1 234,50", "1234.50", [WarningCode.AMOUNT_DECIMAL_COMMA, WarningCode.AMOUNT_REFORMATTED]],
    ["1 234 567.8", "1234567.80", [WarningCode.AMOUNT_REFORMATTED]],
    ["100", "100.00", [WarningCode.AMOUNT_REFORMATTED]],
    ["020.45", "20.45", [WarningCode.AMOUNT_REFORMATTED]],
    [".20", "0.20", [WarningCode.AMOUNT_REFORMATTED]],
    ["-0.00", "0.00", [WarningCode.AMOUNT_REFORMATTED]],
    ["-00100.00", "-100.00", [WarningCode.AMOUNT_REFORMATTED]],
    ["+5", "5.00", [WarningCode.AMOUNT_REFORMATTED]],
    ["  12.30 ", "12.30", []],
    [87988.5, "87988.50", [WarningCode.AMOUNT_FROM_NUMBER]],
    [-0, "0.00", [WarningCode.AMOUNT_FROM_NUMBER]],
    [0.1, "0.10", [WarningCode.AMOUNT_FROM_NUMBER]],
    [99999999.99, "99999999.99", [WarningCode.AMOUNT_FROM_NUMBER]],
    [-99999999.99, "-99999999.99", [WarningCode.AMOUNT_FROM_NUMBER]],
  ];
  for (const [input, expected, warnings] of ok) {
    test(`${JSON.stringify(input)} → ${expected}`, () => {
      const result = normalizeAmount(input, "celk_trzba");
      expect(result.issues).toEqual([]);
      expect(result.value).toBe(expected);
      expect(codes(result)).toEqual(warnings);
    });
  }

  const bad: [input: unknown, issue: IssueCode][] = [
    ["10.255", "too_many_decimals"],
    ["10.500", "too_many_decimals"],
    [0.1 + 0.2, "too_many_decimals"], // 0.30000000000000004 — float noise is never rounded away
    [1e-7, "too_many_decimals"],
    ["1,234", "too_many_decimals"],
    ["1.234,50", "invalid_format"],
    ["1,234.50", "invalid_format"],
    ["100000000.00", "out_of_range"],
    [1e21, "out_of_range"],
    [Number.NaN, "invalid_format"],
    ["12 Kč", "invalid_format"],
    ["", "invalid_format"],
    ["-", "invalid_format"],
    [true, "invalid_type"],
  ];
  for (const [input, code] of bad) {
    test(`${String(input)} → ${code}`, () => {
      const result = normalizeAmount(input, "celk_trzba");
      expect(result.value).toBeUndefined();
      expect(problem(result)).toEqual([code]);
    });
  }
});
