"""A request body size cap that applies before any route reads the body."""

import hmac
import ipaddress
import logging

from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_BODY = 8 * 1024 * 1024


class BodyLimit:
    """Answers 413 for a body over the cap, by header when it is honest and by counting when it is not."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await self._refuse(send)
            return
        seen = 0
        refused = False

        async def counted() -> Message:
            nonlocal seen, refused
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max_bytes:
                    refused = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        started = False

        async def guarded(message: Message) -> None:
            nonlocal started
            if refused and not started:
                started = True
                await self._refuse(send)
                return
            if refused:
                return
            started = True
            await send(message)

        await self.app(scope, counted, guarded)

    async def _refuse(self, send: Send) -> None:
        body = b'{"detail":"the request body is too large"}'
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


class ProtectedMetrics:
    """Serves the metrics app, asking for `Authorization: Bearer <token>` when a token is configured."""

    def __init__(self, app: ASGIApp, token: str) -> None:
        self.app = app
        self.token = token

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if not self.token and scope["type"] == "http":
            # metrics are off until METRICS_TOKEN is set, because they reveal how the server is used
            body = b'{"detail":"metrics are off"}'
            await send(
                {
                    "type": "http.response.start",
                    "status": 404,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        if self.token and scope["type"] == "http":
            given = dict(scope["headers"]).get(b"authorization", b"").decode()
            if not hmac.compare_digest(given, f"Bearer {self.token}"):
                body = b'{"detail":"metrics need a token"}'
                await send(
                    {
                        "type": "http.response.start",
                        "status": 401,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
        await self.app(scope, receive, send)


class PeerWatch:
    """Warns once when every request has come from one private address and no proxy is configured.

    That is what the server sees behind a proxy it has not been told about or behind Docker Desktop's network
    translation. Every caller then looks like the same address, so one stranger's failures count against everyone's
    sign-ins. The message says how to fix it.
    """

    SAMPLE = 50

    def __init__(self, app: ASGIApp, hops: int) -> None:
        self.app = app
        self.hops = hops
        self.seen = 0
        self.peers: set[str] = set()
        self.warned = False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and not self.warned and self.hops == 0:
            client = scope.get("client")
            if client:
                self.seen += 1
                if len(self.peers) < 4:
                    self.peers.add(str(client[0]))
                if self.seen >= self.SAMPLE:
                    self.warned = True
                    self._check()
        await self.app(scope, receive, send)

    def _check(self) -> None:
        if len(self.peers) != 1:
            return
        (peer,) = self.peers
        try:
            address = ipaddress.ip_address(peer)
        except ValueError:
            return
        if address.is_private and not address.is_loopback:
            logging.getLogger("melophos.proxy").warning(
                "every one of the first %d requests came from %s, a private address and no proxy is configured."
                " If a reverse proxy or Docker's network sits in front, all callers look like one address and the"
                " sign-in limits will treat them as one person. Set TRUSTED_PROXY_HOPS to the number of proxies and"
                " TRUSTED_PROXY_CIDRS to %s/32 (see docs/self-hosting.md)",
                self.SAMPLE,
                peer,
                peer,
            )
