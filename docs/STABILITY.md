# Stabilita a verzování

> **English:** this page says what you can rely on while the project is at version 0.x, what may
> still change, how deprecation works, and which runtimes are supported. In short: the HTTP API
> v1, warning and error codes and the `SaleResult` shape only grow and are never renumbered or
> removed; anything else may change in a 0.x minor release, and breaking changes are always
> marked in the commit and in the [CHANGELOG](../CHANGELOG.md).

Projekt je ve verzi 0.x (viz [README](../README.md#stav-a-omezení)). Verze 1.0 má kritéria v
[ROADMAP](../ROADMAP.md). Pravidla níže vycházejí z [CONTRIBUTING](../CONTRIBUTING.md)
(„Stabilní API“, „Commity a vydání“); co je tam výslovně uvedeno, je označeno jako **záruka**.
Ostatní řádky jsou **záměr**: snažíme se je držet, ale nejsou vynucené testem ani pravidlem v
CONTRIBUTING.

## Co je stabilní už teď

Platí pravidlo: **jen přibývá, nic se nepřečísluje ani nemaže.** Rozbíjející změna je v commitu
označená `!` nebo `BREAKING CHANGE:` a objeví se v CHANGELOGu.

| Oblast                                   | Co přesně                                                                                                                                                                                                                                                        | Úroveň                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **HTTP API v1**                          | Cesty pod `/v1`, jejich metody a parametry, stavové kódy `200`/`202`/`409`/`422`, tvar chyb `{ "error": { "code", "message" } }`, hlavičky `Idempotency-Key`, `Idempotent-Replayed`, `Location` ([SERVER](SERVER.md))                                            | **záruka** (CONTRIBUTING); shodu s [openapi.json](openapi.json) hlídá test |
| **Kódy varování a chyb**                 | Číselné kódy varování a jejich názvy a řetězcové kódy chyb (`required`, `idempotency_conflict`, `not_retryable`, …) z [INGEST](INGEST.md) a [QUEUE](QUEUE.md). Test `docs.test.ts` hlídá, že jsou v dokumentech všechny                                          | **záruka** (CONTRIBUTING)                                                  |
| **Tvar `SaleResult`**                    | Pole z [QUEUE](QUEUE.md#saleresult) a hodnoty `status`: `accepted`, `verification_ok`, `rejected`, `queued`, `uncertain`, `invalid`. Stejný tvar ve knihovně, HTTP API i CLI                                                                                     | **záruka** (CONTRIBUTING)                                                  |
| **Klíče konfigurace a proměnné `EET_*`** | Klíče v [SERVER](SERVER.md#konfigurace) a v [`eet.config.example.yaml`](../examples/eet.config.example.yaml), včetně pravidla, že heslo do konfigurace nepatří (`password` se odmítne). Neznámý klíč je chyba při startu, proto přejmenování by rozbilo nasazení | záměr: přejmenování a odstranění označíme `!` a uvedeme v CHANGELOGu       |
| **CLI příkazy a exit kódy**              | Příkazy z [CLI](CLI.md) a exit kódy `0`, `1`, `2`, `3`                                                                                                                                                                                                           | záměr                                                                      |
| **Pravidla doposílání**                  | Doposlání s novým `uuid_zpravy` a `prvni_zaslani=false` a stejnými `<Data>`; nikdy dvakrát jako první odeslání ([ADR-003](ADR-003-queue-retry-policy.md))                                                                                                        | záměr; změna pravidla by vyžadovala nový ADR                               |

Klienti by měli **snést nové hodnoty**: nové kódy varování a chyb, nové hodnoty `reason` a nová
pole v odpovědích mohou přibýt i v minor verzi a nepovažují se za rozbíjející změnu.

## Co se může změnit i v 0.x

Bez předchozí deprekace, v libovolné minor verzi (bude v CHANGELOGu, ale nemusí být `!`):

- **Veřejné TypeScript API balíčků** (`@eet-gateway/core`, `ingest`, `queue`, `server`, `cli`).
  Doporučený a zdokumentovaný povrch ([QUEUE](QUEUE.md), [INGEST](INGEST.md)) držíme, ostatní
  exporty a podpisy funkcí se mohou měnit. Zvlášť rozhraní `EetTransport` je určené pro výměnu
  implementace (ADR-001).
- **Rozhraní `QueueStore`** a **schéma tabulek SQLite** (`eet_sales`, `eet_attempts`,
  `eet_queue_meta`). Schéma má verzi, ale kompatibilita databáze mezi 0.x verzemi není
  zaručená. Před aktualizací si fronta zálohuj ([SECURITY](../SECURITY.md)).
- **Texty zpráv** (`message`, `warnings[].message`, hlášky chyb), **formát lidského výstupu CLI**
  a **text a pole logů**. Strojově čti kódy, ne texty.
- **Výchozí profil důvěry v odpověď** (vložené kotvy důvěry, očekávaný subjekt GFŘ). Produkční
  profil je zatím neověřený předpoklad ([ADR-002](ADR-002-response-trust.md)) a po ověření se
  může upravit.
- **Výchozí hodnoty** voleb fronty a časování (`retry`, `leaseMs`, …), pokud je změna zdůvodněná
  ADR.
- **Vnitřnosti Docker image** (základní obraz, rozložení souborů). Nezměníme `EXPOSE 8080`,
  svazek `/data`, cestu `/etc/eet/eet.config.yaml` ani uživatele `65532` bez poznámky v CHANGELOGu.
- **Přesná verze závislosti `@finitoapp/eet-client`** (připnutá, mění se přes PR s testy;
  [ADR-001](ADR-001-protocol-core.md)).
- **Chování vůči EET**, pokud ho změní Finanční správa (nová verze rozhraní, jiná pravidla).
  Zdrojem pravdy jsou oficiální dokumenty, ne tento projekt; změny hlídá `bun run spec:drift`.

## Verzování (semver)

Verzi drží `version.txt` a vydání vytváří release-please podle Conventional Commits
([CONTRIBUTING](../CONTRIBUTING.md#commity-a-vydání)).

| Změna                                        | Do 1.0 (0.x)                  | Od 1.0 (záměr)    |
| -------------------------------------------- | ----------------------------- | ----------------- |
| Rozbíjející změna (`!` / `BREAKING CHANGE:`) | minor (0.**N**.0)             | major (**N**.0.0) |
| Nová funkce (`feat`), nový kód, nové pole    | minor                         | minor             |
| Oprava (`fix`)                               | patch                         | patch             |
| Dokumentace, CI, testy                       | bez vlivu na verzi nebo patch | totéž             |

Platí jedna verze pro celý repozitář (balíčky, služba, binárky a `info.version` v
`openapi.json` mají stejné číslo). Balíčky nejsou na npm ([README](../README.md#balíčky)).

## Deprekace

Toto je pravidlo projektu, ne technický mechanismus:

1. **Oznámení.** Co se chystá odstranit nebo přejmenovat, se označí v dokumentaci jako
   zastaralé a zapíše do CHANGELOGu, spolu s náhradou.
2. **Souběh.** Zastaralá možnost funguje dál aspoň jednu minor verzi po oznámení, pokud to
   bezpečnost nebo shoda s EET nevylučují.
3. **Odstranění** přijde s `!` v commitu a poznámkou v CHANGELOGu. Do 1.0 může být v nejbližší
   minor verzi, od 1.0 jen v nové major verzi.
4. **Výjimky.** Bezpečnostní chyba nebo změna oficiální specifikace může vynutit rychlejší
   postup. Takovou změnu zdůvodníme v CHANGELOGu.
5. **Kódy se nemažou ani po deprekaci.** Zastaralý kód varování nebo chyby zůstává v
   dokumentaci označený jako zastaralý (pravidlo „nepřečíslovat, nemazat“).

## Podporované runtimy

| Runtime     | Verze                                                       | Co se v CI ověřuje                                                                                  |
| ----------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Node.js** | 22.18+ (CI: 22.18 a 24)                                     | Sestavená knihovna `core`, `ingest` a `queue` (job `core-compat`)                                   |
| **Bun**     | verze v [`.bun-version`](../.bun-version) (nyní 1.4.4)      | Všechny testy; služba, CLI a binárky běží v Bunu. Docker image vychází z `oven/bun` ve stejné verzi |
| **Deno**    | 2.x (CI: `v2.x`; fronta s `node:sqlite` vyžaduje Deno 2.2+) | Stejný job `core-compat` jako Node                                                                  |
- Jádro (`core`), ingest a fronta (`queue`) jsou runtime-neutrální: bez API Bunu a Node
  ([ADR-001](ADR-001-protocol-core.md) bod 8). `server` je Hono aplikace (`app.fetch`) bez API
  specifických pro Bun, v CI se ale na Node ani Deno nespouští.
- Binárky `eet` pro `linux-x64`, `linux-arm64`, `darwin-arm64` a `windows-x64` se testují při
  vydání ([CLI](CLI.md)). Binárka pro macOS není podepsaná.
- Úložiště SQLite vyžaduje SQLite 3.37+ ([QUEUE](QUEUE.md#úložiště)).
- Starší verze runtimů nepodporujeme. Zvýšení minimální verze runtimu je rozbíjející změna a
  dostane `!`.
- Bezpečnostní opravy vychází jen pro poslední vydání 0.x ([SECURITY](../SECURITY.md)).
