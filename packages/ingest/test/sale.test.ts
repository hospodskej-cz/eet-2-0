import { describe, expect, test } from "bun:test";
import {
  type IngestContext,
  type IngestResult,
  normalizeKey,
  normalizeSale,
  WarningCode,
} from "../src/index.ts";

const NOW = () => new Date("2026-11-15T12:00:00+01:00");
const BASE = {
  eic_popl: "CZ00000019",
  id_jednotky: "11",
  id_pokl: "P1",
  porad_cis: "2026/1",
  dat_trzby: "2026-11-15T11:59:00+01:00",
  celk_trzba: "100.00",
};
const run = (input: unknown, context: IngestContext = {}) =>
  normalizeSale(input, { now: NOW, ...context });
const codes = (r: IngestResult) => r.warnings.map((w) => w.code);
const issues = (r: IngestResult) => (r.ok ? [] : r.issues.map((i) => `${i.field ?? ""}:${i.code}`));

describe("field names", () => {
  test("XSD, camelCase, English and loosely written names are the same field", () => {
    const variants = [
      BASE,
      {
        eicPopl: "CZ00000019",
        idJednotky: "11",
        idPokl: "P1",
        poradCis: "2026/1",
        datTrzby: BASE.dat_trzby,
        celkTrzba: "100.00",
      },
      {
        taxpayerId: "CZ00000019",
        premisesId: "11",
        posId: "P1",
        receiptNumber: "2026/1",
        saleDateTime: BASE.dat_trzby,
        totalAmount: "100.00",
      },
      {
        "EIC popl": "CZ00000019",
        "ID-JEDNOTKY": "11",
        "Id Pokl": "P1",
        "porad cis": "2026/1",
        DAT_TRZBY: BASE.dat_trzby,
        "Celk Trzba": "100.00",
      },
    ];
    for (const input of variants) {
      const result = run(input);
      expect(result.ok && result.sale.data).toEqual(BASE);
      expect(codes(result)).toEqual([]);
    }
  });

  test("normalizeKey ignores case, diacritics and separators", () => {
    expect(normalizeKey("Částka-Celkem")).toBe("castkacelkem");
  });

  test("fieldMap maps custom column names and wins over aliases", () => {
    const result = run(
      { ...BASE, celk_trzba: undefined, "Cena celkem": "250,00", amount: "999.00" },
      { fieldMap: { "Cena celkem": "celk_trzba", amount: "urceno_cerp_zuct" } },
    );
    expect(result.ok && result.sale.data.celk_trzba).toBe("250.00");
    expect(result.ok && result.sale.data.urceno_cerp_zuct).toBe("999.00");
  });

  test("unknown fields are reported, never silently dropped", () => {
    const result = run({ ...BASE, poznamka: "VIP" });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: WarningCode.UNKNOWN_FIELD_IGNORED, field: "poznamka" }),
    );
  });

  test("two names for one field must agree", () => {
    expect(issues(run({ ...BASE, totalAmount: "200.00" }))).toEqual([
      "celk_trzba:conflicting_fields",
    ]);
    expect(run({ ...BASE, totalAmount: "100.00" }).ok).toBe(true);
  });
});

describe("values", () => {
  test("register defaults fill missing fields with a warning", () => {
    const { eic_popl, id_jednotky, id_pokl, ...rest } = BASE;
    const result = run(rest, { register: { eic_popl, id_jednotky: 11, id_pokl } });
    expect(result.ok && result.sale.data).toEqual(BASE);
    expect(codes(result)).toEqual([
      WarningCode.DEFAULT_APPLIED,
      WarningCode.DEFAULT_APPLIED,
      WarningCode.DEFAULT_APPLIED,
    ]);
  });

  test("an input value wins over the register default", () => {
    const result = run(BASE, { register: { id_pokl: "OTHER" } });
    expect(result.ok && result.sale.data.id_pokl).toBe("P1");
    expect(codes(result)).toEqual([]);
  });

  test("empty optional fields count as absent", () => {
    const result = run({ ...BASE, eic_poverujiciho: "", urceno_cerp_zuct: "  ", cerp_zuct: null });
    expect(result.ok && result.sale.data).toEqual(BASE);
  });

  test("all optional XSD fields", () => {
    const result = run({
      ...BASE,
      eic_popl: "CZ8551015704",
      eic_poverujiciho: "CZ00000019",
      povereni_vice_popl: "1",
      urceno_cerp_zuct: "343.00",
      cerp_zuct: "-237.00",
    });
    expect(result.ok && result.sale.data).toEqual({
      ...BASE,
      eic_popl: "CZ8551015704",
      eic_poverujiciho: "CZ00000019",
      povereni_vice_popl: true,
      urceno_cerp_zuct: "343.00",
      cerp_zuct: "-237.00",
    });
  });

  test("missing mandatory fields", () => {
    expect(issues(run({ celk_trzba: "1.00", dat_trzby: BASE.dat_trzby }))).toEqual([
      "eic_popl:required",
      "id_jednotky:required",
      "id_pokl:required",
      "porad_cis:required",
    ]);
  });

  test("diacritics in identifiers are rejected, not rewritten (OQ6)", () => {
    expect(issues(run({ ...BASE, id_pokl: "Pokladna č1" }))).toEqual(["id_pokl:non_ascii"]);
    expect(issues(run({ ...BASE, porad_cis: "Účtenka 1" }))).toEqual(["porad_cis:non_ascii"]);
  });

  test("XSD formats are enforced after normalization", () => {
    expect(issues(run({ ...BASE, eic_popl: "00000019" }))).toEqual(["eic_popl:invalid_format"]);
    expect(issues(run({ ...BASE, id_pokl: "x".repeat(21) }))).toEqual(["id_pokl:invalid_format"]);
    expect(issues(run({ ...BASE, id_jednotky: 0 }))).toEqual(["id_jednotky:invalid_format"]);
  });

  test("non-object input", () => {
    expect(issues(run("text"))).toEqual([":invalid_type"]);
    expect(issues(run([BASE]))).toEqual([":invalid_type"]);
  });
});

describe("message options", () => {
  test("defaults: production mode, first submission", () => {
    const result = run(BASE);
    expect(result.ok && [result.sale.overeni, result.sale.prvni_zaslani]).toEqual([false, true]);
  });

  test("verification mode, manual resend and register selection", () => {
    const result = run({ ...BASE, verify: true, firstSubmission: "false", register: "shop-1" });
    expect(result.ok && result.sale).toMatchObject({
      overeni: true,
      prvni_zaslani: false,
      register: "shop-1",
    });
  });

  test("Czech yes/no is understood with a warning", () => {
    const result = run({ ...BASE, overeni: "ano" });
    expect(result.ok && result.sale.overeni).toBe(true);
    expect(codes(result)).toEqual([WarningCode.BOOLEAN_INTERPRETED]);
    expect(issues(run({ ...BASE, overeni: "maybe" }))).toEqual(["overeni:invalid_format"]);
  });
});

describe("predicted EET warnings (rozhraní §2.2.4) and the late first submission", () => {
  test("warning 1: EIČ differs from the certificate", () => {
    expect(codes(run(BASE, { certificateEic: "CZ683555118" }))).toEqual([
      WarningCode.EET_EIC_CERTIFICATE_MISMATCH,
    ]);
    expect(codes(run(BASE, { certificateEic: "CZ00000019" }))).toEqual([]);
  });

  test("warning 4: more than 2 hours in the future", () => {
    expect(codes(run({ ...BASE, dat_trzby: "2026-11-15T14:01:00+01:00" }))).toEqual([
      WarningCode.EET_SALE_IN_FUTURE,
    ]);
    expect(codes(run({ ...BASE, dat_trzby: "2026-11-15T13:59:00+01:00" }))).toEqual([]);
  });

  test("warning 5: older than 2 years or before the environment minimum", () => {
    const old = { ...BASE, dat_trzby: "2024-11-01T12:00:00+01:00", prvni_zaslani: false };
    expect(codes(run(old))).toEqual([WarningCode.EET_SALE_TOO_OLD]);
    const beforeProduction = {
      ...BASE,
      dat_trzby: "2026-10-31T12:00:00+01:00",
      prvni_zaslani: false,
    };
    expect(codes(run(beforeProduction, { environment: "production" }))).toEqual([
      WarningCode.EET_SALE_TOO_OLD,
    ]);
    expect(codes(run(beforeProduction, { environment: "playground" }))).toEqual([]);
  });

  test("warning 6: id_jednotky not shaped like a DIS+ unit number", () => {
    expect(codes(run({ ...BASE, id_jednotky: "10" }))).toEqual([WarningCode.EET_UNIT_FORMAT]);
    expect(codes(run({ ...BASE, id_jednotky: "4" }))).toEqual([WarningCode.EET_UNIT_FORMAT]);
    expect(codes(run({ ...BASE, id_jednotky: "164968741" }))).toEqual([]);
  });

  test("warning 7: authorizing EIČ equals the taxpayer's", () => {
    expect(codes(run({ ...BASE, eic_poverujiciho: "CZ00000019" }))).toEqual([
      WarningCode.EET_SAME_EIC,
    ]);
  });

  test("1051: first submission long after the sale (metodika 1.2)", () => {
    const late = { ...BASE, dat_trzby: "2026-11-15T11:00:00+01:00" };
    expect(codes(run(late))).toEqual([WarningCode.LATE_FIRST_SUBMISSION]);
    expect(codes(run({ ...late, prvni_zaslani: false }))).toEqual([]);
    expect(codes(run({ ...late, overeni: true }))).toEqual([]);
    expect(codes(run(late, { lateFirstSubmissionMs: 2 * 3_600_000 }))).toEqual([]);
  });

  test("predicted warnings carry source 'ingest'", () => {
    const result = run({ ...BASE, id_jednotky: "10" });
    expect(result.warnings[0]).toMatchObject({ code: 6, source: "ingest", field: "id_jednotky" });
  });
});
