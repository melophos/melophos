import os
import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import migrate
from app.main import create_app

from .safety import TEST_DB_PREFIX, check_test_server, check_throwaway_name

# the container from tests/infra/compose.yml, see tests/README.md
ADMIN_URL = os.getenv("MELOPHOS_TEST_DB_URL", "postgresql://postgres:test-only@127.0.0.1:25432/postgres")
TEST_SECRET = "test-secret-key-that-is-long-enough-to-sign-things-0123456789"


def _with_database(url: str, name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, "/" + name, "", ""))


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    """A fresh database with a random name on the throwaway server, dropped at the end of the run."""
    check_test_server(ADMIN_URL, os.getenv("DATABASE_URL", ""))
    name = TEST_DB_PREFIX + secrets.token_hex(6)
    check_throwaway_name(name)
    try:
        admin = psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=5)
    except psycopg.OperationalError as error:
        pytest.fail(
            "the test database is not running. From server/ run: "
            "docker compose -p <any-name> -f tests/infra/compose.yml up -d --wait\n" + str(error)
        )
    with admin:
        admin.execute(f'CREATE DATABASE "{name}"')  # type: ignore[arg-type]
        url = _with_database(ADMIN_URL, name)
        try:
            migrate(url)
            yield url
        finally:
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')  # type: ignore[arg-type]


@contextmanager
def scratch_database(prefix: str = "melophos_test_") -> Iterator[str]:
    """An empty database of its own on the throwaway server, for tests that must not share state."""
    check_test_server(ADMIN_URL, os.getenv("DATABASE_URL", ""))
    name = prefix + secrets.token_hex(5)
    check_throwaway_name(name)
    with psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=5) as admin:
        admin.execute(f'CREATE DATABASE "{name}"')  # type: ignore[arg-type]
        try:
            yield _with_database(ADMIN_URL, name)
        finally:
            admin.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')  # type: ignore[arg-type]


@pytest.fixture(autouse=True)
def clean_tables(database_url: str, request: pytest.FixtureRequest) -> None:
    if "no_clean" in request.keywords:
        return
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(
            "TRUNCATE users, devices, instruments, songs, practice_sessions, note_events, recordings,"
            " integration_accounts, rate_events, pairing_codes, auth_sessions, webhook_endpoints, songs CASCADE"
        )


@pytest.fixture()
def settings(database_url: str) -> Settings:
    return Settings(
        database_url=database_url,
        secret_key=TEST_SECRET,
        cors_origins=["http://localhost:5173"],
        trusted_proxy_hops=0,
        trusted_proxy_cidrs=["10.0.0.0/8"],
        argon2_memory_kib=8,
        argon2_time_cost=1,
        webhook_allow_private=False,
        session_webhook_url="",
        allow_stand_in_scorer=True,
        allow_privileged_database=True,
        mqtt_host="",
    )


@pytest.fixture()
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


BROKER_HOST = os.getenv("MELOPHOS_TEST_MQTT_HOST", "127.0.0.1")
BROKER_PORT = int(os.getenv("MELOPHOS_TEST_MQTT_PORT", "21883"))
BROKER_ADMIN = ("admin", "test-admin-only-0123456789")


@pytest.fixture(scope="session")
def broker_admin():
    """The throwaway Mosquitto from tests/infra/compose.yml, driven the way the server drives it."""
    import socket

    from app.broker import DynsecBroker

    try:
        socket.create_connection((BROKER_HOST, BROKER_PORT), timeout=2).close()
    except OSError:
        pytest.fail(
            "the test broker is not running. From server/ run: "
            "docker compose -p <any-name> -f tests/infra/compose.yml up -d --build --wait"
        )
    admin = DynsecBroker(BROKER_HOST, BROKER_PORT, *BROKER_ADMIN)
    admin.ensure_roles()
    return admin


@pytest.fixture()
def mqtt_settings(settings: Settings, broker_admin) -> Settings:
    return Settings(
        **{
            **settings.__dict__,
            "mqtt_host": BROKER_HOST,
            "mqtt_port": BROKER_PORT,
            "mqtt_username": "melophos-server",
            "mqtt_password": "test-ingest-password-0123456789",
            "mqtt_admin_username": BROKER_ADMIN[0],
            "mqtt_admin_password": BROKER_ADMIN[1],
        }
    )


@pytest.fixture()
def mqtt_client(mqtt_settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(mqtt_settings)) as test_client:
        yield test_client


@pytest.fixture()
def private_settings(settings: Settings) -> Settings:
    """Webhooks may reach 127.0.0.1, which the tests need for a local receiver. Production refuses it."""
    return Settings(**{**settings.__dict__, "webhook_allow_private": True})


@pytest.fixture()
def private_client(private_settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(private_settings)) as test_client:
        yield test_client


# the safety tests: the release path, the installer, backup and restore and the merge step. A tool that is missing must
# never make them quietly pass by not running. In CI (MELOPHOS_REQUIRE_SAFETY_TESTS=1) a skipped one FAILS. Anywhere
# else the end of the run names each one that did not run and why.
SAFETY_MODULES = {"test_release", "test_backup_restore", "test_verify_release", "test_merge_images"}
_not_run: list[tuple[str, str]] = []


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo[None]):  # type: ignore[no-untyped-def]
    outcome = yield
    report = outcome.get_result()
    if report.skipped and item.module.__name__.rsplit(".", 1)[-1] in SAFETY_MODULES:
        longrepr = report.longrepr
        reason = str(longrepr[2] if isinstance(longrepr, tuple) else longrepr).removeprefix("Skipped: ")
        if os.getenv("MELOPHOS_REQUIRE_SAFETY_TESTS") == "1":
            report.outcome = "failed"
            report.longrepr = f"a safety test was skipped, which is a failure here: {reason}"
        elif call.when in {"setup", "call"}:
            _not_run.append((item.nodeid, reason))


def pytest_terminal_summary(terminalreporter: pytest.TerminalReporter) -> None:
    if not _not_run:
        return
    reasons = sorted({reason for _, reason in _not_run})
    terminalreporter.section("SAFETY TESTS THAT DID NOT RUN", sep="!", red=True)
    terminalreporter.write_line(
        f"{len(_not_run)} safety tests did not run and their checks are unproven here: " + "; ".join(reasons)
    )
    for node, _ in _not_run[:12]:
        terminalreporter.write_line("  " + node)
    terminalreporter.write_line(
        "Install the missing tools or run in CI. MELOPHOS_REQUIRE_SAFETY_TESTS=1 makes a skip a failure."
    )
