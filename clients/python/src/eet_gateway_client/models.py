"""Typed models of the EET Gateway HTTP API v1 (docs/openapi.json).

Responses are parsed into frozen dataclasses with snake_case attributes; the EET field names
(`dat_trzby`, `celk_trzba`, ...) stay as they are on the wire. Fields the gateway adds later are
ignored; a status this library does not know yet is kept as a plain string.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Mapping, Optional, Union

JsonObject = Dict[str, Any]


class SaleStatus(str, Enum):
    """`SaleResult.status`. Compares equal to its string, so `result.status == "accepted"` works."""

    ACCEPTED = "accepted"  # EET registered the sale; `pok` is set
    VERIFICATION_OK = "verification_ok"  # verification mode: EET checked it, registered nothing
    REJECTED = "rejected"  # EET answered with an error (`code`, `message`)
    QUEUED = "queued"  # stored, not sent yet; the gateway keeps trying
    UNCERTAIN = "uncertain"  # sent, no answer; the gateway resends safely
    INVALID = "invalid"  # failed the local check (`issues`); nothing was sent

    def __str__(self) -> str:
        return self.value


#: Statuses that mean "still on its way": poll `get_sale` or use `wait_for_sale`.
PENDING_STATUSES = (SaleStatus.QUEUED, SaleStatus.UNCERTAIN)


def _status(value: Any) -> Union[SaleStatus, str]:
    try:
        return SaleStatus(value)
    except ValueError:
        return str(value)


@dataclass(frozen=True)
class SaleWarning:
    """A change or remark made while handling a sale (`warnings[]`)."""

    code: int
    message: str
    source: str  # "eet" | "ingest" | "queue"
    field: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "SaleWarning":
        return cls(code=d["code"], message=d["message"], source=d["source"], field=d.get("field"))


@dataclass(frozen=True)
class Issue:
    """Why a sale is invalid (`issues[]`)."""

    code: str
    message: str
    field: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "Issue":
        return cls(code=d["code"], message=d["message"], field=d.get("field"))


def _warnings(d: Mapping[str, Any]) -> List[SaleWarning]:
    return [SaleWarning.from_dict(w) for w in d.get("warnings") or []]


def _issues(d: Mapping[str, Any]) -> List[Issue]:
    return [Issue.from_dict(i) for i in d.get("issues") or []]


@dataclass(frozen=True)
class SaleData:
    """The EET `<Data>` stored for a sale; every attempt sends exactly this."""

    eic_popl: str
    id_jednotky: str
    id_pokl: str
    porad_cis: str
    dat_trzby: str
    celk_trzba: str
    eic_poverujiciho: Optional[str] = None
    povereni_vice_popl: Optional[bool] = None
    urceno_cerp_zuct: Optional[str] = None
    cerp_zuct: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "SaleData":
        return cls(
            eic_popl=d["eic_popl"],
            id_jednotky=d["id_jednotky"],
            id_pokl=d["id_pokl"],
            porad_cis=d["porad_cis"],
            dat_trzby=d["dat_trzby"],
            celk_trzba=d["celk_trzba"],
            eic_poverujiciho=d.get("eic_poverujiciho"),
            povereni_vice_popl=d.get("povereni_vice_popl"),
            urceno_cerp_zuct=d.get("urceno_cerp_zuct"),
            cerp_zuct=d.get("cerp_zuct"),
        )


@dataclass(frozen=True)
class SaleResult:
    """The state of one sale: the body of POST /v1/sales, GET /v1/sales/{id} and queue items."""

    status: Union[SaleStatus, str]
    warnings: List[SaleWarning] = field(default_factory=list)
    attempts: int = 0
    id: Optional[str] = None  # absent when nothing was stored (`invalid`)
    register: Optional[str] = None
    data: Optional[SaleData] = None
    pok: Optional[str] = None  # fiscal identification code, `accepted` only
    uuid: Optional[str] = None  # `uuid_zpravy` of the last attempt
    test: Optional[bool] = None  # EET answered from the playground
    code: Optional[int] = None  # EET error code of the last answer (`kod`)
    message: Optional[str] = None
    reason: Optional[str] = None  # why the last attempt has no EET answer: timeout, network, ...
    issues: List[Issue] = field(default_factory=list)
    next_attempt_at: Optional[str] = None  # ISO 8601 UTC
    overdue: Optional[bool] = None  # no POK 48 hours after the sale (ZoET §20)
    created_at: Optional[str] = None
    deadline_at: Optional[str] = None
    http_status: Optional[int] = None
    global_transaction_id: Optional[str] = None
    raw_request: Optional[str] = None  # debug only
    raw_response: Optional[str] = None  # debug only
    #: `Location` header of the submit response (`/v1/sales/{id}`).
    location: Optional[str] = None
    #: `Idempotent-Replayed: true`: the stored result of an earlier call with the same key.
    replayed: bool = False

    @classmethod
    def from_dict(
        cls, d: Mapping[str, Any], location: Optional[str] = None, replayed: bool = False
    ) -> "SaleResult":
        data = d.get("data")
        return cls(
            status=_status(d["status"]),
            warnings=_warnings(d),
            attempts=d.get("attempts", 0),
            id=d.get("id"),
            register=d.get("register"),
            data=SaleData.from_dict(data) if data else None,
            pok=d.get("pok"),
            uuid=d.get("uuid"),
            test=d.get("test"),
            code=d.get("code"),
            message=d.get("message"),
            reason=d.get("reason"),
            issues=_issues(d),
            next_attempt_at=d.get("nextAttemptAt"),
            overdue=d.get("overdue"),
            created_at=d.get("createdAt"),
            deadline_at=d.get("deadlineAt"),
            http_status=d.get("httpStatus"),
            global_transaction_id=d.get("globalTransactionId"),
            raw_request=d.get("rawRequest"),
            raw_response=d.get("rawResponse"),
            location=location,
            replayed=replayed,
        )

    @property
    def is_success(self) -> bool:
        """EET accepted the sale, or (verification mode) found it correct."""
        return self.status in (SaleStatus.ACCEPTED, SaleStatus.VERIFICATION_OK)

    @property
    def is_pending(self) -> bool:
        """`queued` or `uncertain`: not decided yet, the gateway keeps going."""
        return self.status in PENDING_STATUSES

    @property
    def is_final(self) -> bool:
        """Nothing more will happen without a manual retry."""
        return not self.is_pending


@dataclass(frozen=True)
class BatchRow:
    row: int  # JSON array: position from 1; NDJSON, CSV, XML: line number
    result: SaleResult

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "BatchRow":
        return cls(row=d["row"], result=SaleResult.from_dict(d["result"]))


@dataclass(frozen=True)
class BatchResult:
    """Result of POST /v1/sales/batch. When `issues` is set the source could not be read (422)."""

    rows: List[BatchRow]
    warnings: List[SaleWarning] = field(default_factory=list)
    issues: List[Issue] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "BatchResult":
        return cls(
            rows=[BatchRow.from_dict(r) for r in d.get("rows") or []],
            warnings=_warnings(d),
            issues=_issues(d),
        )


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    warnings: List[SaleWarning] = field(default_factory=list)
    issues: List[Issue] = field(default_factory=list)
    register: Optional[str] = None
    data: Optional[SaleData] = None  # the EET <Data> that would be sent
    overeni: Optional[bool] = None
    prvni_zaslani: Optional[bool] = None

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "ValidationResult":
        data = d.get("data")
        return cls(
            valid=d["valid"],
            warnings=_warnings(d),
            issues=_issues(d),
            register=d.get("register"),
            data=SaleData.from_dict(data) if data else None,
            overeni=d.get("overeni"),
            prvni_zaslani=d.get("prvni_zaslani"),
        )


@dataclass(frozen=True)
class ValidationRow:
    row: int
    result: ValidationResult

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "ValidationRow":
        return cls(row=d["row"], result=ValidationResult.from_dict(d["result"]))


@dataclass(frozen=True)
class ValidationBatch:
    """Result of POST /v1/validate. When `issues` is set the source could not be read (422)."""

    rows: List[ValidationRow]
    warnings: List[SaleWarning] = field(default_factory=list)
    issues: List[Issue] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "ValidationBatch":
        return cls(
            rows=[ValidationRow.from_dict(r) for r in d.get("rows") or []],
            warnings=_warnings(d),
            issues=_issues(d),
        )

    @property
    def valid(self) -> bool:
        """The source was readable and every row is valid."""
        return not self.issues and all(r.result.valid for r in self.rows)


@dataclass(frozen=True)
class Attempt:
    """One message sent to EET for a sale (GET /v1/sales/{id}/attempts)."""

    n: int
    uuid_zpravy: str
    dat_odesl: str
    prvni_zaslani: bool
    overeni: bool
    environment: str  # "playground" | "production"
    endpoint: str
    started_at: str
    finished_at: Optional[str] = None  # absent while the attempt is running
    #: accepted | verification_ok | rejected | not_sent | uncertain | interrupted
    outcome: Optional[str] = None
    reason: Optional[str] = None
    code: Optional[int] = None
    message: Optional[str] = None
    pok: Optional[str] = None
    http_status: Optional[int] = None
    global_transaction_id: Optional[str] = None
    duration_ms: Optional[int] = None

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "Attempt":
        return cls(
            n=d["n"],
            uuid_zpravy=d["uuid_zpravy"],
            dat_odesl=d["dat_odesl"],
            prvni_zaslani=d["prvni_zaslani"],
            overeni=d["overeni"],
            environment=d["environment"],
            endpoint=d["endpoint"],
            started_at=d["startedAt"],
            finished_at=d.get("finishedAt"),
            outcome=d.get("outcome"),
            reason=d.get("reason"),
            code=d.get("code"),
            message=d.get("message"),
            pok=d.get("pok"),
            http_status=d.get("httpStatus"),
            global_transaction_id=d.get("globalTransactionId"),
            duration_ms=d.get("durationMs"),
        )


@dataclass(frozen=True)
class QueuePage:
    """One page of GET /v1/queue, newest first."""

    items: List[SaleResult]
    next_cursor: Optional[str] = None  # pass as `cursor` for the next page

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "QueuePage":
        return cls(
            items=[SaleResult.from_dict(i) for i in d.get("items") or []],
            next_cursor=d.get("nextCursor"),
        )


@dataclass(frozen=True)
class Certificate:
    eic: str
    subject: str
    issuer: str
    serial_number: str
    fingerprint_sha256: str
    not_before: str
    not_after: str
    days_left: int  # negative once expired
    active: bool  # used for sending right now
    expires_soon: bool  # valid, but expires within 21 days
    expired: bool

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "Certificate":
        return cls(
            eic=d["eic"],
            subject=d["subject"],
            issuer=d["issuer"],
            serial_number=d["serialNumber"],
            fingerprint_sha256=d["fingerprintSha256"],
            not_before=d["notBefore"],
            not_after=d["notAfter"],
            days_left=d["daysLeft"],
            active=d["active"],
            expires_soon=d["expiresSoon"],
            expired=d["expired"],
        )


@dataclass(frozen=True)
class Register:
    """A configured cash register and its certificates (GET /v1/registers)."""

    id: str
    environment: str  # "playground" | "production"
    endpoint: str
    time_zone: str
    defaults: Dict[str, str]  # eic_popl, id_jednotky, id_pokl as far as configured
    certificates: List[Certificate]

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "Register":
        return cls(
            id=d["id"],
            environment=d["environment"],
            endpoint=d["endpoint"],
            time_zone=d["timeZone"],
            defaults=dict(d.get("defaults") or {}),
            certificates=[Certificate.from_dict(c) for c in d.get("certificates") or []],
        )


@dataclass(frozen=True)
class EetCheck:
    """Reachability of one EET endpoint (`/health?eet=true`)."""

    endpoint: str
    reachable: bool
    duration_ms: float
    checked_at: str
    http_status: Optional[int] = None
    error: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "EetCheck":
        return cls(
            endpoint=d["endpoint"],
            reachable=d["reachable"],
            duration_ms=d["durationMs"],
            checked_at=d["checkedAt"],
            http_status=d.get("httpStatus"),
            error=d.get("error"),
        )


@dataclass(frozen=True)
class Health:
    """Body of GET /health. `status` is "ok" or "degraded" (HTTP 503 is returned, not raised)."""

    status: str
    version: str
    database: str  # "ok" | "error"
    eet: Optional[List[EetCheck]] = None  # only with check_eet=True

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "Health":
        eet = d.get("eet")
        return cls(
            status=d["status"],
            version=d["version"],
            database=d["database"],
            eet=None if eet is None else [EetCheck.from_dict(e) for e in eet],
        )

    @property
    def ok(self) -> bool:
        return self.status == "ok"


# --- request side -------------------------------------------------------------------------------

Amount = Union[str, int, float, Decimal]
Moment = Union[str, int, datetime]


def _amount(value: Any) -> Any:
    """Decimal and float become a two-place string ("123.50"); strings and ints pass through."""
    if isinstance(value, (Decimal, float)):
        return f"{Decimal(str(value)).quantize(Decimal('0.01')):f}"
    return value


@dataclass
class SaleInput:
    """One sale as the gateway accepts it. Everything but the two required fields is optional:
    `eic_popl`, `id_jednotky` and `id_pokl` come from the register configuration.

    Instead of this class `submit_sale` also takes a plain dict with any field the gateway's
    ingest understands (docs/INGEST.md).
    """

    dat_trzby: Moment  # a datetime without tzinfo is read in the register's time zone
    celk_trzba: Amount  # "123.50"; a Decimal or float is formatted to 2 places
    porad_cis: Optional[Union[str, int]] = None
    eic_popl: Optional[str] = None
    eic_poverujiciho: Optional[str] = None
    povereni_vice_popl: Optional[bool] = None
    id_jednotky: Optional[Union[str, int]] = None
    id_pokl: Optional[str] = None
    urceno_cerp_zuct: Optional[Amount] = None
    cerp_zuct: Optional[Amount] = None
    overeni: Optional[bool] = None
    prvni_zaslani: Optional[bool] = None
    register: Optional[str] = None
    #: Any further field the ingest understands.
    extra: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> JsonObject:
        out: JsonObject = dict(self.extra)
        for name in _SALE_INPUT_FIELDS:
            value = getattr(self, name)
            if value is not None:
                out[name] = _amount(value) if name in _AMOUNT_FIELDS else value
        return out


_SALE_INPUT_FIELDS = (
    "eic_popl",
    "eic_poverujiciho",
    "povereni_vice_popl",
    "id_jednotky",
    "id_pokl",
    "porad_cis",
    "dat_trzby",
    "celk_trzba",
    "urceno_cerp_zuct",
    "cerp_zuct",
    "overeni",
    "prvni_zaslani",
    "register",
)
_AMOUNT_FIELDS = ("celk_trzba", "urceno_cerp_zuct", "cerp_zuct")


def json_default(value: Any) -> Any:
    """`json.dumps(default=...)` for the types sales are built from."""
    if isinstance(value, Decimal):
        return _amount(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, SaleInput):
        return value.to_dict()
    raise TypeError(f"{type(value).__name__} is not JSON serializable")
