# `@eet-gateway/ingest` — vstupní formáty a normalizace

Ingest převede tržbu v libovolném běžném tvaru na data, která projdou XSD rozhraní EET 4.1.
**Každá konverze vrátí varování; nic se neděje potichu.** Je to čistá knihovna bez I/O. Běží
v Node 22+, Bunu i Deno a jde ji použít samostatně, třeba jen k ověření dat ve vlastní pokladně,
bez odesílání.

Kódy varování a chyb v tomto dokumentu jsou **stabilní API**: nikdy se nepřečíslují, jen
přibývají. Test `packages/ingest/test/docs.test.ts` hlídá, že je dokument uvádí všechny.

```ts
import { normalizeSale, parseSales } from "@eet-gateway/ingest";

const one = normalizeSale(
  { totalAmount: 87988.5, saleDateTime: "15.11.2026 11:58", receiptNumber: "2026/0001" },
  { register: { eic_popl: "CZ00000019", id_jednotky: "11", id_pokl: "KASA-1" } },
);
if (one.ok) send(one.sale.data); // EetReceiptData, validated against the XSD
for (const w of one.warnings) log(w.code, w.message); // 1001, 1015, 1021 …

const batch = parseSales(csvBytes, "csv", { fieldMap: { "Cena celkem": "celk_trzba" } });
for (const { row, result } of batch.rows) if (!result.ok) report(row, result.issues);
```

## API

| Funkce                                 | Popis                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `normalizeSale(input, context?)`       | Jedna tržba (JS objekt) → `IngestResult`                                                |
| `parseSales(source, format, context?)` | `string` nebo `Uint8Array` ve formátu `json` / `ndjson` / `csv` / `xml` → `BatchResult` |
| `formatFromContentType(contentType)`   | `application/json`, `application/x-ndjson`, `text/csv`, `application/xml` → formát      |
| `SaleInputSchema`                      | zod schéma volného vstupu (kanonické názvy), pro dokumentaci API                        |

`context` (vše nepovinné):

| Pole                    | Význam                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `register`              | Výchozí `eic_popl`, `id_jednotky`, `id_pokl` z konfigurace pokladny (varování 1021) |
| `timeZone`              | Zóna pokladny, výchozí `Europe/Prague`                                              |
| `fieldMap`              | Vlastní názvy polí → kanonické pole, např. `{ "Cena celkem": "celk_trzba" }`        |
| `environment`           | `playground` / `production`: zapne kontrolu minimálního data tržby (varování 5)     |
| `certificateEic`        | EIČ z certifikátu pokladny, pro varování 1                                          |
| `now`                   | Hodiny (testy)                                                                      |
| `lateFirstSubmissionMs` | Hranice varování 1051, výchozí 5 minut                                              |

Tvar výsledků:

- `IngestResult`:
  - úspěch: `{ ok: true, sale: { data, overeni, prvni_zaslani, register? }, warnings }`
  - chyba: `{ ok: false, issues, warnings }`
- `BatchResult`: `{ rows: [{ row, result }], warnings, issues }`.
  - `row` je číslo řádku ve zdroji: u CSV, NDJSON a XML fyzický řádek, kde záznam začíná; u
    pole v JSON pořadí od 1.
  - `warnings` a `issues` na nejvyšší úrovni se týkají celého souboru (např. kódování, nečitelný
    soubor).
  - Chybný řádek nikdy neschová ostatní.

Varování: `{ code: number, message, source: "ingest", field? }` — stejný tvar jako varování EET
ve výsledku odeslání. Chyba: `{ code: string, message, field? }`.

## Formáty

| Formát        | Pravidla                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objekt / JSON | Jeden objekt, nebo pole objektů. Bajty musí být UTF-8.                                                                                                                                                                                                                                                                                                                    |
| NDJSON        | Jeden objekt na řádek, prázdné řádky se přeskočí, rozbitý řádek → `parse_error` jen u něj.                                                                                                                                                                                                                                                                                |
| CSV           | Hlavička s názvy polí. Oddělovač `,` nebo `;` (pozná se z hlavičky). Uvozovky podle RFC 4180 (oddělovač i konec řádku uvnitř uvozovek, `""` = `"`). CRLF i LF. UTF-8 s BOM i bez; jiné bajty se dekódují jako Windows-1250 (varování 1061). Řádek s víc poli než hlavička → `parse_error`.                                                                                |
| XML           | Samostatný `<Data …/>`, celé `<Trzba>`, nebo libovolný kořen s více `<Trzba>`/`<Data>`. Prefixy jmenného prostoru jsou libovolné. Z `<Hlavicka>` se převezmou `overeni` a `prvni_zaslani`; `uuid_zpravy` a `dat_odesl` se pro každý pokus generují znovu (varování 1042). DOCTYPE a vlastní entity se odmítnou (`unsupported_format`), komentáře, PI a CDATA se přeskočí. |

## Pole a aliasy

Názvy se porovnávají normalizovaně: bez ohledu na velikost písmen, diakritiku, `_`, `-` a mezery.
`celk_trzba`, `celkTrzba`, `Celk Trzba` a `CELK-TRZBA` jsou tedy totéž pole. Anglické názvy
vycházejí z oficiálního anglického překladu popisu rozhraní. `fieldMap` má přednost před
vestavěnými aliasy.

| Kanonické pole                              | Aliasy                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `eic_popl`                                  | `eicPopl`, `taxpayerId`, `eic`, `vatId`, `taxId`                                  |
| `eic_poverujiciho`                          | `eicPoverujiciho`, `authorizingTaxpayerId`, `principalTaxpayerId`                 |
| `povereni_vice_popl`                        | `povereniVicePopl`, `multipleTaxpayers`, `multipleTaxpayersAuthorization`         |
| `id_jednotky`                               | `idJednotky`, `registeringUnitId`, `registratingUnitId`, `unitId`, `premisesId`   |
| `id_pokl`                                   | `idPokl`, `posId`, `cashRegisterId`, `deviceId`                                   |
| `porad_cis`                                 | `poradCis`, `sequenceNumber`, `receiptNumber`, `transactionNumber`                |
| `dat_trzby`                                 | `datTrzby`, `transactionDateTime`, `saleDateTime`, `dateTime`, `saleDate`, `date` |
| `celk_trzba`                                | `celkTrzba`, `totalAmount`, `total`, `amount`                                     |
| `urceno_cerp_zuct`                          | `urcenoCerpZuct`, `amountIntendedForDrawing`, `intendedForDrawingAmount`          |
| `cerp_zuct`                                 | `cerpZuct`, `amountDrawn`, `drawnAmount`                                          |
| `overeni` (ověřovací mód)                   | `verify`, `verification`, `verificationMode`                                      |
| `prvni_zaslani` (`false` = ruční opakování) | `prvniZaslani`, `firstSubmission`                                                 |
| `register` (výběr pokladny)                 | `registerId`                                                                      |
- Prázdná hodnota (`""`, jen mezery, `null`) znamená, že pole není vyplněné (rozhraní §3.3.2).
- Neznámé pole se ignoruje s varováním 1041.
- Dvě pole se stejným významem a různou hodnotou → `conflicting_fields`.

## Normalizace

| Co              | Pravidlo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Částky          | Vstup jako text i číslo. Číslo se převede přes nejkratší desetinný zápis a dál se zpracovává jako text, nikdy ve float (1001). Desetinná čárka (1002). Mezery jako oddělovač tisíců, doplnění na 2 desetinná místa, vedoucí nuly, `+`, `-0.00` (1003). **Víc než 2 desetinná místa je chyba, nikdy se nezaokrouhluje** (i `10.500`, i float šum `0.1+0.2`). Kombinace tečky a čárky (`1.234,50`) je nejednoznačná → chyba. Rozsah ±99 999 999,99 Kč.                                                                                                                                                                                                                     |
| Datum a čas     | Výstup je vždy místní čas zóny pokladny s posunem a bez zlomků sekund. ISO s posunem v jiné zóně nebo `Z` se přepočte na stejný okamžik (1012). ISO bez posunu se chápe jako místní čas pokladny (1011). Dále se přijímá `Date` (1016), epocha v sekundách nebo ms jako číslo i 10/13místný text (1014) a `d.m.yyyy h:mm[:ss]` (1015). Mezera místo `T`, chybějící sekundy a posun bez dvojtečky (1018). Zlomky sekund se oříznou (1013). Čas v mezeře přechodu na letní čas → `nonexistent_local_time`. Dvojznačný čas při přechodu na zimní čas → první výskyt (1017). `24:00:00` se odmítá (XSD ho připouští; přísnější varianta, aby měl jeden okamžik jeden zápis). |
| Text            | Ořez mezer na okrajích (1031). Znaky mimo ASCII 32–126 v `id_pokl`, `porad_cis` a EIČ → `non_ascii`; diakritika se nikdy nepřepisuje (jde o identifikátory). Celé číslo se u `id_jednotky` a `porad_cis` převede na text.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Ano/ne          | `true`/`false`/`1`/`0` bez varování; `ano`/`ne`/`yes`/`no`/`a`/`n`/`y` s varováním 1032.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Výchozí hodnoty | `eic_popl`, `id_jednotky` a `id_pokl` z `context.register`, pokud chybí (1021).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Volby zprávy    | `overeni` výchozí `false`, `prvni_zaslani` výchozí `true`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## Kódy varování

Kódy 1–7 předpovídají propustné kontroly EET (rozhraní §2.2.4, §3.4.4) se stejnými čísly jako
EET. `source: "ingest"` je odliší od skutečné odpovědi EET; EET o nich rozhoduje samo.

| Kód  | Název                          | Význam                                                                           |
| ---- | ------------------------------ | -------------------------------------------------------------------------------- |
| 1    | `EET_EIC_CERTIFICATE_MISMATCH` | `eic_popl` ≠ EIČ v certifikátu pokladny (jen se zadaným `certificateEic`)        |
| 4    | `EET_SALE_IN_FUTURE`           | `dat_trzby` je o víc než 2 h v budoucnosti                                       |
| 5    | `EET_SALE_TOO_OLD`             | `dat_trzby` je starší než 2 roky nebo než minimální datum prostředí              |
| 6    | `EET_UNIT_FORMAT`              | `id_jednotky` nemá aspoň 2 číslice s poslední 1–4 (tvar z DIS+)                  |
| 7    | `EET_SAME_EIC`                 | `eic_poverujiciho` = `eic_popl`                                                  |
| 1001 | `AMOUNT_FROM_NUMBER`           | Částka zadaná číslem převedena na text                                           |
| 1002 | `AMOUNT_DECIMAL_COMMA`         | Desetinná čárka nahrazena tečkou                                                 |
| 1003 | `AMOUNT_REFORMATTED`           | Oddělovače tisíců, doplněná desetinná místa, vedoucí nuly, `+`, `-0.00`          |
| 1011 | `DATETIME_ASSUMED_TIME_ZONE`   | Čas bez posunu chápán jako místní čas pokladny                                   |
| 1012 | `DATETIME_CONVERTED_TIME_ZONE` | Čas v jiné zóně přepočten do zóny pokladny (stejný okamžik)                      |
| 1013 | `DATETIME_FRACTION_TRUNCATED`  | Zlomky sekund oříznuty                                                           |
| 1014 | `DATETIME_FROM_EPOCH`          | Čas zadaný epochou (s/ms)                                                        |
| 1015 | `DATETIME_FROM_CZECH_FORMAT`   | Čas zadaný jako `d.m.yyyy h:mm[:ss]`                                             |
| 1016 | `DATETIME_FROM_DATE`           | Čas zadaný objektem `Date`                                                       |
| 1017 | `DATETIME_AMBIGUOUS`           | Dvojznačný místní čas (zimní čas), použit první výskyt                           |
| 1018 | `DATETIME_REFORMATTED`         | Mezera místo `T`, chybějící sekundy nebo posun bez dvojtečky                     |
| 1021 | `DEFAULT_APPLIED`              | Hodnota doplněna z konfigurace pokladny                                          |
| 1031 | `VALUE_TRIMMED`                | Odstraněny mezery na okrajích                                                    |
| 1032 | `BOOLEAN_INTERPRETED`          | `ano`/`ne`/`yes`/`no` chápáno jako true/false                                    |
| 1041 | `UNKNOWN_FIELD_IGNORED`        | Neznámé pole ignorováno                                                          |
| 1042 | `HEADER_FIELD_IGNORED`         | `uuid_zpravy`/`dat_odesl` z XML hlavičky ignorovány                              |
| 1051 | `LATE_FIRST_SUBMISSION`        | První odeslání tržby starší než `lateFirstSubmissionMs` (ZoET §16, metodika 1.2) |
| 1061 | `ENCODING_CP1250`              | CSV dekódováno jako Windows-1250 (k celému souboru)                              |

## Kódy chyb

| Kód                      | Význam                                                       |
| ------------------------ | ------------------------------------------------------------ |
| `required`               | Povinné pole chybí a není ani v konfiguraci pokladny         |
| `invalid_type`           | Nepoužitelný typ hodnoty (např. objekt místo textu)          |
| `invalid_format`         | Hodnota neodpovídá formátu EET                               |
| `non_ascii`              | Znaky mimo ASCII, které EET nepřipouští (typicky diakritika) |
| `too_many_decimals`      | Částka s víc než 2 desetinnými místy                         |
| `out_of_range`           | Částka nebo číslo mimo rozsah XSD                            |
| `nonexistent_local_time` | Místní čas v mezeře přechodu na letní čas                    |
| `conflicting_fields`     | Dvě pole se stejným významem a různou hodnotou               |
| `parse_error`            | Soubor nebo řádek nejde přečíst (CSV, JSON, NDJSON, XML)     |
| `unsupported_format`     | Nepodporovaný formát nebo konstrukce (např. XML DOCTYPE)     |
