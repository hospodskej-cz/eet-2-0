/**
 * Date/time → EET `dateTime` in the register's time zone (rozhraní §3.3.3.2, §3.3.3.11): local
 * time with an explicit offset, no fractional seconds. Accepted inputs: ISO 8601 with or without
 * offset, `Date`, epoch seconds/milliseconds, and Czech `d.m.yyyy h:mm[:ss]`. Instants given in
 * another offset are re-expressed in the register's zone (same instant, SPEC_NOTES OQ4).
 */
import { formatEetDateTime, isEetDateTime } from "@eet-gateway/core";
import { issue, type ValueResult, WarningCode, warning } from "./codes.ts";

interface LocalTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function localText(t: LocalTime): string {
  return `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
}

function isRealLocalTime(t: LocalTime): boolean {
  if (t.hour > 23 || t.minute > 59 || t.second > 59 || t.year < 1) return false;
  const d = new Date(Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second));
  return (
    d.getUTCFullYear() === t.year && d.getUTCMonth() === t.month - 1 && d.getUTCDate() === t.day
  );
}

/**
 * Instants at which the wall-clock time `t` occurs in `timeZone`: none in the spring-forward gap,
 * two in the fall-back hour, otherwise one. Uses only `Intl` via `formatEetDateTime`.
 */
export function instantsOfLocalTime(t: LocalTime, timeZone: string): number[] {
  const asUtc = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  const wanted = localText(t);
  const offsets = new Set<number>();
  for (const probe of [asUtc - 86_400_000, asUtc, asUtc + 86_400_000]) {
    const formatted = formatEetDateTime(new Date(probe), timeZone);
    const m = /([+-])(\d\d):(\d\d)$/.exec(formatted);
    if (m === null) continue;
    offsets.add((m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000);
  }
  return [...offsets]
    .map((offset) => asUtc - offset)
    .filter((instant) => formatEetDateTime(new Date(instant), timeZone).slice(0, 19) === wanted)
    .sort((a, b) => a - b);
}

const ISO =
  /^(\d{4})-(\d\d)-(\d\d)([T ])(\d\d):(\d\d)(?::(\d\d)(?:[.,](\d+))?)?(Z|[+-]\d\d:?\d\d)?$/;
const CZECH = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?:\s+|T)(\d{1,2}):(\d\d)(?::(\d\d))?$/;
const EPOCH_TEXT = /^-?(\d{10}|\d{13})$/;

export function normalizeDateTime(value: unknown, timeZone: string, field: string): ValueResult {
  const warnings: ValueResult["warnings"] = [];
  const fail = (code: Parameters<typeof issue>[0], message: string): ValueResult => ({
    warnings,
    issues: [issue(code, `${field}: ${message}`, field)],
  });
  const fromInstant = (ms: number, code: number, label: string): ValueResult => {
    if (!Number.isFinite(ms)) return fail("invalid_format", `${label} není platný okamžik.`);
    const value = formatEetDateTime(new Date(ms), timeZone);
    warnings.push(
      warning(code, `${field}: ${label} převedeno na "${value}" (${timeZone}).`, field),
    );
    if (ms % 1000 !== 0) {
      warnings.push(
        warning(
          WarningCode.DATETIME_FRACTION_TRUNCATED,
          `${field}: zlomky sekund oříznuty.`,
          field,
        ),
      );
    }
    return { value, warnings, issues: [] };
  };
  const fromLocal = (t: LocalTime, code: number, label: string): ValueResult => {
    if (!isRealLocalTime(t)) return fail("invalid_format", `"${label}" není platné datum a čas.`);
    const instants = instantsOfLocalTime(t, timeZone);
    const first = instants[0];
    if (first === undefined) {
      return fail(
        "nonexistent_local_time",
        `"${label}" v zóně ${timeZone} neexistuje (přechod na letní čas).`,
      );
    }
    const value = formatEetDateTime(new Date(first), timeZone);
    warnings.push(
      warning(
        code,
        `${field}: "${label}" chápáno jako místní čas ${timeZone} → "${value}".`,
        field,
      ),
    );
    if (instants.length > 1) {
      warnings.push(
        warning(
          WarningCode.DATETIME_AMBIGUOUS,
          `${field}: "${label}" nastává v ${timeZone} dvakrát (přechod na zimní čas); použit první výskyt "${value}".`,
          field,
        ),
      );
    }
    return { value, warnings, issues: [] };
  };

  if (value instanceof Date) {
    return fromInstant(value.getTime(), WarningCode.DATETIME_FROM_DATE, "Date");
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value))
      return fail("invalid_format", `${value} není celočíselná epocha.`);
    const ms = Math.abs(value) < 1e11 ? value * 1000 : value;
    return fromInstant(ms, WarningCode.DATETIME_FROM_EPOCH, `epocha ${value}`);
  }
  if (typeof value !== "string")
    return fail("invalid_type", "datum a čas musí být text, číslo nebo Date.");

  const text = value.trim();
  if (EPOCH_TEXT.test(text)) {
    const n = Number(text);
    return fromInstant(
      text.replace("-", "").length === 10 ? n * 1000 : n,
      WarningCode.DATETIME_FROM_EPOCH,
      `epocha ${text}`,
    );
  }

  const czech = CZECH.exec(text);
  if (czech !== null) {
    const [, d, mo, y, h, mi, s = "0"] = czech;
    return fromLocal(
      {
        year: Number(y),
        month: Number(mo),
        day: Number(d),
        hour: Number(h),
        minute: Number(mi),
        second: Number(s),
      },
      WarningCode.DATETIME_FROM_CZECH_FORMAT,
      text,
    );
  }

  const iso = ISO.exec(text);
  if (iso === null) return fail("invalid_format", `"${text}" není podporovaný formát data a času.`);
  const [, y, mo, d, separator, h, mi, s, fraction, zone] = iso;
  const local: LocalTime = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s ?? "0"),
  };
  if (!isRealLocalTime(local)) return fail("invalid_format", `"${text}" není platné datum a čas.`);
  if (fraction !== undefined) {
    warnings.push(
      warning(
        WarningCode.DATETIME_FRACTION_TRUNCATED,
        `${field}: zlomky sekund v "${text}" oříznuty.`,
        field,
      ),
    );
  }
  if (
    separator === " " ||
    s === undefined ||
    (zone !== undefined && zone !== "Z" && !zone.includes(":"))
  ) {
    warnings.push(
      warning(
        WarningCode.DATETIME_REFORMATTED,
        `${field}: "${text}" převedeno do tvaru ISO 8601.`,
        field,
      ),
    );
  }

  if (zone === undefined) {
    return fromLocal(local, WarningCode.DATETIME_ASSUMED_TIME_ZONE, text);
  }

  const offsetText = zone === "Z" ? "+00:00" : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
  const sign = offsetText.startsWith("-") ? -1 : 1;
  const offsetMs =
    sign * (Number(offsetText.slice(1, 3)) * 60 + Number(offsetText.slice(4, 6))) * 60_000;
  const given = `${localText(local)}${offsetText}`;
  if (!isEetDateTime(given))
    return fail("invalid_format", `"${text}" má neplatný posun časové zóny.`);
  const instant =
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) -
    offsetMs;
  const canonical = formatEetDateTime(new Date(instant), timeZone);
  if (canonical !== given) {
    warnings.push(
      warning(
        WarningCode.DATETIME_CONVERTED_TIME_ZONE,
        `${field}: "${text}" přepočteno do zóny ${timeZone} → "${canonical}" (stejný okamžik).`,
        field,
      ),
    );
  }
  return { value: canonical, warnings, issues: [] };
}
