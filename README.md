# EET Gateway (pracovní název)

Open-source (MIT) knihovna pro odesílání tržeb do **EET 2.0** (Finanční správa ČR, SOAP rozhraní
4.1), kterou si kdokoli zabuduje do svého pokladního nebo účetního softwaru. Tržbu přijme
v libovolném běžném formátu, převede ji na platnou datovou zprávu, podepíše, odešle a vrátí
normalizovanou odpověď. Integrovat ji půjde jako TypeScript knihovnu (Node 22+, Bun, Deno), jako
HTTP službu s OpenAPI pro jiné jazyky nebo jako CLI.

> An open-source gateway for Czech EET 2.0 sales registration: library, HTTP service and CLI.
> Full English documentation will follow in phase 7.

**Stav: fáze 6 z 7.**

- Jádro (`packages/core`) umí načíst certifikát z `.p12`, podepsat a odeslat jednu tržbu
  a ověřit podpis potvrzení; ověřeno živě proti playgroundu.
- Ingest (`packages/ingest`) převede tržby z objektů, JSON, NDJSON, CSV (UTF-8 i CP1250) a XML
  na platná data EET.
- Fronta (`packages/queue`) každou tržbu nejdřív uloží (SQLite v Bunu, Node i Deno), pak odešle
  a po výpadku bezpečně doposílá. Je idempotentní a nikdy nepošle tutéž tržbu dvakrát jako první
  odeslání.
- HTTP API (`packages/server`) s OpenAPI 3.1, autentizací API klíčem a více pokladnami běží
  jako Docker image nebo přímo v Bunu.
- CLI `eet` (`packages/cli`) umí odeslat a zkontrolovat soubor, spravovat frontu, zkontrolovat
  certifikát a spustit službu; jde sestavit jako samostatná binárka pro Linux, macOS a Windows.

- [docs/SPEC_NOTES.md](docs/SPEC_NOTES.md): výtah z oficiální specifikace s odkazy na zdroje,
  rozdíly mezi zadáním a zdroji, otevřené otázky, živé ověření (§15)
- [docs/ADR-001-protocol-core.md](docs/ADR-001-protocol-core.md): protokolové jádro nad
  `@finitoapp/eet-client`
- [docs/ADR-002-response-trust.md](docs/ADR-002-response-trust.md): důvěra v podpis potvrzení
  a čtení X.509
- [docs/INGEST.md](docs/INGEST.md): vstupní formáty, aliasy polí, pravidla normalizace, kódy
  varování a chyb
- [docs/QUEUE.md](docs/QUEUE.md): fronta, stavy, `SaleResult`, idempotence, události, úložiště
- [docs/ADR-003-queue-retry-policy.md](docs/ADR-003-queue-retry-policy.md): pravidla doposílání
- [docs/CLI.md](docs/CLI.md): příkazy `eet`, exit kódy, binárky
- [docs/SERVER.md](docs/SERVER.md): HTTP API, konfigurace, Docker, logy;
  [docs/openapi.json](docs/openapi.json): OpenAPI 3.1

## Vyzkoušej

Pošle jednu vymyšlenou tržbu na playground EET se sdíleným testovacím certifikátem a vypíše
výsledek. Playground nic neeviduje a jeho POK (končí `-ff`) nejsou platné.

```sh
bun install
bun run certs:playground          # jednou: stáhne testovací certifikáty do .cache/playground/
bun run playground:send           # ostrý mód → "kind": "accepted", POK …-ff
bun run playground:send --verify  # ověřovací mód → "kind": "verification_ok"
bun run playground:send --unit 10 # id_jednotky nekončí 1–4 → varování 6
bun run playground:send --debug   # přidá raw XML požadavku a odpovědi (SignatureValue skryté)
```

Jako knihovna:

```ts
import { createEetTransport, createHeader, formatEetDateTime, loadPkcs12 } from "@eet-gateway/core";

const certificate = await loadPkcs12(p12Bytes, password);
const transport = createEetTransport({ environment: "playground", certificate });
const outcome = await transport.send({
  data: {
    eic_popl: certificate.info.eic,
    id_jednotky: "11",
    id_pokl: "pokladna-1",
    porad_cis: "2026/0001",
    dat_trzby: formatEetDateTime(new Date()),
    celk_trzba: "250.00",
  },
  header: createHeader({ prvni_zaslani: true }),
});
// outcome.kind: accepted | verification_ok | rejected | not_sent | uncertain
```

Převod vstupu z vlastního systému (bez odesílání, čistá funkce):

```ts
import { normalizeSale, parseSales } from "@eet-gateway/ingest";

const result = normalizeSale(
  { totalAmount: "1 234,50", saleDateTime: "15.11.2026 11:58", receiptNumber: "2026/0001" },
  { register: { eic_popl: "CZ00000019", id_jednotky: "11", id_pokl: "KASA-1" } },
);
// result.ok → result.sale.data je EetReceiptData pro transport.send(); result.warnings vysvětlí každou úpravu

const batch = parseSales(csvBytes, "csv"); // výsledek pro každý řádek s číslem řádku
```

S frontou (uložení, odeslání, doposílání po výpadku, idempotence):

```ts
import { Database } from "bun:sqlite"; // Node, Deno: DatabaseSync z "node:sqlite"
import { createEetQueue, createSqliteStore } from "@eet-gateway/queue";

const queue = createEetQueue({
  store: createSqliteStore(new Database("eet-queue.db")),
  registers: {
    "kasa-1": {
      transport,
      context: { register: { eic_popl: "CZ00000019", id_jednotky: "11", id_pokl: "KASA-1" } },
    },
  },
});
queue.start();
const result = await queue.submit(
  { porad_cis: "2026/0001", dat_trzby: new Date(), celk_trzba: "250,00" },
  { idempotencyKey: requestId },
);
// result.status: accepted | verification_ok | rejected | queued | uncertain | invalid
```

Jako HTTP služba (pro PHP, Python, .NET, …; konfigurace podle
[`examples/eet.config.example.yaml`](examples/eet.config.example.yaml)):

```sh
docker build -t eet-gateway .
docker run -p 8080:8080 -e EET_API_KEYS=… \
  -v ./eet.config.yaml:/etc/eet/eet.config.yaml:ro -v ./certs:/certs:ro -v eet-data:/data eet-gateway

curl -H "Authorization: Bearer …" -H "Content-Type: application/json" \
  -d '{"porad_cis":"2026/0001","dat_trzby":"2026-11-15T11:58:00+01:00","celk_trzba":"250,00"}' \
  localhost:8080/v1/sales          # → {"status":"accepted","pok":"…", …}
```

Dokumentace API běží na `/docs`, OpenAPI na `/openapi.json`.

Z příkazové řádky (stejná konfigurace a fronta):

```sh
bun run build:binaries native                       # → dist/bin/eet-<os>-<arch>
eet send trzby.csv --config eet.config.yaml         # odešle soubor, vypíše výsledek řádek po řádku
eet queue list --status queued,uncertain            # co čeká na doposlání
eet cert inspect kasa.p12 --password-file heslo.txt # EIČ, prostředí, platnost
```

## Síťové požadavky

Server, na kterém knihovnu provozuješ, musí mít HTTPS spojení (TLS 1.2+) na endpoint EET.
Dostupnost není samozřejmá: playground EET nepřijímá spojení z runnerů GitHub Actions
(SPEC_NOTES §15) a jak filtruje produkce, není zveřejněno. Z cílového prostředí si to ověříš
takto (pošle jen preflight `OPTIONS`, žádnou tržbu):

```ts
import { checkEndpoint, EET_PLAYGROUND_ENDPOINT } from "@eet-gateway/core";
console.log(await checkEndpoint(EET_PLAYGROUND_ENDPOINT)); // { reachable: true, httpStatus: 204, … }
```

## Vývoj

Potřebuješ [Bun](https://bun.sh) ve verzi z `.bun-version` a `xmllint` (libxml2) pro kontraktní
testy proti XSD.

```sh
bun install
bun run check             # biome + tsc + bun test
bun run compat:node       # sestaví core, ingest a queue a ověří, že běží v Node
bun run gen:openapi       # přegeneruje docs/openapi.json po změně API
scripts/docker-smoke.sh   # ověří Docker image (docker build -t eet-gateway:dev . předtím)
bun run build:binaries    # samostatné binárky eet do dist/bin/ (native = jen pro tento stroj)
scripts/binary-smoke.sh dist/bin/eet-darwin-arm64   # ověří binárku bez odeslání do EET
bun run spec:drift        # porovná oficiální dokumenty na eet.gov.cz se stavem v docs/sources
bun run certs:playground  # stáhne sdílené testovací certifikáty do .cache/ (necommitují se)
bun run test:live         # živé testy proti playgroundu (7 vymyšlených zpráv)
```

Živé testy proti playgroundu pouštěj lokálně z české sítě; z runnerů GitHubu je playground
nedostupný (případně self-hosted runner přes proměnnou repozitáře `LIVE_RUNNER`). Golden soubory
ingestu se přegenerují přes `UPDATE_GOLDEN=1 bun test packages/ingest`.

Offline testy potřebují testovací certifikáty (`bun run certs:playground`); bez nich selžou se
srozumitelnou hláškou.

| Balíček           | Účel                                           |
| ----------------- | ---------------------------------------------- |
| `packages/core`   | protokolová vrstva za rozhraním `EetTransport` |
| `packages/ingest` | parsery a normalizace vstupů                   |
| `packages/queue`  | perzistentní fronta a doposílání               |
| `packages/server` | HTTP API v1 + OpenAPI                          |
| `packages/cli`    | CLI                                            |

## Licence

[MIT](LICENSE)
