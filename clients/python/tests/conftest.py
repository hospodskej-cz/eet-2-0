"""A tiny in-process fake of the gateway: scripted answers, recorded requests."""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlsplit

import pytest


@dataclass
class Recorded:
    method: str
    path: str
    query: Dict[str, str]
    headers: Dict[str, str]
    body: bytes

    def json(self) -> Any:
        return json.loads(self.body)


@dataclass
class Fake:
    url: str
    requests: List[Recorded] = field(default_factory=list)
    _script: List[Tuple[int, bytes, Dict[str, str], float]] = field(default_factory=list)
    _last: Optional[Tuple[int, bytes, Dict[str, str], float]] = None

    def respond(
        self,
        status: int,
        body: Any = None,
        headers: Optional[Dict[str, str]] = None,
        delay: float = 0.0,
    ) -> None:
        """Queues the answer to the next request; the last answer repeats once the queue is empty."""
        if isinstance(body, (dict, list)):
            raw = json.dumps(body).encode()
            headers = {"Content-Type": "application/json", **(headers or {})}
        else:
            raw = (body or "").encode() if isinstance(body, str) else (body or b"")
        self._script.append((status, raw, headers or {}, delay))

    @property
    def last(self) -> Recorded:
        return self.requests[-1]


@pytest.fixture()
def gateway():
    fake = Fake(url="")

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _handle(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            parts = urlsplit(self.path)
            fake.requests.append(
                Recorded(
                    method=self.command,
                    path=parts.path,
                    query={k: v[0] for k, v in parse_qs(parts.query, keep_blank_values=True).items()},
                    headers={k.lower(): v for k, v in self.headers.items()},
                    body=self.rfile.read(length) if length else b"",
                )
            )
            if fake._script:
                fake._last = fake._script.pop(0)
            assert fake._last is not None, "no answer queued: call gateway.respond() first"
            status, raw, headers, delay = fake._last
            if delay:
                time.sleep(delay)
            try:
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except OSError:  # the client gave up (timeout test)
                pass

        do_GET = do_POST = _handle

        def log_message(self, *args: Any) -> None:  # keep pytest output quiet
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    fake.url = f"http://127.0.0.1:{server.server_address[1]}"
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    yield fake
    server.shutdown()
    server.server_close()


def sale_body(status: str = "accepted", **extra: Any) -> Dict[str, Any]:
    """A SaleResult as the gateway returns it."""
    body: Dict[str, Any] = {"id": "sale-1", "status": status, "warnings": [], "attempts": 1}
    if status == "accepted":
        body["pok"] = "A1B2-C3"
    body.update(extra)
    return body
