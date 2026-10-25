/**
 * Amounts → `CastkaType` (rozhraní §3.3.3.12): exactly two decimals, decimal point, no leading
 * zeros, no `-0.00`, |x| < 100 000 000. All work is done on decimal *text*; a JS number is first
 * turned into its shortest round-trip decimal string, so no float arithmetic ever touches money.
 * More than two decimal places is an error — ingest never rounds.
 */
import { EET_PATTERNS } from "@eet-gateway/core";
import { issue, type ValueResult, WarningCode, warning } from "./codes.ts";

/** Expands `1.5e+3` / `1e-7` (as produced by `String(number)`) into plain decimal text. */
function expandExponent(text: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(text);
  if (m === null) return text;
  const [, sign = "", int = "", frac = "", exp = "0"] = m;
  const digits = int + frac;
  const point = int.length + Number(exp);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

const THOUSANDS = /^[+-]?\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d*)?$/;

export function normalizeAmount(value: unknown, field: string): ValueResult {
  const warnings: ValueResult["warnings"] = [];
  let text: string;
  let fromNumber = false;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return {
        warnings,
        issues: [issue("invalid_format", `${field}: ${value} není částka.`, field)],
      };
    }
    text = expandExponent(String(value));
    fromNumber = true;
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return {
      warnings,
      issues: [issue("invalid_type", `${field}: částka musí být text nebo číslo.`, field)],
    };
  }
  const original = text;

  let reformatted = false;
  if (THOUSANDS.test(text)) {
    text = text.replace(/[ \u00a0\u202f]/g, "");
    reformatted = true;
  }
  const hasComma = text.includes(",");
  if (hasComma && text.includes(".")) {
    return {
      warnings,
      issues: [
        issue(
          "invalid_format",
          `${field}: "${original}" kombinuje tečku a čárku — nejednoznačné.`,
          field,
        ),
      ],
    };
  }
  if (hasComma) text = text.replace(",", ".");

  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (m === null || `${m[2] ?? ""}${m[3] ?? ""}` === "") {
    return {
      warnings,
      issues: [issue("invalid_format", `${field}: "${original}" není částka.`, field)],
    };
  }
  let [, sign = "", int = "", frac = ""] = m;
  if (frac.length > 2) {
    return {
      warnings,
      issues: [
        issue(
          "too_many_decimals",
          `${field}: "${original}" má víc než 2 desetinná místa; částky se nezaokrouhlují.`,
          field,
        ),
      ],
    };
  }
  int = int.replace(/^0+(?=\d)/, "") || "0";
  frac = frac.padEnd(2, "0");
  if (sign === "+" || (sign === "-" && int === "0" && frac === "00")) sign = "";
  if (int.length > 8) {
    return {
      warnings,
      issues: [
        issue("out_of_range", `${field}: "${original}" je mimo rozsah ±99 999 999,99 Kč.`, field),
      ],
    };
  }

  const result = `${sign}${int}.${frac}`;
  if (!EET_PATTERNS.amount.test(result)) {
    return {
      warnings,
      issues: [issue("invalid_format", `${field}: "${original}" není platná částka.`, field)],
    };
  }
  if (fromNumber) {
    warnings.push(
      warning(
        WarningCode.AMOUNT_FROM_NUMBER,
        `${field}: číslo ${original} převedeno na "${result}".`,
        field,
      ),
    );
  } else {
    if (hasComma) {
      warnings.push(
        warning(
          WarningCode.AMOUNT_DECIMAL_COMMA,
          `${field}: desetinná čárka "${original}" → "${result}".`,
          field,
        ),
      );
    }
    const afterComma = hasComma ? original.replace(",", ".") : original;
    if (reformatted || afterComma !== result) {
      warnings.push(
        warning(
          WarningCode.AMOUNT_REFORMATTED,
          `${field}: "${original}" upraveno na "${result}".`,
          field,
        ),
      );
    }
  }
  return { value: result, warnings, issues: [] };
}
