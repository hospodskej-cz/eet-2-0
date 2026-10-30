[Česky](README.md) | **English**

# EET Gateway

[![CI](https://github.com/hospodskej-cz/eet-2-0/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hospodskej-cz/eet-2-0/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/hospodskej-cz/eet-2-0)](https://github.com/hospodskej-cz/eet-2-0/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![EET playground: verified 2026-10-25](https://img.shields.io/badge/EET%20playground-verified%202026--10--25-brightgreen)](docs/SPEC_NOTES.md#15-živé-ověření-na-playgroundu)
[![EET production: not yet verified](https://img.shields.io/badge/EET%20production-not%20yet%20verified-orange)](ROADMAP.md)

> **Unofficial project, no warranty.** This is not a product of, or software approved by, the Czech
> Financial Administration. The software is provided "as is". Certification, register registration and
> compliance with the Act on Registration of Sales are each operator's own responsibility. See
> [Disclaimer](#disclaimer).

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
> verified live against the EET playground, **not yet against production**, and the code has
> not had an external security audit yet. The API may change until 1.0 (semver 0.x, see the
> [CHANGELOG](CHANGELOG.md) and [STABILITY](docs/STABILITY.md)). Details in
> [Status and limitations](#status-and-limitations). Plan towards 1.0: [ROADMAP](ROADMAP.md)
> (in Czech with a short English summary).

Detailed documentation lives in `docs/` and is written in Czech, like the official EET
specification it follows; the OpenAPI document, code and examples are in English.

## Quick start in 60 seconds

Docker and curl against the **EET playground** (nothing is registered, the POK is a test one).
You need Git, Docker, [Bun](https://bun.sh) and `unzip`; Bun and `unzip` only fetch the shared
GFŘ test certificates (SHA-256 verified).

```sh
git clone https://github.com/hospodskej-cz/eet-2-0 && cd eet-2-0
bun install && bun run certs:playground      # test certificates → .cache/playground/

# configuration: one register with the shared test certificate CZ00000019
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
chmod -R a+rX certs eet.config.yaml          # the service runs as user 65532

docker build -t eet-gateway .
docker run -d -p 8080:8080 -e EET_API_KEYS=a-long-secret-key-123 \
  -v "$PWD/eet.config.yaml:/etc/eet/eet.config.yaml:ro" -v "$PWD/certs:/certs:ro" \
  -v eet-data:/data eet-gateway

# 1) validate only, nothing is sent
curl -H "Authorization: Bearer a-long-secret-key-123" -H "Content-Type: application/json" \
  -d '{"porad_cis":"2026/0001","dat_trzby":"2026-11-15T11:58:00+01:00","celk_trzba":"250.00"}' \
  localhost:8080/v1/validate

# 2) really send to the playground
curl -H "Authorization: Bearer a-long-secret-key-123" -H "Content-Type: application/json" \
  -H "Idempotency-Key: 2026/0001" \
  -d '{"porad_cis":"2026/0001","dat_trzby":"2026-11-15T11:58:00+01:00","celk_trzba":"250.00"}' \
  localhost:8080/v1/sales
# → 200 {"status":"accepted","pok":"…", "warnings":[…], …}
```

Step 2 needs a connection to the playground, which accepts connections only from some networks
(Czech networks yes, cloud CI runners no, see [Network](#network)). If the connection fails, the
sale stays in the queue (`202`, `queued` or `uncertain`) and the service resends it. Without a
certificate and without network access you can try the examples against a fake EET
([examples/](examples/README.md)).

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
  An untrusted answer never ends as `accepted`
  ([ADR-002](docs/ADR-002-response-trust.md)).
- **Security:**
  - the private key stays non-extractable;
  - certificate passwords are kept out of the configuration;
  - logs never contain keys, passwords or signatures;
  - the API requires a key;
  - the Docker image runs without root.

  See [SECURITY](SECURITY.md).

## Other ways to use it

### HTTP service

Configure registers and certificates after
[`examples/eet.config.example.yaml`](examples/eet.config.example.yaml). `.p12` passwords go into
a file or an environment variable, never into the configuration. A step-by-step run is in the
[Quick start](#quick-start-in-60-seconds); configuration and operations:
[SERVER](docs/SERVER.md) (in Czech).

`POST /v1/sales` status codes:

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

All commands: [CLI](docs/CLI.md) (in Czech). Exit codes:

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
core (`@eet-gateway/core`, one send) can be used on their own. See [QUEUE](docs/QUEUE.md) and
[INGEST](docs/INGEST.md) (in Czech).

## Other languages

[`examples/`](examples/README.md) contains examples with idempotency and the `200`/`202`/`422`
handling done:

- [curl](examples/curl/send.sh);
- [PHP](examples/php/send.php);
- [Python](examples/python/send.py);
- [C#](examples/csharp/EetExample/Program.cs);
- [Node as a library](examples/node/send.ts).

CI runs them against the real API. Clients for PHP, Python, C# and Java are in
[`clients/`](clients/README.md); generate a client for any other language from
[docs/openapi.json](docs/openapi.json).

## Documentation

The documents in `docs/` are written in Czech, like the official specification they follow.

| Document                                                                                                                           | Contents                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [SPEC_NOTES](docs/SPEC_NOTES.md)                                                                                                   | Digest of the official specification with references, differences, open questions, live verification |
| [INGEST](docs/INGEST.md)                                                                                                           | Input formats, field aliases, normalization, warning and error codes                                 |
| [QUEUE](docs/QUEUE.md)                                                                                                             | Queue, statuses, `SaleResult`, idempotency, events, stores                                           |
| [SERVER](docs/SERVER.md)                                                                                                           | HTTP API, configuration, HTTP codes, Docker, logs                                                    |
| [CLI](docs/CLI.md)                                                                                                                 | `eet` commands, exit codes, binaries                                                                 |
| [ADR-001](docs/ADR-001-protocol-core.md), [ADR-002](docs/ADR-002-response-trust.md), [ADR-003](docs/ADR-003-queue-retry-policy.md) | Protocol core, trust in the response signature, resend rules                                         |
| [STABILITY](docs/STABILITY.md)                                                                                                     | What is stable before 1.0, what may change, deprecation, supported runtimes                          |
| [ROADMAP](ROADMAP.md)                                                                                                              | The way to 1.0: criteria, planned (not promised) items                                               |

## Network

- The host needs an HTTPS connection (TLS 1.2+) to the EET endpoint. The EET playground refuses
  connections from cloud CI runners (SPEC_NOTES §15). How production filters connections is not
  published.
- Check reachability from your environment with `GET /health?eet=true` or `checkEndpoint()` from
  `@eet-gateway/core`. Both send only an `OPTIONS` preflight, never a sale.
- Production requires a fresh DNS lookup per connection. Outside Docker, run with
  `BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS=0` ([SERVER](docs/SERVER.md#síť)).

## Packages

| Package           | Purpose                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `packages/core`   | Protocol: signing, sending, response verification (`EetTransport`) |
| `packages/ingest` | Input parsers and normalization                                    |
| `packages/queue`  | Persistent queue, resending, idempotency                           |
| `packages/server` | HTTP API v1, OpenAPI 3.1, the service                              |
| `packages/cli`    | The `eet` command                                                  |

**Installing from npm:** `npm i @eet-gateway/cli` (or `core`, `ingest`, `queue`, `server`). The packages
have been on npm since 0.2.0, with provenance from the next release. Without Node: the Docker image
`ghcr.io/hospodskej-cz/eet-2-0` or the `eet` binary from the
[releases](https://github.com/hospodskej-cz/eet-2-0/releases).

## Status and limitations

The project is at version 0.x. Before you run it in production, note:

- **Verified on the playground only.** We verified sending, the response signature, the queue
  and resending after a lost response live against the EET playground (25 October 2026,
  [SPEC_NOTES §15](docs/SPEC_NOTES.md#15-živé-ověření-na-playgroundu)). **Production is
  unverified:** we do not know the GFŘ production signing certificate yet. If it has a different
  issuer or `organizationIdentifier`, every production confirmation ends safely as
  `uncertain/signature`, never as a false `accepted`
  ([ADR-002](docs/ADR-002-response-trust.md)). What a production verification has to cover:
  SPEC_NOTES §15, "Produkce: neověřeno".
- **No external audit.** The code has not had an independent security audit. Verification of the
  response signature rests on our own minimal DER/X.509 reader (ADR-002 point 6), compared with
  `openssl` output on 7 real certificates. Revocation (CRL/OCSP) is not checked locally
  (ADR-002 point 4; SPEC_NOTES §8). See [SECURITY](SECURITY.md).
- **The playground is unreachable from the cloud.** The EET playground refuses connections from
  cloud CI runners (SPEC_NOTES §15), so live tests do not run in CI, only locally from a Czech
  network. Whether production filters source IP addresses is unknown. Check from your target
  environment with `GET /health?eet=true`.
- **A third-party transport package.** Signing and sending the message is done by
  `@finitoapp/eet-client` (exact version pinned, a single maintainer). Why, and when we would
  replace it: [ADR-001](docs/ADR-001-protocol-core.md).
- **A real EET outage has only been simulated in tests**
  ([ADR-003](docs/ADR-003-queue-retry-policy.md)).
- **The API may change until 1.0**, see [STABILITY](docs/STABILITY.md). The way to 1.0 is in the
  [ROADMAP](ROADMAP.md) (a plan, not a commitment).

## Disclaimer

- This project is **not a product of the Czech Financial Administration** (Finanční správa ČR)
  and is not affiliated with, or endorsed by, it.
- The operator (the taxpayer) alone is responsible for the correctness of the recorded sales and
  for complying with the Czech Act on Registration of Sales (zákon o evidenci tržeb, ZoET,
  Act No. 180/2026 Sb.). The gateway only processes and forwards a sale; it does not replace
  accounting or legal review.
- The MIT license provides the software "as is", without any warranty. There is no guarantee
  that using the gateway satisfies ZoET.
- **Certification is your own responsibility:** obtaining and managing register certificates,
  registering with the tax administrator and any approval or certification of your own cash register
  solution rest with the operator. This project handles none of it and guarantees none of it.
- Check your setup with your tax advisor before going live.

## Community and project governance

- [CONTRIBUTING](CONTRIBUTING.md): development, tests, releases;
- [GOVERNANCE](GOVERNANCE.md): how decisions are made;
- [SUPPORT](SUPPORT.md): where to ask questions and report problems;
- [CODE_OF_CONDUCT](CODE_OF_CONDUCT.md): expected behaviour;
- [SECURITY](SECURITY.md): reporting vulnerabilities (privately, not as a public issue).

## License

[MIT](LICENSE). No warranty, see the [Disclaimer](#disclaimer).
