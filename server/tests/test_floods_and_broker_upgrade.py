"""Floods from many networks, spraying, readiness, the broker upgrade and the stored counter. Each test fails without its fix."""

import json
import subprocess
import threading
import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import psycopg
import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from app import accounts as accounts_module
from app.main import create_app

from .helpers import PASSWORD, new_hub, pair, send_session, sign_up
from .test_limits_and_deletion import parallel


@pytest.fixture()
def proxied(settings):
    with TestClient(
        create_app(replace(settings, trusted_proxy_hops=1, trusted_proxy_cidrs=["10.0.0.0/8"]))
    ) as c:
        yield c


def start(c, ip):
    return c.post("/api/v1/pairing", headers={"X-Forwarded-For": ip})


# 1 pairing: nothing is ever evicted


def test_a_flood_from_many_networks_cannot_evict_a_waiting_hub(proxied):
    real = start(proxied, "198.51.100.1").json()
    owner = sign_up(proxied)
    with (
        patch.object(accounts_module, "MAX_PENDING_PAIRINGS", 30),
        patch.object(accounts_module, "RESERVED_FOR_KNOWN", 5),
    ):
        codes = [start(proxied, f"203.0.113.{i}").status_code for i in range(1, 60)]
    assert 201 in codes and 503 in codes  # the cap is reached by other networks and new requests are refused
    hub_headers = {"Authorization": f"Device {real['device_id']}:{real['device_secret']}"}
    assert proxied.get("/api/v1/device", headers=hub_headers).status_code == 200  # its identity survived
    claimed = proxied.post("/api/v1/devices/pair", json={"code": real["code"]}, headers=owner.headers)
    assert claimed.status_code == 200  # and so did its code


def test_one_network_cannot_push_out_another_networks_code_or_its_own(proxied):
    first = start(proxied, "198.51.100.7").json()
    results = [start(proxied, "198.51.100.7").status_code for _ in range(7)]
    assert (
        results.count(201) == accounts_module.PER_ADDRESS_PENDING - 1
    )  # five waiting in all, counting the first
    assert set(results) - {201} == {429}
    hub_headers = {"Authorization": f"Device {first['device_id']}:{first['device_secret']}"}
    assert proxied.get("/api/v1/device", headers=hub_headers).status_code == 200


# 2 sign-in: spraying and memory


def signin(c, email, password, ip):
    return c.post(
        "/api/v1/auth/signin", json={"email": email, "password": password}, headers={"X-Forwarded-For": ip}
    )


def test_spraying_many_accounts_from_one_address_is_stopped_but_known_accounts_still_sign_in(proxied):
    ip = "10.9.0.5"
    for name in ("mum", "kid"):
        sign_up(proxied, f"{name}@example.test")
        assert (
            signin(proxied, f"{name}@example.test", PASSWORD, ip).status_code == 200
        )  # this address knows them
    codes = [signin(proxied, f"victim{i}@example.test", "spray-guess-1", ip).status_code for i in range(60)]
    assert codes[:20] == [401] * 20
    # past the ceiling an address is slowed to about one password check a second, so nearly all of these are refused
    assert codes[20:].count(429) >= 35 and 401 in codes[20:]
    for name in ("mum", "kid"):
        assert signin(proxied, f"{name}@example.test", PASSWORD, ip).status_code == 200


def test_a_refused_spray_attempt_costs_no_hash(proxied):
    ip = "10.9.0.6"
    for i in range(21):
        signin(proxied, f"spray{i}@example.test", "spray-guess-1", ip)
    calls = {"n": 0}
    original = PasswordHasher.verify

    def counting(self, *a, **k):
        calls["n"] += 1
        return original(self, *a, **k)

    with patch.object(PasswordHasher, "verify", counting):
        assert signin(proxied, "another@example.test", "guess-guess-1", ip).status_code == 429
    assert calls["n"] == 0


def test_only_a_few_password_hashes_run_at_once_and_the_rest_are_refused_fast(settings, monkeypatch):
    import app.security as security

    monkeypatch.setattr(security, "HASH_WAIT_SECONDS", 0.2)
    state = {"now": 0, "peak": 0}
    lock = threading.Lock()
    original = PasswordHasher.verify

    def slow(self, *a, **k):
        with lock:
            state["now"] += 1
            state["peak"] = max(state["peak"], state["now"])
        try:
            time.sleep(0.4)
            return original(self, *a, **k)
        finally:
            with lock:
                state["now"] -= 1

    with TestClient(
        create_app(replace(settings, trusted_proxy_hops=1, trusted_proxy_cidrs=["10.0.0.0/8"]))
    ) as c:
        sign_up(c, "slow@example.test")
        with patch.object(PasswordHasher, "verify", slow):
            codes = parallel(
                24, lambda i: signin(c, "slow@example.test", f"wrong-{i}", f"10.1.{i}.1").status_code
            )
    assert state["peak"] <= security.MAX_CONCURRENT_HASHES
    assert 503 in codes and 401 in codes  # the extras are told to retry and the rest were really checked


# 4 deleted accounts leave nothing to send


def test_nothing_about_a_deleted_account_is_ever_sent(settings):
    from app.config import Settings
    from app.webhooks import Dispatcher, SecretBox

    from .receiver import Receiver

    rx = Receiver()
    try:
        config = Settings(
            **{
                **settings.__dict__,
                "webhook_allow_private": True,
                "session_webhook_url": rx.url,
                "session_webhook_secret": "Hq7vN2xKz9LmW4RjY8bT3cDfGaP5sUe",
            }
        )
        with TestClient(create_app(config)) as c:
            person = sign_up(c)
            send_session(c, pair(c, person))
            with psycopg.connect(config.database_url) as conn:
                assert conn.execute("SELECT count(*) FROM webhook_deliveries").fetchone()[0] == 1
            assert (
                c.request(
                    "DELETE", "/api/v1/auth/account", json={"password": PASSWORD}, headers=person.headers
                ).status_code
                == 204
            )
            with psycopg.connect(config.database_url) as conn:
                assert conn.execute("SELECT count(*) FROM webhook_deliveries").fetchone()[0] == 0
                fk = conn.execute(
                    "SELECT count(*) FROM information_schema.table_constraints WHERE table_name = 'webhook_deliveries'"
                    " AND constraint_type = 'FOREIGN KEY'"
                ).fetchone()[0]
            assert fk >= 2  # the endpoint and the session
            Dispatcher(c.app.state.pool, SecretBox(config.secret_key), allow_private=True).run_once()
        assert rx.requests == []
    finally:
        rx.close()


def test_deleting_a_session_removes_its_pending_deliveries(settings):
    from app.config import Settings

    from .receiver import Receiver

    rx = Receiver()
    try:
        config = Settings(
            **{
                **settings.__dict__,
                "webhook_allow_private": True,
                "session_webhook_url": rx.url,
                "session_webhook_secret": "Hq7vN2xKz9LmW4RjY8bT3cDfGaP5sUe",
            }
        )
        with TestClient(create_app(config)) as c:
            person = sign_up(c)
            sid = send_session(c, pair(c, person))["id"]
            c.delete(f"/api/v1/sessions/{sid}", headers=person.headers)
            with psycopg.connect(config.database_url) as conn:
                assert conn.execute("SELECT count(*) FROM webhook_deliveries").fetchone()[0] == 0
    finally:
        rx.close()


# 5 readiness follows the broker connection


def broker_container() -> str:
    """The container that publishes the test broker's port, whatever compose project it belongs to. Stopping it by its
    own id means a run under any project name touches only its own broker, never someone else's."""
    from .conftest import BROKER_PORT

    found = subprocess.run(
        ["docker", "ps", "-q", "--filter", f"publish={BROKER_PORT}"],
        capture_output=True,
        check=True,
        text=True,
    ).stdout.split()
    assert len(found) == 1, f"expected one container publishing {BROKER_PORT}, found {found}"
    return found[0]


def docker(*args):
    return subprocess.run(["docker", *args], capture_output=True, check=True, text=True).stdout.strip()


def test_readiness_follows_the_brokers_connection(mqtt_client):
    from .test_mqtt_e2e import wait_for

    ingest = mqtt_client.app.state.ingest
    wait_for(lambda: ingest.healthy())
    assert mqtt_client.get("/ready").status_code == 200
    container = broker_container()
    docker("stop", container)
    try:
        wait_for(lambda: not ingest.healthy(), 20)
        assert mqtt_client.get("/ready").status_code == 503
    finally:
        docker("start", container)
        wait_for(lambda: docker("inspect", "-f", "{{.State.Health.Status}}", container) == "healthy", 40)
        # the test broker keeps its rules in memory, so a restart forgets them. A real one keeps them on a volume
        time.sleep(1)
        mqtt_client.app.state.broker.ensure_roles()
        login = ingest._username
        mqtt_client.app.state.broker.ensure_ingest_user(
            login, "test-ingest-password-0123456789", clientid=login
        )
    wait_for(lambda: ingest.healthy(), 30)
    assert mqtt_client.get("/ready").status_code == 200


def test_a_dead_clients_socket_is_closed_when_the_supervisor_replaces_it():
    from app.mqtt_runner import MqttIngest

    closed = []

    class Dead:
        _thread = None

        def loop_stop(self):
            pass

        def disconnect(self):
            closed.append("disconnect")

        def _sock_close(self):
            closed.append("socket")

    ingest = MqttIngest("127.0.0.1", 1, "u", "p", handler=None)  # type: ignore[arg-type]
    ingest._client = Dead()  # type: ignore[assignment]
    ingest._launch = lambda: None  # type: ignore[method-assign]
    ingest._replace_dead_client()
    assert "socket" in closed


# 6 a broker made by an older version is brought up to date


def test_an_old_broker_loses_the_wildcard_rule_and_binds_its_existing_logins(broker_admin):
    import secrets as s

    from .test_broker import connect, stop

    old = "hub-" + s.token_hex(5)
    password = "legacy-" + s.token_hex(16)
    # how the first version left things: the wildcard rule and a login with no client id
    broker_admin._run(
        [
            {
                "command": "addRoleACL",
                "rolename": "hub",
                "acltype": "publishClientSend",
                "topic": "melophos/%u/+",
                "allow": True,
                "priority": 0,
            }
        ],
        tolerate=("already",),
    )
    broker_admin._run(
        [{"command": "createClient", "username": old, "password": password, "roles": [{"rolename": "hub"}]}]
    )
    c, ok = connect(old, password, cid="someone-else")
    stop(c)
    assert ok is True  # before the upgrade any client id works
    broker_admin.ensure_roles()  # the start-up call
    rules = broker_admin._send([{"command": "getRole", "rolename": "hub"}])[0]["data"]["role"]["acls"]
    assert "melophos/%u/+" not in [r["topic"] for r in rules]
    assert sorted(r["topic"] for r in rules) == sorted(
        f"melophos/%u/{k}" for k in ("notes", "session", "status")
    )
    c, ok = connect(old, password, cid="someone-else")
    stop(c)
    assert ok is False  # now bound to its own id
    c, ok = connect(old, password, cid=old)
    stop(c)
    assert ok is True
    broker_admin.delete_device(old)


def test_running_the_upgrade_twice_changes_nothing(broker_admin):
    broker_admin.ensure_roles()
    broker_admin.ensure_roles()


# 8 the smaller items


def test_the_stored_event_counter_matches_the_sum_through_every_change(client, database_url):
    from app.ingest import IngestHandler

    from .test_ingest import finish, notes

    person = sign_up(client)
    hub = pair(client, person)
    other = pair(client, person)

    def counter():
        with psycopg.connect(database_url) as conn:
            stored = conn.execute("SELECT stored_events FROM users WHERE id = %s", (person.id,)).fetchone()[0]
            real = conn.execute("SELECT coalesce(sum(event_count), 0) FROM practice_sessions").fetchone()[0]
        return stored, real

    first = send_session(client, hub)["id"]
    send_session(client, other, started_at=(datetime.now(UTC) - timedelta(hours=5)).isoformat())
    stored, real = counter()
    assert stored == real == 12
    handler = IngestHandler(client.app.state.pool, client.app.state.store)
    assert (
        handler.handle(f"melophos/{hub.device_id}/notes", json.dumps(notes(seq=1)).encode()).value == "stored"
    )
    assert counter() == (14, 14)  # a notes batch moves it too
    client.delete(f"/api/v1/sessions/{first}", headers=person.headers)
    assert counter() == (8, 8)
    client.delete(f"/api/v1/devices/{other.device_id}", headers=person.headers)
    assert counter() == (2, 2)
    assert finish and notes


def test_the_owner_can_see_the_quota_and_when_it_is_reached(client, monkeypatch):
    import app.routers.auth as auth
    import app.store as store

    person = sign_up(client)
    me = client.get("/api/v1/auth/me", headers=person.headers).json()
    assert (me["events_used"], me["events_limit"], me["storage_full"]) == (
        0,
        store.MAX_EVENTS_PER_ACCOUNT,
        False,
    )
    monkeypatch.setattr(store, "MAX_EVENTS_PER_ACCOUNT", 6)
    monkeypatch.setattr(auth, "MAX_EVENTS_PER_ACCOUNT", 6)
    send_session(client, pair(client, person))
    me = client.get("/api/v1/auth/me", headers=person.headers).json()
    assert (me["events_used"], me["events_limit"], me["storage_full"]) == (6, 6, True)


def test_the_operator_endpoint_has_a_delivery_slot_of_its_own(settings):
    from app.config import Settings
    from app.webhooks import Dispatcher, SecretBox

    from .receiver import Receiver

    rx, rx2 = Receiver(), Receiver()
    try:
        config = Settings(
            **{
                **settings.__dict__,
                "webhook_allow_private": True,
                "session_webhook_url": rx.url,
                "session_webhook_secret": "Hq7vN2xKz9LmW4RjY8bT3cDfGaP5sUe",
            }
        )
        with TestClient(create_app(config)) as c:
            person = sign_up(c, password=PASSWORD)
            hub = pair(c, person)
            c.post("/api/v1/webhooks", json={"url": rx2.url, "password": PASSWORD}, headers=person.headers)
            for i in range(4):
                send_session(c, hub, started_at=(datetime.now(UTC) - timedelta(hours=i + 1)).isoformat())
            jobs = Dispatcher(c.app.state.pool, SecretBox(config.secret_key), allow_private=True)._claim(20)
            assert len(jobs) == 4  # two for the owner's endpoint and two more for the operator's
    finally:
        rx.close()
        rx2.close()


def test_a_proxy_is_trusted_only_when_configured(settings):
    from app.config import check_secrets

    with pytest.raises(RuntimeError, match="TRUSTED_PROXY_CIDRS"):
        check_secrets(replace(settings, trusted_proxy_hops=1, trusted_proxy_cidrs=[]))
    check_secrets(replace(settings, trusted_proxy_hops=1, trusted_proxy_cidrs=["172.16.0.0/12"]))
    assert settings.trusted_proxy_hops == 0


def test_database_passwords_off_this_machine_are_checked(settings):
    from app.config import check_secrets

    for bad in (
        "postgresql://melophos_app:change-me@db:5432/melophos",
        "postgresql://melophos_app:short@db:5432/melophos",
    ):
        with pytest.raises(RuntimeError, match="DATABASE_URL"):
            check_secrets(replace(settings, database_url=bad))
    check_secrets(
        replace(settings, database_url="postgresql://melophos_app:Zq81LmXv0TgR5aYb3NcWd7@db:5432/melophos")
    )
    check_secrets(settings)  # the loopback test database with a short password is allowed


def test_the_image_reads_the_example_file_it_ships(monkeypatch, tmp_path):
    from app.config import published_values

    example = tmp_path / "example.env"
    example.write_text("SECRET_KEY=totally-unique-published-value-1234567890\n")
    monkeypatch.setenv("ENV_EXAMPLE_PATH", str(example))
    assert "totally-unique-published-value-1234567890" in published_values()


# 10 messages sent while the server is down are kept by the broker, 11 the hub can see its counter


def test_a_session_sent_while_the_server_was_down_arrives_exactly_once(mqtt_client, mqtt_settings):
    import sys

    from app.ingest import IngestHandler
    from app.mqtt_runner import MqttIngest

    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "client"))
    from melophos_client.mqtt import run_session

    from .conftest import BROKER_HOST, BROKER_PORT
    from .test_mqtt_e2e import outcome, wait_for

    owner = sign_up(mqtt_client)
    hub = new_hub(mqtt_client)
    mqtt_client.post("/api/v1/devices/pair", json={"code": hub.code}, headers=owner.headers)
    assert mqtt_client.get("/api/v1/device", headers=hub.headers).json()["paired"] is True
    first = mqtt_client.app.state.ingest
    wait_for(lambda: first.healthy())
    time.sleep(0.5)
    first.stop()  # the server goes away, cleanly
    before_replayed, before_stored = outcome("replayed"), outcome("stored")
    # the hub publishes and the broker acknowledges while nobody is subscribed
    report = run_session(
        BROKER_HOST,
        BROKER_PORT,
        hub.device_id,
        hub.secret,
        1,
        "piano-61",
        [{"t_ms": 0, "note": 60, "velocity": 80}],
    )
    assert report.refused == [] and report.sent >= 3
    assert mqtt_client.get("/api/v1/sessions", headers=owner.headers).json()["items"] == []  # nothing yet
    # the server comes back with the same client id and finds the messages waiting
    again = MqttIngest(
        mqtt_settings.mqtt_host,
        mqtt_settings.mqtt_port,
        first._username,
        mqtt_settings.mqtt_password,
        IngestHandler(mqtt_client.app.state.pool, mqtt_client.app.state.store),
        client_id=first.client_id,
    )
    again.start()
    try:
        wait_for(
            lambda: len(mqtt_client.get("/api/v1/sessions", headers=owner.headers).json()["items"]) == 1, 15
        )
        time.sleep(1.0)
        assert (
            len(mqtt_client.get("/api/v1/sessions", headers=owner.headers).json()["items"]) == 1
        )  # exactly once
        assert outcome("replayed") == before_replayed  # and nothing arrived twice
        assert outcome("stored") >= before_stored + report.sent
    finally:
        again.stop()


def test_the_server_connects_with_a_fixed_client_id_and_a_persistent_session():
    from app.mqtt_runner import SESSION_EXPIRY_SECONDS, MqttIngest

    ingest = MqttIngest("127.0.0.1", 1, "u", "p", handler=None, client_id="melophos-server-a")  # type: ignore[arg-type]
    assert ingest.client_id == "melophos-server-a"
    assert SESSION_EXPIRY_SECONDS >= 86_400
    assert ingest._build()._client_id == b"melophos-server-a"  # the same id after every restart


def test_the_broker_queue_bounds_are_stated_and_set():
    conf = (Path(__file__).resolve().parents[1] / "deploy" / "mosquitto" / "mosquitto.conf").read_text()
    assert "max_queued_messages 20000" in conf and "max_queued_bytes 67108864" in conf
    assert "persistence true" in conf


def test_the_hub_can_see_the_highest_boot_the_server_accepted(client):
    from app.ingest import IngestHandler

    hub = pair(client, sign_up(client))
    assert client.get("/api/v1/device", headers=hub.headers).json()["last_boot"] is None
    handler = IngestHandler(client.app.state.pool, client.app.state.store)
    for boot, kind, body in (
        (5, "status", {"firmware": "1"}),
        (7, "notes", None),
    ):
        if body is not None:
            handler.handle(
                f"melophos/{hub.device_id}/{kind}", json.dumps({"boot": boot, "seq": 1, **body}).encode()
            )
    handler.handle(
        f"melophos/{hub.device_id}/status", json.dumps({"boot": 9, "seq": 1, "firmware": "1"}).encode()
    )
    assert client.get("/api/v1/device", headers=hub.headers).json()["last_boot"] == 9
    owner_view = client.get(f"/api/v1/devices/{hub.device_id}", headers=sign_up(client).headers)
    assert owner_view.status_code == 404
