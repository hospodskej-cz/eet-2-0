# hospodskej-cz/eet-gateway-client (PHP)

Typed PHP 8.1+ client for the [EET Gateway](https://github.com/hospodskej-cz/eet-2-0) HTTP API v1
(Czech EET 2.0). `ext-curl`, no other dependencies. Česky a o ostatních jazycích:
[clients/README.md](../README.md).

```sh
composer require hospodskej-cz/eet-gateway-client
```

```php
use EetGateway\Client\Client;

$client = new Client('http://localhost:8080', apiKey: getenv('EET_API_KEY') ?: null);

$result = $client->submitSale(
    ['porad_cis' => 'R-1001', 'dat_trzby' => date('c'), 'celk_trzba' => '123.50'],
    idempotencyKey: 'R-1001', // repeat the call with the same key after any error
);
if ($result->isPending()) {   // queued | uncertain: the gateway keeps sending
    $result = $client->waitForSale($result);
}

echo $result->status->value, ' ', $result->pok, "\n";
```

- `submitSale()` returns a `SaleResult` for HTTP 200 (`accepted`, `verification_ok`, `rejected`),
  202 (`queued`, `uncertain`) and 422 (`invalid`, see `$result->issues`). 409 throws
  `IdempotencyConflictException`; other error statuses throw `ApiException` subclasses; no answer
  throws `TransportException` / `TimeoutException` (all extend `EetGatewayException`).
- `SaleInput` is an alternative to a plain array; `DateTime` and `float` values are formatted for
  you.
- Every operation of the API is covered: `submitSale`, `submitBatch`, `getSale`, `getSaleAttempts`,
  `retrySale`, `listQueue` / `iterateQueue`, `listRegisters`, `validateSales`, `health`,
  `getOpenApi`, `getDocs`; `*Raw` variants take NDJSON, CSV or XML.
- The default transport is cURL and follows no redirects. To use Guzzle or a PSR-18 client implement
  the one-method `EetGateway\Client\Http\Transport` interface and pass it as `transport:`.
- `timeout:` (default 30 s) bounds each request. The client does not retry by itself.

Tests: `composer install && vendor/bin/phpunit`. With `EET_URL` set (see the
[overview](../README.md#vývoj)) the integration tests run against a real gateway too.
