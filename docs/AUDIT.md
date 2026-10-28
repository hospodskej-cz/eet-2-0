# Zadání bezpečnostní revize a výsledky interní revize

> **Status: žádný nezávislý audit zatím neproběhl.** Tento dokument je podklad pro externího
> recenzenta a záznam interní revize. Interní revize je práce autorů kódu (s pomocí AI asistenta),
> ne audit, a nenahrazuje ho.

> **English summary.** Scoping document for an external security reviewer of the EET 2.0
> gateway. Scope: `packages/core` (about 1 670 lines of TypeScript): hand-written DER/X.509
> reader, response-signature trust policy, transport. Focus: can a forged or replayed EET
> response ever be returned as `accepted`, and can a hostile response lose or duplicate a sale.
> An internal adversarial review on 28 Oct 2026 found and fixed 13 findings (12 defects and one hardening; none of them a way
> to forge `accepted` as the code was configured by default; the worst allowed an unsigned
> "verification OK" answer to close a live sale without a POK, and an oversized response to
> make the queue drop a sale). It did **not** cover the queue, server, CLI, ingest, Docker
> image or the third-party library in depth, and no independent party has looked at any of it.
> Build and test: `bun install --frozen-lockfile && bun run certs:playground && bun run check`.

## 1. Co se revidovalo a co zbývá

**Rozsah (doporučený pro externí revizi), řádků TypeScriptu k 28. 10. 2026:**

| Soubor (`packages/core/src/`) | Řádků | Co v něm je                                                                                       |
| ----------------------------- | ----: | ------------------------------------------------------------------------------------------------- |
| `der.ts`                      |   202 | čtečka ASN.1 DER: délky, OID, časy, řetězce                                                       |
| `x509.ts`                     |   207 | certifikát, jména, ověření podpisu vydavatelem, kontrola použití podpisového certifikátu          |
| `response-trust.ts`           |   189 | politika důvěry v potvrzení, `createResponseVerifier`                                             |
| `certificate.ts`              |   120 | načtení `.p12`, nevyexportovatelný klíč, určení prostředí                                         |
| `finito-transport.ts`         |   456 | transport: kontrola prostředí a endpointu, redakce, mapování výsledků a chyb                      |
| `transport.ts`, `bytes.ts`, `trust-anchors.ts` | 167 | typy výsledku, bajtové pomocné funkce, vložené certifikáty CA (generované ze `spec/ca/`) |
| `schema.ts`, `datetime.ts`, `check-endpoint.ts`, `sale-key.ts`, `constants.ts`, `index.ts` | 331 | validace vstupu, čas, dosažitelnost; méně citlivé |

Celkem 1 672 řádků ve zdroji `packages/core`. K tomu patří testy (`packages/core/test/`, asi
2 000 řádků) a rozhodnutí v [ADR-001](ADR-001-protocol-core.md), [ADR-002](ADR-002-response-trust.md),
[ADR-004](ADR-004-transport-dependency.md), [SPEC_NOTES](SPEC_NOTES.md), [SECURITY](../SECURITY.md)
a [THREAT_MODEL](THREAT_MODEL.md).

**Mimo `packages/core`, ale bezpečnostně relevantní (neprošlo touto interní revizí):**
`packages/server` (autentizace API klíčem, limity těl, ~1 900 řádků), `packages/queue` (stavy,
doposílání, SQLite, ~2 000), `packages/ingest` (CSV/XML/JSON, odmítnutí `DOCTYPE`, ~1 400),
`packages/cli` (~770), `Dockerfile`, workflow v `.github/`, skripty sestavení binárek.

**Cizí kód, na kterém jádro stojí:** `@finitoapp/eet-client@0.4.0` (parser XML, C14N, kontrola
digestu, PKCS#12). Čteno jen v částech používaných při odpovědi, viz [ADR-004](ADR-004-transport-dependency.md).

## 2. Na co se zaměřit

Pořadí podle dopadu:

1. **Může se falešná nebo přehraná odpověď vrátit jako `accepted`?** Cesta:
   `finito-transport.ts` → `client.submit` → `verifyAcceptedSignature` (knihovna) →
   `createResponseVerifier`. Zkontrolujte kanonizaci, to, co se podepisuje, a zda se z těla
   čte totéž, co se hashuje. Zkuste obejít `uuid_zpravy`, `test`/`-ff` a kontrolu prostředí.
2. **Politika důvěry** (ADR-002): pin vydávající CA + subjekt GFŘ + použití klíče. Je to
   dostatečné proti jinému zákazníkovi I.CA a proti jinému certifikátu GFŘ? Je akceptovatelné,
   že se neověřuje revokace?
3. **Čtečka DER/X.509**: je opravdu „fail-closed“ na každém nedůvěryhodném vstupu? Rozdíly mezi
   tím, co čteme my, a tím, co podepsala CA (jména, OID, časy, duplicity).
4. **Klasifikace výsledků a ztráta tržby**: kdy se z `uncertain` stane konečný stav a kdy
   se doposílá (ADR-003). Chyby v mapování výsledku znamenají zákonnou chybu, ne jen pád.
5. **Práce s klíčem a hesly**: `loadPkcs12`, vstup hesla, chybové hlášky, logy.
6. **Dodavatelský řetězec**: pin a integrita, připnuté akce, plán forku.
7. Potom server, fronta, ingest, image a CI (mimo interní revizi).

Otázky, na které hledáme názor:

- Je rozhodnutí neověřovat CRL/OCSP (ADR-002 bod 4) obhajitelné, nebo patří do první verze?
- Je „pin vydávající CA + subjekt“ přijatelná náhrada plné cesty?
- Je správné, že chybové odpovědi bez podpisu rozhodují o konečném stavu `rejected`?
- Má smysl připnutí TLS certifikátu endpointu EET?

## 3. Jak sestavit a spustit

```sh
bun install --frozen-lockfile          # Bun z .bun-version
bun run certs:playground               # sdílené testovací certifikáty GFŘ do .cache/ (SHA-256 ověřen)
bun run check                          # biome + tsc + všechny offline testy
bun test packages/core                 # jen jádro
bun run test:live                      # živé testy; jen z české sítě (docs/live-testing.md)
bun run compat:node                    # jádro v Node (CI i v Deno)
```

Potřebné nástroje: `xmllint` (kontraktní testy XSD), `unzip` (certifikáty). Bez nich část testů
selže pro prostředí, ne pro kód (viz „Stav testů“ níže).

Užitečné vstupy: `test/fixtures/responses/pg-accepted-2026-10-25.xml` (skutečná podepsaná
odpověď PG), `spec/ca/` (kotvy), `spec/eet-v4.1/samples/` (vzorové požadavky se skutečným
pokladním certifikátem PG).

Testy interní revize jsou soběstačné (nepotřebují síť ani sdílené `.p12`):
`der.test.ts`, `der-fuzz.test.ts`, `trust-hardening.test.ts`, `transport-hardening.test.ts`,
pomocník `der-builder.ts` (stavba vlastních CA a listů). Fuzz testy jsou deterministické
(semínka 7, 42, 43, 1000 až 1003); selhání lze zopakovat se stejným indexem.

## 4. Známá omezení

- Revokace (CRL/OCSP) se neověřuje. Důvěra je pin vydávající CA, ne plná cesta (ADR-002).
- Chybové odpovědi EET jsou nepodepsané; ochranou je TLS (viz [THREAT_MODEL](THREAT_MODEL.md) R2).
- Produkční podpisový profil GFŘ je předpoklad (stejná CA a subjekt jako PG), neověřený.
- Platnost certifikátů se počítá z lokálního času.
- Bajty soukromého klíče se po importu nenulují (JavaScript to nezaručí).
- Čtečka DER toleruje neminimální délky; při duplicitním atributu jména bere poslední.
- `leafPins: []` nepinuje nic.
- Podpis, C14N a PKCS#12 dělá knihovna třetí strany s jediným správcem ([ADR-004](ADR-004-transport-dependency.md)).
- Žádné měření pokrytí testy, žádné dlouhodobé fuzzování (jen deterministické mutace v testech).

## 5. Výsledky interní revize (28. 10. 2026)

Metoda: čtení zdroje jádra a relevantních částí knihovny, útočné scénáře (hostile certifikáty,
podvržené odpovědi, wrapping, přehrání, nepřátelská těla), u každé skutečné vady **nejdřív
selhávající test, potom minimální oprava**. Veřejné API ani stabilní kódy chyb a varování se
nezměnily.

### Nalezeno a opraveno

| #   | Vada                                                                                                                                                                                                                                      | Závažnost (naše hodnocení)                                              | Commit    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------- |
| F1  | `ResponseTrust` bez `subjectOrganizationIdentifier` porovnával `undefined !== undefined` a důvěřoval **každému** listu pinnuté CA bez toho atributu. Nedosažitelné přes konfiguraci serveru ani CLI (ty `responseTrust` neposkytují), jen přes API jádra z netypovaného kódu. | střední (špatná konfigurace otevře důvěru všem zákazníkům I.CA)         | `fd80720` |
| F2  | Nepodepsané „kód 0“ ověřovacího módu se vrátilo jako `verification_ok` i pro **ostrou** tržbu. `verification_ok` je konečný stav bez POK a bez opakování: tržba by se tiše nezaevidovala. Vyvolá to proxy, útočník na TLS nebo chyba serveru. | vysoký dopad, vyžaduje narušení TLS nebo chybu serveru                  | `1d26134` |
| F3  | Chybová odpověď s `uuid_zpravy` jiného požadavku se brala jako verdikt o této tržbě (`rejected`).                                                                                                                                              | nízká až střední                                                        | `1d26134` |
| F4  | Příliš velká **odpověď** (nad 1 MB) se mapovala na `not_sent/too_large`, přestože požadavek už odešel. Fronta ji uzavře jako `invalid`: tržbu zahodí, ačkoli ji EET mohl zaevidovat. Vyvolá to škodlivý endpoint nebo vadná proxy. | střední                                                                 | `1d26134` |
| F5  | Podpisovým certifikátem odpovědi mohl být CA certifikát nebo klíč určený jen k šifrování, pokud ho pinnutá CA vydala subjektu GFŘ. Nyní se kontroluje `basicConstraints` a `keyUsage` (skutečný podpisový certifikát PG má `CA:FALSE`, `digitalSignature, nonRepudiation`). | nízká (obrana do hloubky)                                               | `fd80720` |
| F6  | `decodeOid` přijímal nezakončené poslední číslo (`55 04 83` se četlo jako `2.5.4`), neminimální kódování (`80 55 04 03` splývalo s `2.5.4.3`) a čísla nad 2^53.                                                                                  | nízká (čtečka nerozhoduje o důvěře samotná, ale zbytečně vyrábí aliasy) | `fd80720` |
| F7  | `decodeTime` přes `Date.UTC` bez kontroly rozsahu: měsíc 13 přetekl na další rok, 30. únor na březen, GeneralizedTime s rokem pod 100 se četl jako 19xx. Datum platnosti mohlo „vypadat“ jinak než v certifikátu.                                  | nízká (datum podepsala CA)                                              | `fd80720` |
| F8  | `decodeString`: neplatné UTF-8 vyhodilo `TypeError` místo `DerError` (kontrakt `parseCertificate`), liché BMPString tiše zahodilo koncový bajt, PrintableString a IA5String přijímaly 8bitové znaky, rozbalení pole bajtů přetéká zásobník na velkých vstupech. Nalezeno fuzzováním. | nízká                                                                   | `fd80720` |
| F9  | `parseCertificate` nevyžadoval shodu algoritmu uvnitř TBS a vně (RFC 5280 4.1.1.2) a přijal prázdné sériové číslo.                                                                                                                               | nízká                                                                   | `fd80720` |
| F10 | `fetch` následoval přesměrování: podepsanou zprávu by znovu odeslal na jinou adresu (i http).                                                                                                                                                  | nízká                                                                   | `1d26134` |
| F11 | Endpoint mohl být prostý `http://`. Server to už odmítá, ale API jádra ne.                                                                                                                                                                    | nízká                                                                   | `1d26134` |
| F12 | Ladicí režim: zachycení odpovědi bylo neomezené a redakce `SignatureValue` kvadratická (800 kB neukončených značek trvalo desítky sekund; změřeno 38 až 52 s).                                                                                | nízká (jen `debug`)                                                     | `1d26134` |
| F13 | Verifier spoléhal jen na knihovnu, že hash těla odpovídá `DigestValue`. Doplněná druhá kontrola (digest a algoritmy), aby případná chyba knihovny nešla zneužít k podstrčení těla pod pravý podpis `SignedInfo`. Na knihovně jsem chybu nenašel. | obrana do hloubky                                                       | `fd80720` |

### Prověřeno a bez nálezu

- **Signature wrapping**: osm variant (druhé tělo před i za podepsaným, kopie `wsu:Id`, tělo
  schované do hlavičky, druhá `Odpoved` v těle, chybějící podpis, prázdná `SignatureValue`,
  zlomená hodnota, záměna certifikátu) nikdy nevedou k `accepted`.
- **Zlehčení algoritmu** (SHA-1, RSA-SHA1) knihovna odmítá před ověřením.
- **Přehrání pravé odpovědi pro jiné `uuid_zpravy`**: odmítne knihovna; máme regresní test.
- **Odpověď prostředí PG z produkčního endpointu**: `environment_mismatch`.
- **DoS těly odpovědí**: 130 000 vnořených prvků, 80 000 atributů, DOCTYPE/entity, miliardový
  smích, neplatné UTF-8, 500 kB `faultstring`: vždy `uncertain`, do sekund.
- **Čtečka DER**: žádná rekurze, 20 000 vnořených SEQUENCE i 300 000 prázdných potomků zvládne
  lineárně, délka 4 GiB se odmítne bez alokace. 1 500 seedovaných mutací na každý ze 4
  skutečných certifikátů: vždy `DerError`; pokud se změněný certifikát přečte a změnila se
  podepsaná část, ověření podpisu vydavatelem selže.

### Nalezeno, neopraveno (hlášeno)

| #   | Nález                                                                                                                              | Důvod                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| N1  | Revokace se neověřuje                                                                                                              | rozhodnutí ADR-002; viz R1 v modelu hrozeb                                                       |
| N2  | `leafPins: []` je „bez pinu“                                                                                                       | oprava by změnila chování API (`ResponseTrust`)                                                  |
| N3  | Binárky a Docker image obsahují MIT kód `@finitoapp/eet-client` a `zod` bez oznámení třetích stran (`THIRD_PARTY_NOTICES` neexistuje) | soubory mimo rozsah revize: `scripts/build-binaries.ts`, `Dockerfile`, `release.yml`             |
| N4  | Žádná konfigurace `dependabot.yml`; sledování knihovny je ruční                                                                    | mimo rozsah; návrh v ADR-004                                                                     |
| N5  | `CONTRIBUTING.md` a `SPEC_NOTES.md` §15 odkazují na proměnnou `LIVE_RUNNER`; workflow nyní používá štítek `eet-playground` a `LIVE_PLAYGROUND_ENABLED` | soubory mimo rozsah; vyžaduje sjednocení textu                                                   |
| N6  | Knihovna: XML parser bez limitu hloubky, C14N bez instrukcí zpracování a `xml:*` dědičnosti                                        | dopad neprokázán; viz ADR-004                                                                    |

### Co interní revize nepokryla

- `packages/server`, `queue`, `ingest`, `cli`, Docker image, binárky, `.github/workflows/*`
  kromě `live-playground.yml`.
- Správnost podpisu **požadavku** (XMLDSig z naší strany) mimo to, co ověřuje živý playground.
- Samotná knihovna `@finitoapp/eet-client`: čteno jen odpovědní větve, ne celý balíček
  (PKCS#12 včetně RC2/3DES se nečetlo vůbec). Podpis Sigstore provenance jsem neověřoval.
- Chování v Node a Deno (revize běžela v Bunu 1.4.4; kompatibilitu hlídá CI).
- Zpracování reálné **produkční** odpovědi (nemáme ji).
- Dlouhodobé fuzzování, měření pokrytí, statická analýza nástroji, formální ověření.
- Časové a postranní kanály.
- Workflow `live-playground.yml` se nespustil na skutečném runneru.

### Stav testů při revizi

`bun test packages/core`: 105 testů z nových souborů prochází. V celé sadě jádra prochází 161
testů a 20 selhává; všech 20 selhání je **prostředí, ne kód**: 12 testů `isEetDateTime`
potřebuje `xmllint`, zbytek (`loadPkcs12`, `detectEnvironment`, `transport.test.ts`) potřebuje
`bun run certs:playground`. V CI se obojí instaluje. `bun run typecheck` zelený, `biome ci
packages/core` zelený. Zbylé balíčky (`queue`, `server`, `cli`, `ingest`) mají na tomto stroji
další selhání z téhož důvodu (chybějící certifikáty), nezkoumané.
