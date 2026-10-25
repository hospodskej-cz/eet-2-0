# `@eet-gateway/queue` — fronta a doposílání

Fronta každou tržbu nejdřív uloží a teprve potom odešle. Po výpadku ji bezpečně doposílá:
s novým `uuid_zpravy`, s `prvni_zaslani=false` a s bajtově stejnými `<Data>`. Nikdy nepošle tutéž
tržbu dvakrát jako první odeslání. Pravidla a jejich zdůvodnění jsou v
[ADR-003](ADR-003-queue-retry-policy.md). Tento dokument je **stabilní kontrakt** pro
integrátory. Kódy se nepřečíslují, jen přibývají; test `packages/queue/test/docs.test.ts` hlídá,
že je dokument uvádí všechny.

Fronta běží v Bunu, Node 22.18+ i Deno 2.2+. Databázi otevírá integrátor, fronta sama SQLite
neimportuje.

```ts
import { Database } from "bun:sqlite"; // Node, Deno: import { DatabaseSync } from "node:sqlite"
import { createEetTransport, loadPkcs12 } from "@eet-gateway/core";
import { createEetQueue, createSqliteStore } from "@eet-gateway/queue";

const certificate = await loadPkcs12(p12Bytes, password);
const queue = createEetQueue({
  store: createSqliteStore(new Database("eet-queue.db")),
  registers: {
    "kasa-1": {
      transport: createEetTransport({ environment: "playground", certificate }),
      context: {
        register: { eic_popl: certificate.info.eic, id_jednotky: "11", id_pokl: "KASA-1" },
      },
    },
  },
  onEvent: (event) => log(event), // attempt | needs_attention | overdue | error
});
queue.start(); // doposílání na pozadí

const result = await queue.submit(
  { porad_cis: "2026/0001", dat_trzby: new Date(), celk_trzba: "250,00" },
  { idempotencyKey: requestId },
);
// result.status: accepted | verification_ok | rejected | queued | uncertain | invalid
await queue.stop(); // při ukončení aplikace: počká na rozběhnuté pokusy
```

## API

| Funkce                                                               | Popis                                                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createEetQueue(options)`                                            | Vytvoří frontu (volby níže)                                                                                                                                   |
| `queue.submit(input, options?)`                                      | Ingest → uložení → odeslání. Špatný vstup nevyhodí výjimku, vrátí `invalid`                                                                                   |
| `queue.submitBatch(source, format, options?)`                        | `readSales` + `submit` po řádcích; výsledek pro každý řádek s jeho číslem. Řádek může určit vlastní pokladnu (pole `register`), `options.register` je výchozí |
| `queue.validateBatch(source, format, options?)`                      | Stejný ingest a výběr pokladny jako `submitBatch`, ale nic neuloží ani neodešle (`ValidationResult`)                                                          |
| `queue.get(id)`                                                      | Aktuální `SaleResult`, nebo `undefined`                                                                                                                       |
| `queue.attempts(id)`                                                 | Historie pokusů (`uuid_zpravy`, `dat_odesl`, `prvni_zaslani`, výsledek, endpoint, …)                                                                          |
| `queue.retry(id)`                                                    | Ruční okamžité odeslání. Nejde u `accepted`, `verification_ok` a `invalid` (`QueueError` s kódem `not_retryable`)                                             |
| `queue.list({ status, register, from, to, overdue, limit, cursor })` | Přehled, od nejnovějších. `from`/`to` filtruje podle `dat_trzby`, `limit` je výchozí 50, nejvýš 500                                                           |
| `queue.runDue()`                                                     | Pošle vše splatné a počká na výsledek. Pro vlastní plánovač (cron, serverless) a testy                                                                        |
| `queue.start()` / `queue.stop()`                                     | Worker na pozadí, kontroluje frontu po `pollIntervalMs`                                                                                                       |
| `createSqliteStore(db)` / `createMemoryStore()`                      | Úložiště. Paměťové je jen pro testy: při ukončení procesu o vše přijde                                                                                        |
| `SaleResultSchema`                                                   | zod schéma výsledku, stejné pro knihovnu, HTTP API i CLI                                                                                                      |

**Volby `createEetQueue`:**

| Volba                      | Výchozí                                                                       | Význam                                                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `store`                    | —                                                                             | `QueueStore`                                                                                                                                                                                                 |
| `registers`                | —                                                                             | `{ [id]: { transport, context? } }`. `context` je `IngestContext` pokladny (výchozí `eic_popl`/`id_jednotky`/`id_pokl`, `timeZone`, `fieldMap`, `certificateEic`). Transport se bere při každém pokusu znovu |
| `retryUncertain`           | `true`                                                                        | Automaticky doposílat nejisté pokusy (ADR-003 bod 3)                                                                                                                                                         |
| `retry`                    | `{ initialDelayMs: 5000, maxDelayMs: 300000, code8Attempts: 3, jitter: 0.2 }` | Backoff                                                                                                                                                                                                      |
| `concurrency`              | `4`                                                                           | Kolik pokusů worker pošle najednou                                                                                                                                                                           |
| `leaseMs`                  | `120000`                                                                      | Výhrada jednoho pokusu. Musí být víc než dvojnásobek `timeoutMs` transportu; pokus se přeruší po `leaseMs / 2`                                                                                               |
| `pollIntervalMs`           | `5000`                                                                        | Jak často běžící worker hledá splatná doposlání                                                                                                                                                              |
| `onEvent`, `now`, `random` | —                                                                             | Události; hodiny a náhoda pro testy                                                                                                                                                                          |

**Volby `submit`:**

| Volba            | Význam                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `register`       | Id pokladny. Může přijít i v poli `register` vstupu. Při jedné nakonfigurované pokladně se nemusí uvádět                                                                       |
| `mode`           | `sync` (výchozí): počká na první pokus. `async`: vrátí `queued` hned a odešle na pozadí okamžitě, i bez `start()`. Pozdější doposílání ale potřebuje `start()` nebo `runDue()` |
| `verify`         | Ověřovací mód (`overeni=true`), nic se neeviduje                                                                                                                               |
| `idempotencyKey` | Opakované volání se stejným klíčem a stejnou tržbou vrátí uložený výsledek (varování 1071). Se stejným klíčem a jinou tržbou vrátí `invalid/idempotency_conflict`              |

## Stavy

| `status`          | Význam                                                                                     | Co dál                                     |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `accepted`        | EET tržbu přijalo, `pok` je fiskální identifikační kód                                     | —                                          |
| `verification_ok` | Ověřovací mód: zpráva je v pořádku, nic se neevidovalo                                     | —                                          |
| `rejected`        | EET zprávu odmítlo (`code`, `message`)                                                     | Opravit data nebo certifikát; `retry()`    |
| `queued`          | Zatím nezaevidováno, odešle se v `nextAttemptAt`                                           | Čekat                                      |
| `uncertain`       | Pokus mohl do EET dojít, odpověď nedorazila (`reason`). Má-li `nextAttemptAt`, doposílá se | Bez `nextAttemptAt`: rozhodnout, `retry()` |
| `invalid`         | Neprošlo lokální kontrolou, nic se neodeslalo (`issues`). Bez `id`, pokud se nic neuložilo | Opravit vstup                              |

## `SaleResult`

`id`, `status`, `register`, `pok`, `uuid` (`uuid_zpravy` posledního pokusu), `test` (odpověď
z playgroundu), `code` a `message` (poslední odpověď EET), `reason`, `warnings`
(`{ code, message, source: "eet" | "ingest" | "queue", field? }`), `issues` (u `invalid`),
`attempts`, `nextAttemptAt`, `overdue` (48 h bez POK, ZoET §20; v ověřovacím módu chybí),
`createdAt`, `deadlineAt`, `httpStatus`, `globalTransactionId`. `rawRequest` a `rawResponse`
vrací jen synchronní volání s transportem v `debug` a nikdy se neukládají.

`reason` je jedna z hodnot `UncertainReason` / `NotSentReason` jádra (`timeout`, `network`,
`aborted`, `http`, `soap_fault`, `malformed_response`, `signature`, `environment_mismatch`,
`signer`, `too_large`), dále `interrupted` (pokus přerušil pád procesu nebo vypršela výhrada)
nebo `transport_error` (vlastní transport vyhodil výjimku).

## Kódy varování

Navazují na kódy ingestu ([INGEST](INGEST.md#kódy-varování)).

| Kód  | Název           | Kdy                                                                                                                        |
| ---- | --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1071 | `SALE_REPLAYED` | Tržba už ve frontě je (stejný klíč idempotence, nebo stejná tržba podle R §4). Vrácen existující záznam, nic se neodeslalo |

## Kódy chyb

Kromě chyb ingestu ([INGEST](INGEST.md#kódy-chyb)) může `invalid` nést:

| Kód                    | Kdy                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `unknown_register`     | Pokladna není nakonfigurovaná, nebo jich je víc a volání žádnou neurčilo              |
| `idempotency_conflict` | Klíč idempotence už patří jiné tržbě                                                  |
| `sale_conflict`        | Ve frontě je tržba se stejným klíčem unikátnosti (R §4), ale s jinými ostatními údaji |
| `conflicting_fields`   | Vstup určuje jinou pokladnu než volání                                                |

`QueueError.code` u `retry()`: `not_found`, `not_retryable`, `unknown_register`, `in_progress`.

## Události (`onEvent`)

| `type`            | Kdy                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `attempt`         | Po každém pokusu: `id`, `register`, `attempt`, `outcome`, `reason`, `code`, `status`, `nextAttemptAt` |
| `needs_attention` | Záznam se sám nevyřeší: `rejected`, nedůvěryhodná odpověď, `retryUncertain=false`, `too_large`        |
| `overdue`         | Neúspěšný pokus víc než 48 h po tržbě                                                                 |
| `error`           | Chyba úložiště nebo workeru. Výsledek, který se nepodařilo uložit, se po vypršení výhrady doposílá    |

Události nesou jen id, kódy a zprávy EET. Klíče, hesla ani podpisy v nich nikdy nejsou.

## Úložiště

`createSqliteStore(db)` při prvním použití vytvoří tabulky `eet_sales`, `eet_attempts`
a `eet_queue_meta` (verze schématu). Může tedy sdílet databázi s aplikací; `PRAGMA user_version`
nechává být. Spojení přepne do WAL se `synchronous = FULL`: potvrzený zápis „pokus zahájen“
přežije pád procesu i stroje. Vyžaduje SQLite 3.37+ (tabulky `STRICT`).

| Runtime     | Databáze                                                                     |
| ----------- | ---------------------------------------------------------------------------- |
| Bun         | `new Database(path)` z `bun:sqlite`                                          |
| Node 22.18+ | `new DatabaseSync(path)` z `node:sqlite` (Node vypíše `ExperimentalWarning`) |
| Deno 2.2+   | `new DatabaseSync(path)` z `node:sqlite`                                     |

Vlastní úložiště (např. Postgres) implementuje `QueueStore` a musí projít sadou
`packages/queue/test/store-contract.ts` (ADR-003 bod 12).

Do jednoho souboru SQLite může zapisovat víc procesů: převzetí záznamu je atomické. Pro
nasazení s několika instancemi je ale vhodnější Postgres.
