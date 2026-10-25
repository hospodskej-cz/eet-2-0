/**
 * One sale from any object shape → validated `EetReceiptData` plus message options. Every path
 * (object, JSON, NDJSON, CSV, XML) ends here. Every conversion is reported as a warning.
 */
import { DEFAULT_TIME_ZONE, type EetReceiptData, EetReceiptDataSchema } from "@eet-gateway/core";
import { z } from "zod";
import { normalizeAmount } from "./amount.ts";
import {
  type IngestIssue,
  type IngestWarning,
  issue,
  type ValueResult,
  WarningCode,
  warning,
} from "./codes.ts";
import { normalizeDateTime } from "./datetime.ts";
import { type CanonicalField, type FieldMap, isEmpty, mapFields } from "./fields.ts";

/** Register defaults, so inputs need not repeat them (configured per register). */
export interface RegisterDefaults {
  readonly eic_popl?: string | undefined;
  readonly id_jednotky?: string | number | undefined;
  readonly id_pokl?: string | undefined;
}

export interface IngestContext {
  readonly register?: RegisterDefaults | undefined;
  /** Time zone for inputs without offset and for the output. Default `Europe/Prague`. */
  readonly timeZone?: string | undefined;
  readonly fieldMap?: FieldMap | undefined;
  /** Enables the minimum-date check of EET warning 5 (rozhraní §2.2.4, item 4). */
  readonly environment?: "playground" | "production" | undefined;
  /** EIČ of the register's certificate, for EET warning 1. */
  readonly certificateEic?: string | undefined;
  readonly now?: (() => Date) | undefined;
  /** First submissions older than this get warning 1051 (metodika 1.2). Default 5 minutes. */
  readonly lateFirstSubmissionMs?: number | undefined;
}

export interface NormalizedSale {
  readonly data: EetReceiptData;
  /** Verification mode: nothing is registered (rozhraní §2.2.1). */
  readonly overeni: boolean;
  /** `false` when the caller already attempted to send this sale (manual resend). */
  readonly prvni_zaslani: boolean;
  /** Register id selecting certificate and defaults, if the input names one. */
  readonly register?: string;
}

export type IngestResult =
  | { readonly ok: true; readonly sale: NormalizedSale; readonly warnings: IngestWarning[] }
  | { readonly ok: false; readonly issues: IngestIssue[]; readonly warnings: IngestWarning[] };

/**
 * Loose description of accepted input, for API documentation (OpenAPI). Any alias from
 * docs/INGEST.md is accepted too; this schema lists the canonical names only.
 */
export const SaleInputSchema = z
  .object({
    eic_popl: z.string().optional(),
    eic_poverujiciho: z.string().optional(),
    povereni_vice_popl: z.union([z.boolean(), z.string()]).optional(),
    id_jednotky: z.union([z.string(), z.number().int()]).optional(),
    id_pokl: z.string().optional(),
    porad_cis: z.union([z.string(), z.number().int()]).optional(),
    dat_trzby: z.union([z.string(), z.number().int()]),
    celk_trzba: z.union([z.string(), z.number()]),
    urceno_cerp_zuct: z.union([z.string(), z.number()]).optional(),
    cerp_zuct: z.union([z.string(), z.number()]).optional(),
    overeni: z.union([z.boolean(), z.string()]).optional(),
    prvni_zaslani: z.union([z.boolean(), z.string()]).optional(),
    register: z.string().optional(),
  })
  .catchall(z.unknown());

export type SaleInput = z.input<typeof SaleInputSchema>;

const REQUIRED: readonly CanonicalField[] = [
  "eic_popl",
  "id_jednotky",
  "id_pokl",
  "porad_cis",
  "dat_trzby",
  "celk_trzba",
];
const TEXT_FIELDS = [
  "eic_popl",
  "eic_poverujiciho",
  "id_jednotky",
  "id_pokl",
  "porad_cis",
] as const;
const AMOUNT_FIELDS = ["celk_trzba", "urceno_cerp_zuct", "cerp_zuct"] as const;
const BOOLEAN_FIELDS = ["povereni_vice_popl", "overeni", "prvni_zaslani"] as const;
const DEFAULTABLE = ["eic_popl", "id_jednotky", "id_pokl"] as const;

const TWO_HOURS = 2 * 3_600_000;
const TWO_YEARS = 2 * 365.25 * 86_400_000;

/** Minimum sale date per environment (rozhraní §2.2.4 item 4, PG §4.1, P §4.1). */
function minimumSaleDate(environment: "playground" | "production", now: Date): Date {
  if (environment === "playground") return new Date("2026-07-01T00:00:00+02:00");
  return now < new Date("2027-01-01T00:00:00+01:00")
    ? new Date("2026-11-01T00:00:00+01:00")
    : new Date("2027-01-01T00:00:00+01:00");
}

function normalizeText(value: unknown, field: string): ValueResult {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      return {
        warnings: [],
        issues: [issue("invalid_format", `${field}: ${value} není platná hodnota.`, field)],
      };
    }
    return { value: String(value), warnings: [], issues: [] };
  }
  if (typeof value !== "string") {
    return { warnings: [], issues: [issue("invalid_type", `${field}: očekáván text.`, field)] };
  }
  const trimmed = value.trim();
  const warnings =
    trimmed === value
      ? []
      : [
          warning(
            WarningCode.VALUE_TRIMMED,
            `${field}: odstraněny mezery na začátku/konci "${value}".`,
            field,
          ),
        ];
  // EET allows ASCII 32–126 only in these fields (rozhraní §3.1).
  if (/[^\x20-\x7e]/.test(trimmed)) {
    return {
      warnings,
      issues: [
        issue(
          "non_ascii",
          `${field}: "${trimmed}" obsahuje znaky mimo ASCII (diakritiku?); EET je nepřipouští a ingest je nepřepisuje.`,
          field,
        ),
      ],
    };
  }
  return { value: trimmed, warnings, issues: [] };
}

const TRUE = new Set(["true", "1"]);
const FALSE = new Set(["false", "0"]);
const TRUE_WORDS = new Set(["ano", "yes", "a", "y"]);
const FALSE_WORDS = new Set(["ne", "no", "n"]);

function normalizeBoolean(
  value: unknown,
  field: string,
): { value?: boolean; warnings: IngestWarning[]; issues: IngestIssue[] } {
  if (typeof value === "boolean") return { value, warnings: [], issues: [] };
  if (typeof value === "number" && (value === 0 || value === 1))
    return { value: value === 1, warnings: [], issues: [] };
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (TRUE.has(text)) return { value: true, warnings: [], issues: [] };
    if (FALSE.has(text)) return { value: false, warnings: [], issues: [] };
    if (TRUE_WORDS.has(text) || FALSE_WORDS.has(text)) {
      const result = TRUE_WORDS.has(text);
      return {
        value: result,
        warnings: [
          warning(
            WarningCode.BOOLEAN_INTERPRETED,
            `${field}: "${value}" chápáno jako ${result}.`,
            field,
          ),
        ],
        issues: [],
      };
    }
  }
  return {
    warnings: [],
    issues: [
      issue("invalid_format", `${field}: "${String(value)}" není ano/ne (true/false/1/0).`, field),
    ],
  };
}

/**
 * The register an input names (field `register` or an alias), read before normalization so the
 * caller can pick that register's defaults. Undefined when the input names none.
 */
export function inputRegister(input: unknown, fieldMap?: FieldMap): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const value = mapFields(input as Record<string, unknown>, fieldMap).values.register;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

export function normalizeSale(input: unknown, context: IngestContext = {}): IngestResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [issue("invalid_type", "Tržba musí být objekt.")], warnings: [] };
  }
  const timeZone = context.timeZone ?? DEFAULT_TIME_ZONE;
  const now = (context.now ?? (() => new Date()))();
  const mapped = mapFields(input as Record<string, unknown>, context.fieldMap);
  const warnings = [...mapped.warnings];
  const issues = [...mapped.issues];
  const values = { ...mapped.values };

  for (const field of DEFAULTABLE) {
    const fallback = context.register?.[field];
    if (isEmpty(values[field]) && !isEmpty(fallback)) {
      values[field] = fallback;
      warnings.push(
        warning(
          WarningCode.DEFAULT_APPLIED,
          `${field}: doplněno z konfigurace pokladny ("${fallback}").`,
          field,
        ),
      );
    }
  }
  for (const field of REQUIRED) {
    if (isEmpty(values[field]))
      issues.push(issue("required", `${field}: povinné pole chybí.`, field));
  }

  const data: Record<string, unknown> = {};
  const collect = (
    field: string,
    result: { value?: unknown; warnings: IngestWarning[]; issues: IngestIssue[] },
  ) => {
    warnings.push(...result.warnings);
    issues.push(...result.issues);
    if (result.value !== undefined) data[field] = result.value;
  };
  for (const field of TEXT_FIELDS)
    if (!isEmpty(values[field])) collect(field, normalizeText(values[field], field));
  for (const field of AMOUNT_FIELDS)
    if (!isEmpty(values[field])) collect(field, normalizeAmount(values[field], field));
  if (!isEmpty(values.dat_trzby))
    collect("dat_trzby", normalizeDateTime(values.dat_trzby, timeZone, "dat_trzby"));

  const options: Record<string, boolean> = { overeni: false, prvni_zaslani: true };
  for (const field of BOOLEAN_FIELDS) {
    if (isEmpty(values[field])) continue;
    const result = normalizeBoolean(values[field], field);
    warnings.push(...result.warnings);
    issues.push(...result.issues);
    if (result.value === undefined) continue;
    if (field === "povereni_vice_popl") data[field] = result.value;
    else options[field] = result.value;
  }
  let register: string | undefined;
  if (!isEmpty(values.register)) {
    const result = normalizeText(values.register, "register");
    warnings.push(...result.warnings);
    issues.push(...result.issues);
    register = result.value;
  }

  if (issues.length > 0) return { ok: false, issues, warnings };

  const parsed = EetReceiptDataSchema.safeParse(data);
  if (!parsed.success) {
    for (const zodIssue of parsed.error.issues) {
      const field = zodIssue.path.join(".");
      issues.push(issue("invalid_format", `${field}: ${zodIssue.message}`, field));
    }
    return { ok: false, issues, warnings };
  }
  const sale = parsed.data;
  warnings.push(...predictEetWarnings(sale, context, now));

  const instant = Date.parse(sale.dat_trzby);
  const lateAfter = context.lateFirstSubmissionMs ?? 300_000;
  if (options["prvni_zaslani"] && !options["overeni"] && now.getTime() - instant > lateAfter) {
    warnings.push(
      warning(
        WarningCode.LATE_FIRST_SUBMISSION,
        `První odeslání tržby z ${sale.dat_trzby} — evidovat se má nejpozději při uskutečnění tržby (ZoET §16, metodika 1.2).`,
        "dat_trzby",
      ),
    );
  }

  return {
    ok: true,
    sale: {
      data: sale,
      overeni: options["overeni"] ?? false,
      prvni_zaslani: options["prvni_zaslani"] ?? true,
      ...(register !== undefined ? { register } : {}),
    },
    warnings,
  };
}

/** Local mirror of EET's pass-through checks (rozhraní §2.2.4); EET still decides. */
function predictEetWarnings(
  sale: EetReceiptData,
  context: IngestContext,
  now: Date,
): IngestWarning[] {
  const warnings: IngestWarning[] = [];
  if (context.certificateEic !== undefined && context.certificateEic !== sale.eic_popl) {
    warnings.push(
      warning(
        WarningCode.EET_EIC_CERTIFICATE_MISMATCH,
        `EIC poplatnika ${sale.eic_popl} se neshoduje s EIC v certifikatu (${context.certificateEic}).`,
        "eic_popl",
      ),
    );
  }
  const instant = Date.parse(sale.dat_trzby);
  if (instant - now.getTime() > TWO_HOURS) {
    warnings.push(
      warning(
        WarningCode.EET_SALE_IN_FUTURE,
        "Datum a cas uskutecneni trzby je o vic nez 2 hodiny v budoucnosti.",
        "dat_trzby",
      ),
    );
  }
  const minimum =
    context.environment === undefined ? undefined : minimumSaleDate(context.environment, now);
  if (
    now.getTime() - instant > TWO_YEARS ||
    (minimum !== undefined && instant < minimum.getTime())
  ) {
    warnings.push(
      warning(
        WarningCode.EET_SALE_TOO_OLD,
        "Datum a cas uskutecneni trzby je vyrazne v minulosti.",
        "dat_trzby",
      ),
    );
  }
  if (!/^[1-9][0-9]*[1-4]$/.test(sale.id_jednotky)) {
    warnings.push(
      warning(
        WarningCode.EET_UNIT_FORMAT,
        "id_jednotky neodpovida formatem pridelenemu c. evidencni jednotky (aspon 2 cislice, posledni 1–4).",
        "id_jednotky",
      ),
    );
  }
  if (sale.eic_poverujiciho !== undefined && sale.eic_poverujiciho === sale.eic_popl) {
    warnings.push(
      warning(
        WarningCode.EET_SAME_EIC,
        "EIC poverujiciho se shoduje s EIC poplatnika.",
        "eic_poverujiciho",
      ),
    );
  }
  return warnings;
}
