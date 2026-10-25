/**
 * zod v4 schemas of the EET data message, mirroring EETXMLSchema.xsd 4.1 (docs/SPEC_NOTES.md
 * §4–§6). This is the single schema set shared by the library, the HTTP API and the CLI; ingest
 * normalizes arbitrary input *into* these shapes, it never loosens them. Field names are the XSD
 * attribute names. Parity with the XSD is enforced by packages/core/test/schema.test.ts against
 * the same fixtures xmllint validates.
 */
import { z } from "zod";

/**
 * XSD patterns (implicitly anchored in XSD, explicitly anchored here). XSD `\d` matches any
 * Unicode digit while JS `\d` is ASCII-only; the stricter JS reading is correct because every
 * EET field is limited to ASCII (rozhraní §3.1).
 */
export const EET_PATTERNS = {
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
  dateTime: /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(Z|([+-])(\d\d):(\d\d))$/,
  eic: /^CZ[0-9]{8,10}$/,
  idJednotky: /^[1-9][0-9]{0,8}$/,
  string20: /^[0-9a-zA-Z.,:;/#\-_ ]{1,20}$/,
  string25: /^[0-9a-zA-Z.,:;/#\-_ ]{1,25}$/,
  amount: /^((0|-?[1-9]\d{0,7})\.\d\d|-0\.(0[1-9]|[1-9]\d))$/,
  pok: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}-[0-9a-fA-F]{2}$/,
} as const;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * Checks the `tns:dateTime` pattern *and* the value space of its `xs:dateTime` base type
 * (real calendar date, hour 00–23, offset within ±14:00), which a regex alone cannot express.
 * Stricter than XSD in one point: `24:00:00` is rejected so an instant has a single spelling.
 */
export function isEetDateTime(value: string): boolean {
  const m = EET_PATTERNS.dateTime.exec(value);
  if (m === null) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year === 0 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const maxDay = month === 2 && leap ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  if (day > maxDay || hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== "Z") {
    const offsetHours = Number(m[9]);
    const offsetMinutes = Number(m[10]);
    if (offsetMinutes > 59 || offsetHours > 14 || (offsetHours === 14 && offsetMinutes !== 0)) {
      return false;
    }
  }
  return true;
}

const eic = z.string().regex(EET_PATTERNS.eic, "EIČ must match ^CZ[0-9]{8,10}$");
const eetDateTime = z
  .string()
  .refine(isEetDateTime, "must be yyyy-mm-ddThh:mm:ss with Z or ±hh:mm, no fractional seconds");
const amount = z
  .string()
  .regex(
    EET_PATTERNS.amount,
    "amount must have exactly two decimals, a decimal point, no leading zeros, no -0.00, |x| < 100000000",
  );

/** `<Data>` — business data of one registered sale (rozhraní §3.3.2–§3.3.3). */
export const EetReceiptDataSchema = z.strictObject({
  eic_popl: eic,
  eic_poverujiciho: eic.optional(),
  povereni_vice_popl: z.boolean().optional(),
  id_jednotky: z.string().regex(EET_PATTERNS.idJednotky, "id_jednotky must be 1–999999999"),
  id_pokl: z.string().regex(EET_PATTERNS.string20, "id_pokl: 1–20 of [0-9a-zA-Z.,:;/#-_ ]"),
  porad_cis: z.string().regex(EET_PATTERNS.string25, "porad_cis: 1–25 of [0-9a-zA-Z.,:;/#-_ ]"),
  dat_trzby: eetDateTime,
  celk_trzba: amount,
  urceno_cerp_zuct: amount.optional(),
  cerp_zuct: amount.optional(),
});

/** `<Hlavicka>` — technical header of one data message (rozhraní §3.3.3.1–§3.3.3.4). */
export const EetHeaderSchema = z.strictObject({
  uuid_zpravy: z.string().regex(EET_PATTERNS.uuid, "uuid_zpravy must be an RFC 9562 UUID v1–v5"),
  dat_odesl: eetDateTime,
  prvni_zaslani: z.boolean(),
  overeni: z.boolean().optional(),
});

export type EetReceiptData = z.infer<typeof EetReceiptDataSchema>;
export type EetHeader = z.infer<typeof EetHeaderSchema>;
