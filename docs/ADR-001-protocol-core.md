# ADR-001: Protokolové jádro nad `@finitoapp/eet-client` za rozhraním `EetTransport`

- **Stav:** přijato (fáze 1, 25. 10. 2026). Ve fázi 2 implementováno a ověřeno živě proti
  playgroundu (`packages/core/src/finito-transport.ts`). Odchylky od předběžného návrhu níže:
  - `TransportRequest.header` používá XSD názvy (`uuid_zpravy`, `dat_odesl`, `prvni_zaslani`,
    `overeni`), stejně jako `<Data>`;
  - výsledek `not_sent` má důvody `network` | `signer` | `too_large` | `aborted`;
  - výsledek `uncertain` má navíc důvody `aborted` a `environment_mismatch`
    (`packages/core/src/transport.ts`);
  - pro každé `send()` vzniká nová instance klienta, aby zachycená data jednoho požadavku
    nepřepsal souběžný požadavek;
  - ověřování odpovědi řeší [ADR-002](ADR-002-response-trust.md).
- **Rozsah:** `packages/core`. Politika fronty a opakování (`retryUncertain`) sem nepatří. Je
  odvozená v [SPEC_NOTES §11](SPEC_NOTES.md#11-pravidla-odesílání-a-opakování) a rozhodne se
  v samostatném ADR ve fázi 4.

## Kontext

Jádro sestaví datovou zprávu, podepíše ji, odešle a ověří odpověď. Podpis je WS-Security 1.1 +
XMLDSig, podepsaný je jen `soap:Body`, kanonizace Exclusive C14N 1.0, SHA-256 a RSA-SHA256
(SPEC_NOTES §2). Nejvíc chyb v takové implementaci obvykle vzniká v kanonizaci a jmenných
prostorech. Požadavky na jádro:

- TypeScript strict, běh pod Bunem, jádro musí fungovat i v Node 22+ a Deno;
- PKCS#12 s legacy šifrováním (RC2-40-CBC, 3DES), klíč importovaný jako non-extractable;
- klíč, hesla ani `SignatureValue` se nikdy nelogují; při `debug` se vrací raw request a response;
- rozlišit „určitě neodesláno“ od „odesláno, výsledek neznámý“ (`uncertain`);
- konfigurovatelné ověřování podpisu odpovědi. Podepisuje I.CA, ne CA EET (SPEC_NOTES §2, §12).

## Ověřené vlastnosti `@finitoapp/eet-client@0.4.0`

Z typových deklarací a README publikovaného balíčku (npm, `time.modified` 19. 10. 2026):

- MIT, **žádné runtime závislosti**, `zod ^4` jako volitelná peer dependency; ESM i CJS;
  `engines.node >= 22.18.0`. Nepoužívá importy `node:`; Node, Bun a Deno jsou v jeho CI.
- `createEetClient({ endpoint, signer, responseSignatureVerifier, fetch?, timeoutMs?, cryptoBackend? })`
  vrací klienta se `submit(data, { firstSubmission, verification?, uuid?, sentAt? })`, výsledkem je
  `Result<EetSubmitOutcome, EetError>`.
- Výsledek `submit()` je jeden z těchto tvarů:
  - `accepted { pok, uuid, receivedAt, test, warnings, httpStatus, globalTransactionId? }`
  - `verification { uuid?, test, warnings, … }`
  - `rejected { code, message, uuid?, rejectedAt?, test, warnings, … }`
- Typované chyby: `Validation`, `MessageTooLarge` (12 000 B), `Network`, `Timeout`, `Http`,
  `SoapFault`, `Xml`, `ResponseSchema`, `Signature`, `Signer`.
- Žádná fronta ani opakování (záměrně). Opakování je nové volání s novým `uuid` a
  `firstSubmission: false`.
- Adaptér `EetSigner` (`getCertificate()`, `sign(bytes)`) umožní non-extractable `CryptoKey`,
  HSM nebo KMS.
- `ResponseSignatureVerifier` je povinný; bez `verify() === true` nikdy nevrátí `accepted`.
  Součástí je helper pro pinning jednoho leaf certifikátu.
- `/pkcs12`: `parsePkcs12()` vrátí DER certifikáty a PKCS#8 klíč a zvládá legacy algoritmy.
- `/zod`: schémata `EetReceiptDataZodSchema` a `EetHeaderZodSchema` (zod v4); `/builtin`
  obsahuje validátory bez závislostí.
- Bezpečné parsování XML (bez DTD a entit) a omezená velikost těla odpovědi.
- Experimentální `/caeet-renewal` (obnova certifikátu) nepoužíváme, je mimo rozsah.

## Rozhodnutí

1. **Vlastní rozhraní `EetTransport` v `packages/core`.** Typy eet-clientu neprosakují do
   ingestu, fronty, serveru ani CLI. Předběžný tvar, finální podoba vznikne ve fázi 2:

   ```ts
   interface EetTransport {
     send(request: TransportRequest, options?: { signal?: AbortSignal }): Promise<TransportOutcome>;
   }
   interface TransportRequest {
     data: EetReceiptData;                // validated <Data>, byte-identical across attempts
     header: { uuid: string; sentAt: string; firstSubmission: boolean; verification: boolean };
   }
   type TransportOutcome =
     | { kind: "accepted"; pok: string; uuid: string; receivedAt: string; test: boolean; warnings: Warning[]; meta: Meta }
     | { kind: "verification_ok"; test: boolean; warnings: Warning[]; meta: Meta }
     | { kind: "rejected"; code: number; message: string; test: boolean; warnings: Warning[]; meta: Meta }
     | { kind: "not_sent"; reason: string; meta: Meta }   // connection never established
     | { kind: "uncertain"; reason: string; meta: Meta }; // may have reached EET, no trustworthy answer
   interface Meta { httpStatus?: number; globalTransactionId?: string; durationMs: number; rawRequest?: string; rawResponse?: string }
   ```

2. **První implementace `FinitoTransport` obaluje `createEetClient`.** Verze je připnutá přesně
   na `0.4.0`. Upgrade jde jen přes PR, ve kterém projdou kontraktní testy (XSD, vzorové
   zprávy) i živé testy proti playgroundu.
3. **`uuid_zpravy` a `dat_odesl` generuje volající** (fronta), ne knihovna. Musí být uložené
   dřív, než se odešlou (write-ahead, SPEC_NOTES §11).
4. **Vlastní obal nad `fetch`** předávaný do `createEetClient`:
   - zachytí raw request a response pro `debug`; `SignatureValue` se ve vráceném i logovaném
     výstupu nahradí `[redacted]`;
   - změří dobu trvání a převezme `X-Global-Transaction-Id`;
   - roztřídí síťové chyby. DNS a odmítnuté spojení před odesláním znamenají `not_sent`; vše
     ostatní po pokusu o spojení je `uncertain`. `fetch` neumí říct, zda bajty odešly, proto
     platí konzervativní výklad.
5. **Signer:** `createCryptoKeySigner` s klíčem z `/pkcs12`, importovaným přes
   `crypto.subtle.importKey(..., extractable: false, ["sign"])`. Raw bajty klíče se po importu
   zahodí.
6. **Ověřování podpisu odpovědi:** vlastní `ResponseSignatureVerifier`. V konfiguraci je seznam
   SHA-256 pinů leaf certifikátu, volitelně pin vydávající CA I.CA. Výchozí piny pro playground
   převezmeme z reálné podepsané odpovědi ve fázi 2. Chování při selhání ověření: SPEC_NOTES §7
   a OQ3.
7. **Pojistky prostředí:** prostředí se rozpozná podle řetězce vydavatele pokladního
   certifikátu, ne podle OID politiky (dokumentované OID PG neodpovídá realitě, SPEC_NOTES §13
   bod 11). Certifikát z PG řetězce se nesmí použít na produkční endpoint. Odpověď s
   `test="true"` nebo POK `-ff` z produkčního endpointu je chyba konfigurace.
8. **Jádro a ingest jsou runtime-neutrální:** žádné API Bunu ani Node, `tsconfig` s `types: []`.
   Ověřuje to CI job `core-compat` na Node 22.18, Node 24 a Deno 2.

## Kdy napsat vlastní implementaci podpisu a C14N

Přecházíme, pokud nastane aspoň jedno z následujícího. Rozhodnutí se zapíše jako nové ADR.

- Blokující chyba, kterou nejde obejít adaptéry (`fetch`, signer, verifier) a upstream ji
  neopraví v rozumné době (orientačně do 14 dnů od nahlášení).
- Bezpečnostní problém v knihovně bez rychlé opravy.
- Změna licence nebo opuštění projektu.
- Potřeba, kterou adaptéry nepokryjí, například jiný podpisový profil v budoucí hlavní verzi
  rozhraní (`/v5`).

Rozhraní `EetTransport` spolu s kontraktními testy a živými testy proti PG drží takovou výměnu
uvnitř `packages/core`.

## Důsledky

- **Výhody:** fáze 2 stojí na implementaci ověřené proti playgroundu. Nepíšeme vlastní C14N.
  Strom závislostí zůstává malý.
- **Nevýhody:**
  - Závisíme na knihovně ve verzi 0.x s jediným správcem. Mitigace: přesný pin, review diffu
    při upgradu, vlastní kontraktní testy.
  - Klasifikace síťových chyb je heuristická (bod 4), proto konzervativně `uncertain`.
  - Minimální verze Node je 22.18.
- `rawRequest` a `rawResponse` nejsou součástí API knihovny. Získáváme je výhradně přes vlastní
  `fetch`, takže redakci řídíme sami.

## Zvážené a zamítnuté alternativy

- **Vlastní XMLDSig/C14N hned:** vysoké riziko chyb a žádná výhoda, dokud nenarazíme na limit
  knihovny.
- **`xml-crypto` + `@xmldom/xmldom`:** Node crypto a další závislosti narušují runtime-neutrální
  jádro. Navíc by stejně chyběl parser legacy PKCS#12.
- **Volat OpenSSL (`-legacy`) přes CLI kvůli PKCS#12:** systémová závislost a horší přenositelnost
  (Windows, distroless image, `bun build --compile`).
