# SPEC_NOTES — EET 2.0, rozhraní 4.1

Výtah ze zdrojů pravdy pro implementaci brány. **U každého pravidla je odkaz na kapitolu zdroje.**
Řádky označené **návrh** jsou naše odvození nebo rozhodnutí, nejsou ze zdroje. Při rozporu platí
zdroj, ne tento soubor. Změny zdrojů hlídá `bun run spec:drift` (v CI týdně, viz
`.github/workflows/spec-drift.yml`); hashe jsou v [`sources/sources.json`](sources/sources.json).

Stav k 25. 10. 2026.

## 1. Zdroje a zkratky citací

| Zkratka  | Dokument                                                             | Verze | Datum       | Soubor (pod `https://eet.gov.cz/assets/cs/cmsmedia/pro-vyvojare/`)              |
| -------- | -------------------------------------------------------------------- | ----- | ----------- | ------------------------------------------------------------------------------- |
| **R**    | Formát a struktura údajů o evidované tržbě a popis datového rozhraní | 1.2   | 25. 8. 2026 | `EET_popis_rozhrani_v1.2.pdf` (závazný; EN `…v1.2a_EN.pdf` je jen informativní) |
| **XSD**  | `EETXMLSchema.xsd`                                                   | 4.1   | —           | v repu: `spec/eet-v4.1/EETXMLSchema.xsd`                                        |
| **WSDL** | `EETServiceSOAP.wsdl`                                                | 4.1   | —           | v repu: `spec/eet-v4.1/EETServiceSOAP.wsdl`                                     |
| **Vzor** | zachycené požadavky na playground                                    | —     | —           | v repu: `spec/eet-v4.1/samples/CZ*.eet.v4.req.xml`                              |
| **PG**   | Neprodukční prostředí (playground) — přístupové a provozní informace | 1.1   | 30. 6. 2026 | `EET_pristupove_provozni_informace_playgr-3.pdf` — **TLP:AMBER**                |
| **P**    | Production environment — access and operational information          | 1.1   | 10. 7. 2026 | `EET_pristupove_provozni_informace_produk-3.pdf` — **TLP:AMBER**                |
| **M**    | Popis položek datové zprávy s příklady jejich vyplnění (metodika)    | 1.0   | 5. 10. 2026 | `EET_popis_polozek_datove_zpravy.pdf`                                           |
| **ZoET** | Zákon č. 180/2026 Sb., o evidenci tržeb (úplné znění)                | —     | 7. 10. 2026 | `Uplne_zneni_Zakon_o_EET.pdf`                                                   |

Citace: `R §3.3.3.12` = kapitola rozhraní; `M 1.3` = metodika kap. 1, bod 3; `M kap. 6` = celá
kapitola; `PG §3.1.5`, `P §2.1` = kapitoly přístupových informací.

Dokumenty PG a P jsou na eet.gov.cz volně ke stažení, ale nesou označení TLP:AMBER. Proto je
nikam nekopírujeme (hlídá `test/contract/sources.test.ts`) a přebíráme z nich jen fakta potřebná
pro interoperabilitu. XSD, WSDL a vzorové požadavky jsou veřejné, v repu jsou uložené bajtově
shodné kopie.

## 2. Transport a podpis

| Pravidlo                           | Hodnota                                                                                                                                                                                                                                                     | Zdroj                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Protokol                           | SOAP 1.1, document/literal, jediná operace `OdeslaniTrzby` (`Trzba` → `Odpoved`)                                                                                                                                                                            | R §1, WSDL                      |
| Zabezpečení zpráv                  | WS-Security 1.1                                                                                                                                                                                                                                             | R §1                            |
| HTTPS                              | povinné, TLS ≥ 1.2, bez klientského certifikátu; klient **musí** ověřit serverový certifikát (důvěryhodná CA, shoda jména)                                                                                                                                  | R §2.3.1, §5.1                  |
| TLS certifikát serveru             | DigiCert, typ EV (PG i produkce); konkrétní certifikát se může změnit, atributy (důvěryhodná CA, EV, doména) zůstanou                                                                                                                                       | PG §3.2, P §3.2                 |
| HTTP                               | HTTP/1.1 povinně, metoda POST                                                                                                                                                                                                                               | R §2.3.2, §2.3.3                |
| Hlavičky požadavku                 | `Content-Type: text/xml; charset=utf-8`, `SOAPAction` podle WSDL: `http://fs.gov.cz/eet/OdeslaniTrzby`                                                                                                                                                      | R §2.3.3, §3.1, WSDL            |
| Kódování                           | UTF-8; buď charset v `Content-Type`, nebo první řádek `<?xml version="1.0" encoding="UTF-8"?>`                                                                                                                                                              | R §3.1                          |
| Povolené znaky ve všech položkách  | jednobajtové ASCII s kódy 9, 10, 13, 32–126                                                                                                                                                                                                                 | R §3.1                          |
| Jmenný prostor                     | `http://fs.gov.cz/eet/schema/v4`                                                                                                                                                                                                                            | R §3.1, XSD                     |
| Verzování                          | hlavní verze je v URL (`/v4`); vedlejší změny (4.1 → 4.2) jsou kompatibilní a namespace ani URL nemění; nekompatibilní změna = nová hlavní verze (`/v5`)                                                                                                    | R §1.1                          |
| Souběh verzí                       | PG i produkce podporují souběh aktuální a předchozí hlavní verze (od 4.0)                                                                                                                                                                                   | PG §2.3, P §2.3                 |
| Co se podepisuje                   | právě jeden element: `soap:Body` s `<Trzba>`, referovaný relativním odkazem (`wsu:Id`)                                                                                                                                                                      | R §5.2                          |
| Kanonizace                         | Exclusive XML Canonicalization 1.0, `http://www.w3.org/2001/10/xml-exc-c14n#`                                                                                                                                                                               | R §5.2                          |
| Otisk                              | SHA-256, `http://www.w3.org/2001/04/xmlenc#sha256`                                                                                                                                                                                                          | R §5.2                          |
| Podpis                             | RSA-SHA256, `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256`                                                                                                                                                                                             | R §5.2                          |
| Certifikát ve zprávě               | `wsse:BinarySecurityToken`, EncodingType `…soap-message-security-1.0#Base64Binary`, ValueType `…x509-token-profile-1.0#X509v3`, referovaný z `ds:KeyInfo/wsse:SecurityTokenReference`                                                                       | R §5.2, Vzor                    |
| InclusiveNamespaces (informativně) | vzor používá `PrefixList="soapenv v4"` u `SignedInfo` a `"v4"` u transformace Body                                                                                                                                                                          | Vzor                            |
| Zakázané navíc                     | další hlavičky (Timestamp, WS-Addressing) a podepisování jiných elementů; zpráva může být považována za útok a odmítnuta                                                                                                                                    | R §5.2                          |
| Max. velikost                      | celá zpráva včetně SOAP obálky ≤ 12 kB (kritická kontrola → chyba 7). Jednotka není definována; **návrh:** 12 000 B (stejně jako eet-client). Vzorové zprávy mají asi 4,2 kB.                                                                               | R §2.2.3 bod 5, Vzor            |
| Trasování                          | hlavička odpovědi `X-Global-Transaction-Id` (alfanumerické a interpunkční znaky, typicky < 32, max. 64 znaků); vhodné ji logovat a ukládat                                                                                                                  | R §5.4                          |
| CORS                               | server podporuje přímé volání z prohlížeče (preflight → 204); pro serverovou bránu nerelevantní                                                                                                                                                             | R §2.3.3                        |
| Podpis odpovědí                    | potvrzovací zprávy podepisuje certifikát vydaný **I.CA**: `CN = I.CA Public CA/RSA 06/2022`, `O = První certifikační autorita, a.s.`, `2.5.4.97 = NTRCZ-26439395`, `C = CZ` (kořeny na <https://www.ica.cz/korenove-certifikaty>, CN 100000002 a 100001063) | PG §3.3, P §3.3, R §5.3         |
| Chybové odpovědi                   | nepodepsané, `SOAP Header` bez podpisu i certifikátu                                                                                                                                                                                                        | R §3.2, §3.5                    |
| Žádná odpověď                      | při podezření na kybernetický útok server neodpoví vůbec; u chyby kódování (2) může vrátit SOAP Fault nebo zprávu ignorovat                                                                                                                                 | R §2.2.3, R §3.5.4 pozn. `****` |

**Důsledky (návrh):** chybějící odpověď neznamená, že zpráva nedorazila, proto `uncertain`.
Opakování musí mít exponenciální backoff s horní mezí, aby nezahlcovalo server, který nás mohl
vyhodnotit jako útok. `X-Global-Transaction-Id` se ukládá ke každému pokusu.

## 3. Prostředí

|                                       | Playground (PG)                                                                                                                                         | Produkce                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| URL služby                            | `https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4` (PG §2.1, WSDL)                                                                             | `https://trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4` (P §2.1), v bráně **vždy z konfigurace**                                      |
| DNS                                   | IP adresa se během provozu změní, nepoužívat IP v URL (PG §2.1)                                                                                         | DNS balancing; DNS překlad při **každém novém spojení**, respektovat TTL (P §2.1)                                                      |
| Min. `dat_trzby` (propustná kontrola) | 1. 7. 2026 00:00 (R §2.2.4 bod 4a, PG §4.1)                                                                                                             | 1. 11. 2026 v přechodném režimu, jinak 1. 1. 2027 00:00 (R §2.2.4 bod 4b–c, P §4.1)                                                    |
| Provozní doba                         | 24×7, dostupnost 8×5, ročně 99,5 % (PG §4.1)                                                                                                            | 24×7, ročně 99,99 %, oprava kritické vady do 4 h, dvě datová centra active-active (P §4.1)                                             |
| Servisní okno                         | zpravidla čtvrtek 20:00–06:00 (PG §4.1)                                                                                                                 | zpravidla čtvrtek 20:00–06:00 (P §4.1)                                                                                                 |
| CA pokladních certifikátů             | „EET CA 2 Playground“: Root RSA 4096 / 10 let, SubCA RSA 2048 / 4 roky; CRL se nevydává (PG §3.1.1–3.1.4)                                               | CA EET: Root CA EET + SubCA; CRL `https://caeet.gov.cz/crldp` každých 8 h a do 1 min po revokaci, platnost CRL 24 h (P §3.1.1, §3.1.3) |
| Politika (OID) pokladního certifikátu | dokument: `1.2.203.19122063.10.4.102.x.y` (PG §3.1.5); **skutečně ve všech 3 PG certifikátech: `1.2.203.19122063.10.2.102.0.1`** (ověřeno 25. 10. 2026) | `1.2.203.19122063.10.1.102.x.y` (P §3.1.2), neověřeno                                                                                  |
| Vydavatel (skutečný, ověřeno)         | `CN=playground EETv2 NCA SubCA RSA 05/2026` ← `CN=playground EETv2 NCA RootCA RSA 05/2026`                                                              | `CN=EETv2 NCA SubCA RSA 10/2026` (soubor `ca_eet-sub_prod.pem`)                                                                        |
| Potvrzení                             | `test="true"`, POK končí `-ff`, **není platný POK** (R §2.2.2 Tab. 1, §3.4.2.3)                                                                         | bez `test`, platný POK                                                                                                                 |
| Právní účinek                         | žádný (R §2.2.2, PG §1.1)                                                                                                                               | plnění povinnosti podle ZoET                                                                                                           |
| Podpora                               | `epodpora@fs.gov.cz` (PG §4.2)                                                                                                                          | `epodpora@fs.gov.cz` (P §4.2)                                                                                                          |

Sdílená testovací EIČ (PG §2.4, §3.1.6–3.1.8): `CZ8551015704` (fyzická osoba s RČ),
`CZ00000019` (právnická osoba s IČ), `CZ683555118` (poplatník s VČP).

**Pojistky (návrh, ADR-001):** pokladna s certifikátem z řetězce PG se nesmí odeslat na
produkční endpoint; odmítne se start. Prostředí se pozná podle **vydavatele a řetězce** (PG Root
a SubCA se liší od produkčních), ne podle OID: dokumentované OID PG neodpovídá skutečným
certifikátům (viz tabulka výše a §13). Když z endpointu nakonfigurovaného jako produkce přijde
`test="true"` nebo POK `-ff`, je to chyba konfigurace, ne `accepted`.

## 4. Hlavička `<Hlavicka>` (atributy)

| #   | XML jméno       | Povinná | XSD typ        | Maska (regex)                                                                                | Délka | Pravidla                                                                                                                                           | Zdroj                  |
| --- | --------------- | ------- | -------------- | -------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 1   | `uuid_zpravy`   | Ano     | `UUIDType`     | `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$` | 36    | RFC 9562, doporučená verze 4. Identifikuje **zprávu, ne tržbu**. Nové pro každý pokus včetně opakování, storna i opravy, nikdy se znovu nepoužije. | R §3.3.3.1, M 1.1      |
| 2   | `dat_odesl`     | Ano     | `tns:dateTime` | `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z\|[+\-]\d\d:\d\d)$`                                        | 25    | Okamžik odeslání. V ČR lokální čas s `+01:00` (SEČ) / `+02:00` (SELČ), mimo ČR offset nebo `Z`. Bez zlomků sekund.                                 | R §3.3.3.2, M 1.2, XSD |
| 3   | `prvni_zaslani` | Ano     | `xs:boolean`   | `true`/`false`/`1`/`0`                                                                       | 1–5   | `true` = první pokus, **bez ohledu na to, zda uspěl**; `false` = každý další pokus o tutéž tržbu                                                   | R §3.3.3.3, M 1.3      |
| 4   | `overeni`       | Ne      | `xs:boolean`   | `true`/`false`/`1`/`0`                                                                       | 1–5   | `true` = ověřovací mód; chybí nebo `false` = ostrý mód                                                                                             | R §3.3.3.4, M 1.4      |

## 5. Data `<Data>` (atributy)

`<Data>` nemá žádné podřízené elementy, všechny položky jsou atributy (XSD `TrzbaDataType`).
Nepovinné položky se musí vyplnit, pokud jsou pro tržbu relevantní. Chybějící položka se
považuje za prázdnou; u částek to **neznamená 0**. Prázdný atribut (`eic_poverujiciho=""`) je
chyba (R §3.3.2, §3.3.3.12).

| #   | XML jméno            | Povinná | XSD typ                         | Maska (regex)                                         | Délka | Pravidla                                                                                                                                                                               | Zdroj                                   |
| --- | -------------------- | ------- | ------------------------------- | ----------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 5   | `eic_popl`           | Ano     | `CZEICType`                     | `^CZ[0-9]{8,10}$`                                     | 10–12 | EIČ = DIČ, nebo CZ + RČ, nebo CZ + VČP (ZoET §18). Shoduje se s CN certifikátu (jinak varování 1). Výjimka: po změně EIČ lze nové EIČ podepsat původním certifikátem do vydání nového. | R §3.3.3.5, M 1.5                       |
| 6   | `eic_poverujiciho`   | Ne      | `CZEICType`                     | `^CZ[0-9]{8,10}$`                                     | 10–12 | Povinné při pověření jediným poplatníkem, kterému tržba plyne (ZoET §10 odst. 1); ≠ `eic_popl` (jinak varování 7)                                                                      | R §3.3.3.6, M 1.6, M kap. 3             |
| 7   | `povereni_vice_popl` | Ne      | `xs:boolean`                    | `true`/`false`/`1`/`0`                                | 1–5   | Tržba plyne více poplatníkům; chybějící = `false`                                                                                                                                      | R §3.3.3.7, M 1.7                       |
| 8   | `id_jednotky`        | Ano     | `IdEvidJednotkyType` (`xs:int`) | `^[1-9][0-9]{0,8}$`                                   | 1–9   | 1 až 999 999 999, přiděluje DIS+. Propustná kontrola: alespoň 2 číslice, poslední 1–4 (jinak varování 6).                                                                              | R §3.3.3.8, §2.2.4 bod 5, M 1.8         |
| 9   | `id_pokl`            | Ano     | `string20`                      | `^[0-9a-zA-Z\.,:;/#\-_ ]{1,20}$`                      | 1–20  | Unikátní čtveřice (`eic_popl`, `id_jednotky`, `id_pokl`, `dat_trzby`)                                                                                                                  | R §3.3.3.9, M 1.9                       |
| 10  | `porad_cis`          | Ano     | `string25`                      | `^[0-9a-zA-Z\.,:;/#\-_ ]{1,25}$`                      | 1–25  | Unikátní pětice (`eic_popl`, `id_jednotky`, `id_pokl`, `porad_cis`, `dat_trzby`); typicky číslo účtenky                                                                                | R §3.3.3.10, M 1.10                     |
| 11  | `dat_trzby`          | Ano     | `tns:dateTime`                  | `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z\|[+\-]\d\d:\d\d)$` | 20/25 | Okamžik přijetí tržby nebo vydání příkazu k platbě, je-li dřív. Lokální čas zóny, kde tržba proběhla, s povinným offsetem; bez zlomků sekund.                                          | R §3.3.3.11, §3.3.3.2, M 1.11, ZoET §16 |
| 12  | `celk_trzba`         | Ano     | `CastkaType`                    | viz níže                                              | 4–12  | Celková částka v Kč                                                                                                                                                                    | R §3.3.3.12, M 1.12                     |
| 13  | `urceno_cerp_zuct`   | Ne      | `CastkaType`                    | viz níže                                              | 4–12  | Platby určené k následnému čerpání nebo zúčtování                                                                                                                                      | R §3.3.3.12, M 1.13                     |
| 14  | `cerp_zuct`          | Ne      | `CastkaType`                    | viz níže                                              | 4–12  | Platby, které jsou následným čerpáním nebo zúčtováním                                                                                                                                  | R §3.3.3.12, M 1.14                     |

**Částky (`CastkaType`)** (R §3.3.3.12, XSD):

- Maska `^((0|-?[1-9]\d{0,7})\.\d\d|-0\.(0[1-9]|[1-9]\d))$`, báze `xs:decimal`, rozsah
  (−100 000 000; 100 000 000) s otevřenými mezemi.
- Právě dvě desetinná místa a desetinná **tečka**. Hodnoty mohou být kladné, nulové i záporné.
- Zakázané jsou vedoucí nuly (`020.45`), `-0.00`, `-00.00`, `.20`, `-00100.00`.
- Délka je 4–11 znaků pro nezáporné hodnoty, 5–12 pro záporné.
- Věcný obsah částek (záloha, kauce, sleva, spropitné, storno) popisuje M kap. 4–5. To je účetní
  logika, která je mimo rozsah brány.

## 6. Odpověď `<Odpoved>`

Struktura (XSD `OdpovedType`): `Hlavicka`, pak **právě jedno** z `Potvrzeni` | `Chyba`, pak 0–10× `Varovani`.

| Položka                 | Kde       | Povinná                                                                            | Formát                                                                                                                                                                                                 | Zdroj                              |
| ----------------------- | --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `Hlavicka/@uuid_zpravy` | obě       | v potvrzení ano, v chybě ne (chybí, když zprávu nešlo analyzovat); v XSD nepovinná | `UUIDType`                                                                                                                                                                                             | R §3.4.2.1, §3.5.2.1, §3.5.3 př. 2 |
| `Hlavicka/@dat_prij`    | potvrzení | ano                                                                                | `tns:dateTime`                                                                                                                                                                                         | R §3.4.2.2                         |
| `Hlavicka/@dat_odmit`   | chyba     | ne                                                                                 | `tns:dateTime`                                                                                                                                                                                         | R §3.5.2.2                         |
| `Potvrzeni/@pok`        | potvrzení | ano                                                                                | `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}-[0-9a-fA-F]{2}$`, 39 znaků, `uuid_prijem-Id_zarizeni`; unikátní pro každou přijatou zprávu; `-ff` = neprodukční | R §3.4.2.3, §2.1                   |
| `Potvrzeni/@test`       | potvrzení | ne                                                                                 | `xs:boolean`; `true` = PG, chybí = produkce                                                                                                                                                            | R §3.4.2.4                         |
| `Chyba/@kod`            | chyba     | ano                                                                                | `xs:int` −999…999, `^-?\d{1,3}$`                                                                                                                                                                       | R §3.5.2.3                         |
| `Chyba` (text)          | chyba     | ano                                                                                | ASCII bez diakritiky, max. 100 znaků                                                                                                                                                                   | R §3.5.2.4                         |
| `Chyba/@test`           | chyba     | ne                                                                                 | `xs:boolean`                                                                                                                                                                                           | R §3.5.2.5                         |
| `Varovani/@kod_varov`   | obě       | ne                                                                                 | `xs:int` 1…999, `^[1-9]\d{0,2}$`                                                                                                                                                                       | R §3.4.2.5                         |
| `Varovani` (text)       | obě       | ne                                                                                 | ASCII bez diakritiky, max. 100 znaků; v chybové zprávě jen při kódu 0                                                                                                                                  | R §3.4.2.6, §3.5.2 pozn. `**`      |

**Návrh:** text `Chyba`/`Varovani` je smíšený obsah (`mixed="true"`), příklady obsahují odřádkování
a odsazení. Před vrácením ho ořízneme a bílé znaky sloučíme do mezer.

## 7. Módy zprávy a mapování na `SaleResult.status`

Varianty odpovědi podle R §2.2.2 (Tabulka 1); sloupec `status` je **návrh**.

| Mód       | Prostředí | Zpráva    | Odpověď systému EET                                                                                                                    | `status`                                                 |
| --------- | --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| ostrý     | produkce  | validní   | `Potvrzeni` s platným POK (+ `Varovani`), podepsáno; tržba zaevidována                                                                 | `accepted`                                               |
| ostrý     | produkce  | nevalidní | `Chyba` s kódem ≠ 0, nepodepsáno                                                                                                       | `rejected`, nebo opakování podle §9                      |
| ostrý     | PG        | validní   | `Potvrzeni`, POK `-ff`, `test="true"`, podepsáno; nic se neeviduje                                                                     | `accepted` + `test: true`                                |
| ostrý     | PG        | nevalidní | `Chyba` s kódem ≠ 0, `test="true"`                                                                                                     | `rejected`, nebo opakování podle §9                      |
| ověřovací | obě       | validní   | `Chyba kod="0"` „Datovou zpravu evidovane trzby v overovacim modu se podarilo zpracovat“ (+ `Varovani`), nepodepsáno; nic se neeviduje | `verification_ok`                                        |
| ověřovací | obě       | nevalidní | `Chyba` s kódem ≠ 0                                                                                                                    | `rejected` (bez auto-opakování)                          |
| —         | —         | —         | odesláno, odpověď nepřišla nebo vypršel timeout                                                                                        | `uncertain`                                              |
| —         | —         | —         | spojení se vůbec nenavázalo (DNS, odmítnuté spojení)                                                                                   | `queued` (bude se opakovat)                              |
| —         | —         | —         | `Potvrzeni`, jehož podpis nejde ověřit                                                                                                 | `uncertain` bez auto-opakování + alert (OQ3)             |
| —         | —         | —         | SOAP Fault nebo HTTP chyba bez `Odpoved`                                                                                               | `uncertain` (R §3.5.4 pozn. `****` připouští SOAP Fault) |
| —         | —         | —         | neprošlo lokální validací, nic se neodeslalo                                                                                           | `invalid`                                                |

Zpráva v ověřovacím módu ani zpráva na PG neplní evidenční povinnost (R §2.2.1, §2.2.2, M 1.4).

## 8. Kontroly na straně EET a jejich lokální zrcadlení

### 8.1 Kritické kontroly — zpráva se odmítne, POK se nevydá (R §2.2.3)

Server může zpracování ukončit už na první kritické chybě.

| #   | Kontrola                                    | Chyba | Lokálně (návrh)                                                                                                                |
| --- | ------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | kódování XML je UTF-8                       | 2     | zprávu vždy generujeme v UTF-8                                                                                                 |
| 2   | soulad s XSD a přítomnost povinných položek | 3     | zod schémata zrcadlící XSD + kontraktní test proti XSD (`test/contract/xsd.test.ts`)                                           |
| 3a  | vydavatel pokladního certifikátu            | 4     | při načtení .p12 ověřit řetězec k CA EET daného prostředí                                                                      |
| 3b  | platnost pokladního certifikátu včetně CRL  | 4     | před odesláním kontrola notBefore/notAfter; varování 21 dní před koncem platnosti (požadavek zadání). CRL lokálně neověřujeme. |
| 3c  | kryptografická kontrola podpisu             | 4     | podepisuje eet-client                                                                                                          |
| 4   | integrita EIČ poplatníka                    | 6     | jen regex, algoritmus není zveřejněn                                                                                           |
| 5   | velikost zprávy ≤ 12 kB                     | 7     | eet-client odmítne > 12 000 B ještě před odesláním                                                                             |

### 8.2 Propustné kontroly — POK se vydá, přidá se varování (R §2.2.4)

| #   | Kontrola                                                                                           | Varování | Lokálně jako ingest warning (návrh)                                 |
| --- | -------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------- |
| 1   | `eic_popl` ≠ EIČ v certifikátu                                                                     | 1        | porovnat s CN certifikátu pokladny (výjimka: změna EIČ, R §3.3.3.5) |
| 2   | integrita EIČ pověřujícího                                                                         | 2        | jen regex                                                           |
| 3   | `eic_popl` = `eic_poverujiciho`                                                                    | 7        | porovnat                                                            |
| 4   | `dat_trzby` je o víc než 2 h novější než přijetí zprávy                                            | 4        | porovnat s lokálními hodinami                                       |
| 4   | `dat_trzby` je o víc než 2 roky starší než přijetí, nebo starší než minimální datum prostředí (§3) | 5        | porovnat                                                            |
| 5   | `id_jednotky` má alespoň 2 číslice a poslední je 1–4                                               | 6        | `^[1-9][0-9]*[1-4]$`                                                |

Když selže jakákoli propustná kontrola a žádná kritická, zpráva se přijme a POK se vydá, jako by
prošlo všechno. Varování jsou i v chybové odpovědi s kódem 0 v ověřovacím módu (R §2.2.4).

## 9. Chybové kódy a varování

### 9.1 Chybové kódy (R §3.5.4)

| Kód       | Text                                                                            | Klasifikace (návrh)                                                    |
| --------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| −999 … −2 | rezervováno                                                                     | jako −1, dočasná chyba (předpoklad: záporné kódy = technické problémy) |
| −1        | Docasna technicka chyba zpracovani – odeslete prosim datovou zpravu pozdeji     | opakovat s backoffem                                                   |
| 0         | Datovou zpravu evidovane trzby v overovacim modu se podarilo zpracovat          | `verification_ok`                                                      |
| 1         | rezervováno                                                                     | ruční kontrola                                                         |
| 2         | Kodovani XML neni platne (místo toho může přijít SOAP Fault nebo žádná odpověď) | permanentní, chyba brány                                               |
| 3         | XML zprava nevyhovela kontrole XML schematu                                     | permanentní, chyba brány (lokální validace by ji měla zachytit)        |
| 4         | Neplatny podpis SOAP zpravy                                                     | permanentní, dokud se neopraví certifikát; pak ruční opakování         |
| 5         | používáno před verzí 4                                                          | ruční kontrola                                                         |
| 6         | EIC poplatnika ma chybnou strukturu                                             | permanentní                                                            |
| 7         | Datova zprava je prilis velka                                                   | permanentní                                                            |
| 8         | Datova zprava nebyla zpracovana kvuli technicke chybe nebo chybe dat            | nejednoznačné, viz OQ5                                                 |
| 9 … 999   | rezervováno                                                                     | ruční kontrola                                                         |

### 9.2 Kódy varování (R §3.4.4)

| Kód     | Text                                                                    |
| ------- | ----------------------------------------------------------------------- |
| 1       | EIC poplatnika v datove zprave se neshoduje s EIC v certifikatu         |
| 2       | Chybny format EIC poverujiciho poplatnika                               |
| 3       | (používáno před verzí 4)                                                |
| 4       | Datum a cas uskutecneni trzby je novejsi nez datum a cas prijeti zpravy |
| 5       | Datum a cas uskutecneni trzby je vyrazne v minulosti                    |
| 6       | id_jednotky neodpovida formatem pridelenemu c. evidencni jednotky       |
| 7       | EIC poverujiciho se shoduje s EIC poplatnika                            |
| 8 … 999 | rezervováno                                                             |

## 10. Unikátnost tržby (R §4)

Tržbu jednoznačně určují normalizované hodnoty šesti položek `<Data>`, zřetězené v tomto
pořadí v ASCII s oddělovačem `|` (kód 124). Chybějící nepovinná položka by vstupovala jako `""`,
ale všech šest položek je povinných.

```
eic_popl|id_jednotky|id_pokl|porad_cis|dat_trzby|celk_trzba
CZ00000019|243|24/A-6/Brno_2|#135433c/11/2027|2027-01-09T16:45:36+01:00|3264.50
```

- Zpráva se stejnými hodnotami jako dříve přijatá zpráva se považuje za **zaslání údajů o téže
  tržbě**, ne za novou tržbu (R §4).
- Každá přijatá zpráva přesto dostane vlastní unikátní POK (R §2.1). Opakování téže tržby tedy
  vrátí nový POK pro tutéž tržbu.
- Pokladna tento kód počítat nemusí (R §4).
- **Návrh:** tentýž řetězec použijeme jako interní `saleKey` pro detekci duplicit ve frontě.
  Server data „normalizuje“, ale pravidla normalizace nejsou zveřejněná. Proto `<Data>`
  ukládáme jako finální řetězce a při každém pokusu je posíláme bajtově shodné.

## 11. Pravidla odesílání a opakování

| #   | Pravidlo                                                                                                                                        | Zdroj                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | Tržba se eviduje nejpozději při uskutečnění, tj. při přijetí platby nebo vydání příkazu k ní, je-li dřív (typicky platba kartou)                | ZoET §16 odst. 1–2, M 1.2                              |
| 2   | První pokus o odeslání musí proběhnout nejpozději v okamžiku tržby                                                                              | M 1.3, M kap. 6                                        |
| 3   | Centrální server nesmí zprávy „bezdůvodně kumulovat a následně odesílat dávkově“                                                                | M 1.2                                                  |
| 4   | Mezní doba odezvy (čekání na POK) je **nejméně 2 s**, nastavená podle druhu činnosti a kvality připojení                                        | ZoET §19, M kap. 6                                     |
| 5   | Po překročení mezní doby odezvy: odeslat bezodkladně po pominutí příčiny, **nejpozději do 48 h od uskutečnění tržby**; povinnost trvá i po 48 h | ZoET §20, M kap. 6                                     |
| 6   | Opakuje se jen tehdy, když nedorazil POK. Postup je **stejný**, ať zprávu server nepřijal, nebo přijal a ztratila se odpověď.                   | M 1.3                                                  |
| 7   | Při opakování: **nové** `uuid_zpravy`, **nový** `dat_odesl`, `prvni_zaslani=false`, `<Data>` **beze změny**                                     | R §3.3.3.1, §3.3.3.3, M 1.1, M 1.3, M kap. 6 (příklad) |
| 8   | `prvni_zaslani=true` má jen první pokus, i když selhal                                                                                          | M 1.3                                                  |
| 9   | Podepisuje se certifikátem platným v okamžiku odeslání, i když tržba proběhla za platnosti staršího                                             | R §3.3                                                 |
| 10  | Po změně EIČ lze posílat nové EIČ podepsané původním certifikátem, dokud není vydán nový                                                        | R §3.3.3.5, M 1.5                                      |
| 11  | Storno a oprava jsou nové zprávy s novým UUID                                                                                                   | M 1.1, M kap. 4                                        |
| 12  | Při podezření na útok server neodpoví, viz §2                                                                                                   | R §2.2.3                                               |
| 13  | Výpadky je třeba čekat v servisním okně (zpravidla čt 20:00–06:00)                                                                              | PG §4.1, P §4.1                                        |
| 14  | Odesílat přes server poskytovatele cloudových služeb je přípustné; za zabezpečení soukromých klíčů odpovídá poplatník (ZoET §14)                | M kap. 7                                               |

**Odvozená politika fronty** (rozhodnuto ve fázi 4, podrobně v
[ADR-003](ADR-003-queue-retry-policy.md)):

- `uncertain` se opakuje automaticky (`retryUncertain = true` jako výchozí). Opírá se o pravidlo 6
  a o §10: opakování nezpůsobí dvojí evidenci, jen další POK pro tutéž tržbu. Viz OQ2.
- Před každým síťovým voláním se zapíše „pokus zahájen“ (write-ahead). Záznam, u kterého po pádu
  procesu chybí výsledek, má stav `uncertain` a další pokus má `prvni_zaslani=false`. Na jednu
  tržbu tak připadne nejvýš jeden pokus s `prvni_zaslani=true`.
- `rejected` s permanentním kódem (§9.1) se neopakuje automaticky.
- Po 48 h bez POK se dál opakuje, záznam dostane příznak `overdue` a alert.
- Výchozí timeout musí být ≥ 2 000 ms a konfigurace nižší hodnotu odmítne.
- Klíče se importují jako non-extractable a hesla se drží mimo konfigurační soubor (pravidlo 14).

## 12. Certifikáty

- **Profil pokladního certifikátu:** CN = EIČ, C = CZ, `description` volitelně (max. 64 znaků),
  RSA 2048, `sha256WithRSAEncryption`, platnost 366 dní, KeyUsage (kritické) =
  `digitalSignature, nonRepudiation`, politika podle prostředí (§3) (PG §3.1.5, P §3.1.1–3.1.2).
- **Hierarchie:** Root CA RSA 4096 / 10 let → SubCA RSA 2048 / 4 roky → pokladní certifikát
  (PG §3.1.2–3.1.3, P §3.1.1).
- Poplatník může mít více pokladních certifikátů. Kolik jich má a jak je přidělí pokladnám, je
  na něm (P §3.1). Testovací certifikáty jsou sdílené pro všechny testující (PG §2.4).
- **Formát:** PKCS#12 s privátním klíčem. Heslo PG certifikátů má 8 znaků (velká a malá písmena,
  číslice) a je přiložené v archivu (PG §3.1.6).
- **Ověřeno 25. 10. 2026** (`openssl pkcs12 -info`, OpenSSL 3.6.1) na
  `CAEET_Playground_2026_v1.zip`: MAC SHA-1 s 2048 iteracemi, certifikáty šifrované
  `pbeWithSHA1And40BitRC2-CBC`, klíč `pbeWithSHA1And3-KeyTripleDES-CBC`, 3 certificate bags
  (leaf, PG SubCA, PG RootCA). Bez `-legacy` OpenSSL 3 selže na `RC2-40-CBC unsupported`.
  Leaf `CZ00000019` platí 2026-05-13 09:40:23Z až 2027-05-14 09:40:23Z a je bajtově shodný
  s certifikátem ve vzorovém požadavku (SHA-256 `7EC806E6…DC061C05`). KeyUsage odpovídá profilu.
  OID politiky je ale `1.2.203.19122063.10.2.102.0.1`, ne dokumentované `…10.4.102.x.y`.
- **CA certifikáty PG (ověřeno 25. 10. 2026):** `ca_eet-root_cert-playground.crt` (SHA-256
  otisk certifikátu `61C1E3C7…7C604619`, platnost 2026-05-05 až 2036-05-02) a
  `ca_eet-sub_cert-playground.crt` (`464FFC1F…D60627CA`, 2026-05-05 až 2030-05-04). Soubory
  odpovídají hashům v `sources.json` a `openssl verify` leaf certifikátu `CZ00000019` vůči
  nim projde. Jsou ale v **PEM**, ne v DER, jak uvádí PG §3.1.2–3.1.3. Vydávají
  **pokladní** certifikáty; potvrzovací odpovědi jimi podepsané nejsou (to dělá I.CA, viz níže).
- Kořenové a podřízené certifikáty CA EET (PG i produkce) a `I.CA Public CA/RSA 06/2022` jsou
  od fáze 2 uložené ve `spec/ca/` (hashe v `sources.json`) a vložené do jádra jako kotvy důvěry.
  Slouží k určení prostředí pokladního certifikátu a k ověření podpisu potvrzení (ADR-002).
- **Podpis odpovědí:** certifikát vydaný I.CA, ne CA EET (§2). Řetězec I.CA není součástí žádného
  dokumentu EET, proto **návrh:** pinning (OQ3). Skutečný certifikát PG je v §15.
- **Obnova:** CA EET má REST API (`caeetapi_jwt.zip`, OpenAPI s JWT). Je to mimo rozsah, připraví
  se jen rozhraní.
- **Důsledek pro konfiguraci (návrh):** kvůli pravidlu §11.9 má pokladna během obnovy mít dva
  certifikáty (starý a nový). Konfigurace proto připustí víc .p12 na pokladnu a vybere ten
  aktuálně platný.
- Testovací .p12 se do repa nikdy necommitují. `bun run certs:playground` je stáhne do `.cache/`
  a ověří SHA-256.

## 13. Rozdíly mezi zadáním a zdroji

| #   | Zadání říká                                                        | Zdroje říkají                                                                                                                                                                                                                                    | Dopad                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | „Server neprovádí deduplikaci, každé odeslání dostane vlastní POK“ | Vlastní POK ano (R §2.1). Zpráva se stejnými 6 obchodními údaji je ale **tatáž tržba** (R §4).                                                                                                                                                   | Opakování nezpůsobí dvojí evidenci, `retryUncertain` může být výchozí `true` (OQ2)                                                                                                                                                                                               |
| 2   | „U `uncertain` NEposílej automaticky znovu bez `retryUncertain`“   | Metodika výslovně požaduje opakovat i tehdy, když zprávu server přijal a ztratila se jen odpověď (M 1.3)                                                                                                                                         | Výchozí `true` (OQ2)                                                                                                                                                                                                                                                             |
| 3   | „`dat_trzby`: ISO 8601 s explicitním offsetem“                     | Navíc: **bez zlomků sekund** (XSD). V ČR offset +01:00 / +02:00, `Z` jen mimo ČR (R §3.3.3.2). PG přesto `Z` přijímá (Vzor).                                                                                                                     | Ingest ořízne zlomky (warning) a převede na zónu pokladny (OQ4)                                                                                                                                                                                                                  |
| 4   | „Částky: přesně dvě desetinná místa“                               | Navíc: zakázané vedoucí nuly a `-0.00`, absolutní hodnota < 100 000 000, záporné hodnoty povolené (R §3.3.3.12)                                                                                                                                  | Validace v ingestu                                                                                                                                                                                                                                                               |
| 5   | —                                                                  | Booleany přijímají i `1`/`0`. Prázdný atribut je chyba (R §3.3.2).                                                                                                                                                                               | Ingest akceptuje `1`/`0`, prázdné hodnoty vynechá                                                                                                                                                                                                                                |
| 6   | „Produkční endpoint vždy konfigurace“                              | URL je zveřejněná (P §2.1). Produkce navíc vyžaduje nový DNS překlad pro každé spojení a respektování TTL.                                                                                                                                       | Zůstává v konfiguraci (`productionEndpoint`, `EET_ENDPOINT_PRODUCTION`). **DNS ověřeno ve fázi 5:** Bun drží DNS 30 s; s `BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS=0` překládá při každém novém spojení (3 spojení = 3 překlady). Docker image to nastavuje ([SERVER](SERVER.md#síť)) |
| 7   | „Limit podepsané obálky 12 kB“                                     | Jednotka není definovaná (R §2.2.3)                                                                                                                                                                                                              | 12 000 B                                                                                                                                                                                                                                                                         |
| 8   | Režim `async`, `POST /v1/sales/batch`                              | Zákaz bezdůvodné kumulace a dávkového odesílání (M 1.2), první pokus nejpozději v okamžiku tržby                                                                                                                                                 | OQ1                                                                                                                                                                                                                                                                              |
| 9   | `timeoutMs` bez spodní meze                                        | Mezní doba odezvy ≥ 2 s (ZoET §19); 48 h na doposlání a povinnost trvá i potom (ZoET §20, M kap. 6)                                                                                                                                              | Validace konfigurace, příznak `overdue`                                                                                                                                                                                                                                          |
| 10  | Validace „podle XSD“                                               | Propustné kontroly jdou zrcadlit lokálně (R §2.2.4). Algoritmus integrity EIČ (chyba 6) není zveřejněný.                                                                                                                                         | Ingest warnings podle §8.2, u EIČ jen regex                                                                                                                                                                                                                                      |
| 11  | —                                                                  | POK `-ff` a `test="true"` značí PG (R §3.4.2). Politika certifikátu má podle PG §3.1.5 být `…10.4.102.x.y`, **skutečné PG certifikáty ale mají `…10.2.102.0.1`**. Kořen PG se jmenuje `…NCA RootCA RSA 05/2026`, ne `…NCA Root CA…` (PG §3.1.2). | Pojistky proti záměně prostředí podle řetězce vydavatele, ne podle OID (§3)                                                                                                                                                                                                      |
| 12  | „Načtení .p12 včetně legacy šifrování“                             | Potvrzeno: RC2-40-CBC + 3DES, MAC SHA-1 (§12)                                                                                                                                                                                                    | eet-client `/pkcs12`                                                                                                                                                                                                                                                             |
| 13  | „Každá pokladna má vlastní .p12“                                   | Podpis aktuálně platným certifikátem (R §3.3), během obnovy jsou platné dva                                                                                                                                                                      | Více .p12 na pokladnu (§12)                                                                                                                                                                                                                                                      |
| 14  | Zdroje k přečtení                                                  | Přístupové dokumenty PG a P jsou TLP:AMBER                                                                                                                                                                                                       | Jen odkazy, žádné kopie (§1)                                                                                                                                                                                                                                                     |
| 15  | Podklady z finitoapp `docs/reference/eet-2.0`                      | finitoapp přepisuje rozhraní v1.1; aktuální je **v1.2** (CORS, formální opravy)                                                                                                                                                                  | Pracujeme s v1.2                                                                                                                                                                                                                                                                 |
| 16  | —                                                                  | PG §3.1.2–3.1.3: CA certifikáty PG „v binárním formátu DER“; zveřejněné soubory `.crt` jsou ve skutečnosti **PEM**                                                                                                                               | Loader CA certifikátů musí přijmout PEM i DER                                                                                                                                                                                                                                    |
| 17  | Typ `SaleResult` (`id` povinné, `source: "eet" \| "ingest"`)       | — (rozhodnutí fáze 4)                                                                                                                                                                                                                            | `id` chybí u `invalid` (nic se neuložilo); navíc `source: "queue"`, `register`, `data`, `reason`, `issues`, `nextAttemptAt`, `overdue`, `createdAt`, `deadlineAt`; `raw*` se neukládají ([QUEUE](QUEUE.md))                                                                      |

## 14. Otevřené otázky

Do rozhodnutí platí doporučená varianta. V závorce je fáze, kterou otázka blokuje.

- ~~**OQ1 Dávky a `async` vs zákaz kumulace**~~ **Rozhodnuto ve fázi 4**
  ([ADR-003](ADR-003-queue-retry-policy.md) bod 11): `async` uloží a hned odešle na pozadí, bez
  umělého dávkování. První pokusy nezdržuje ani brána koncového bodu. `submitBatch`
  (a `/v1/sales/batch` ve fázi 5) slouží k doposlání po výpadku a k migraci. První odeslání
  tržby starší než 5 minut dostane varování 1051 `LATE_FIRST_SUBMISSION` ([INGEST](INGEST.md)).
- ~~**OQ2 Výchozí `retryUncertain`**~~ **Rozhodnuto ve fázi 4:** `true`
  ([ADR-003](ADR-003-queue-retry-policy.md) bod 3; §11 pravidlo 6, §10). Nikdy ale po
  `signature` a `environment_mismatch`. Živě ověřeno: doposlání se ztracenou odpovědí dostane
  vlastní POK (§15).
- ~~**OQ3 Ověřování podpisu odpovědi**~~ **Vyřešeno ve fázi 2:** viz
  [ADR-002](ADR-002-response-trust.md). Pin vydávající CA I.CA, kontrola platnosti a subjektu
  GFŘ (`NTRCZ-72080043`), volitelně piny leafů; selhání ověření → `uncertain/signature`. Čtení
  X.509 řeší vlastní minimální čtečka DER. Na produkci zůstává neověřené (§15).
- ~~**OQ4 Offset `dat_trzby`**~~ **Hotovo ve fázi 3:** vstup se `Z` nebo cizím offsetem se převede
  do zóny pokladny jako stejný okamžik s varováním 1012 ([INGEST](INGEST.md)). Fronta (fáze 4)
  uloží výsledný řetězec a při opakování ho použije beze změny.
- ~~**OQ5 Chyba 8 „technická chyba nebo chyba dat“**~~ **Rozhodnuto ve fázi 4:** 3 pokusy
  s backoffem, potom `rejected` k ruční kontrole (`code8Attempts`,
  [ADR-003](ADR-003-queue-retry-policy.md) bod 5).
- ~~**OQ6 Diakritika v `id_pokl`/`porad_cis`**~~ **Hotovo ve fázi 3:** chyba `non_ascii`, nic se
  nepřepisuje ([INGEST](INGEST.md)).
- ~~**OQ8 Síťová dostupnost EET z místa nasazení**~~ **Rozhodnuto (uživatel, 25. 10. 2026):**
  stavíme knihovnu, kterou si kdokoli zabuduje do svého řešení. Kde poběží, rozhoduje
  integrátor. Knihovna mu dává `checkEndpoint()` z core (preflight `OPTIONS`, nic se neodesílá)
  a dokumentaci síťových požadavků (README). Od fáze 5 ji nabízí i `GET /health?eet=true`
  ([SERVER](SERVER.md)).
- **OQ7 npm scope (fáze 7).** Zatím `@eet-gateway/*` s `private: true`. Jméno a vlastnictví scope
  vyřešit před publikací.

## 15. Živé ověření na playgroundu

**25. 10. 2026, 17:30 SEČ.** Jedna vymyšlená tržba v ostrém módu (`overeni` neuvedeno) na
`https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4`, odeslaná se svolením uživatele
jednorázovým skriptem nad `@finitoapp/eet-client@0.4.0` se sdíleným testovacím certifikátem
`CZ00000019`. Na PG se nic neeviduje a POK tam neplatí (§3).

| Položka                        | Hodnota                                                                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Odesláno                       | `eic_popl=CZ00000019`, `id_jednotky=11`, `id_pokl=eet2-lib-probe`, `porad_cis=probe-1792945804148`, `dat_trzby=2026-10-25T17:30:04+01:00`, `celk_trzba=1.00`, `prvni_zaslani=true`, `uuid_zpravy=016baac6-a5d1-4a6b-b304-8910f1c89d89` |
| Velikost podepsaného požadavku | 3 879 B (limit 12 kB, §2)                                                                                                                                                                                                              |
| HTTP                           | 200, `Content-Type: text/xml; charset=UTF-8`, odezva asi 200 ms                                                                                                                                                                        |
| `X-Global-Transaction-Id`      | `bc626a986ade2e8c00fe06e3` (24 hex znaků)                                                                                                                                                                                              |
| Odpověď                        | `Potvrzeni pok="8b925c37-737a-4242-86a7-986a62bc0cc9-ff" test="true"`, `dat_prij` = náš `dat_odesl` s `+01:00`, žádné `Varovani`                                                                                                       |
| Hlavička odpovědi              | `wsse:Security` má `soapenv:mustUnderstand="1"`; parser odpovědi to musí snést                                                                                                                                                         |
| Podpis odpovědi                | jeden `BinarySecurityToken`; RSA-SHA256 podpis `SignedInfo` ověřen veřejným klíčem z tohoto certifikátu                                                                                                                                |

Shoduje se s Tabulkou 1 (R §2.2.2) i s formátem POK pro PG (R §3.4.2.3). Odpověď je bajtově
uložená v `test/fixtures/responses/pg-accepted-2026-10-25.xml` pro offline testy parseru
a verifieru.

**Podpisový certifikát odpovědí na PG:**

|                     | Leaf                                                                                                                                                                                                                                        | Vydavatel                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Subjekt             | `CN=NEOSTRE - playground prostredi EET, O=Generální finanční ředitelství, organizationIdentifier=NTRCZ-72080043, serialNumber=ICA - 1275853, C=CZ`                                                                                          | `CN=I.CA Public CA/RSA 06/2022, O=První certifikační autorita, a.s., organizationIdentifier=NTRCZ-26439395, C=CZ` |
| Vydal               | `I.CA Public CA/RSA 06/2022`                                                                                                                                                                                                                | `I.CA Root CA/RSA 05/2022`                                                                                        |
| Platnost            | 2026-06-08 14:06:44Z až **2027-06-08 14:06:41Z**                                                                                                                                                                                            | 2022-06-20 až 2032-06-17                                                                                          |
| SHA-256 certifikátu | `B810009EDEAF22F6004FB5951E4A10A17EE71E41AB207F912C086EF4CAFBF93B`                                                                                                                                                                          | `DF5BAF6D7E1A7D14E9911C5B8C676EC6EBCAD9354A74F4AC7314E133E07A94DE`                                                |
| SHA-256 SPKI        | `5ec0940f35be2f7c79100030ad381aa9cc20fc0558530f510be7b71a87596f16`                                                                                                                                                                          | —                                                                                                                 |
| Další               | KeyUsage `digitalSignature, nonRepudiation, keyEncipherment`; EKU `emailProtection, clientAuth`; politiky `1.3.6.1.4.1.23624.10.1.71.1.1`, `0.4.0.2042.1.1`; CRL `http://scrldp1.ica.cz/pca22_rsa.crl`; OCSP `http://ocsp.ica.cz/pca22_rsa` | stažen z AIA leafu `http://s.ica.cz/pca22_rsa.cer`; `openssl verify -partial_chain` leafu vůči němu: OK           |

Produkční podpisový certifikát zatím nemáme. Podle P §3.3 ho vydává tatáž I.CA, CN produkčního
leafu ale neznáme.

**Dostupnost playgroundu podle sítě (25. 10. 2026):**

| Odkud                                  | Výsledek                                                                                                                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Česká síť (vývojový počítač)           | `pg.trzbyeet.gov.cz` → `5.145.110.163`, TCP spojení za 57 ms, preflight `OPTIONS` vrátí 204; živé testy projdou (3/3)                                                                                                                                     |
| GitHub-hosted runner (`ubuntu-latest`) | DNS vrací `5.145.110.163` i `2a01:8b40:1000:d0::1:163` (`pg.eet.spcss.cz`). **IPv4: TCP spojení vyprší** (curl 28, 15 s), IPv6: runner nemá trasu. `eet.gov.cz` je ze stejného runneru dostupný (HTTP 200). Transport správně vrátil `uncertain/timeout`. |

Playground tedy nejspíš filtruje zdrojové IP adresy (cloud nebo zahraničí). Zdroje o tom nic
neříkají. **Důsledky:**

- Živé testy jsou nástroj správce knihovny. Běží lokálně (`bun run test:live`), případně na
  self-hosted runneru v síti, odkud je playground dostupný (proměnná repozitáře `LIVE_RUNNER`,
  viz `.github/workflows/live-playground.yml`).
- Jestli produkční `trzbyeet.gov.cz` filtruje zdrojové IP stejně, není známo. Integrátor si to
  ověří z cílového prostředí přes `checkEndpoint()` (OQ8).

**Doposlání po ztracené odpovědi (25. 10. 2026, fáze 4).** Živý test fronty
(`packages/queue/test/live`) poslal jednu vymyšlenou tržbu, která do PG skutečně došla
(`accepted`). Frontě ale ohlásil `uncertain/timeout`, tedy ztracenou odpověď podle M 1.3. Fronta
tržbu doposlala s novým `uuid_zpravy`, novým `dat_odesl`, `prvni_zaslani=false` a stejnými
`<Data>`. PG vrátil `Potvrzeni` s **jiným POK** (`103cfd5e-…-ff` pro první zprávu,
`ee4c7961-…-ff` pro doposlání). Potvrzuje to R §2.1 (každá přijatá zpráva má vlastní POK)
a podporuje výchozí `retryUncertain = true` (OQ2). Jestli server obě zprávy uvnitř přiřadí
k téže tržbě (R §4), z odpovědi zjistit nejde.
