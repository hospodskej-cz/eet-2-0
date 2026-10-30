# EET Gateway client (Java)

Typed Java 17 client for the [EET Gateway](https://github.com/hospodskej-cz/eet-2-0) HTTP API v1
(Czech EET 2.0). `java.net.http` from the JDK, **no dependencies** (not even a JSON library).
Česky a o ostatních jazycích: [clients/README.md](../README.md).

```xml
<dependency>
  <groupId>io.github.hospodskej-cz</groupId>
  <artifactId>eet-gateway-client</artifactId>
  <version>0.1.0</version>
</dependency>
```

```kotlin
implementation("io.github.hospodskej-cz:eet-gateway-client:0.1.0")  // Gradle (Kotlin DSL)
```

```java
import cz.hospodskej.eetgateway.*;
import java.math.BigDecimal;
import java.time.OffsetDateTime;

EetGatewayClient client =
    EetGatewayClient.builder("http://localhost:8080").apiKey(System.getenv("EET_API_KEY")).build();

SaleResult result =
    client.submitSale(
        SaleInput.of(OffsetDateTime.now(), new BigDecimal("123.50")).poradCis("R-1001"),
        new RequestOptions().idempotencyKey("R-1001")); // repeat the call with the same key after any error
if (result.isPending()) {                               // queued | uncertain: the gateway keeps sending
  result = client.waitForSale(result);
}

if (result.isSuccess()) {
  System.out.println("POK " + result.pok());
} else if ("invalid".equals(result.status())) {
  for (Issue issue : result.issues()) {
    System.out.println(issue.code() + " " + issue.field() + ": " + issue.message()); // nothing was sent
  }
}
```

- `submitSale` returns a `SaleResult` for HTTP 200 (`accepted`, `verification_ok`, `rejected`), 202
  (`queued`, `uncertain`) and 422 (`invalid`, see `issues()`). 409 throws
  `IdempotencyConflictException`; other error statuses throw `ApiException` subclasses; no answer
  throws `TransportException` / `RequestTimeoutException` (all derive from the unchecked
  `EetGatewayException`).
- Every operation of the API is covered: `submitSale`, `submitBatch`, `getSale`,
  `getSaleAttempts`, `retrySale`, `listQueue` / `iterateQueue`, `listRegisters`, `validateSales`,
  `health`, `getOpenApi`, `getDocs`; the `*Raw` variants take XML, NDJSON or CSV.
- A sale is a `SaleInput` or a plain `Map` with any field the gateway's ingest understands.
- Pass your own `HttpClient` (proxy, TLS, executor) with `builder(...).httpClient(...)`; it must not
  follow redirects. `builder(...).timeout(...)` (default 30 s) bounds each request. The client does
  not retry by itself and is thread-safe.
- Results are immutable records. A status this library does not know yet stays a plain string
  (`result.knownStatus()` is then empty); fields the gateway adds later are ignored.

Tests: `mvn -f clients/java/pom.xml test`. With `EET_URL` set (see the
[overview](../README.md#vývoj)) the integration tests run against a real gateway too.

MIT licence.
