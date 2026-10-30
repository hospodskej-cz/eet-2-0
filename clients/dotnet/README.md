# EetGateway.Client (C#)

Typed .NET 8 client for the [EET Gateway](https://github.com/hospodskej-cz/eet-2-0) HTTP API v1
(Czech EET 2.0). `HttpClient` + `System.Text.Json`, no other dependencies. Česky a o ostatních
jazycích: [clients/README.md](../README.md).

```sh
dotnet add package EetGateway.Client
```

```csharp
using EetGateway.Client;

using var client = new EetGatewayClient("http://localhost:8080", Environment.GetEnvironmentVariable("EET_API_KEY"));

var result = await client.SubmitSaleAsync(
    new SaleInput { PoradCis = "R-1001", DatTrzby = DateTimeOffset.Now, CelkTrzba = 123.50m },
    new SubmitOptions { IdempotencyKey = "R-1001" }); // repeat the call with the same key after any error
if (result.IsPending)                                  // Queued | Uncertain: the gateway keeps sending
    result = await client.WaitForSaleAsync(result);

Console.WriteLine($"{result.Status} {result.Pok}");
```

- `SubmitSaleAsync` returns a `SaleResult` for HTTP 200 (`Accepted`, `VerificationOk`, `Rejected`),
  202 (`Queued`, `Uncertain`) and 422 (`Invalid`, see `result.Issues`). 409 throws
  `IdempotencyConflictException`; other error statuses throw `ApiException` subclasses; no answer
  throws `TransportException` / `RequestTimeoutException` (all derive from `EetGatewayException`).
- Every operation of the API is covered: `SubmitSaleAsync`, `SubmitBatchAsync`, `GetSaleAsync`,
  `GetSaleAttemptsAsync`, `RetrySaleAsync`, `ListQueueAsync` / `ListQueueAllAsync`,
  `ListRegistersAsync`, `ValidateSalesAsync`, `HealthAsync`, `GetOpenApiAsync`, `GetDocsAsync`;
  `*RawAsync` variants take NDJSON, CSV or XML.
- Pass your own `HttpClient` (for `IHttpClientFactory`, proxies, handlers) with
  `new EetGatewayClient(httpClient, apiKey)`; its `BaseAddress` is the gateway root. The client sets
  the key and the timeout per request and never disposes a client it did not create.
- `EetGatewayClientOptions.Timeout` (default 30 s) bounds each request. The client does not retry
  by itself.

Tests: `dotnet test clients/dotnet`. With `EET_URL` set (see the [overview](../README.md#vývoj))
the integration tests run against a real gateway too.
