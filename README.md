**Česky** | [English](README.en.md)

# EET Gateway

[![CI](https://github.com/hospodskej-cz/eet-2-0/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hospodskej-cz/eet-2-0/actions/workflows/ci.yml)
[![Poslední vydání](https://img.shields.io/github/v/release/hospodskej-cz/eet-2-0)](https://github.com/hospodskej-cz/eet-2-0/releases)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)
[![EET playground: ověřeno 2026-10-25](https://img.shields.io/badge/EET%20playground-ov%C4%9B%C5%99eno%202026--10--25-brightgreen)](docs/SPEC_NOTES.md#15-živé-ověření-na-playgroundu)
[![EET produkce: zatím neověřeno](https://img.shields.io/badge/EET%20produkce-zat%C3%ADm%20neov%C4%9B%C5%99eno-orange)](ROADMAP.md)

> **Neoficiální projekt, bez záruky.** Nejde o produkt ani schválený software Finanční správy ČR.
> Software je poskytován „tak, jak je“. Certifikaci, registraci pokladny a soulad se zákonem o evidenci
> tržeb si zajišťuje a za ně odpovídá každý provozovatel sám. Viz [Disclaimer](#disclaimer).

Open-source (MIT) brána pro odesílání tržeb do **EET 2.0** (Finanční správa ČR, SOAP rozhraní
4.1, běžný provoz od 1. 1. 2027). Tržbu přijme v jakémkoli běžném formátu, převede ji na platnou
datovou zprávu, podepíše, odešle a vrátí jednotnou odpověď. Každou tržbu nejdřív uloží, takže
výpadek sítě ani pád procesu nic neztratí. Po výpadku tržby bezpečně doposílá.

Jak ji zapojit do vlastního softwaru:

- **HTTP služba** (Docker, samostatná binárka) s OpenAPI 3.1 pro PHP, Python, .NET, Javu a cokoli
  dalšího;
- **CLI** `eet` pro soubory, skripty a správu fronty;
- **TypeScript knihovna** pro Node.js 22.18+, Bun a Deno.

> **Stav:** verze 0.x. Odesílání, ověření podpisu, fronta i doposílání jsou ověřené živě proti
> playgroundu EET, **proti produkci zatím ne**, a kód zatím neprošel externím bezpečnostním
> auditem. API se může do 1.0 měnit (semver 0.x, viz [CHANGELOG](CHANGELOG.md) a
> [STABILITY](docs/STABILITY.md)). Podrobně v sekci [Stav a omezení](#stav-a-omezení).
> Plán k 1.0: [ROADMAP](ROADMAP.md).

## Rychlý start za 60 sekund

Docker a curl proti **playgroundu EET** (nic se neeviduje, POK je testovací). Potřebuješ Git,
Docker, [Bun](https://bun.sh) a `unzip`; Bun a `unzip` jen na stažení sdílených testovacích
certifikátů GFŘ (ověřené SHA-256).

```sh
git clone https://github.com/hospodskej-cz/eet-2-0 && cd eet-2-0
bun install && bun run certs:playground      # testovací certifikáty → .cache/playground/

# konfigurace: jedna pokladna s testovacím certifikátem CZ00000019
mkdir certs
cp .cache/playground/CA_EET-Playground-CZ00000019.p12 certs/kasa.p12
cp .cache/playground/password_pokladni_cert_playground.txt certs/kasa.password
cat > eet.config.yaml <<'YAML'
registers:
  kasa-1:
    environment: playground
    certificates: [{ p12: /certs/kasa.p12, passwordFile: /certs/kasa.password }]
    defaults: { id_jednotky: 11, id_pokl: KASA-1 }
YAML
chmod -R a+rX certs eet.config.yaml          # služba běží jako uživatel 65532

docker build -t eet-gateway .
docker run -d -p 8080:8080 -e EET_API_KEYS=dlouhy-tajny-klic-123 \
  -v "$PWD/eet.config.yaml:/etc/eet/eet.config.yaml:ro" -v "$PWD/certs:/certs:ro" \
  -v eet-data:/data eet-gateway

# 1) jen kontrola vstupu, nic se neodešle
curl -H "Authorization: Bearer dlouhy-tajny-klic-123" -H "Content-Type: application/json" \
  -d '{"porad_cis":"2026/0001","dat_trzby":"2026-11-15T11:58:00+01:00","celk_trzba":"250,00"}' \
  localhost:8080/v1/validate

# 2) skutečné odeslání na playground
curl -H "Authorization: Bearer dlouhy-tajny-klic-123" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 2026/0001" \
  -d '{"porad_cis":"2026/0001","dat_trzby":"2026-11-15T11:58:00+01:00","celk_trzba":"250,00"}' \
  localhost:8080/v1/sales
# → 200 {"status":"accepted","pok":"…", "warnings":[…], …}
```

Krok 2 potřebuje spojení na playground, který přijímá spojení jen z některých sítí
(z české sítě ano, z cloudových runnerů ne, viz [Síť](#síť)). Když se spojení nepovede, tržba
zůstane ve frontě (`202`, `queued` nebo `uncertain`) a služba ji doposílá. Bez certifikátu
a bez sítě můžeš vyzkoušet příklady nad falešným EET ([examples/](examples/README.md)).

## Co umí

- **Vstup v libovolném tvaru:** JSON, NDJSON, CSV (UTF-8 i Windows-1250, `,` i `;`), XML
  (`<Data>` i celé `<Trzba>`), formulář, JS objekt. Částky s českou čárkou, data s offsetem
  i bez něj (letní čas), epoch, `dd.mm.yyyy`. Každá úprava vstupu se vrací jako varování, nic
  se neděje potichu ([INGEST](docs/INGEST.md)).
- **Bezpečné doposílání:**
  - každá tržba se nejdřív uloží (SQLite, nebo vlastní úložiště);
  - po timeoutu, výpadku nebo pádu procesu se doposílá s novým `uuid_zpravy`
    a `prvni_zaslani=false`, ale se stejnými `<Data>`;
  - tatáž tržba nikdy nejde dvakrát jako první odeslání;
  - hlídá se lhůta 48 h (ZoET §20);
  - pravidla a jejich zdůvodnění popisuje [ADR-003](docs/ADR-003-queue-retry-policy.md).
- **Idempotence:** opakované volání se stejným `Idempotency-Key`, nebo prostě stejná tržba,
  vrátí uložený výsledek a nic znovu neodešle.
- **Více pokladen a certifikátů v jedné instanci.**
  - Každá pokladna má vlastní `.p12`, včetně starého šifrování testovacích certifikátů.
  - Během obnovy certifikátu podepisuje ten, který je zrovna platný.
  - Na konec platnosti služba upozorní 21 dní předem.
- **Ověření odpovědi:** podpis potvrzení se ověřuje proti CA I.CA a subjektu GFŘ. Nedůvěryhodná
  odpověď nikdy neskončí jako `accepted` ([ADR-002](docs/ADR-002-response-trust.md)).
- **Bezpečnost:**
  - privátní klíč je v paměti jako nevyexportovatelný (`non-extractable`);
  - hesla k certifikátům nejsou v konfiguraci;
  - logy neobsahují klíče, hesla ani podpisy;
  - API vyžaduje klíč;
  - Docker image běží bez roota.

  Podrobnosti v [SECURITY](SECURITY.md).

## Další způsoby použití

### HTTP služba

Konfigurace podle [`examples/eet.config.example.yaml`](examples/eet.config.example.yaml)
(pokladny, certifikáty, výchozí `id_jednotky`/`id_pokl`); hesla k `.p12` patří do souboru nebo do
proměnné prostředí, ne do konfigurace. Postup krok za krokem je v
[Rychlém startu](#rychlý-start-za-60-sekund); HTTP kódy, konfigurace a provoz:
[SERVER](docs/SERVER.md). Interaktivní dokumentace API je na `/docs`, OpenAPI na `/openapi.json`
([docs/openapi.json](docs/openapi.json)).

Stavové kódy `POST /v1/sales`:

| Kód   | Význam                                                                             |
| ----- | ---------------------------------------------------------------------------------- |
| `200` | EET odpovědělo; `status` v těle říká `accepted`, `verification_ok` nebo `rejected` |
| `202` | Ve frontě nebo nejisté; ptej se na `GET /v1/sales/{id}`                            |
| `422` | Neplatný vstup; viz `issues`                                                       |
| `409` | `Idempotency-Key` už patří jiné tržbě                                              |

### CLI

```sh
bun run build:binaries native                        # → dist/bin/eet-<os>-<arch> (Release: hotové binárky)
eet send trzby.csv --config eet.config.yaml          # odešle soubor, výsledek řádek po řádku
eet validate trzby.csv                               # jen kontrola
eet queue list --status queued,uncertain             # co čeká na doposlání
eet queue flush                                      # po výpadku: pošli čekající hned
eet cert inspect kasa.p12 --password-file heslo.txt  # EIČ, prostředí, platnost
eet serve                                            # totéž HTTP API jako v Dockeru
```

Exit kódy:

| Kód | Význam                                 |
| --- | -------------------------------------- |
| `0` | V pořádku                              |
| `1` | Chyba                                  |
| `2` | Chybné použití                         |
| `3` | Tržba nebyla přijata, nebo je neplatná |

Všechny příkazy: [CLI](docs/CLI.md).

### Knihovna (TypeScript)

```ts
import { DatabaseSync } from "node:sqlite"; // v Bunu i new Database() z "bun:sqlite"
import { createEetTransport, loadPkcs12 } from "@eet-gateway/core";
import { createEetQueue, createSqliteStore } from "@eet-gateway/queue";

const certificate = await loadPkcs12(p12Bytes, password);
const queue = createEetQueue({
  store: createSqliteStore(new DatabaseSync("eet-queue.db")),
  registers: {
    "kasa-1": {
      transport: createEetTransport({ environment: "playground", certificate }),
      context: {
        register: { eic_popl: certificate.info.eic, id_jednotky: "11", id_pokl: "KASA-1" },
      },
    },
  },
});
queue.start(); // doposílání na pozadí
const result = await queue.submit(
  { porad_cis: "2026/0001", dat_trzby: new Date(), celk_trzba: "250,00" },
  { idempotencyKey: "2026/0001" },
);
// result.status: accepted | verification_ok | rejected | queued | uncertain | invalid
```

Samostatně jde použít i převod vstupu (`@eet-gateway/ingest`, čisté funkce bez I/O) nebo jen
protokolové jádro (`@eet-gateway/core`, jedno odeslání). Viz [QUEUE](docs/QUEUE.md) a
[INGEST](docs/INGEST.md).

## Integrace z jiných jazyků

[`examples/`](examples/README.md) obsahuje příklady s hotovým ošetřením idempotence a odpovědí
`200`, `202` a `422`:

- [curl](examples/curl/send.sh);
- [PHP](examples/php/send.php);
- [Python](examples/python/send.py);
- [C#](examples/csharp/EetExample/Program.cs);
- [Node jako knihovna](examples/node/send.ts).

CI je spouští proti skutečnému API. Vygenerované klienty pro PHP, Python a C# jsou v
[`clients/`](clients/README.md); klienta pro libovolný jiný jazyk vygeneruješ z
[docs/openapi.json](docs/openapi.json).

## Dokumentace

| Dokument                                                                                                                           | Obsah                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [SPEC_NOTES](docs/SPEC_NOTES.md)                                                                                                   | Výtah z oficiální specifikace s odkazy, rozdíly, otevřené otázky, živá ověření |
| [INGEST](docs/INGEST.md)                                                                                                           | Vstupní formáty, aliasy polí, normalizace, kódy varování a chyb                |
| [QUEUE](docs/QUEUE.md)                                                                                                             | Fronta, stavy, `SaleResult`, idempotence, události, úložiště                   |
| [SERVER](docs/SERVER.md)                                                                                                           | HTTP API, konfigurace, HTTP kódy, Docker, logy                                 |
| [CLI](docs/CLI.md)                                                                                                                 | Příkazy `eet`, exit kódy, binárky                                              |
| [ADR-001](docs/ADR-001-protocol-core.md), [ADR-002](docs/ADR-002-response-trust.md), [ADR-003](docs/ADR-003-queue-retry-policy.md) | Protokolové jádro, důvěra v podpis odpovědi, pravidla doposílání               |
| [STABILITY](docs/STABILITY.md)                                                                                                     | Co je stabilní do 1.0, co se může změnit, deprekace, podporované runtimy       |
| [ROADMAP](ROADMAP.md)                                                                                                              | Cesta k 1.0: kritéria, plánované (ne slíbené) body                             |

## Síť

- Server musí mít HTTPS spojení (TLS 1.2+) na endpoint EET. Playground EET nepřijímá spojení
  z cloudových runnerů (SPEC_NOTES §15) a jak filtruje produkce, není zveřejněno.
- Dostupnost z cílového prostředí ověříš přes `GET /health?eet=true` nebo
  `checkEndpoint()` z `@eet-gateway/core`. Pošle se jen preflight `OPTIONS`, žádná tržba.
- Produkce vyžaduje nový DNS překlad pro každé spojení. Mimo Docker spouštěj s
  `BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS=0` ([SERVER](docs/SERVER.md#síť)).

## Balíčky

| Balíček           | Účel                                                          |
| ----------------- | ------------------------------------------------------------- |
| `packages/core`   | Protokol: podpis, odeslání, ověření odpovědi (`EetTransport`) |
| `packages/ingest` | Parsery a normalizace vstupů                                  |
| `packages/queue`  | Perzistentní fronta, doposílání, idempotence                  |
| `packages/server` | HTTP API v1, OpenAPI 3.1, služba                              |
| `packages/cli`    | Příkaz `eet`                                                  |

**Instalace z npm:** npm balíčky `@eet-gateway/*` jsou po prvním vydání. Zatím nejsou na npm
publikované (balíčky jsou `private`, jméno a vlastnictví scope jsou otevřená otázka OQ7 v
[SPEC_NOTES](docs/SPEC_NOTES.md#14-otevřené-otázky)). Dokud nejsou, použij Docker image,
binárku `eet` z vydání, nebo repozitář (workspace).

## Stav a omezení

Projekt je ve verzi 0.x. Než ho nasadíš na ostrý provoz, vezmi na vědomí:

- **Ověřeno jen na playgroundu.** Živě jsme ověřili odeslání, podpis odpovědi, frontu a
  doposlání po ztracené odpovědi, a to proti playgroundu EET (25. 10. 2026,
  [SPEC_NOTES §15](docs/SPEC_NOTES.md#15-živé-ověření-na-playgroundu)). **Produkce je
  neověřená:** produkční podpisový certifikát GFŘ zatím neznáme. Pokud bude mít jiného
  vydavatele nebo `organizationIdentifier`, všechna produkční potvrzení skončí bezpečně jako
  `uncertain/signature`, nikdy jako falešné `accepted` ([ADR-002](docs/ADR-002-response-trust.md)).
  Co musí ověření produkce pokrýt: SPEC_NOTES §15, „Produkce: neověřeno“.
- **Bez externího auditu.** Kód neprošel nezávislým bezpečnostním auditem. Ověření podpisu
  odpovědi stojí na vlastní minimální čtečce DER/X.509 (ADR-002 bod 6), která je jen
  porovnaná s výstupem `openssl` na 7 skutečných certifikátech. Revokace (CRL/OCSP) se lokálně
  neověřuje (ADR-002 bod 4; SPEC_NOTES §8). Viz [SECURITY](SECURITY.md).
- **Playground z cloudu nedostupný.** Playground EET nepřijímá spojení z cloudových CI
  runnerů (SPEC_NOTES §15), proto živé testy v CI neběží, ale jen lokálně z české sítě.
  Zda produkce filtruje zdrojové IP adresy, není známo. Ověř z cílového prostředí přes
  `GET /health?eet=true`.
- **Závislost na balíčku třetí strany.** Podpis a odeslání zprávy dělá
  `@finitoapp/eet-client` (připnutá přesná verze, jeden správce). Proč a kdy ho případně
  nahradit: [ADR-001](docs/ADR-001-protocol-core.md).
- **Skutečný výpadek EET jsme simulovali jen v testech** ([ADR-003](docs/ADR-003-queue-retry-policy.md)).
- **API se do 1.0 může měnit**, viz [STABILITY](docs/STABILITY.md). Cesta k 1.0 je v
  [ROADMAP](ROADMAP.md) (plán, ne závazek).

## Disclaimer

- Projekt **není produktem Finanční správy ČR** a není s ní nijak spojen ani jí schválen.
- Za správnost evidovaných tržeb a za splnění povinností podle zákona o evidenci tržeb
  (ZoET, zákon č. 180/2026 Sb.) odpovídá výhradně provozovatel (poplatník). Brána tržbu
  jen zpracuje a odešle, nenahrazuje účetní ani právní kontrolu.
- Licence MIT software poskytuje „tak, jak je“, bez jakékoli záruky. Neexistuje záruka,
  že použití brány splní požadavky ZoET.
- **Certifikaci řeší každý sám:** získání a správa certifikátů pokladny, registrace u správce daně a
  případné schvalování či certifikace vlastního pokladního řešení jsou na provozovateli. Projekt nic
  z toho nevyřizuje ani nezaručuje.
- Před ostrým nasazením si své řešení ověř s daňovým poradcem.

## Komunita a správa projektu

- [CONTRIBUTING](CONTRIBUTING.md): vývoj, testy, vydávání;
- [GOVERNANCE](GOVERNANCE.md): jak se rozhoduje;
- [SUPPORT](SUPPORT.md): kam s dotazy a problémy;
- [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md): pravidla slušného chování;
- [SECURITY](SECURITY.md): hlášení zranitelností (soukromě, ne veřejným issue).

## Licence

[MIT](LICENSE). Bez záruky, viz [Disclaimer](#disclaimer).
