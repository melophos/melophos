"""Guards that keep the test suite away from any database a person could be using."""

from urllib.parse import urlsplit

LOOPBACK = {"localhost", "127.0.0.1", "::1", "testdb"}
TEST_DB_PREFIX = "melophos_test_"


class UnsafeTestTarget(RuntimeError):
    pass


def check_test_server(admin_url: str, development_url: str = "") -> None:
    """Refuse a server the suite must never write to.

    The suite creates its own database with a random name on the server named here, so what needs guarding is
    the server: it must be on this machine, it must not be the default Postgres port and it must not be the
    server DATABASE_URL points at.
    """
    parts = urlsplit(admin_url)
    host, port = parts.hostname or "", parts.port or 5432
    if host not in LOOPBACK:
        raise UnsafeTestTarget(f"the test server must be on this machine, not {host!r}")
    if port == 5432:
        raise UnsafeTestTarget("port 5432 is the usual development database, use the test container's port")
    if development_url:
        dev = urlsplit(development_url)
        if (dev.hostname or "", dev.port or 5432) == (host, port):
            raise UnsafeTestTarget("the test server is the one DATABASE_URL points at")


def check_throwaway_name(name: str) -> None:
    if not name.startswith(TEST_DB_PREFIX):
        raise UnsafeTestTarget(f"{name!r} is not a throwaway test database name")
