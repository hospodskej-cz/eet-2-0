import type { EetHeader } from "./schema.ts";

/** Time zone of registers in Czechia (SEČ +01:00 / SELČ +02:00, rozhraní §3.3.3.2). */
export const DEFAULT_TIME_ZONE = "Europe/Prague";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Formats an instant as an EET `dateTime`: local time in `timeZone` with an explicit `±hh:mm`
 * offset and no fractional seconds (they are truncated), e.g. `2027-01-09T04:25:28+01:00`.
 */
export function formatEetDateTime(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  if (Number.isNaN(instant.getTime())) throw new RangeError("invalid Date");
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  const zone = parts.timeZoneName ?? "";
  // "GMT" for a zero offset, otherwise "GMT+01:00" / "GMT-03:30".
  const offset = zone === "GMT" ? "+00:00" : zone.replace("GMT", "");
  if (!/^[+-]\d\d:\d\d$/.test(offset)) throw new RangeError(`unexpected offset "${zone}"`);
  const { year, month, day, hour, minute, second } = parts;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

export interface CreateHeaderOptions {
  /** `true` for the first attempt to send a sale, even if it fails; `false` for every resend. */
  readonly prvni_zaslani: boolean;
  /** Verification mode: nothing is registered (rozhraní §2.2.1). */
  readonly overeni?: boolean;
  readonly now?: Date;
  readonly timeZone?: string;
}

/**
 * Builds a fresh `<Hlavicka>`: a new UUID v4 and the current time as `dat_odesl`. Every attempt,
 * including a resend of the same sale, needs a new header (rozhraní §3.3.3.1, metodika 1.1).
 */
export function createHeader(options: CreateHeaderOptions): EetHeader {
  const header: EetHeader = {
    uuid_zpravy: crypto.randomUUID(),
    dat_odesl: formatEetDateTime(options.now ?? new Date(), options.timeZone),
    prvni_zaslani: options.prvni_zaslani,
  };
  if (options.overeni !== undefined) header.overeni = options.overeni;
  return header;
}
