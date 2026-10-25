# ADR-002: Důvěra v podpis potvrzení EET a čtení X.509 v jádře

- **Stav:** přijato (fáze 2, 25. 10. 2026). Ověřeno na playgroundu, na produkci zatím ne.
- **Rozsah:** `packages/core/src/response-trust.ts`, `x509.ts`, `der.ts`, `certificate.ts`,
  `trust-anchors.ts`. Řeší OQ3 ze [SPEC_NOTES](SPEC_NOTES.md#14-otevřené-otázky).

## Kontext

- Potvrzení s POK je podepsané, chybové odpovědi ne (R §3.2). `@finitoapp/eet-client`
  zkontroluje algoritmy a otisk `soap:Body`. Rozhodnutí, zda podpisovému certifikátu věřit,
  nechává na povinném adaptéru `ResponseSignatureVerifier` (ADR-001).
- Na playgroundu podepisuje `CN=NEOSTRE - playground prostredi EET`,
  `O=Generální finanční ředitelství`, `organizationIdentifier=NTRCZ-72080043`. Vydala ho
  `I.CA Public CA/RSA 06/2022` (podpis SHA-512) a **platí jen do 2027-06-08** (SPEC_NOTES §15).
  Podle P §3.3 vydává produkční podpisový certifikát tatáž CA.
- Helper z eet-clientu umí jen pin jednoho leaf certifikátu. Takový pin by po roční výměně
  certifikátu odmítal všechna potvrzení všem instalacím, dokud by někdo ručně nezměnil
  konfiguraci.
- Z pokladního certifikátu potřebujeme EIČ (CN), platnost a vydavatele: kvůli pojistce
  prostředí a varování před expirací. OID politiky k rozlišení prostředí použít nejde,
  protože dokumentované OID PG neodpovídá skutečným certifikátům (SPEC_NOTES §13 bod 11).
- Jádro musí zůstat runtime-neutrální (Node 22+, Bun, Deno; ADR-001 bod 8).

## Rozhodnutí

1. **Výchozí důvěra v potvrzení** (`playgroundResponseTrust()`, `productionResponseTrust()`).
   Potvrzení se přijme, jen když platí všechno:
   - leaf certifikát z `BinarySecurityToken` je podepsaný **pinovanou vydávající CA**. Jméno
     vydavatele se musí shodovat v DER přesně a podpis RSA PKCS#1 v1.5 (SHA-256/384/512) se musí
     ověřit veřejným klíčem CA. Výchozí pin je vložený certifikát `I.CA Public CA/RSA 06/2022`
     (SHA-256 `df5baf6d…07a94de`, platnost do 2032-06-17);
   - leaf je v okamžiku ověření platný;
   - subjekt leafu má `organizationIdentifier = NTRCZ-72080043` (GFŘ);
   - `SignedInfo` je platně podepsané (RSA-SHA256) klíčem leafu.
2. **Volitelně přísněji:** `leafPins` (SHA-256 otisky leaf certifikátů) se kontrolují _navíc_.
   Konfigurace přes `responseTrustFrom({ issuers, subjectOrganizationIdentifier, leafPins })`
   přijímá CA certifikáty v PEM i DER.
3. **Když ověření selže**, výsledek je `uncertain/signature` s konkrétním důvodem a nikdy ne
   `accepted`. Transport neopakuje; o dalším postupu rozhodne fronta (fáze 4). Server tržbu
   nejspíš zapsal, ale jeho odpověď neumíme potvrdit.
4. **Revokaci (CRL/OCSP I.CA) zatím neověřujeme.** Šlo by o síťovou závislost v cestě každé
   tržby. Identitu serveru navíc chrání povinné HTTPS s EV certifikátem (R §5.1, PG/P §3.2).
   Přehodnotí se, pokud to bude požadovat zdroj nebo bezpečnostní posouzení.
5. **Prostředí pokladního certifikátu** se určuje ověřením jeho podpisu klíčem PG, resp.
   produkční SubCA CA EET (vložené kotvy), ne podle OID. `createEetTransport` odmítne PG
   certifikát pro produkci a naopak. Certifikát od neznámé CA přijme jen s
   `allowUnknownCertificateIssuer`, což je pro případ budoucí výměny SubCA.
6. **Vlastní minimální čtečka DER/X.509** (`der.ts` + `x509.ts`, asi 300 řádků, jen čtení, bez
   závislostí, bez obecného sestavování cest). Testy ji porovnávají s výstupem `openssl x509`
   na 7 skutečných certifikátech.
7. **Kotvy důvěry** (4 certifikáty CA EET a 1 I.CA) jsou bajtově uložené ve `spec/ca/` s hashi
   v `docs/sources/sources.json`. Do jádra je jako base64 konstanty dostane
   `bun run gen:trust-anchors`. Test selže, pokud se generovaný soubor rozejde se `spec/ca/`, a
   týdenní kontrola změn zdrojů hlídá i URL I.CA.

## Zvážené a zamítnuté alternativy

- **Pin samotného leaf certifikátu (helper eet-clientu):** rozbil by se 2027-06-08.
- **Plné ověření cesty až ke kořenu I.CA, včetně revokace:** kořen I.CA není součástí žádného
  dokumentu EET, přidalo by to síťovou závislost a nic nezíská proti pinu vydávající CA
  s kontrolou subjektu.
- **`@peculiar/x509` 2.2.0:** 12 závislostí včetně `tsyringe`, které potřebuje
  `reflect-metadata`.
- **`pkijs` 4.0.0:** 3 závislosti, asi 0,9 MB. Na čtení pár polí je to zbytečně velká plocha.
- **`node:crypto` `X509Certificate`:** porušilo by runtime-neutrální jádro.

## Důsledky

- Běžná roční výměna podpisového certifikátu GFŘ projde bez zásahu, pokud zůstane stejná CA
  i subjekt.
- **Produkční profil je zatím neověřený předpoklad.** Pokud bude mít produkční podpisový
  certifikát jiného vydavatele nebo `organizationIdentifier`, všechna produkční potvrzení skončí
  jako `uncertain/signature`. Selže to bezpečně: nikdy nevznikne falešné `accepted`. Při první
  produkční odpovědi se to musí ověřit, zapsat do SPEC_NOTES §15 a případně upravit výchozí
  profil.
- Kdy rozhodnutí přehodnotit: GFŘ změní CA (změna P §3.3 zachycená kontrolou změn zdrojů),
  blíží se expirace I.CA CA (2032-06-17), nebo se poprvé ověří produkce.
