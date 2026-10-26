# EET Gateway

**[Česká verze](README.md)**

An open-source (MIT) gateway for sending sales to the Czech **EET 2.0** (electronic registration
of sales by the Financial Administration, SOAP interface 4.1, in production from 1 January 2027).
It takes a sale in any common shape, turns it into a valid data message, signs it, sends it and
returns one consistent result. Every sale is stored first, so a network outage or a crashed
process loses nothing, and the gateway resends safely after a failure.

How to plug it into your own software:

- an **HTTP service** (Docker, standalone binary) with OpenAPI 3.1 for PHP, Python, .NET, Java
  and anything else;
- the **`eet` CLI** for files, scripts and queue maintenance;
- a **TypeScript library** for Node.js 22.18+, Bun and Deno.

> **Status:** version 0.x. Sending, response signature checks, the queue and resending are
> verified live against the EET playground, **not yet against production**. The API may change
> until 1.0 (semver 0.x, see the [CHANGELOG](CHANGELOG.md)). The packages are not on npm yet.

Detailed documentation lives in `docs/` and is written in Czech, like the official EET
specification it follows; the OpenAPI document, code and examples are in English.

## Features

- **Any input shape:** JSON, NDJSON, CSV (UTF-8 or Windows-1250, `,` or `;`), XML (`<Data>` or
  a whole `<Trzba>`), form fields, JS objects. Amounts with a Czech decimal comma; dates with or
  without an offset (daylight saving aware), epoch, `dd.mm.yyyy`. Every change made to the input
  is reported as a warning, never silently.
- **Safe resending:**
  - every sale is stored first (SQLite or your own store);
  - after a timeout, an outage or a crash it is resent with a new `uuid_zpravy` and
    `prvni_zaslani=false`, but the same `<Data>`;
  - the same sale is never sent twice as a first submission;
  - the 48-hour limit (ZoET §20) is tracked;
  - [ADR-003](docs/ADR-003-queue-retry-policy.md) explains the rules.
- **Idempotency:** repeating a call with the same `Idempotency-Key`, or simply the same sale,
  returns the stored result and sends nothing again.
- **Several registers and certificates in one instance:**
  - each register has its own `.p12`, including the legacy encryption of the test certificates;
  - during a renewal the certificate valid at the moment signs;
  - expiry is warned about 21 days ahead.
- **Response verification:** confirmations are checked against the I.CA CA and the GFŘ subject.
  An untrusted answer never ends as `accepted`.
- **Security:**
  - the private key stays non-extractable;
  - certificate passwords are kept out of the configuration;
  - logs never contain keys, passwords or signatures;
  - the API requires a key;
  - the Docker image runs without root.

  See [SECURITY](SECURITY.md).

## Quick start

### HTTP service (Docker)

Configure registers and certificates after
[`examples/eet.config.example.yaml`](examples/eet.config.example.yaml). `.p12` passwords go into
a file or an environment variable, never into the configuration.

```sh
docker build -t eet-gateway .
docker run -p 8080:8080 -e EET_API_KEYS=a-long-secret-key-123 \
  -v ./eet.config.yaml:/etc/eet/eet.config.yaml:ro -v ./certs:/certs:ro -v eet-data:/data eet-gateway

curl -H "Authorization: Bearer a-long-secret-key-123" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 2026/0001" \
  -d '{"porad_cis":"2026/0001","dat_trzby":"2026-11-15T11:58:00+01:00","celk_trzba":"250.00"}' \
  localhost:8080/v1/sales
# → 200 {"status":"accepted","pok":"…", "warnings":[…], …}
```

HTTP status codes:

| Code  | Meaning                                                                             |
| ----- | ----------------------------------------------------------------------------------- |
| `200` | EET answered; `status` in the body says `accepted`, `verification_ok` or `rejected` |
| `202` | Queued or uncertain; poll `GET /v1/sales/{id}`                                      |
| `422` | Invalid input; see `issues`                                                         |
| `409` | Idempotency key reused for another sale                                             |

Interactive API docs are served at `/docs`, OpenAPI at `/openapi.json`
([docs/openapi.json](docs/openapi.json)).

### CLI

```sh
bun run build:binaries native                        # → dist/bin/eet-<os>-<arch> (releases ship binaries)
eet send sales.csv --config eet.config.yaml          # sends a file, reports every row
eet validate sales.csv                               # checks only
eet queue list --status queued,uncertain             # what waits for a resend
eet queue flush                                      # after an outage: send the waiting sales now
eet cert inspect register.p12 --password-file pw.txt # EIČ, environment, validity
eet serve                                            # the same HTTP API as in Docker
```

Exit codes:

| Code | Meaning                               |
| ---- | ------------------------------------- |
| `0`  | OK                                    |
| `1`  | Error                                 |
| `2`  | Usage                                 |
| `3`  | A sale was not accepted, or not valid |

### Library (TypeScript)

```ts
import { DatabaseSync } from "node:sqlite"; // on Bun also new Database() from "bun:sqlite"
import { createEetTransport, loadPkcs12 } from "@eet-gateway/core";
import { createEetQueue, createSqliteStore } from "@eet-gateway/queue";

const certificate = await loadPkcs12(p12Bytes, password);
const queue = createEetQueue({
  store: createSqliteStore(new DatabaseSync("eet-queue.db")),
  registers: {
    "register-1": {
      transport: createEetTransport({ environment: "playground", certificate }),
      context: {
        register: { eic_popl: certificate.info.eic, id_jednotky: "11", id_pokl: "POS-1" },
      },
    },
  },
});
queue.start(); // resends in the background
const result = await queue.submit(
  { porad_cis: "2026/0001", dat_trzby: new Date(), celk_trzba: "250.00" },
  { idempotencyKey: "2026/0001" },
);
// result.status: accepted | verification_ok | rejected | queued | uncertain | invalid
```

The input conversion (`@eet-gateway/ingest`, pure functions without I/O) and the bare protocol
core (`@eet-gateway/core`, one send) can be used on their own.

## Other languages

[`examples/`](examples/README.md) contains examples with idempotency and the `200`/`202`/`422`
handling done:

- [curl](examples/curl/send.sh);
- [PHP](examples/php/send.php);
- [Python](examples/python/send.py);
- [C#](examples/csharp/EetExample/Program.cs);
- [Node as a library](examples/node/send.ts).

CI runs them against the real API. Generate a client for any other language from
[docs/openapi.json](docs/openapi.json).

## Network

- The host needs an HTTPS connection (TLS 1.2+) to the EET endpoint. The EET playground refuses
  connections from cloud CI runners. How production filters connections is not published.
- Check reachability from your environment with `GET /health?eet=true` or `checkEndpoint()` from
  `@eet-gateway/core`. Both send only an `OPTIONS` preflight, never a sale.
- Production requires a fresh DNS lookup per connection. Outside Docker, run with
  `BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS=0`.

## Contributing, security, license

Development, tests and releases: [CONTRIBUTING](CONTRIBUTING.md). Reporting vulnerabilities:
[SECURITY](SECURITY.md). License: [MIT](LICENSE). This project is not a product of, nor
affiliated with, the Czech Financial Administration.
