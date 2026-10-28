# Příklady integrace

Každý příklad pošle jednu tržbu s `Idempotency-Key` (vlastní unikátní číslo účtenky) a
vypíše výsledek. Odpovědi ošetřuje takto:

| HTTP odpověď | Co příklad udělá                                                        |
| ------------ | ----------------------------------------------------------------------- |
| `200`        | EET odpovědělo, příklad vypíše výsledek                                 |
| `202`        | Tržba je ve frontě nebo nejistá; příklad se ptá na `GET /v1/sales/{id}` |
| `409`, `422` | Vypíše `issues`, nic se neodeslalo                                      |

Příklad skončí s kódem 0, když je tržba `accepted` nebo `verification_ok`.

| Příklad                                 | Požadavky                             | Spuštění                                                         |
| --------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| [curl](curl/send.sh)                    | bash, curl, jq                        | `examples/curl/send.sh`                                          |
| [PHP](php/send.php)                     | PHP 8.1+, ext-curl                    | `php examples/php/send.php`                                      |
| [Python](python/send.py)                | Python 3.9+ (jen standardní knihovna) | `python3 examples/python/send.py`                                |
| [C#](csharp/EetExample/Program.cs)      | .NET 8                                | `dotnet run --project examples/csharp/EetExample`                |
| [Node, knihovna bez HTTP](node/send.ts) | Node.js 22.18+ nebo Bun               | `EET_P12=kasa.p12 EET_P12_PASSWORD=… node examples/node/send.ts` |

HTTP příklady čtou `EET_URL` (výchozí `http://localhost:8080`) a `EET_API_KEY`. Hodnoty
`eic_popl`, `id_jednotky` a `id_pokl` doplní brána z konfigurace pokladny
([`eet.config.example.yaml`](eet.config.example.yaml)), takže je tržba nemusí posílat.

## Vyzkoušení bez EET

`scripts/examples-server.ts` spustí skutečné HTTP API nad falešným EET. Nic se nikam neposílá.
První pokus o každou tržbu skončí „timeoutem“ a doposlání o půl sekundy později projde, takže
příklady projdou i větví `202`. Stejně je spouští CI.

```sh
bun scripts/examples-server.ts 8080 &
export EET_URL=http://localhost:8080 EET_API_KEY=examples-key-0123456789
examples/curl/send.sh && php examples/php/send.php && python3 examples/python/send.py
```

Příklad pro Node posílá přímo na playground EET. Na playgroundu se nic neeviduje; testovací
certifikát stáhne `bun run certs:playground`.

## Klient z OpenAPI

Hotové vygenerované klienty pro PHP, Python a C# jsou v [`clients/`](../clients/README.md).

Pro jiné jazyky nebo pro typovaného klienta vygeneruj kód z [`docs/openapi.json`](../docs/openapi.json),
například přes [OpenAPI Generator](https://openapi-generator.tech/):

```sh
docker run --rm -v "$PWD:/local" openapitools/openapi-generator-cli generate \
  -i /local/docs/openapi.json -g java -o /local/build/eet-client-java   # nebo go, kotlin, ruby, …
```

Zdrojem pravdy je OpenAPI; ručně psané SDK projekt nevydává.
