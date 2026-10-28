# `@eet-gateway/server` — HTTP API v1 a služba

HTTP API pro pokladní systémy v libovolném jazyce. Úplný popis operací a schémat je
v [openapi.json](openapi.json) (OpenAPI 3.1). Běžící služba ho publikuje na `GET /openapi.json`
a interaktivně na `GET /docs`. Hotové klienty pro PHP, Python a C# jsou v [`clients/`](../clients/README.md),
ostatní jazyky jde z dokumentu vygenerovat. Za API stojí fronta ([QUEUE](QUEUE.md)) a ingest ([INGEST](INGEST.md)).

## Spuštění

```sh
bun packages/server/src/main.ts --config eet.config.yaml   # nebo EET_CONFIG; výchozí ./eet.config.yaml
bun packages/server/src/main.ts --dev                      # bez API klíčů, jen playground
eet serve --config eet.config.yaml                         # totéž přes CLI (docs/CLI.md)
```

| Exit kód | Význam                                                                                    |
| -------- | ----------------------------------------------------------------------------------------- |
| 0        | Zastaveno signálem SIGTERM/SIGINT: přestane přijímat, dokončí rozběhnuté pokusy, zavře DB |
| 1        | Chyba konfigurace, certifikátu nebo hesla (seznam `cesta: zpráva` na stderr)              |
| 2        | Neplatné argumenty                                                                        |

Docker (image z `Dockerfile`, runtime `oven/bun:1.4.4-distroless`):

```sh
docker build -t eet-gateway .
docker run -p 8080:8080 -e EET_API_KEYS=… \
  -v ./eet.config.yaml:/etc/eet/eet.config.yaml:ro -v ./certs:/certs:ro -v eet-data:/data eet-gateway
```

- Služba běží jako neprivilegovaný uživatel `65532`. Konfigurace, certifikáty a soubory s hesly
  musí být pro něj čitelné.
- Fronta (SQLite) leží ve svazku `/data` (`EET_DB_PATH=/data/eet-queue.db`). **Svazek je nutný**,
  jinak by se fronta při výměně kontejneru ztratila.
- `HEALTHCHECK` volá `/health`. `docker stop` pošle SIGTERM a služba skončí čistě.
- `scripts/docker-smoke.sh` image ověří bez odeslání čehokoli do EET (stejně jako job `docker` v CI).

Jako knihovnu vložíš API do vlastního serveru přes `createApp({ queue, apiKeys, registers })`
z `@eet-gateway/server`. Je to Hono aplikace bez API specifických pro Bun (`app.fetch`).

## Konfigurace

Vzor s komentáři je v [`examples/eet.config.example.yaml`](../examples/eet.config.example.yaml).
Relativní cesty se berou vůči konfiguračnímu souboru. Konfigurace se kontroluje při startu:
- všechny chyby se vypíšou najednou;
- neznámý klíč je chyba;
- hesla se nikdy nevypisují.

| Klíč                                           | Env                              | Výchozí                  | Význam                                                                                                          |
| ---------------------------------------------- | -------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `server.host`, `server.port`                   | `EET_HOST`, `EET_PORT`           | `0.0.0.0`, `8080`        | Kde služba poslouchá; `--port` má přednost                                                                      |
| `apiKeys`                                      | `EET_API_KEYS` (čárkami)         | —                        | Klíče pro `Authorization: Bearer`, každý aspoň 16 znaků. Bez klíčů služba nenaběhne (kromě `--dev`)             |
| `database`                                     | `EET_DB_PATH`                    | `./eet-queue.db`         | Soubor SQLite s frontou                                                                                         |
| `timeZone`                                     | `EET_DEFAULT_TZ`                 | `Europe/Prague`          | Zóna pro časy bez offsetu a pro `dat_odesl`                                                                     |
| `productionEndpoint`                           | `EET_ENDPOINT_PRODUCTION`        | —                        | URL produkce (jen `https`). Povinná, jakmile je některá pokladna produkční                                      |
| `queue.*`                                      | —                                | viz [QUEUE](QUEUE.md)    | `retryUncertain`, `concurrency`, `pollIntervalMs`, `leaseMs`, `retry.{initialDelayMs,maxDelayMs,code8Attempts}` |
| `registers.<id>.environment`                   | —                                | —                        | `playground` nebo `production`; musí odpovídat CA, která certifikát vydala                                      |
| `registers.<id>.certificates[].p12`            | `EET_REGISTER_<ID>_P12_PATH`     | —                        | Soubor `.p12` od CA EET (i legacy RC2/3DES). Env jde použít jen u pokladny s jedním certifikátem                |
| `registers.<id>.certificates[].passwordFile`   | `EET_REGISTER_<ID>_P12_PASSWORD` | —                        | Heslo ze souboru (např. Docker secret), jinak z env. **Klíč `password` konfigurace odmítne**                    |
| `registers.<id>.defaults`                      | —                                | `eic_popl` z certifikátu | Výchozí `eic_popl`, `id_jednotky`, `id_pokl`, takže je tržby nemusí opakovat                                    |
| `registers.<id>.endpoint`                      | —                                | podle prostředí          | Vlastní URL (např. proxy)                                                                                       |
| `registers.<id>.timeoutMs`                     | —                                | `10000`                  | Mezní doba odezvy, nejméně 2000 (ZoET §19)                                                                      |
| `registers.<id>.timeZone`, `fieldMap`, `debug` | —                                | —                        | Zóna pokladny, vlastní názvy polí ([INGEST](INGEST.md)), raw XML v synchronní odpovědi (podpisy skryté)         |

`<ID>` v názvu proměnné je id pokladny velkými písmeny, ostatní znaky jsou `_`. Například
`kasa-1` → `EET_REGISTER_KASA_1_P12_PASSWORD`.

**Víc certifikátů na pokladnu.** Během obnovy uveď starý i nový certifikát. Každý pokus podepíše
certifikát, který je v tu chvíli platný (při překryvu ten novější), jak vyžaduje rozhraní §3.3.
Když platný certifikát chybí, tržby zůstávají ve frontě (`queued`, `reason: signer`).

**Expirace.** Při startu a pak každých 24 h služba zaloguje `warn` 21 dní před koncem platnosti
a `error` po jejím konci. Stejné údaje vrací `GET /v1/registers` (`daysLeft`, `expiresSoon`,
`expired`, `active`).

## Autentizace

- Všechno pod `/v1` vyžaduje `Authorization: Bearer <klíč>`. Klíče se porovnávají v konstantním
  čase a nikdy se nelogují.
- `GET /health`, `GET /openapi.json` a `GET /docs` jsou veřejné a nic citlivého neobsahují.
- `--dev` povolí start bez klíčů (`/v1` je pak otevřené). Odmítne ale produkční pokladny.

## Endpointy a HTTP kódy

| Endpoint                      | Popis                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/sales`              | Jedna tržba: JSON, XML (`<Data>` nebo `<Trzba>`), formulář. Query `mode` (`sync` výchozí, nebo `async`), `verify`, `register`. Limit 64 KiB              |
| `POST /v1/sales/batch`        | Dávka podle `Content-Type`: JSON, NDJSON, CSV (UTF-8 i Windows-1250), XML. Výchozí `mode=async` (OQ1: dávky slouží k doposílání a migraci). Limit 10 MiB |
| `GET /v1/sales/{id}`          | Stav a výsledek (`SaleResult`)                                                                                                                           |
| `GET /v1/sales/{id}/attempts` | Všechny pokusy s `uuid_zpravy` a `dat_odesl`                                                                                                             |
| `POST /v1/sales/{id}/retry`   | Ruční opakování                                                                                                                                          |
| `GET /v1/queue`               | Přehled: `status` (čárkami), `register`, `from`/`to` (`dat_trzby`), `overdue`, `limit`, `cursor`                                                         |
| `GET /v1/registers`           | Pokladny a stav certifikátů                                                                                                                              |
| `POST /v1/validate`           | Jen ingest a kontrola, nic se neuloží ani neodešle                                                                                                       |
| `GET /health`                 | Proces a databáze; `?eet=true` navíc ověří dostupnost EET preflightem `OPTIONS` (výsledek se drží 60 s)                                                  |

**Odpověď s `SaleResult`:**

| Kód   | Kdy                                                                                                                         |
| ----- | --------------------------------------------------------------------------------------------------------------------------- |
| `200` | EET odpovědělo: `accepted`, `verification_ok` nebo `rejected`. Výsledek nese `status` v těle; odmítnutí EET není chyba HTTP |
| `202` | Ještě není rozhodnuto: `queued` nebo `uncertain`. Stav zjistíš na adrese z hlavičky `Location`                              |
| `409` | Klíč `Idempotency-Key` už patří jiné tržbě (`issues[].code = idempotency_conflict`)                                         |
| `422` | `invalid`: neprošlo kontrolou (`issues`), nic se neodeslalo                                                                 |

Hlavičky:
- `Idempotency-Key` (1–255 tisknutelných znaků ASCII): opakované volání vrátí uložený výsledek
  s `Idempotent-Replayed: true`. U dávky se řádky klíčují `<klíč>:<řádek>`.
- `Location: /v1/sales/{id}` u každého uloženého záznamu.

**Ostatní chyby** mají tvar `{ "error": { "code", "message" } }`:

| Kód   | `error.code`                                                 |
| ----- | ------------------------------------------------------------ |
| `400` | `bad_request` (neplatný query parametr nebo hlavička)        |
| `401` | `unauthorized` (+ `WWW-Authenticate: Bearer`)                |
| `404` | `not_found`                                                  |
| `409` | `not_retryable`, `in_progress`, `unknown_register` (u retry) |
| `413` | `payload_too_large`                                          |
| `415` | `unsupported_media_type`                                     |
| `422` | `single_sale_expected` (dávka poslaná na `/v1/sales`)        |
| `500` | `internal` (podrobnosti jen v logu)                          |

Dávka a validace vrací `200` s výsledkem pro každý řádek. `422` vrací, jen když zdroj nejde
přečíst vůbec (pole `issues`).

## Logy

Na stdout jde jeden JSON objekt na řádek (`time`, `level`, `msg` a pole):

- `request`: `method`, `route` (vzor cesty, ne konkrétní id ani query), `status`, `durationMs`;
- `attempt`, `needs attention`, `overdue`, `queue error`: události fronty (id, kódy, stavy);
- `certificate`: expirace;
- `listening`, `stopping`, `stopped`.

**Nikdy se nelogují:** těla požadavků, hlavička `Authorization`, API klíče, hesla, klíče a
`SignatureValue`.

## Síť

Služba potřebuje HTTPS spojení na endpoint EET. Ověříš ho přes `GET /health?eet=true` nebo
`checkEndpoint()` (README, SPEC_NOTES §15).

Produkce vyžaduje nový překlad DNS pro každé spojení (P §2.1). Bun si ale DNS bez nastavení
drží 30 s. Image proto nastavuje `BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS=0`: Bun pak překládá při
každém novém spojení (ověřeno, SPEC_NOTES §13 ř. 6). Mimo Docker nastav stejnou proměnnou.
