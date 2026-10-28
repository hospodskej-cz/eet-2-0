from __future__ import annotations

import json
import socket
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from conftest import sale_body
from eet_gateway_client import (
    ApiError,
    AuthenticationError,
    BadRequestError,
    ConflictError,
    EetGatewayClient,
    IdempotencyConflictError,
    InvalidResponseError,
    NotFoundError,
    PayloadTooLargeError,
    RequestTimeoutError,
    SaleInput,
    SaleStatus,
    ServerError,
    TransportError,
    UnprocessableError,
    UnsupportedMediaTypeError,
)

SALE = {"porad_cis": "R-1", "dat_trzby": "2027-01-05T12:00:00+01:00", "celk_trzba": "123.50"}


@pytest.fixture()
def client(gateway):
    return EetGatewayClient(gateway.url, "secret-key-0123456789", timeout=5)


# --- submit_sale: 200 / 202 / 422 / 409 -----------------------------------------------------


def test_submit_sale_accepted(client, gateway):
    gateway.respond(200, sale_body(), {"Location": "/v1/sales/sale-1"})
    result = client.submit_sale(SALE, idempotency_key="R-1")
    assert result.status == SaleStatus.ACCEPTED == "accepted"
    assert result.pok == "A1B2-C3"
    assert result.is_success and result.is_final and not result.is_pending
    assert result.location == "/v1/sales/sale-1"
    assert result.replayed is False
    request = gateway.last
    assert (request.method, request.path) == ("POST", "/v1/sales")
    assert request.headers["authorization"] == "Bearer secret-key-0123456789"
    assert request.headers["idempotency-key"] == "R-1"
    assert request.headers["content-type"] == "application/json"
    assert request.headers["user-agent"].startswith("eet-gateway-client-python/")
    assert request.json() == SALE
    assert request.query == {}


def test_submit_sale_query_options(client, gateway):
    gateway.respond(200, sale_body("verification_ok"))
    result = client.submit_sale(SALE, mode="async", verify=True, register="kasa-1")
    assert result.status == SaleStatus.VERIFICATION_OK and result.is_success
    assert gateway.last.query == {"mode": "async", "verify": "true", "register": "kasa-1"}
    assert "idempotency-key" not in gateway.last.headers


def test_submit_sale_rejected_is_a_result_not_an_error(client, gateway):
    gateway.respond(200, sale_body("rejected", code=4, message="Neplatný podpis"))
    result = client.submit_sale(SALE)
    assert result.status == SaleStatus.REJECTED
    assert (result.code, result.message) == (4, "Neplatný podpis")
    assert not result.is_success and result.is_final


@pytest.mark.parametrize("status", ["queued", "uncertain"])
def test_submit_sale_202_is_pending(client, gateway, status):
    gateway.respond(
        202,
        sale_body(status, reason="timeout", nextAttemptAt="2027-01-05T11:00:05Z"),
        {"Location": "/v1/sales/sale-1", "Idempotent-Replayed": "true"},
    )
    result = client.submit_sale(SALE)
    assert result.is_pending and not result.is_final and not result.is_success
    assert result.reason == "timeout"
    assert result.next_attempt_at == "2027-01-05T11:00:05Z"
    assert result.replayed is True


def test_submit_sale_422_invalid_returns_issues(client, gateway):
    gateway.respond(
        422,
        {
            "status": "invalid",
            "warnings": [{"code": 101, "message": "przesunięto", "source": "ingest", "field": "dat_trzby"}],
            "attempts": 0,
            "issues": [{"code": "missing_field", "message": "celk_trzba chybí", "field": "celk_trzba"}],
        },
    )
    result = client.submit_sale({"porad_cis": "R-1"})
    assert result.status == SaleStatus.INVALID and result.id is None
    assert result.issues[0].code == "missing_field"
    assert result.issues[0].field == "celk_trzba"
    assert result.warnings[0].source == "ingest" and result.warnings[0].field == "dat_trzby"


def test_submit_sale_409_idempotency_conflict(client, gateway):
    gateway.respond(
        409,
        {
            "status": "invalid",
            "warnings": [],
            "attempts": 0,
            "issues": [{"code": "idempotency_conflict", "message": "key used for another sale"}],
        },
    )
    with pytest.raises(IdempotencyConflictError) as caught:
        client.submit_sale(SALE, idempotency_key="R-1")
    assert isinstance(caught.value, ConflictError) and isinstance(caught.value, ApiError)
    assert caught.value.status == 409 and caught.value.code == "idempotency_conflict"
    assert caught.value.result.issues[0].code == "idempotency_conflict"


def test_submit_sale_422_single_sale_expected_is_an_error(client, gateway):
    gateway.respond(422, {"error": {"code": "single_sale_expected", "message": "one sale only"}})
    with pytest.raises(UnprocessableError) as caught:
        client.submit_sale([SALE, SALE])
    assert caught.value.code == "single_sale_expected"


def test_submit_sale_accepts_sale_input_decimal_and_datetime(client, gateway):
    gateway.respond(200, sale_body())
    sale = SaleInput(
        dat_trzby=datetime(2027, 1, 5, 12, 0, tzinfo=timezone(timedelta(hours=1))),
        celk_trzba=Decimal("99.9"),
        porad_cis=7,
        cerp_zuct=12.5,
        extra={"currency": "CZK"},
    )
    client.submit_sale(sale)
    assert gateway.last.json() == {
        "currency": "CZK",
        "porad_cis": 7,
        "dat_trzby": "2027-01-05T12:00:00+01:00",
        "celk_trzba": "99.90",
        "cerp_zuct": "12.50",
    }


def test_submit_sale_raw_xml(client, gateway):
    gateway.respond(200, sale_body())
    client.submit_sale_raw("<Data celk_trzba='1.00'/>", "application/xml", idempotency_key="x")
    assert gateway.last.headers["content-type"] == "application/xml"
    assert gateway.last.body == b"<Data celk_trzba='1.00'/>"


@pytest.mark.parametrize("key", ["", "a" * 256, "line\nbreak", "abc\n", "žluťoučký"])
def test_invalid_idempotency_key_is_rejected_before_sending(client, gateway, key):
    with pytest.raises(ValueError):
        client.submit_sale(SALE, idempotency_key=key)
    assert gateway.requests == []


# --- parsed models --------------------------------------------------------------------------


def test_sale_result_full_model(client, gateway):
    gateway.respond(
        200,
        sale_body(
            register="kasa-1",
            uuid="u-1",
            test=True,
            overdue=False,
            createdAt="2027-01-05T11:00:00Z",
            deadlineAt="2027-01-07T11:00:00Z",
            httpStatus=200,
            globalTransactionId="g-1",
            data={
                "eic_popl": "CZ00000019",
                "id_jednotky": "11",
                "id_pokl": "KASA-1",
                "porad_cis": "R-1",
                "dat_trzby": "2027-01-05T12:00:00+01:00",
                "celk_trzba": "123.50",
            },
            warnings=[{"code": 5, "message": "m", "source": "eet"}],
            futureField="ignored",
        ),
    )
    result = client.get_sale("sale-1")
    assert result.data is not None and result.data.celk_trzba == "123.50"
    assert result.data.eic_popl == "CZ00000019"
    assert (result.register, result.uuid, result.test) == ("kasa-1", "u-1", True)
    assert result.global_transaction_id == "g-1" and result.http_status == 200
    assert result.created_at and result.deadline_at and result.overdue is False
    assert result.warnings[0].source == "eet"


def test_unknown_status_is_kept_as_string(client, gateway):
    gateway.respond(200, sale_body("brand_new"))
    result = client.get_sale("sale-1")
    assert result.status == "brand_new"
    assert not result.is_success and result.is_final


# --- other operations -----------------------------------------------------------------------


def test_submit_batch(client, gateway):
    gateway.respond(
        200,
        {
            "rows": [
                {"row": 1, "result": sale_body("queued")},
                {"row": 2, "result": sale_body("invalid", id=None, issues=[{"code": "c", "message": "m"}])},
            ],
            "warnings": [],
            "issues": [],
        },
    )
    result = client.submit_batch([SALE, SALE], idempotency_key="batch-1", mode="sync")
    assert [r.row for r in result.rows] == [1, 2]
    assert result.rows[0].result.is_pending
    assert result.rows[1].result.status == SaleStatus.INVALID
    assert (gateway.last.method, gateway.last.path) == ("POST", "/v1/sales/batch")
    assert gateway.last.json() == [SALE, SALE]
    assert gateway.last.headers["idempotency-key"] == "batch-1"
    assert gateway.last.query == {"mode": "sync"}


def test_submit_batch_unreadable_source_422(client, gateway):
    gateway.respond(
        422,
        {"rows": [], "warnings": [], "issues": [{"code": "bad_json", "message": "not JSON"}]},
    )
    result = client.submit_batch_raw("{{", "application/json")
    assert result.rows == [] and result.issues[0].code == "bad_json"


def test_submit_batch_raw_csv(client, gateway):
    gateway.respond(200, {"rows": [], "warnings": [], "issues": []})
    client.submit_batch_raw("dat_trzby;celk_trzba\n2027-01-05;1,00\n", "text/csv")
    assert gateway.last.headers["content-type"] == "text/csv"


def test_get_sale_path_is_escaped(client, gateway):
    gateway.respond(200, sale_body())
    client.get_sale("a/b c")
    assert gateway.last.path == "/v1/sales/a%2Fb%20c"


def test_get_sale_attempts(client, gateway):
    gateway.respond(
        200,
        {
            "items": [
                {
                    "n": 1,
                    "uuid_zpravy": "u-1",
                    "dat_odesl": "2027-01-05T12:00:01+01:00",
                    "prvni_zaslani": True,
                    "overeni": False,
                    "environment": "playground",
                    "endpoint": "https://pg.example/eet",
                    "startedAt": "2027-01-05T11:00:01Z",
                    "outcome": "uncertain",
                    "reason": "timeout",
                    "durationMs": 10000,
                },
                {
                    "n": 2,
                    "uuid_zpravy": "u-2",
                    "dat_odesl": "2027-01-05T12:00:20+01:00",
                    "prvni_zaslani": False,
                    "overeni": False,
                    "environment": "playground",
                    "endpoint": "https://pg.example/eet",
                    "startedAt": "2027-01-05T11:00:20Z",
                    "finishedAt": "2027-01-05T11:00:21Z",
                    "outcome": "accepted",
                    "pok": "A1B2-C3",
                    "httpStatus": 200,
                },
            ]
        },
    )
    attempts = client.get_sale_attempts("sale-1")
    assert gateway.last.path == "/v1/sales/sale-1/attempts"
    assert [a.n for a in attempts] == [1, 2]
    assert attempts[0].finished_at is None and attempts[0].duration_ms == 10000
    assert attempts[1].outcome == "accepted" and attempts[1].pok == "A1B2-C3"
    assert attempts[1].prvni_zaslani is False


def test_retry_sale(client, gateway):
    gateway.respond(202, sale_body("queued"))
    result = client.retry_sale("sale-1")
    assert (gateway.last.method, gateway.last.path) == ("POST", "/v1/sales/sale-1/retry")
    assert result.is_pending


def test_retry_sale_not_retryable(client, gateway):
    gateway.respond(409, {"error": {"code": "not_retryable", "message": "final"}})
    with pytest.raises(ConflictError) as caught:
        client.retry_sale("sale-1")
    assert not isinstance(caught.value, IdempotencyConflictError)
    assert caught.value.code == "not_retryable"


def test_list_queue_filters(client, gateway):
    gateway.respond(200, {"items": [sale_body("queued")], "nextCursor": "c2"})
    page = client.list_queue(
        status=["queued", SaleStatus.UNCERTAIN],
        register="kasa-1",
        from_=datetime(2027, 1, 1, tzinfo=timezone.utc),
        to="2027-02-01T00:00:00Z",
        overdue=False,
        limit=20,
        cursor="c1",
    )
    assert page.next_cursor == "c2" and page.items[0].is_pending
    assert gateway.last.query == {
        "status": "queued,uncertain",
        "register": "kasa-1",
        "from": "2027-01-01T00:00:00+00:00",
        "to": "2027-02-01T00:00:00Z",
        "overdue": "false",
        "limit": "20",
        "cursor": "c1",
    }


def test_list_queue_single_status(client, gateway):
    gateway.respond(200, {"items": []})
    client.list_queue(status=SaleStatus.REJECTED)
    assert gateway.last.query == {"status": "rejected"}


def test_iter_queue_follows_cursors(client, gateway):
    gateway.respond(200, {"items": [sale_body(id="a"), sale_body(id="b")], "nextCursor": "p2"})
    gateway.respond(200, {"items": [sale_body(id="c")]})
    assert [s.id for s in client.iter_queue(limit=2)] == ["a", "b", "c"]
    assert [r.query.get("cursor") for r in gateway.requests] == [None, "p2"]
    assert gateway.requests[1].query["limit"] == "2"


def test_list_registers(client, gateway):
    gateway.respond(
        200,
        {
            "items": [
                {
                    "id": "kasa-1",
                    "environment": "playground",
                    "endpoint": "https://pg.example/eet",
                    "defaults": {"eic_popl": "CZ00000019", "id_jednotky": "11"},
                    "timeZone": "Europe/Prague",
                    "certificates": [
                        {
                            "eic": "CZ00000019",
                            "subject": "CN=x",
                            "issuer": "CN=I.CA",
                            "serialNumber": "01",
                            "fingerprintSha256": "ab",
                            "notBefore": "2026-01-01T00:00:00Z",
                            "notAfter": "2027-01-20T00:00:00Z",
                            "daysLeft": 15,
                            "active": True,
                            "expiresSoon": True,
                            "expired": False,
                        }
                    ],
                }
            ]
        },
    )
    [register] = client.list_registers()
    assert register.id == "kasa-1" and register.time_zone == "Europe/Prague"
    assert register.defaults["id_jednotky"] == "11"
    cert = register.certificates[0]
    assert (cert.days_left, cert.expires_soon, cert.active, cert.expired) == (15, True, True, False)
    assert cert.fingerprint_sha256 == "ab" and cert.serial_number == "01"


def test_validate_sales(client, gateway):
    gateway.respond(
        200,
        {
            "rows": [
                {"row": 1, "result": {"valid": True, "warnings": [], "issues": [], "overeni": False}},
                {
                    "row": 2,
                    "result": {
                        "valid": False,
                        "warnings": [],
                        "issues": [{"code": "missing_field", "message": "m", "field": "celk_trzba"}],
                    },
                },
            ],
            "warnings": [],
            "issues": [],
        },
    )
    batch = client.validate_sales([SALE, {}], verify=True, register="kasa-1")
    assert (gateway.last.method, gateway.last.path) == ("POST", "/v1/validate")
    assert gateway.last.query == {"verify": "true", "register": "kasa-1"}
    assert batch.rows[0].result.valid and not batch.rows[1].result.valid
    assert not batch.valid
    assert batch.rows[1].result.issues[0].field == "celk_trzba"


def test_validate_sales_raw_unreadable_422(client, gateway):
    gateway.respond(422, {"rows": [], "warnings": [], "issues": [{"code": "bad_csv", "message": "m"}]})
    batch = client.validate_sales_raw(b"\xff", "text/csv")
    assert batch.issues[0].code == "bad_csv" and not batch.valid


def test_health_is_public_and_503_is_returned(client, gateway):
    gateway.respond(
        503,
        {
            "status": "degraded",
            "version": "0.1.0",
            "database": "ok",
            "eet": [
                {"endpoint": "https://e", "reachable": False, "durationMs": 12.5, "checkedAt": "t", "error": "dns"}
            ],
        },
    )
    health = client.health(check_eet=True)
    assert not health.ok and health.database == "ok"
    assert health.eet and health.eet[0].error == "dns" and not health.eet[0].reachable
    assert gateway.last.path == "/health" and gateway.last.query == {"eet": "true"}
    assert "authorization" not in gateway.last.headers


def test_get_openapi_and_docs(client, gateway):
    gateway.respond(200, {"openapi": "3.1.0"})
    assert client.get_openapi() == {"openapi": "3.1.0"}
    assert gateway.last.path == "/openapi.json" and "authorization" not in gateway.last.headers
    gateway.respond(200, "<html>docs</html>", {"Content-Type": "text/html"})
    assert client.get_docs() == "<html>docs</html>"
    assert gateway.last.path == "/docs"


# --- wait_for_sale --------------------------------------------------------------------------


def test_wait_for_sale_polls_until_final(client, gateway):
    gateway.respond(200, sale_body("uncertain"))
    gateway.respond(200, sale_body("queued"))
    gateway.respond(200, sale_body("accepted"))
    result = client.wait_for_sale("sale-1", interval=0.01)
    assert result.status == SaleStatus.ACCEPTED
    assert len(gateway.requests) == 3
    assert all(r.path == "/v1/sales/sale-1" for r in gateway.requests)


def test_wait_for_sale_accepts_a_result_and_skips_final_ones(client, gateway):
    gateway.respond(200, sale_body("accepted"))
    final = client.get_sale("sale-1")
    assert client.wait_for_sale(final) is final
    assert len(gateway.requests) == 1


def test_wait_for_sale_gives_up_with_last_state(client, gateway):
    gateway.respond(202, sale_body("queued"))
    gateway.respond(200, sale_body("queued"))
    pending = client.submit_sale(SALE)
    result = client.wait_for_sale(pending, timeout=0.05, interval=0.01)
    assert result.is_pending


# --- errors ---------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "code", "exc"),
    [
        (400, "bad_request", BadRequestError),
        (401, "unauthorized", AuthenticationError),
        (404, "not_found", NotFoundError),
        (413, "payload_too_large", PayloadTooLargeError),
        (415, "unsupported_media_type", UnsupportedMediaTypeError),
        (500, "internal", ServerError),
    ],
)
def test_error_statuses_map_to_exceptions(client, gateway, status, code, exc):
    gateway.respond(status, {"error": {"code": code, "message": "boom"}})
    with pytest.raises(exc) as caught:
        client.get_sale("x")
    assert isinstance(caught.value, ApiError)
    assert (caught.value.status, caught.value.code, caught.value.message) == (status, code, "boom")


def test_401_carries_headers(client, gateway):
    gateway.respond(
        401,
        {"error": {"code": "unauthorized", "message": "no"}},
        {"WWW-Authenticate": 'Bearer realm="eet-gateway"'},
    )
    with pytest.raises(AuthenticationError) as caught:
        client.list_registers()
    assert caught.value.headers["WWW-Authenticate"].startswith("Bearer")


def test_non_json_error_body(client, gateway):
    gateway.respond(502, "<html>Bad Gateway</html>", {"Content-Type": "text/html"})
    with pytest.raises(ServerError) as caught:
        client.get_sale("x")
    assert caught.value.status == 502 and "Bad Gateway" in caught.value.message


def test_success_with_non_json_body(client, gateway):
    gateway.respond(200, "not json")
    with pytest.raises(InvalidResponseError):
        client.get_sale("x")


def test_redirects_are_not_followed(client, gateway):
    gateway.respond(301, "", {"Location": "http://elsewhere.invalid/"})
    with pytest.raises(ApiError) as caught:
        client.submit_sale(SALE)
    assert caught.value.status == 301
    assert len(gateway.requests) == 1


def test_timeout(gateway):
    gateway.respond(200, sale_body(), delay=1.0)
    slow = EetGatewayClient(gateway.url, "k", timeout=0.2)
    with pytest.raises(RequestTimeoutError) as caught:
        slow.get_sale("x")
    assert isinstance(caught.value, TransportError)


def test_connection_refused():
    with socket.socket() as closed:  # a port nobody listens on
        closed.bind(("127.0.0.1", 0))
        port = closed.getsockname()[1]
    # Windows reports a refused connection only after ~2 s, so give it room.
    with pytest.raises(TransportError):
        EetGatewayClient(f"http://127.0.0.1:{port}", "k", timeout=10).health()


def test_base_url_validation_and_path_prefix(gateway):
    with pytest.raises(ValueError):
        EetGatewayClient("localhost:8080")
    gateway.respond(200, sale_body())
    EetGatewayClient(gateway.url + "/", "k").get_sale("a")
    assert gateway.last.path == "/v1/sales/a"


def test_no_api_key_sends_no_authorization(gateway):
    gateway.respond(200, {"items": []})
    EetGatewayClient(gateway.url).list_registers()
    assert "authorization" not in gateway.last.headers


def test_request_body_is_utf8_json(client, gateway):
    gateway.respond(200, sale_body())
    client.submit_sale({**SALE, "note": "Čaj"})
    assert json.loads(gateway.last.body.decode("utf-8"))["note"] == "Čaj"
