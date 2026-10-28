"""Against the real gateway over a fake EET (no network, no certificates):

    bun scripts/examples-server.ts 8080 &
    EET_URL=http://localhost:8080 EET_API_KEY=examples-key-0123456789 pytest tests/test_integration.py

Skipped without EET_URL. The first attempt of every sale "times out", the resend half a second
later is accepted (scripts/examples-server.ts), so this also walks the 202 -> polling path.
"""

from __future__ import annotations

import os
import time
from datetime import datetime

import pytest

from eet_gateway_client import (
    AuthenticationError,
    EetGatewayClient,
    NotFoundError,
    SaleStatus,
)

URL = os.environ.get("EET_URL")
KEY = os.environ.get("EET_API_KEY", "examples-key-0123456789")

pytestmark = pytest.mark.skipif(not URL, reason="set EET_URL to run against a gateway")


@pytest.fixture()
def client():
    return EetGatewayClient(URL, KEY, timeout=15)


def sale(receipt: str) -> dict:
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    return {"porad_cis": receipt, "dat_trzby": now, "celk_trzba": "123.50"}


def test_submit_wait_and_idempotent_replay(client):
    receipt = f"PT-{time.time_ns()}"
    body = sale(receipt)  # the same sale again, or the key counts as reused for another sale
    first = client.submit_sale(body, idempotency_key=receipt)
    assert first.id and first.location == f"/v1/sales/{first.id}"
    assert first.is_pending  # fake EET: first attempt times out
    done = client.wait_for_sale(first, timeout=15, interval=0.2)
    assert done.status == SaleStatus.ACCEPTED and done.pok

    again = client.submit_sale(body, idempotency_key=receipt)
    assert again.id == first.id and again.replayed

    attempts = client.get_sale_attempts(first.id)
    assert [a.prvni_zaslani for a in attempts] == [True, False]
    assert attempts[-1].outcome == "accepted"
    assert any(s.id == first.id for s in client.iter_queue(limit=5))


def test_verification_mode_and_invalid_sale(client):
    checked = client.submit_sale(sale(f"V-{time.time_ns()}"), verify=True)
    checked = client.wait_for_sale(checked, timeout=15, interval=0.2)
    assert checked.status == SaleStatus.VERIFICATION_OK and checked.is_success

    invalid = client.submit_sale({"porad_cis": "X"})
    assert invalid.status == SaleStatus.INVALID and invalid.issues and invalid.id is None


def test_batch_validate_and_system_endpoints(client):
    rows = [sale(f"B-{time.time_ns()}-{i}") for i in range(2)]
    verdict = client.validate_sales(rows)
    assert verdict.valid and len(verdict.rows) == 2
    batch = client.submit_batch(rows, idempotency_key=f"batch-{time.time_ns()}")
    assert [r.row for r in batch.rows] == [1, 2] and all(r.result.id for r in batch.rows)

    assert client.health().ok
    assert client.get_openapi()["openapi"].startswith("3.1")
    assert "<" in client.get_docs()
    assert isinstance(client.list_registers(), list)


def test_errors(client):
    with pytest.raises(NotFoundError):
        client.get_sale("does-not-exist")
    with pytest.raises(AuthenticationError):
        EetGatewayClient(URL, "wrong-key-0123456789").list_queue()
