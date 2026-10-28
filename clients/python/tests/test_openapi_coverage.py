"""Drift guard: the client must cover everything docs/openapi.json describes.

When the gateway gains an operation, a query parameter, a header or a response field, one of
these tests fails until the client (and this table) catches up. scripts/gen-clients.ts does the
static half of the same check for all three languages.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Set

import pytest

import eet_gateway_client
from conftest import sale_body
from eet_gateway_client import OPERATIONS, EetGatewayClient

ROOT = Path(__file__).resolve().parents[3]
SPEC = json.loads((ROOT / "docs" / "openapi.json").read_text(encoding="utf-8"))
SOURCE = "\n".join(
    p.read_text(encoding="utf-8")
    for p in (Path(eet_gateway_client.__file__).parent).glob("*.py")
)

HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}
SPEC_OPERATIONS: Dict[str, Any] = {
    op["operationId"]: (method.upper(), path, op)
    for path, item in SPEC["paths"].items()
    for method, op in item.items()
    if method in HTTP_METHODS
}

SALE = {"porad_cis": "R-1", "dat_trzby": "2027-01-05T12:00:00+01:00", "celk_trzba": "1.00"}
EMPTY_BATCH = {"rows": [], "warnings": [], "issues": []}

#: operationId -> (client call using EVERY documented parameter, fake answer to give).
CALLS: Dict[str, Any] = {
    "submitSale": (
        lambda c: c.submit_sale(SALE, idempotency_key="k", mode="sync", verify=True, register="r"),
        (200, sale_body()),
    ),
    "submitBatch": (
        lambda c: c.submit_batch([SALE], idempotency_key="k", mode="async", verify=True, register="r"),
        (200, EMPTY_BATCH),
    ),
    "getSale": (lambda c: c.get_sale("id-1"), (200, sale_body())),
    "getSaleAttempts": (lambda c: c.get_sale_attempts("id-1"), (200, {"items": []})),
    "retrySale": (lambda c: c.retry_sale("id-1"), (200, sale_body())),
    "listQueue": (
        lambda c: c.list_queue(
            status="queued", register="r", from_="2027-01-01", to="2027-02-01",
            overdue=True, limit=5, cursor="c",
        ),
        (200, {"items": []}),
    ),
    "listRegisters": (lambda c: c.list_registers(), (200, {"items": []})),
    "validateSales": (
        lambda c: c.validate_sales([SALE], verify=True, register="r"),
        (200, EMPTY_BATCH),
    ),
    "health": (
        lambda c: c.health(check_eet=True),
        (200, {"status": "ok", "version": "0", "database": "ok"}),
    ),
    "openapi": (lambda c: c.get_openapi(), (200, {})),
    "docs": (lambda c: c.get_docs(), (200, "<html></html>")),
}


def test_every_openapi_operation_is_in_the_client_table():
    assert {k: (v[0], v[1]) for k, v in SPEC_OPERATIONS.items()} == dict(OPERATIONS)


def test_every_openapi_operation_has_a_call_in_this_test():
    assert set(CALLS) == set(SPEC_OPERATIONS), "add the new operation to CALLS (and the client)"


@pytest.mark.parametrize("operation_id", sorted(SPEC_OPERATIONS))
def test_operation_hits_the_documented_method_path_and_parameters(gateway, operation_id):
    method, path, op = SPEC_OPERATIONS[operation_id]
    call, (status, body) = CALLS[operation_id]
    gateway.respond(status, body)
    call(EetGatewayClient(gateway.url, "key", timeout=5))
    request = gateway.last

    assert request.method == method
    assert re.fullmatch(re.sub(r"\{[^}]+\}", "[^/]+", path), request.path), request.path

    params = op.get("parameters", [])
    documented_query: Set[str] = {p["name"] for p in params if p["in"] == "query"}
    documented_headers: Set[str] = {p["name"].lower() for p in params if p["in"] == "header"}
    assert set(request.query) == documented_query
    assert documented_headers <= set(request.headers)

    secured = bool(op.get("security"))
    assert ("authorization" in request.headers) == secured

    media_types = set(op.get("requestBody", {}).get("content", {}))
    if media_types:
        assert request.headers["content-type"] in media_types


def _property_names(node: Any) -> Set[str]:
    names: Set[str] = set()
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "properties" and isinstance(value, dict):
                names.update(value)
            names |= _property_names(value)
    elif isinstance(node, list):
        for item in node:
            names |= _property_names(item)
    return names


def test_every_schema_property_is_read_by_the_models():
    missing = sorted(
        name for name in _property_names(SPEC["components"]["schemas"])
        if f'"{name}"' not in SOURCE and name != "error"  # the error envelope is read in client.py
    )
    assert missing == [], f"models do not read: {missing}"


def test_sale_statuses_match_the_schema():
    declared = SPEC["components"]["schemas"]["SaleResult"]["properties"]["status"]["enum"]
    assert [s.value for s in eet_gateway_client.SaleStatus] == declared


def test_documented_error_statuses_have_an_exception():
    documented = {
        int(code)
        for _, _, op in SPEC_OPERATIONS.values()
        for code in op["responses"]
        if int(code) >= 400 and int(code) != 503  # 503 is the degraded /health body
    }
    from eet_gateway_client.client import _ERRORS

    assert documented <= set(_ERRORS), sorted(documented - set(_ERRORS))
