"""Outbound HTTP to an address a user chose, which is the classic way to make a server attack its own network.

Defences, all of which have tests:
- the address is checked when it is saved and again when it is used, after the name is resolved
- every resolved address must be globally routable, so loopback, private, link-local (including cloud metadata
  at 169.254.169.254), carrier-grade NAT, multicast, reserved and documentation ranges are refused
- the connection goes to the address that was checked, with the original name only as the Host header and TLS
  name, so the name cannot resolve somewhere else between the check and the connection
- redirects are never followed and the reply body is read only up to a small cap
- the call runs on plain sockets with a real deadline for the whole of it: every step is given only the time that
  is left and a timer shuts the socket down when the deadline arrives, so even a receiver that sends one byte at a
  time ends exactly then. No thread is ever left behind, so a slow receiver cannot starve the others
"""

import ipaddress
import re
import socket
import ssl
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from contextlib import suppress
from dataclasses import dataclass
from urllib.parse import urlsplit

MAX_URL = 2048
CONNECT_TIMEOUT = 5.0
DEADLINE_SECONDS = (
    15.0  # the whole call from connecting to the status line, enforced by a timer as well as by each step
)
DNS_TIMEOUT = 5.0
MAX_REPLY_BYTES = 4096

Resolver = Callable[[str, int], list[str]]

_BLOCKED_NETS = [
    ipaddress.ip_network(n)
    for n in (
        "64:ff9b::/96",  # NAT64 can carry any IPv4 address, so it can carry a private one
        "2001::/32",  # Teredo
        "100.64.0.0/10",  # carrier-grade NAT
        "::/96",  # IPv4-compatible, so [::127.0.0.1] is loopback
        "::ffff:0:0:0/96",  # IPv4-translated, so [::ffff:0:7f00:1] is loopback
        "64:ff9b:1::/48",  # local-use NAT64
        "100::/64",  # discard
        "2001:db8::/32",  # documentation
        "fec0::/10",  # site-local
        "2002::/16",  # 6to4 carries any IPv4 address
    )
]


class UnsafeDestination(ValueError):
    """The address is not one the server will send to. The message says why, in words a person can act on."""


_dns_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="dns")


def system_resolver(host: str, port: int) -> list[str]:
    def lookup() -> list[str]:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        return sorted({str(info[4][0]) for info in infos})

    try:
        return _dns_pool.submit(lookup).result(timeout=DNS_TIMEOUT)
    except FutureTimeout as error:
        raise UnsafeDestination("the host name took too long to resolve") from error
    except OSError as error:
        raise UnsafeDestination("the host name does not resolve") from error


def _address_problem(text: str) -> str | None:
    try:
        ip = ipaddress.ip_address(text.split("%", 1)[0])
    except ValueError:
        return "the host resolved to something that is not an address"
    # unwrap IPv4 hidden inside IPv6 forms so ::ffff:127.0.0.1 and 6to4 cannot slip past
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        elif ip.sixtofour is not None:
            ip = ip.sixtofour
    if any(ip in net for net in _BLOCKED_NETS if net.version == ip.version):
        return "the host is in a range the server will not send to"
    if not ip.is_global or ip.is_multicast:
        return "the host is a private, loopback, link-local or otherwise internal address"
    return None


@dataclass(frozen=True)
class Destination:
    host: str
    port: int
    scheme: str
    path: str
    addresses: list[str]


def check_url(url: str, *, allow_private: bool = False, resolver: Resolver = system_resolver) -> Destination:
    """Raise UnsafeDestination unless the URL is safe to send to right now. Call it at save time and at send time."""
    if len(url) > MAX_URL:
        raise UnsafeDestination("the address is too long")
    if any(ord(c) < 33 or ord(c) == 127 for c in url):
        raise UnsafeDestination("the address contains spaces or control characters")
    parts = urlsplit(url)
    allowed = {"https", "http"} if allow_private else {"https"}
    if parts.scheme not in allowed:
        raise UnsafeDestination("the address must start with https://")
    if parts.username is not None or parts.password is not None:
        raise UnsafeDestination("the address must not contain a user name or password")
    host = parts.hostname
    if not host:
        raise UnsafeDestination("the address has no host name")
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError as error:
        raise UnsafeDestination("the port is not valid") from error
    if parts.fragment:
        raise UnsafeDestination("the address must not contain a #fragment")
    addresses = [host] if _is_literal(host) else resolver(host, port)
    if not addresses:
        raise UnsafeDestination("the host name does not resolve")
    if not allow_private:
        for address in addresses:
            problem = _address_problem(address)
            if problem:
                raise UnsafeDestination(problem)
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    return Destination(host, port, parts.scheme, path, addresses)


def _is_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


@dataclass(frozen=True)
class SendResult:
    ok: bool
    status: int | None
    error: str | None


Connector = Callable[[str, int, float], socket.socket]
TlsWrapper = Callable[[socket.socket, str, float], socket.socket]


def _connect(address: str, port: int, timeout: float) -> socket.socket:
    return socket.create_connection((address, port), timeout=timeout)


def _wrap_tls(sock: socket.socket, hostname: str, timeout: float) -> socket.socket:
    sock.settimeout(timeout)
    # the certificate is checked against the host name in the address, though the connection went to its IP
    context = ssl.create_default_context()
    # stated here rather than left to the defaults, so an older Python or OpenSSL build cannot offer TLS 1.0 or 1.1
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return context.wrap_socket(sock, server_hostname=hostname)


def post_json(
    url: str,
    body: bytes,
    headers: dict[str, str],
    *,
    allow_private: bool = False,
    resolver: Resolver = system_resolver,
    connector: Connector = _connect,
    tls_wrapper: TlsWrapper = _wrap_tls,
) -> SendResult:
    """POST to a checked address. Returns a result instead of raising, because a failed send is routine.

    The whole call, DNS aside, ends by DEADLINE_SECONDS whatever the receiver does.
    """
    try:
        dest = check_url(url, allow_private=allow_private, resolver=resolver)
    except UnsafeDestination as error:
        return SendResult(False, None, f"blocked: {error}")
    deadline = time.monotonic() + DEADLINE_SECONDS
    host_header = dest.host if dest.port in (80, 443) else f"{dest.host}:{dest.port}"
    lines = [f"POST {dest.path} HTTP/1.1", f"Host: {host_header}", "Content-Type: application/json"]
    lines += [f"Content-Length: {len(body)}", "Connection: close"]
    lines += [f"{k}: {v}" for k, v in headers.items() if "\r" not in v and "\n" not in v]
    request = ("\r\n".join(lines) + "\r\n\r\n").encode() + body

    def left() -> float:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("deadline")
        return remaining

    sock: socket.socket | None = None
    timer: threading.Timer | None = None
    try:
        sock = connector(dest.addresses[0], dest.port, min(CONNECT_TIMEOUT, left()))
        raw = sock

        def kill() -> None:
            # the last resort at the deadline: shutting the socket wakes any read or write that is blocked on it
            with suppress(OSError):
                raw.shutdown(socket.SHUT_RDWR)
            with suppress(OSError):
                raw.close()

        timer = threading.Timer(left(), kill)
        timer.daemon = True
        timer.start()
        if dest.scheme == "https":
            sock = tls_wrapper(sock, dest.host, left())
        view = memoryview(request)
        while view:
            sock.settimeout(left())
            sent = sock.send(view)
            view = view[sent:]
        reply = b""
        while b"\r\n" not in reply and len(reply) < MAX_REPLY_BYTES:
            sock.settimeout(left())
            chunk = sock.recv(1024)
            if not chunk:
                break
            reply += chunk
    except TimeoutError:
        return SendResult(False, None, "timed out")
    except (OSError, ssl.SSLError) as error:
        if time.monotonic() >= deadline:
            return SendResult(False, None, "timed out")
        return SendResult(False, None, f"connection failed: {type(error).__name__}")
    finally:
        if timer is not None:
            timer.cancel()
        if sock is not None:
            with suppress(OSError):
                sock.close()
    # the deadline timer shuts the socket, so the read above can end quietly with half a status line. That is a
    # timeout and not a receiver that spoke something other than HTTP
    if b"\r\n" not in reply and time.monotonic() >= deadline:
        return SendResult(False, None, "timed out")
    match = re.match(rb"HTTP/1\.[01] (\d{3})", reply)
    if match is None:
        return SendResult(False, None, "the receiver did not answer with HTTP")
    status = int(match.group(1))
    if 300 <= status < 400:
        return SendResult(False, status, "redirect refused")
    if 200 <= status < 300:
        return SendResult(True, status, None)
    return SendResult(False, status, f"receiver answered {status}")
