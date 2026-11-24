"""Ingest instances, the hash gate, health checks and pairing places for known addresses. Each test fails without its fix."""

import json
import logging
import os
import shutil
import subprocess
import threading
import time
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import psycopg
import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from app import accounts as accounts_module
from app.main import create_app

from .helpers import PASSWORD, new_hub, sign_up
from .test_limits_and_deletion import parallel

DEPLOY = Path(__file__).resolve().parents[1] / "deploy"


@pytest.fixture()
def proxied(settings):
    with TestClient(
        create_app(replace(settings, trusted_proxy_hops=1, trusted_proxy_cidrs=["10.0.0.0/8"]))
    ) as c:
        yield c


def signin(c, email, password, ip):
    return c.post(
        "/api/v1/auth/signin", json={"email": email, "password": password}, headers={"X-Forwarded-For": ip}
    )


# 1 ingest: an id of its own per process, one queue and a refusal when the id is taken


def test_a_second_process_with_the_same_instance_name_refuses_to_start_ingest(mqtt_settings):
    first = replace(mqtt_settings, mqtt_instance="alpha", mqtt_group="grp-alpha", mqtt_session_expiry=2)
    with (
        TestClient(create_app(first)),
        pytest.raises(RuntimeError, match="already running ingest as alpha"),
        TestClient(create_app(first)),
    ):
        pass


def test_two_processes_with_their_own_instance_names_run_side_by_side_without_a_fight(mqtt_settings):
    import time as _time

    from .test_mqtt_e2e import wait_for

    a = replace(mqtt_settings, mqtt_instance="one", mqtt_group="grp-pair", mqtt_session_expiry=2)
    b = replace(a, mqtt_instance="two")
    with TestClient(create_app(a)) as ca, TestClient(create_app(b)) as cb:
        wait_for(lambda: ca.app.state.ingest.healthy() and cb.app.state.ingest.healthy())
        drops = {"a": 0, "b": 0}
        ca.app.state.ingest._client.on_disconnect = lambda *x: drops.__setitem__("a", drops["a"] + 1)
        cb.app.state.ingest._client.on_disconnect = lambda *x: drops.__setitem__("b", drops["b"] + 1)
        _time.sleep(5)  # two clients fought for 15 s with 7 disconnects
        assert drops == {"a": 0, "b": 0}
        assert ca.get("/ready").status_code == 200 and cb.get("/ready").status_code == 200
        assert ca.app.state.ingest.client_id != cb.app.state.ingest.client_id


def test_the_ingest_login_only_works_with_its_own_client_id(mqtt_settings, broker_admin):
    from .test_broker import connect, stop

    broker_admin.ensure_ingest_user(
        "melophos-server-solo", "test-ingest-password-0123456789", "melophos-server-solo"
    )
    c, ok = connect("melophos-server-solo", "test-ingest-password-0123456789", cid="melophos-server-solo")
    stop(c)
    assert ok is True
    c, ok = connect("melophos-server-solo", "test-ingest-password-0123456789", cid="somebody-else")
    stop(c)
    assert ok is False


def test_a_message_goes_to_one_of_two_running_processes_not_both(mqtt_settings):
    import sys

    from .conftest import BROKER_HOST, BROKER_PORT
    from .test_mqtt_e2e import outcome, wait_for

    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "client"))
    from melophos_client.mqtt import run_session

    a = replace(mqtt_settings, mqtt_instance="left", mqtt_group="grp-lr", mqtt_session_expiry=2)
    b = replace(a, mqtt_instance="right")
    with TestClient(create_app(a)) as ca, TestClient(create_app(b)) as cb:
        wait_for(lambda: ca.app.state.ingest.healthy() and cb.app.state.ingest.healthy())
        time.sleep(0.5)
        owner = sign_up(ca)
        hub = new_hub(ca)
        ca.post("/api/v1/devices/pair", json={"code": hub.code}, headers=owner.headers)
        ca.get("/api/v1/device", headers=hub.headers)
        before = outcome("replayed")
        run_session(
            BROKER_HOST,
            BROKER_PORT,
            hub.device_id,
            hub.secret,
            1,
            "piano-61",
            [{"t_ms": 0, "note": 60, "velocity": 80}],
        )
        wait_for(lambda: len(ca.get("/api/v1/sessions", headers=owner.headers).json()["items"]) == 1)
        time.sleep(1)
        assert len(ca.get("/api/v1/sessions", headers=owner.headers).json()["items"]) == 1
        assert outcome("replayed") == before  # nothing was delivered to both


# 2 first sign-in and the proxy warning


def test_a_right_first_password_gets_in_even_after_a_stranger_has_used_up_the_ceiling(proxied):
    ip = "10.7.0.5"
    sign_up(proxied, "newcomer@example.test")
    for i in range(25):
        signin(proxied, f"nobody{i}@example.test", "spray-guess-1", ip)
    time.sleep(1.2)
    assert signin(proxied, "newcomer@example.test", PASSWORD, ip).status_code == 200  # not 429 for 15 minutes


def test_over_the_ceiling_hashing_is_slow_for_everyone_so_spraying_stays_expensive(proxied):
    ip = "10.7.0.6"
    for i in range(22):
        signin(proxied, f"spray{i}@example.test", "spray-guess-1", ip)
    calls = {"n": 0}
    original = PasswordHasher.verify

    def counting(self, *a, **k):
        calls["n"] += 1
        return original(self, *a, **k)

    with patch.object(PasswordHasher, "verify", counting):
        codes = [signin(proxied, f"more{i}@example.test", "spray-guess-1", ip).status_code for i in range(8)]
    assert (
        calls["n"] <= 2 and codes.count(429) >= 6
    )  # at most about one check a second for an address over the ceiling


def test_a_warning_names_the_fix_when_every_request_comes_from_one_private_address(settings, caplog):
    with (
        TestClient(create_app(settings), client=("172.18.0.1", 50000)) as c,
        caplog.at_level(logging.WARNING, logger="melophos.proxy"),
    ):
        for _ in range(60):
            c.get("/health")
    text = " ".join(r.getMessage() for r in caplog.records)
    assert "172.18.0.1" in text and "TRUSTED_PROXY_HOPS" in text and "TRUSTED_PROXY_CIDRS" in text


def test_no_warning_when_a_proxy_is_configured_or_peers_differ(settings, caplog):
    with (
        TestClient(
            create_app(replace(settings, trusted_proxy_hops=1, trusted_proxy_cidrs=["172.18.0.1/32"])),
            client=("172.18.0.1", 1),
        ) as c,
        caplog.at_level(logging.WARNING, logger="melophos.proxy"),
    ):
        for _ in range(60):
            c.get("/health")
    assert not [r for r in caplog.records if r.name == "melophos.proxy"]


# 3 the hash gate


def test_the_gate_is_sized_from_the_processor_count_within_a_floor_and_a_ceiling():
    from app.security import GATE_CEILING, GATE_FLOOR, hash_slots

    assert hash_slots(1) == GATE_FLOOR == 2
    assert hash_slots(4) == 4
    assert hash_slots(64) == GATE_CEILING == 8


def test_a_known_household_is_served_while_strangers_saturate_the_gate(settings, monkeypatch):
    import app.security as security

    monkeypatch.setattr(security, "HASH_WAIT_SECONDS", 0.3)
    with TestClient(
        create_app(replace(settings, trusted_proxy_hops=1, trusted_proxy_cidrs=["10.0.0.0/8"]))
    ) as c:
        sign_up(c, "home@example.test")
        assert (
            signin(c, "home@example.test", PASSWORD, "10.8.0.1").status_code == 200
        )  # the address now knows it
        original = PasswordHasher.verify

        def slow(self, *a, **k):
            time.sleep(0.8)
            return original(self, *a, **k)

        with patch.object(PasswordHasher, "verify", slow):
            strangers = threading.Thread(
                target=lambda: parallel(
                    30, lambda i: signin(c, f"x{i}@example.test", "guess-guess-1", f"10.9.{i}.1").status_code
                )
            )
            strangers.start()
            time.sleep(0.3)
            codes = [signin(c, "home@example.test", PASSWORD, "10.8.0.1").status_code for _ in range(1)]
            strangers.join()
    assert codes == [200]


# 4 health checks


def test_every_long_running_service_has_its_own_health_check_and_the_image_has_none():
    if shutil.which("docker") is None or shutil.which("openssl") is None:
        pytest.skip("docker and openssl are needed")
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "deploy"
        shutil.copytree(DEPLOY, copy, ignore=shutil.ignore_patterns("certs"))
        shutil.copytree(DEPLOY.parent / "db", Path(tmp) / "db")
        subprocess.run([str(copy / "generate-env.sh")], check=True, capture_output=True)
        out = subprocess.run(
            [
                "docker",
                "compose",
                "--env-file",
                str(copy / ".env"),
                "-f",
                str(copy / "docker-compose.yml"),
                "config",
                "--format",
                "json",
            ],
            env={
                **os.environ,
                "MELOPHOS_SERVER_DIGEST": "sha256:" + "0" * 64,
                "MELOPHOS_MQTT_DIGEST": "sha256:" + "1" * 64,
            },
            capture_output=True,
            check=True,
            text=True,
        ).stdout
    services = json.loads(out)["services"]
    for name in ("server", "worker", "mqtt", "db"):
        assert services[name].get("healthcheck", {}).get("test"), name
    assert "/ready" not in json.dumps(services["worker"]["healthcheck"])
    for name in ("db-roles", "migrate"):
        assert services[name].get("healthcheck", {}).get("disable") is True
    assert "HEALTHCHECK" not in (DEPLOY.parent / "Dockerfile").read_text()


def test_the_worker_check_passes_while_its_loops_run_and_fails_when_one_stops(tmp_path):
    from worker.main import heartbeat, worker_is_alive

    for name in ("webhooks", "imports", "scoring"):
        heartbeat(name, tmp_path)
    assert worker_is_alive(tmp_path, max_age=60)
    stale = tmp_path / "melophos-worker-scoring"
    old = time.time() - 600
    import os

    os.utime(stale, (old, old))
    assert not worker_is_alive(tmp_path, max_age=60)
    assert not worker_is_alive(tmp_path / "missing", max_age=60)


# 6 the counter is out of the app role's reach


def test_the_stored_event_counter_has_a_floor_and_only_triggers_move_it(database_url):
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO users (email, display_name, password_hash) VALUES ('c@example.test', 'c', 'x')"
        )
        with pytest.raises(psycopg.errors.CheckViolation):
            conn.execute("UPDATE users SET stored_events = -999999999")


# 7 pairing keeps places for known addresses


def test_known_addresses_can_still_pair_when_other_networks_have_filled_the_unreserved_places(proxied):
    owner_ip = "10.6.0.1"
    sign_up(proxied, "household@example.test")
    assert (
        signin(proxied, "household@example.test", PASSWORD, owner_ip).status_code == 200
    )  # this address is now known
    with (
        patch.object(accounts_module, "MAX_PENDING_PAIRINGS", 20),
        patch.object(accounts_module, "RESERVED_FOR_KNOWN", 5),
    ):
        flood = [
            proxied.post("/api/v1/pairing", headers={"X-Forwarded-For": f"10.5.{i}.1"}).status_code
            for i in range(30)
        ]
        assert flood.count(201) == 15 and flood.count(503) == 15  # strangers get 15 of the 20 places
        assert proxied.post("/api/v1/pairing", headers={"X-Forwarded-For": owner_ip}).status_code == 201
        assert proxied.post("/api/v1/pairing", headers={"X-Forwarded-For": "10.4.4.4"}).status_code == 503
