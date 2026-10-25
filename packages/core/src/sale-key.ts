import type { EetReceiptData } from "./schema.ts";

/**
 * Uniqueness key of a sale (rozhraní §4): the six mandatory `<Data>` values joined by `|`. EET
 * treats a message with the same key as data about the same sale, not a new sale — and still
 * issues a new POK for it (rozhraní §2.1). Values must already be in their final EET form.
 */
export function saleKey(data: EetReceiptData): string {
  return [
    data.eic_popl,
    data.id_jednotky,
    data.id_pokl,
    data.porad_cis,
    data.dat_trzby,
    data.celk_trzba,
  ].join("|");
}
