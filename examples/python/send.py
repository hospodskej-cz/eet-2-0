"""Sends one sale to the EET Gateway HTTP API and waits for EET's answer.

Python 3.9+, standard library only:
    EET_URL=http://localhost:8080 EET_API_KEY=… python3 examples/python/send.py
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

URL = os.environ.get("EET_URL", "http://localhost:8080")
KEY = os.environ.get("EET_API_KEY") or sys.exit("set EET_API_KEY")


def call(method, path, body=None, headers=None):
    """Returns (HTTP status, decoded JSON body); 4xx answers carry JSON too."""
    request = urllib.request.Request(
        URL + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
            **(headers or {}),
        },
    )
    try:
        # Sync submits wait for EET (up to the register's timeoutMs).
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


# Your own unique receipt id doubles as the idempotency key: repeating the request after a
# network error returns the stored result and never registers the sale twice.
receipt = f"PY-{int(time.time())}"
sale = {
    "porad_cis": receipt,
    "dat_trzby": datetime.now().astimezone().isoformat(timespec="seconds"),
    "celk_trzba": "123.50",  # eic_popl, id_jednotky, id_pokl come from the register config
}

status, result = call("POST", "/v1/sales", sale, {"Idempotency-Key": receipt})

if status == 202:
    # queued or uncertain: the gateway keeps resending; ask for the outcome.
    for _ in range(15):
        if result["status"] not in ("queued", "uncertain"):
            break
        time.sleep(1)
        _, result = call("GET", f"/v1/sales/{result['id']}")
elif status in (409, 422):
    # Invalid sale or idempotency key reused: nothing was sent.
    for issue in result["issues"]:
        print(f"{issue['code']} {issue.get('field', '')}: {issue['message']}", file=sys.stderr)
    sys.exit(1)
elif status != 200:
    sys.exit(f"HTTP {status}: {result}")

print(f"{result['id']}  {result['status']}  POK {result.get('pok', '-')}")
for warning in result["warnings"]:
    print(f"  warning {warning['code']} ({warning['source']}): {warning['message']}")
sys.exit(0 if result["status"] in ("accepted", "verification_ok") else 1)
