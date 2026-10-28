"""Exception hierarchy of the EET Gateway client.

    EetGatewayError
    ├── TransportError              no HTTP answer: connection refused, DNS, TLS, reset
    │   └── RequestTimeoutError     no answer within the timeout
    ├── InvalidResponseError        an answer that is not the documented JSON
    └── ApiError                    the gateway answered with an error status
        ├── BadRequestError         400  bad_request
        ├── AuthenticationError     401  unauthorized
        ├── NotFoundError           404  not_found
        ├── ConflictError           409  not_retryable, in_progress, unknown_register
        │   └── IdempotencyConflictError   409  Idempotency-Key belongs to another sale
        ├── PayloadTooLargeError    413  payload_too_large
        ├── UnsupportedMediaTypeError  415
        ├── UnprocessableError      422  single_sale_expected
        └── ServerError             5xx  internal

A sale that failed validation (`invalid`, HTTP 422) or was `rejected` by EET is *not* an
exception: it comes back as a `SaleResult` with `status` and `issues`.

After a `TransportError` on a submit the sale may or may not have reached the gateway. Repeat the
call with the same `Idempotency-Key`: the gateway returns the stored result and never registers
the sale twice.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Mapping, Optional

if TYPE_CHECKING:  # pragma: no cover
    from .models import SaleResult


class EetGatewayError(Exception):
    """Base class of everything this library raises."""


class TransportError(EetGatewayError):
    """No HTTP answer was received."""


class RequestTimeoutError(TransportError):
    """The gateway did not answer within the client timeout."""


class InvalidResponseError(EetGatewayError):
    """The gateway answered with something that is not the documented JSON."""

    def __init__(self, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status


class ApiError(EetGatewayError):
    """The gateway answered with an error status."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        headers: Optional[Mapping[str, str]] = None,
    ) -> None:
        super().__init__(f"HTTP {status} {code}: {message}")
        self.status = status
        #: Stable machine-readable code from the `{"error": {"code"}}` body, e.g. `not_found`.
        self.code = code
        self.message = message
        self.headers = dict(headers or {})


class BadRequestError(ApiError):
    """400: a query parameter or header is invalid."""


class AuthenticationError(ApiError):
    """401: the API key is missing or wrong."""


class NotFoundError(ApiError):
    """404: no such record."""


class ConflictError(ApiError):
    """409: the record is final (`not_retryable`), being sent (`in_progress`) or its register is gone."""


class IdempotencyConflictError(ConflictError):
    """409: the Idempotency-Key was already used for a different sale. Nothing was sent."""

    def __init__(self, result: "SaleResult", headers: Optional[Mapping[str, str]] = None) -> None:
        first = result.issues[0] if result.issues else None
        super().__init__(
            409,
            first.code if first else "idempotency_conflict",
            first.message if first else "Idempotency-Key was used for another sale.",
            headers,
        )
        self.result = result


class PayloadTooLargeError(ApiError):
    """413: the body is over the gateway limit (64 KiB a sale, 10 MiB a batch)."""


class UnsupportedMediaTypeError(ApiError):
    """415: the Content-Type is not supported by the endpoint."""


class UnprocessableError(ApiError):
    """422 with an error body, e.g. `single_sale_expected` (a batch sent to submit_sale)."""


class ServerError(ApiError):
    """5xx: the gateway failed (details only in its log)."""
