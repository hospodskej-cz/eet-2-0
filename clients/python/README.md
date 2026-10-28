# eet-gateway-client (Python)

Typed Python client for the [EET Gateway](https://github.com/hospodskej-cz/eet-2-0) HTTP API v1
(Czech EET 2.0). Python 3.9+, standard library only. Česky a o ostatních jazycích:
[clients/README.md](../README.md).

```sh
pip install ./clients/python      # from a checkout; not on PyPI yet
```

```python
import os
from datetime import datetime
from eet_gateway_client import EetGatewayClient, IdempotencyConflictError, SaleStatus

client = EetGatewayClient("http://localhost:8080", api_key=os.environ["EET_API_KEY"])

result = client.submit_sale(
    {
        "porad_cis": "R-1001",
        "dat_trzby": datetime.now().astimezone().isoformat(timespec="seconds"),
        "celk_trzba": "123.50",
    },
    idempotency_key="R-1001",  # repeat the call with the same key after any error
)
if result.is_pending:  # queued | uncertain: the gateway keeps sending
    result = client.wait_for_sale(result)

print(result.status, result.pok)
```

- `submit_sale` returns a `SaleResult` for HTTP 200 (`accepted`, `verification_ok`, `rejected`),
  202 (`queued`, `uncertain`) and 422 (`invalid`, see `result.issues`). 409 raises
  `IdempotencyConflictError`; other error statuses raise `ApiError` subclasses; no answer raises
  `TransportError` / `RequestTimeoutError` (all derive from `EetGatewayError`).
- `SaleInput` (dataclass) is an alternative to a plain `dict`; `Decimal`, `float` and `datetime`
  values are formatted for you.
- Every operation of the API is covered: `submit_sale`, `submit_batch`, `get_sale`,
  `get_sale_attempts`, `retry_sale`, `list_queue` / `iter_queue`, `list_registers`,
  `validate_sales`, `health`, `get_openapi`, `get_docs`; `*_raw` variants take NDJSON, CSV or XML.
- The client does not retry by itself, follows no redirects and sends the API key only to the
  URL you gave it.

Tests: `pip install -e ".[test]" && pytest`. With `EET_URL` set (see the
[overview](../README.md#vývoj)) the integration tests run against a real gateway too.
