"""EET Gateway HTTP API v1 client: urllib from the standard library, no dependencies."""

from __future__ import annotations

import json
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import (
    Any,
    Dict,
    Iterable,
    Iterator,
    List,
    Mapping,
    Optional,
    Sequence,
    Tuple,
    Union,
)

from .errors import (
    ApiError,
    AuthenticationError,
    BadRequestError,
    ConflictError,
    IdempotencyConflictError,
    InvalidResponseError,
    NotFoundError,
    PayloadTooLargeError,
    RequestTimeoutError,
    ServerError,
    TransportError,
    UnprocessableError,
    UnsupportedMediaTypeError,
)
from .models import (
    Attempt,
    BatchResult,
    Health,
    JsonObject,
    QueuePage,
    Register,
    SaleInput,
    SaleResult,
    SaleStatus,
    ValidationBatch,
    json_default,
)

__version__ = "0.1.0"

#: Every operation of docs/openapi.json: operationId -> (HTTP method, path). The methods below
#: send requests through this table, and scripts/gen-clients.ts fails CI when it falls behind
#: the OpenAPI document.
OPERATIONS: Dict[str, Tuple[str, str]] = {
    "submitSale": ("POST", "/v1/sales"),
    "submitBatch": ("POST", "/v1/sales/batch"),
    "getSale": ("GET", "/v1/sales/{id}"),
    "getSaleAttempts": ("GET", "/v1/sales/{id}/attempts"),
    "retrySale": ("POST", "/v1/sales/{id}/retry"),
    "listQueue": ("GET", "/v1/queue"),
    "listRegisters": ("GET", "/v1/registers"),
    "validateSales": ("POST", "/v1/validate"),
    "health": ("GET", "/health"),
    "openapi": ("GET", "/openapi.json"),
    "docs": ("GET", "/docs"),
}

JSON = "application/json"
_IDEMPOTENCY_KEY = re.compile(r"^[\x21-\x7e]{1,255}$")

Body = Union[str, bytes]
SaleLike = Union[SaleInput, Mapping[str, Any]]
StatusLike = Union[str, SaleStatus]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A gateway does not redirect; following one would replay POSTs as GETs and leak the key."""

    def redirect_request(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        return None


class _Response:
    __slots__ = ("status", "headers", "body")

    def __init__(self, status: int, headers: Mapping[str, str], body: bytes) -> None:
        self.status = status
        self.headers = headers
        self.body = body


class EetGatewayClient:
    """Client for one EET Gateway.

    >>> client = EetGatewayClient("http://localhost:8080", api_key="...")
    >>> result = client.submit_sale(
    ...     {"porad_cis": "R-1001", "dat_trzby": "2027-01-05T12:00:00+01:00", "celk_trzba": "123.50"},
    ...     idempotency_key="R-1001",
    ... )
    >>> if result.is_pending:
    ...     result = client.wait_for_sale(result)

    `api_key` may be None only for a gateway started with `--dev`. `timeout` (seconds) bounds
    every request; a synchronous submit waits for EET, up to the register's `timeoutMs`
    (10 s by default), so keep it above that. The client never retries on its own: repeat a
    submit yourself with the same `idempotency_key`.
    """

    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        *,
        timeout: float = 30.0,
        user_agent: Optional[str] = None,
        opener: Optional[urllib.request.OpenerDirector] = None,
    ) -> None:
        if not base_url.startswith(("http://", "https://")):
            raise ValueError("base_url must start with http:// or https://")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.user_agent = user_agent or f"eet-gateway-client-python/{__version__}"
        self._opener = opener or urllib.request.build_opener(_NoRedirect)

    # --- sales ------------------------------------------------------------------------------

    def submit_sale(
        self,
        sale: SaleLike,
        *,
        idempotency_key: Optional[str] = None,
        mode: Optional[str] = None,
        verify: Optional[bool] = None,
        register: Optional[str] = None,
    ) -> SaleResult:
        """POST /v1/sales: validates, stores and sends one sale.

        Returns the `SaleResult` for HTTP 200 (`accepted`, `verification_ok`, `rejected`),
        202 (`queued`, `uncertain`: use `wait_for_sale`) and 422 (`invalid`: see `issues`,
        nothing was sent). Raises `IdempotencyConflictError` on 409.

        mode: "sync" (default; waits for the first attempt) or "async" (answers 202 at once).
        verify: verification mode, EET checks the message and registers nothing.
        """
        return self.submit_sale_raw(
            json.dumps(sale, default=json_default),
            JSON,
            idempotency_key=idempotency_key,
            mode=mode,
            verify=verify,
            register=register,
        )

    def submit_sale_raw(
        self,
        body: Body,
        content_type: str,
        *,
        idempotency_key: Optional[str] = None,
        mode: Optional[str] = None,
        verify: Optional[bool] = None,
        register: Optional[str] = None,
    ) -> SaleResult:
        """`submit_sale` for a body you already serialized: XML (`<Data>`, `<Trzba>`), JSON, form."""
        response = self._send(
            "submitSale",
            query={"mode": mode, "verify": verify, "register": register},
            body=body,
            content_type=content_type,
            idempotency_key=idempotency_key,
        )
        return self._sale_result(response, accept=(200, 202, 422))

    def submit_batch(
        self,
        sales: Iterable[SaleLike],
        *,
        idempotency_key: Optional[str] = None,
        mode: Optional[str] = None,
        verify: Optional[bool] = None,
        register: Optional[str] = None,
    ) -> BatchResult:
        """POST /v1/sales/batch: resending after an outage or migration (default mode: async).

        Each row is stored and sent on its own and keyed `<idempotency_key>:<row>`. HTTP 200
        and 422 (the source could not be read: `issues`) both return a `BatchResult`.
        """
        return self.submit_batch_raw(
            json.dumps(list(sales), default=json_default),
            JSON,
            idempotency_key=idempotency_key,
            mode=mode,
            verify=verify,
            register=register,
        )

    def submit_batch_raw(
        self,
        body: Body,
        content_type: str,
        *,
        idempotency_key: Optional[str] = None,
        mode: Optional[str] = None,
        verify: Optional[bool] = None,
        register: Optional[str] = None,
    ) -> BatchResult:
        """`submit_batch` for NDJSON (`application/x-ndjson`), CSV (`text/csv`) or XML."""
        response = self._send(
            "submitBatch",
            query={"mode": mode, "verify": verify, "register": register},
            body=body,
            content_type=content_type,
            idempotency_key=idempotency_key,
        )
        return BatchResult.from_dict(self._json(response, accept=(200, 422)))

    def get_sale(self, sale_id: str) -> SaleResult:
        """GET /v1/sales/{id}: the current state. Raises `NotFoundError`."""
        response = self._send("getSale", path={"id": sale_id})
        return SaleResult.from_dict(self._json(response, accept=(200,)))

    def get_sale_attempts(self, sale_id: str) -> List[Attempt]:
        """GET /v1/sales/{id}/attempts: every message sent for the sale, oldest first."""
        response = self._send("getSaleAttempts", path={"id": sale_id})
        return [Attempt.from_dict(a) for a in self._json(response, accept=(200,))["items"]]

    def retry_sale(self, sale_id: str) -> SaleResult:
        """POST /v1/sales/{id}/retry: send a `queued`, `uncertain` or `rejected` sale now.

        Raises `ConflictError` (`not_retryable`, `in_progress`, `unknown_register`).
        """
        response = self._send("retrySale", path={"id": sale_id})
        return self._sale_result(response, accept=(200, 202))

    def wait_for_sale(
        self,
        sale: Union[str, SaleResult],
        *,
        timeout: float = 30.0,
        interval: float = 1.0,
    ) -> SaleResult:
        """Polls `get_sale` until the sale is neither `queued` nor `uncertain`.

        Gives up after `timeout` seconds and returns the last state, so check `is_pending`: the
        gateway keeps resending in the background, you can ask again later.
        """
        if isinstance(sale, SaleResult):
            if sale.is_final or sale.id is None:
                return sale
            sale_id, current = sale.id, sale
        else:
            sale_id, current = sale, self.get_sale(sale)
        deadline = time.monotonic() + timeout
        while current.is_pending and time.monotonic() < deadline:
            time.sleep(interval)
            current = self.get_sale(sale_id)
        return current

    # --- queue, registers, validation -------------------------------------------------------

    def list_queue(
        self,
        *,
        status: Union[None, StatusLike, Sequence[StatusLike]] = None,
        register: Optional[str] = None,
        from_: Union[None, str, datetime] = None,
        to: Union[None, str, datetime] = None,
        overdue: Optional[bool] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> QueuePage:
        """GET /v1/queue: one page, newest first (`limit` 1-500, default 50).

        status: one status or several; from_/to filter `dat_trzby` (from inclusive, to exclusive).
        overdue: only sales without POK 48 h after they happened (True), or only the others.
        """
        if status is not None and not isinstance(status, (str, SaleStatus)):
            status = ",".join(str(s) for s in status)
        response = self._send(
            "listQueue",
            query={
                "status": status,
                "register": register,
                "from": from_,
                "to": to,
                "overdue": overdue,
                "limit": limit,
                "cursor": cursor,
            },
        )
        return QueuePage.from_dict(self._json(response, accept=(200,)))

    def iter_queue(self, **filters: Any) -> Iterator[SaleResult]:
        """Every sale matching `list_queue` filters, following `next_cursor` page by page."""
        filters.pop("cursor", None)
        cursor: Optional[str] = None
        while True:
            page = self.list_queue(cursor=cursor, **filters)
            yield from page.items
            if not page.next_cursor:
                return
            cursor = page.next_cursor

    def list_registers(self) -> List[Register]:
        """GET /v1/registers: registers with certificate validity (`days_left`, `expires_soon`)."""
        response = self._send("listRegisters")
        return [Register.from_dict(r) for r in self._json(response, accept=(200,))["items"]]

    def validate_sales(
        self,
        sales: Iterable[SaleLike],
        *,
        verify: Optional[bool] = None,
        register: Optional[str] = None,
    ) -> ValidationBatch:
        """POST /v1/validate: the same ingest as a submit, but nothing is stored or sent."""
        return self.validate_sales_raw(
            json.dumps(list(sales), default=json_default), JSON, verify=verify, register=register
        )

    def validate_sales_raw(
        self,
        body: Body,
        content_type: str,
        *,
        verify: Optional[bool] = None,
        register: Optional[str] = None,
    ) -> ValidationBatch:
        """`validate_sales` for NDJSON, CSV, XML or a single JSON object."""
        response = self._send(
            "validateSales",
            query={"verify": verify, "register": register},
            body=body,
            content_type=content_type,
        )
        return ValidationBatch.from_dict(self._json(response, accept=(200, 422)))

    # --- system -----------------------------------------------------------------------------

    def health(self, *, check_eet: bool = False) -> Health:
        """GET /health (public). A degraded gateway (HTTP 503) is returned, not raised.

        check_eet: also probe every EET endpoint (the gateway caches the probe for 60 s).
        """
        response = self._send("health", query={"eet": check_eet or None}, authorize=False)
        return Health.from_dict(self._json(response, accept=(200, 503)))

    def get_openapi(self) -> JsonObject:
        """GET /openapi.json (public): the OpenAPI 3.1 document of the running gateway."""
        response = self._send("openapi", authorize=False)
        return self._json(response, accept=(200,))

    def get_docs(self) -> str:
        """GET /docs (public): the interactive API reference as HTML."""
        response = self._send("docs", authorize=False)
        if response.status != 200:
            raise self._error(response)
        return response.body.decode("utf-8")

    # --- internals --------------------------------------------------------------------------

    def _send(
        self,
        operation: str,
        *,
        path: Optional[Mapping[str, str]] = None,
        query: Optional[Mapping[str, Any]] = None,
        body: Optional[Body] = None,
        content_type: Optional[str] = None,
        idempotency_key: Optional[str] = None,
        authorize: bool = True,
    ) -> _Response:
        method, template = OPERATIONS[operation]
        url = self.base_url + template.format(
            **{k: urllib.parse.quote(v, safe="") for k, v in (path or {}).items()}
        )
        pairs = [(k, _query_value(v)) for k, v in (query or {}).items() if v is not None]
        if pairs:
            url += "?" + urllib.parse.urlencode(pairs)
        headers = {"Accept": JSON, "User-Agent": self.user_agent}
        if authorize and self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if idempotency_key is not None:
            if not _IDEMPOTENCY_KEY.fullmatch(idempotency_key):
                raise ValueError("idempotency_key must be 1-255 printable ASCII characters")
            headers["Idempotency-Key"] = idempotency_key
        data = None
        if body is not None:
            data = body.encode("utf-8") if isinstance(body, str) else body
            headers["Content-Type"] = content_type or JSON
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self._opener.open(request, timeout=self.timeout) as raw:
                return _Response(raw.status, dict(raw.headers.items()), raw.read())
        except urllib.error.HTTPError as error:  # 3xx/4xx/5xx still carry the body
            with error:
                return _Response(error.code, dict(error.headers.items()), error.read())
        except (socket.timeout, TimeoutError) as error:
            raise RequestTimeoutError(f"{method} {url} timed out after {self.timeout} s") from error
        except urllib.error.URLError as error:
            if isinstance(error.reason, (socket.timeout, TimeoutError)):
                raise RequestTimeoutError(
                    f"{method} {url} timed out after {self.timeout} s"
                ) from error
            raise TransportError(f"{method} {url} failed: {error.reason}") from error
        except OSError as error:  # connection reset while reading the body
            raise TransportError(f"{method} {url} failed: {error}") from error

    def _json(self, response: _Response, accept: Tuple[int, ...]) -> Any:
        if response.status not in accept:
            raise self._error(response)
        return _decode(response)

    def _sale_result(self, response: _Response, accept: Tuple[int, ...]) -> SaleResult:
        body = _decode(response) if response.body else None
        is_sale = isinstance(body, dict) and "status" in body
        if response.status == 409 and is_sale:
            result = SaleResult.from_dict(body)
            raise IdempotencyConflictError(result, response.headers)
        if response.status not in accept or not is_sale:
            raise self._error(response)
        headers = {k.lower(): v for k, v in response.headers.items()}
        return SaleResult.from_dict(
            body,
            location=headers.get("location"),
            replayed=headers.get("idempotent-replayed", "").lower() == "true",
        )

    def _error(self, response: _Response) -> ApiError:
        code, message = "http_error", f"unexpected HTTP {response.status}"
        try:
            body = json.loads(response.body)
        except ValueError:
            body = None
            text = response.body.decode("utf-8", "replace").strip()
            if text:
                message = text[:200]
        if isinstance(body, dict) and isinstance(body.get("error"), dict):
            code = str(body["error"].get("code", code))
            message = str(body["error"].get("message", message))
        elif isinstance(body, dict) and body.get("issues"):
            code = str(body["issues"][0].get("code", code))
            message = str(body["issues"][0].get("message", message))
        status = response.status
        cls = _ERRORS.get(status, ServerError if status >= 500 else ApiError)
        return cls(status, code, message, response.headers)


_ERRORS = {
    400: BadRequestError,
    401: AuthenticationError,
    404: NotFoundError,
    409: ConflictError,
    413: PayloadTooLargeError,
    415: UnsupportedMediaTypeError,
    422: UnprocessableError,
}


def _decode(response: _Response) -> Any:
    try:
        return json.loads(response.body)
    except ValueError as error:
        raise InvalidResponseError(
            f"HTTP {response.status}: the body is not JSON", response.status
        ) from error


def _query_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)
