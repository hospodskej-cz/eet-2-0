# Klienti pro HTTP API / API clients

**Česky** · [English](#english)

Malé, typované klienty pro HTTP API brány (`/v1`, popsané v [`docs/openapi.json`](../docs/openapi.json)),
aby pokladní systémy nemusely skládat HTTP ručně. Pokrývají všechny operace a každý je jeden
tenký balíček bez závislostí:

| Jazyk  | Balíček                                            | Požadavky                      | Složka              |
| ------ | -------------------------------------------------- | ------------------------------ | ------------------- |
| PHP    | `hospodskej-cz/eet-gateway-client` (Composer)      | PHP 8.1+, `ext-curl`           | [`php/`](php)       |
| Python | `eet-gateway-client` (import `eet_gateway_client`) | Python 3.9+, jen stdlib        | [`python/`](python) |
| C#     | `EetGateway.Client` (NuGet)                        | .NET 8, jen `System.Text.Json` | [`dotnet/`](dotnet) |
| Java   | `io.github.hospodskej-cz:eet-gateway-client` (Maven Central) | Java 17+, jen JDK (`java.net.http`) | [`java/`](java) |

Balíčky se publikují do Packagistu, PyPI, NuGetu a Maven Central workflowem po tagu `clients-vX.Y.Z` (postup pro
správce je na konci).

## Instalace

```sh
pip install eet-gateway-client
composer require hospodskej-cz/eet-gateway-client
dotnet add package EetGateway.Client
```

Java (Maven `pom.xml`, Gradle: `implementation("io.github.hospodskej-cz:eet-gateway-client:0.1.1")`):

```xml
<dependency>
  <groupId>io.github.hospodskej-cz</groupId>
  <artifactId>eet-gateway-client</artifactId>
  <version>0.1.1</version>
</dependency>
```

Z checkoutu repozitáře (vývoj): `pip install ./clients/python`, v `composer.json` repozitář typu
`path` na `clients/php`, `dotnet add reference clients/dotnet/src/EetGateway.Client`,
`mvn -f clients/java/pom.xml install`.

## Použití

Všechny klienty mají stejný tvar: tržbu pošleš s `Idempotency-Key` (číslo účtenky), výsledek je
typovaný `SaleResult` se `status`, a když není hotovo, počkáš na něj `wait_for_sale`.

**Python**

```python
import os
from datetime import datetime
from eet_gateway_client import EetGatewayClient, SaleStatus

client = EetGatewayClient("http://localhost:8080", api_key=os.environ["EET_API_KEY"])

result = client.submit_sale(
    {
        "porad_cis": "R-1001",
        "dat_trzby": datetime.now().astimezone().isoformat(timespec="seconds"),
        "celk_trzba": "123.50",  # eic_popl, id_jednotky, id_pokl doplní brána z konfigurace pokladny
    },
    idempotency_key="R-1001",
)
if result.is_pending:  # queued | uncertain: brána to dál posílá sama
    result = client.wait_for_sale(result)

if result.is_success:
    print("POK", result.pok)
elif result.status == SaleStatus.INVALID:
    for issue in result.issues:
        print(issue.code, issue.field, issue.message)  # nic se neodeslalo
```

**PHP**

```php
use EetGateway\Client\Client;
use EetGateway\Client\Model\SaleStatus;

$client = new Client('http://localhost:8080', apiKey: getenv('EET_API_KEY') ?: null);

$result = $client->submitSale(
    ['porad_cis' => 'R-1001', 'dat_trzby' => date('c'), 'celk_trzba' => '123.50'],
    idempotencyKey: 'R-1001',
);
if ($result->isPending()) {      // queued | uncertain: brána to dál posílá sama
    $result = $client->waitForSale($result);
}

if ($result->isSuccess()) {
    echo "POK {$result->pok}\n";
} elseif ($result->status === SaleStatus::Invalid) {
    foreach ($result->issues as $issue) {
        echo "{$issue->code} {$issue->field}: {$issue->message}\n"; // nic se neodeslalo
    }
}
```

**C#**

```csharp
using EetGateway.Client;

using var client = new EetGatewayClient("http://localhost:8080", Environment.GetEnvironmentVariable("EET_API_KEY"));

var result = await client.SubmitSaleAsync(
    new SaleInput { PoradCis = "R-1001", DatTrzby = DateTimeOffset.Now, CelkTrzba = 123.50m },
    new SubmitOptions { IdempotencyKey = "R-1001" });
if (result.IsPending)            // Queued | Uncertain: brána to dál posílá sama
    result = await client.WaitForSaleAsync(result);

if (result.IsSuccess)
    Console.WriteLine($"POK {result.Pok}");
else if (result.Status == SaleStatus.Invalid)
    foreach (var issue in result.Issues)
        Console.WriteLine($"{issue.Code} {issue.Field}: {issue.Message}"); // nic se neodeslalo
```

**Java**

```java
import cz.hospodskej.eetgateway.*;

EetGatewayClient client =
    EetGatewayClient.builder("http://localhost:8080").apiKey(System.getenv("EET_API_KEY")).build();

SaleResult result =
    client.submitSale(
        SaleInput.of(OffsetDateTime.now(), new BigDecimal("123.50")).poradCis("R-1001"),
        new RequestOptions().idempotencyKey("R-1001"));
if (result.isPending()) {      // queued | uncertain: brána to dál posílá sama
  result = client.waitForSale(result);
}

if (result.isSuccess()) {
  System.out.println("POK " + result.pok());
} else if (result.knownStatus().orElse(null) == SaleStatus.INVALID) {
  for (Issue issue : result.issues()) {
    System.out.println(issue.code() + " " + issue.field() + ": " + issue.message()); // nic se neodeslalo
  }
}
```

## Co klienti dělají

| Odpověď brány | Klient                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `200`         | vrátí `SaleResult`: `accepted`, `verification_ok` nebo `rejected` (odmítnutí EET **není** výjimka)         |
| `202`         | vrátí `SaleResult` se `status` `queued` nebo `uncertain`; `wait_for_sale` se ptá na `GET /v1/sales/{id}`   |
| `422` (tržba) | vrátí `SaleResult` se `status` `invalid` a `issues`; nic se neodeslalo                                     |
| `409` (klíč)  | vyhodí `IdempotencyConflict…` s výsledkem uvnitř: `Idempotency-Key` už patří jiné tržbě                    |
| ostatní chyby | vyhodí typovanou výjimku (`400`, `401`, `404`, `409`, `413`, `415`, `422`, `5xx`) s `error.code` a zprávou |
| bez odpovědi  | vyhodí `Transport…` (a `…Timeout…` při překročení limitu)                                                  |
- **Idempotence:** `Idempotency-Key` (1–255 tisknutelných znaků ASCII) je volitelný argument každého
  odeslání. Klient se **nikdy sám neopakuje**; po chybě spojení nebo vypršení limitu zavolej
  totéž znovu se stejným klíčem, brána vrátí uložený výsledek a tržbu nezaeviduje dvakrát.
  Použij číslo účtenky.
- **Časový limit:** výchozí 30 s na požadavek. Synchronní odeslání čeká na EET (do `timeoutMs`
  pokladny, výchozích 10 s), limit tedy drž nad ním.
- **Další operace:** dávky (`submit_batch`, i `*_raw` pro NDJSON, CSV, XML), `validate_sales`,
  `retry_sale`, `get_sale_attempts`, `list_queue` (+ procházení všech stránek), `list_registers`
  (platnost certifikátů), `health`, `get_openapi`, `get_docs`.
- **Nové pole nebo stav:** klient je ignoruje (neznámý stav je `Unknown` / řetězec), takže starší
  klient s novější bránou nespadne.
- Tělo jiného formátu (XML `<Data>` / `<Trzba>`, formulář) pošleš přes `submit_sale_raw`.

## Verze

Klienty mluví s **HTTP API v1** (`/v1/...`). Jejich verze je zatím `0.x` jako brána; hlavní verze
klientů se zvedne spolu s `/v2`. Změny API jen přidávají pole a operace (v rámci `v1`), takže
klient se nemusí měnit hned.

## Proč ručně psaní, ne generovaní

Rozhodli jsme se pro tenké ručně psané klienty (jeden až několik malých souborů, žádné závislosti)
místo generovaného kódu z OpenAPI:

- generátory (OpenAPI Generator, Kiota) vyrobí stovky souborů a tahají runtime závislosti
  (Guzzle, `urllib3`, Newtonsoft…), což pokladní software nechce;
- schémata používají `anyOf`/`oneOf` (číslo nebo řetězec, jedna tržba nebo pole) a pole s českými
  názvy, kde generované typy vychází nepřirozeně;
- chování, které na API záleží (`202` a čekání, `422` jako výsledek místo chyby, `409` na
  idempotenci, žádné skryté opakování), by si stejně musel každý dopsat.

Ruční psaní má jednu cenu: klienti se mohou rozejít se specifikací. Proto je hlídá
[`scripts/gen-clients.ts`](../scripts/gen-clients.ts) a testy samotných klientů (viz Vývoj).
Kdo chce jiný jazyk, vygeneruje si klienta z `docs/openapi.json`
([examples/README.md](../examples/README.md)).

## Vývoj

```sh
bun scripts/gen-clients.ts          # hlídač rozdílů proti docs/openapi.json (běží i v `bun test`)
bun scripts/gen-clients.ts --list   # tabulka operací × klientů

cd clients/python && pip install -e ".[test]" && pytest
cd clients/php    && composer install && vendor/bin/phpunit
cd clients/dotnet && dotnet test
cd clients/java   && mvn test
```

- Testy klientů běží proti malému falešnému serveru v procesu (ne proti EET): Python
  `http.server`, PHP `php -S` a mock transportu, C# `HttpListener`, Java `HttpServer` z JDK.
- **Hlídač rozdílů** má dvě půlky. `scripts/gen-clients.ts` staticky zkontroluje, že tabulka
  operací každého klienta (operationId, metoda, cesta) odpovídá `docs/openapi.json` a že se všechny
  query/header parametry a pole schémat v klientovi objevují. Test v každém jazyce
  (`*openapi_coverage*`, `OpenApiCoverage*`) projde operace ze specifikace, zavolá každou přes
  klienta a ověří metodu, cestu a parametry. Přibude-li operace, parametr nebo pole, CI
  (`.github/workflows/clients.yml` a hlavní `bun test`) spadne, dokud klienti nedoženou API.
- **Integrační testy** (`test_integration.py`, `IntegrationTest.php`, `IntegrationTests.cs`,
  `IntegrationTest.java`) se
  spouštějí s `EET_URL` a běží proti skutečné bráně nad falešným EET
  (`bun scripts/examples-server.ts 8080`, klíč `examples-key-0123456789`). Bez `EET_URL` se
  přeskočí. Do EET se nic neposílá.

## Publikace (pro správce)

Publikuje workflow [`publish-clients.yml`](../.github/workflows/publish-clients.yml) po nahrání
tagu `clients-vX.Y.Z`. Verze v tagu se musí shodovat s `pyproject.toml`, `EetGateway.Client.csproj`,
`java/pom.xml` a konstantami `__version__` / `Client::VERSION` / `EetGatewayClient.Version` /
`EetGatewayClient.VERSION` (verzi PHP balíčku nese tag); jinak workflow hned skončí. Každý registr se zapíná vlastní proměnnou repozitáře
(Settings → Secrets and variables → Actions), takže bez nastavení se nic nepublikuje.

1. **PyPI** (`eet-gateway-client`), proměnná `PUBLISH_PYPI=true`. Na pypi.org → _Publishing_ →
   _Add a new pending publisher_: GitHub, vlastník `hospodskej-cz`, repozitář `eet-2-0`, workflow
   `publish-clients.yml`, prostředí prázdné. Žádný token se nevytváří.
2. **NuGet** (`EetGateway.Client`), proměnná `PUBLISH_NUGET=true`. Buď _Trusted Publishing_ na
   nuget.org (vlastník `hospodskej-cz`, repozitář `eet-2-0`, workflow `publish-clients.yml`) a
   proměnná `NUGET_USER` se jménem profilu na nuget.org, nebo secret `NUGET_API_KEY` (klíč s právem
   push pro `EetGateway.Client`).
3. **Packagist** (`hospodskej-cz/eet-gateway-client`), proměnná `PUBLISH_PACKAGIST=true`.
   Packagist chce `composer.json` v kořeni repozitáře, proto workflow zrcadlí `clients/php`
   (včetně historie, `git subtree split`) do `hospodskej-cz/eet-gateway-php` a nahraje tam i tag
   `vX.Y.Z`. Zrcadlo je jen ke čtení, issues a PR patří do tohoto repozitáře. Potřebuje secret
   `PHP_MIRROR_TOKEN` (fine-grained token s _Contents: read and write_ jen pro zrcadlo; deploy
   klíče organizace nepovoluje). Na packagist.org → _Submit_ zadej
   `https://github.com/hospodskej-cz/eet-gateway-php`. Nové tagy si Packagist bere přes hook, jinak
   nastav secret `PACKAGIST_TOKEN` a proměnnou `PACKAGIST_USER`.
4. **Maven Central** (`io.github.hospodskej-cz:eet-gateway-client`), proměnná `PUBLISH_MAVEN=true`.
   Jednorázově: účet na [central.sonatype.com](https://central.sonatype.com) (přihlášení přes
   GitHub), _Namespaces_ → přidat `io.github.hospodskej-cz` a ověřit ho (portál řekne, jak
   pojmenovat dočasný veřejný repozitář v organizaci `hospodskej-cz`), pak _Account_ →
   _Generate User Token_. Podpisový klíč: `gpg --full-generate-key`, veřejnou část nahrát na
   `keyserver.ubuntu.com` (`gpg --keyserver keyserver.ubuntu.com --send-keys <ID>`), soukromou
   exportovat `gpg --armor --export-secret-keys <ID>`. Do secrets repozitáře:
   `MAVEN_CENTRAL_USERNAME` a `MAVEN_CENTRAL_PASSWORD` (z user tokenu), `MAVEN_GPG_PRIVATE_KEY`,
   `MAVEN_GPG_PASSPHRASE`. Verzi, která už je na Central, workflow přeskočí (Central verzi
   nikdy nepřepíše ani nesmaže).

Vydání: zvedni verzi na všech místech výše, slij do `main`, pak
`git tag clients-vX.Y.Z && git push origin clients-vX.Y.Z`.

---

## English

Small, typed clients for the gateway's HTTP API (`/v1`, described by
[`docs/openapi.json`](../docs/openapi.json)), so POS integrators do not have to hand-roll HTTP.
Each covers every operation and is one thin package with no dependencies:

| Language | Package                                            | Needs                         | Folder              |
| -------- | -------------------------------------------------- | ----------------------------- | ------------------- |
| PHP      | `hospodskej-cz/eet-gateway-client` (Composer)      | PHP 8.1+, `ext-curl`          | [`php/`](php)       |
| Python   | `eet-gateway-client` (import `eet_gateway_client`) | Python 3.9+, standard library | [`python/`](python) |
| C#       | `EetGateway.Client` (NuGet)                        | .NET 8, `System.Text.Json`    | [`dotnet/`](dotnet) |
| Java     | `io.github.hospodskej-cz:eet-gateway-client` (Maven Central) | Java 17+, JDK only (`java.net.http`) | [`java/`](java) |

The packages are published to Packagist, PyPI, NuGet and Maven Central by a workflow when a
`clients-vX.Y.Z` tag is pushed (maintainer steps are at the end). Install: `pip install
eet-gateway-client`, `composer require hospodskej-cz/eet-gateway-client`, `dotnet add package
EetGateway.Client`, or the Maven coordinates `io.github.hospodskej-cz:eet-gateway-client`.

**Usage** is shown above in Python, PHP, C# and Java; the shape is identical in all four: send a sale
with an `Idempotency-Key` (your receipt number), get a typed `SaleResult` with a `status`
(`accepted | verification_ok | rejected | queued | uncertain | invalid`), and if it is not settled
call `wait_for_sale`.

**What the clients do**

| Gateway answer | Client                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| `200`          | returns a `SaleResult`: `accepted`, `verification_ok` or `rejected` (an EET rejection is **not** an exception)  |
| `202`          | returns a `SaleResult` with `queued` or `uncertain`; `wait_for_sale` polls `GET /v1/sales/{id}`                 |
| `422` (a sale) | returns a `SaleResult` with `invalid` and `issues`; nothing was sent                                            |
| `409` (a key)  | throws `IdempotencyConflict…` carrying the result: the `Idempotency-Key` belongs to another sale                |
| other errors   | throws a typed exception (`400`, `401`, `404`, `409`, `413`, `415`, `422`, `5xx`) with `error.code` and message |
| no answer      | throws `Transport…` (and `…Timeout…` when the time limit passes)                                                |
- **Idempotency:** `Idempotency-Key` (1-255 printable ASCII characters) is an optional argument of
  every submit. The client **never retries on its own**; after a network error or a timeout call
  again with the same key and the gateway returns the stored result without registering the sale
  twice. Use the receipt number.
- **Timeout:** 30 s per request by default. A synchronous submit waits for EET (up to the
  register's `timeoutMs`, 10 s by default), so keep the limit above that.
- **Other operations:** batches (`submit_batch`, plus `*_raw` for NDJSON, CSV, XML),
  `validate_sales`, `retry_sale`, `get_sale_attempts`, `list_queue` (plus paging through all pages),
  `list_registers` (certificate validity), `health`, `get_openapi`, `get_docs`.
- **New fields or statuses** are ignored (an unknown status is `Unknown` / a plain string), so an
  older client does not break on a newer gateway.
- Another body format (XML `<Data>` / `<Trzba>`, form) goes through `submit_sale_raw`.

**Versioning.** The clients speak **HTTP API v1** (`/v1/...`). Their version is `0.x` like the
gateway's for now; the major version of the clients moves with `/v2`. Changes within `v1` only add
fields and operations, so a client does not need to change right away.

**Why hand-written, not generated.** Thin hand-written clients (a few small files, no
dependencies) instead of code generated from OpenAPI: generators produce hundreds of files and
pull in runtime dependencies (Guzzle, `urllib3`, Newtonsoft, ...) that POS software does not want;
the schemas use `anyOf`/`oneOf` (number or string, one sale or an array) and Czech field names,
which generated types render awkwardly; and the behaviour that matters (`202` and waiting, `422`
as a result instead of an error, `409` for idempotency, no hidden retries) would have to be added
by hand anyway. The price is possible drift from the spec, so
[`scripts/gen-clients.ts`](../scripts/gen-clients.ts) and the clients' own tests guard it. For any
other language generate a client from `docs/openapi.json` ([examples/README.md](../examples/README.md)).

**Development.** See **Vývoj** above for the commands. The client tests run against a tiny
in-process fake server, not EET. The drift guard has two halves: the script checks statically that
each client's operation table, parameters and schema properties match `docs/openapi.json`, and a
test in each language walks the operations of the spec, calls each through the client and checks
method, path and parameters. Adding an operation, parameter or field to the API fails CI
(`.github/workflows/clients.yml` and the main `bun test`) until the clients catch up. Integration
tests run against the real gateway over a fake EET when `EET_URL` is set; nothing is sent to EET.

**Publishing (maintainers).** `.github/workflows/publish-clients.yml` runs on a `clients-vX.Y.Z`
tag, after checking that the tag equals the version in all four clients. Each registry has its own
switch (`PUBLISH_PYPI`, `PUBLISH_NUGET`, `PUBLISH_PACKAGIST`, `PUBLISH_MAVEN`): PyPI and NuGet over trusted
publishing (OIDC, no stored token; NuGet can also use the secret `NUGET_API_KEY`); Packagist reads
a read-only mirror, `hospodskej-cz/eet-gateway-php`, that the workflow fills from `clients/php`
(it needs a fine-grained token `PHP_MIRROR_TOKEN`, since organisation deploy keys are off); Maven
Central takes a signed bundle (namespace `io.github.hospodskej-cz`, secrets `MAVEN_CENTRAL_USERNAME`,
`MAVEN_CENTRAL_PASSWORD`, `MAVEN_GPG_PRIVATE_KEY`, `MAVEN_GPG_PASSPHRASE`). Setup details are in the
Czech section above.
