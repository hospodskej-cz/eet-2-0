/**
 * Field names: every input key is resolved to one canonical field — the XSD attribute name of
 * `<Data>` (rozhraní §3.3.2) or one of the message options. Keys are compared normalized (case,
 * diacritics, `_`, `-` and spaces ignored), so `celk_trzba`, `celkTrzba`, `Celk Trzba` and
 * `CELK-TRZBA` are the same field. English aliases follow the official English translation of
 * the interface description (rozhraní v1.2a EN §3.3.2).
 */
import { type IngestIssue, type IngestWarning, issue, WarningCode, warning } from "./codes.ts";

export const DATA_FIELDS = [
  "eic_popl",
  "eic_poverujiciho",
  "povereni_vice_popl",
  "id_jednotky",
  "id_pokl",
  "porad_cis",
  "dat_trzby",
  "celk_trzba",
  "urceno_cerp_zuct",
  "cerp_zuct",
] as const;

/** Message options: verification mode, first/repeated submission, which register to use. */
export const OPTION_FIELDS = ["overeni", "prvni_zaslani", "register"] as const;

export type DataField = (typeof DATA_FIELDS)[number];
export type OptionField = (typeof OPTION_FIELDS)[number];
export type CanonicalField = DataField | OptionField;

/** Built-in aliases besides the XSD name itself (camelCase and English). */
export const FIELD_ALIASES: Readonly<Record<CanonicalField, readonly string[]>> = {
  eic_popl: ["eicPopl", "taxpayerId", "eic", "vatId", "taxId"],
  eic_poverujiciho: ["eicPoverujiciho", "authorizingTaxpayerId", "principalTaxpayerId"],
  povereni_vice_popl: ["povereniVicePopl", "multipleTaxpayers", "multipleTaxpayersAuthorization"],
  id_jednotky: ["idJednotky", "registeringUnitId", "registratingUnitId", "unitId", "premisesId"],
  id_pokl: ["idPokl", "posId", "cashRegisterId", "deviceId"],
  porad_cis: ["poradCis", "sequenceNumber", "receiptNumber", "transactionNumber"],
  dat_trzby: ["datTrzby", "transactionDateTime", "saleDateTime", "dateTime", "saleDate", "date"],
  celk_trzba: ["celkTrzba", "totalAmount", "total", "amount"],
  urceno_cerp_zuct: ["urcenoCerpZuct", "amountIntendedForDrawing", "intendedForDrawingAmount"],
  cerp_zuct: ["cerpZuct", "amountDrawn", "drawnAmount"],
  overeni: ["verify", "verification", "verificationMode"],
  prvni_zaslani: ["prvniZaslani", "firstSubmission"],
  register: ["registerId"],
};

export function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const BUILT_IN = new Map<string, CanonicalField>();
for (const field of [...DATA_FIELDS, ...OPTION_FIELDS]) {
  for (const name of [field, ...FIELD_ALIASES[field]]) BUILT_IN.set(normalizeKey(name), field);
}

/** Custom names → canonical field, e.g. `{ "Cena celkem": "celk_trzba" }`. */
export type FieldMap = Readonly<Record<string, CanonicalField>>;

export function resolveField(key: string, fieldMap?: FieldMap): CanonicalField | undefined {
  if (fieldMap !== undefined) {
    const normalized = normalizeKey(key);
    for (const [custom, field] of Object.entries(fieldMap)) {
      if (normalizeKey(custom) === normalized) return field;
    }
  }
  return BUILT_IN.get(normalizeKey(key));
}

export function isEmpty(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === "string" && value.trim() === "")
  );
}

export interface MappedFields {
  readonly values: Partial<Record<CanonicalField, unknown>>;
  readonly warnings: IngestWarning[];
  readonly issues: IngestIssue[];
}

/** Resolves keys to canonical fields; empty values count as absent (rozhraní §3.3.2). */
export function mapFields(
  input: Readonly<Record<string, unknown>>,
  fieldMap?: FieldMap,
): MappedFields {
  const values: Partial<Record<CanonicalField, unknown>> = {};
  const sources: Partial<Record<CanonicalField, string>> = {};
  const warnings: IngestWarning[] = [];
  const issues: IngestIssue[] = [];

  for (const [key, value] of Object.entries(input)) {
    const field = resolveField(key, fieldMap);
    if (field === undefined) {
      if (!isEmpty(value)) {
        warnings.push(
          warning(WarningCode.UNKNOWN_FIELD_IGNORED, `Neznámé pole "${key}" bylo ignorováno.`, key),
        );
      }
      continue;
    }
    if (isEmpty(value)) continue;
    const previous = sources[field];
    if (previous !== undefined) {
      if (String(values[field]) !== String(value)) {
        issues.push(
          issue(
            "conflicting_fields",
            `Pole "${previous}" a "${key}" určují ${field}, ale mají různé hodnoty.`,
            field,
          ),
        );
      }
      continue;
    }
    values[field] = value;
    sources[field] = key;
  }
  return { values, warnings, issues };
}
