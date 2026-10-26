# EET Gateway

**[English version](README.en.md)**

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
> playgroundu EET, **proti produkci zatím ne**. API se může do 1.0 měnit (semver 0.x, viz
> [CHANGELOG](CHANGELOG.md)). Balíčky zatím nejsou na npm.

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

## Rychlý start

### HTTP služba (Docker)

Konfigurace podle [`examples/eet.config.example.yaml`](examples/eet.config.example.yaml)
(pokladny, certifikáty, výchozí `id_jednotky`/`id_pokl`); hesla k `.p12` patří do souboru nebo do
proměnné prostředí, ne do konfigurace.

```sh
docker build -t eet-gateway .
docker run -p 8080:8080 -e EET_API_KEYS=dlouhy-tajny-klic-123 \
  -v ./eet.config.yaml:/etc/eet/eet.config.yaml:ro -v ./certs:/certs:ro -v eet-data:/data eet-gateway

curl -H "Authorization: Bearer dlouhy-tajny-klic-123" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 2026/0001" \
  -d '{"porad_cis":"2026/0001","dat_trzby":"2026-11-15T11:58:00+01:00","celk_trzba":"250,00"}' \
  localhost:8080/v1/sales
# → 200 {"status":"accepted","pok":"…", "warnings":[…], …}
```

Interaktivní dokumentace API je na `/docs`, OpenAPI na `/openapi.json`
([docs/openapi.json](docs/openapi.json)). HTTP kódy, konfigurace a provoz:
[SERVER](docs/SERVER.md).

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

Všechny příkazy a exit kódy: [CLI](docs/CLI.md).

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

CI je spouští proti skutečnému API. Klienta pro libovolný jazyk vygeneruješ z
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

Vývoj, testy a vydávání: [CONTRIBUTING](CONTRIBUTING.md). Hlášení zranitelností:
[SECURITY](SECURITY.md).

## Licence

[MIT](LICENSE). Projekt není produktem Finanční správy ČR a není s ní nijak spojen.
