"""A full run: simulated hub, real broker, running server, real database, read back through the HTTP API."""

import json
import sys
import time
from pathlib import Path

import pytest
from prometheus_client import REGISTRY

CLIENT_DIR = Path(__file__).resolve().parents[2] / "client"
if CLIENT_DIR.is_dir():
    sys.path.insert(0, str(CLIENT_DIR))
sim = pytest.importorskip(
    "melophos_client.simulator", reason="the client folder is part of the monorepo checkout"
)
from melophos_client.credentials import Credentials  # noqa: E402
from melophos_client.mqtt import HubLink, broker_password, run_session  # noqa: E402

from .conftest import BROKER_HOST, BROKER_PORT  # noqa: E402
from .helpers import new_hub, sign_up  # noqa: E402

PIANO = {"id": "piano-61", "type": "keyboard", "notes": {"lowest": 36, "highest": 96}}


def wait_for(check, seconds=8.0):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.1)
    raise AssertionError("timed out waiting")


def outcome(name):
    return REGISTRY.get_sample_value("melophos_mqtt_messages_total", {"outcome": name}) or 0.0


@pytest.fixture()
def running(mqtt_client):
    wait_for(lambda: mqtt_client.app.state.ingest.subscribed)
    time.sleep(0.5)  # the subscription is acknowledged a moment after the flag flips
    owner = sign_up(mqtt_client)
    hub = new_hub(mqtt_client)
    claimed = mqtt_client.post("/api/v1/devices/pair", json={"code": hub.code}, headers=owner.headers)
    assert claimed.status_code == 200
    # the hub's next status call after the claim creates its broker login
    assert mqtt_client.get("/api/v1/device", headers=hub.headers).json()["paired"] is True
    return mqtt_client, owner, hub


def test_the_simulator_runs_end_to_end_over_mqtt(running, tmp_path):
    client, owner, hub = running
    profile = tmp_path / "piano-61.json"
    profile.write_text(json.dumps(PIANO))
    creds_path = tmp_path / "creds.json"
    Credentials("http://unused", hub.device_id, hub.secret).save(creds_path)
    assert oct(creds_path.stat().st_mode & 0o777) == "0o600"

    sim.main(
        [
            "--profile",
            str(profile),
            "--credentials",
            str(creds_path),
            "--mqtt",
            f"{BROKER_HOST}:{BROKER_PORT}",
            "--seed",
            "7",
        ]
    )

    expected = [e for e in sim.scale_session(PIANO, seed=7)]
    presses = sum(1 for e in expected if e["velocity"] > 0)
    sessions = wait_for(lambda: client.get("/api/v1/sessions", headers=owner.headers).json()["items"])
    assert len(sessions) == 1
    summary = sessions[0]["summary"]
    assert summary["notes_played"] == presses
    assert sessions[0]["device_id"] == hub.device_id
    events = client.get(
        f"/api/v1/sessions/{sessions[0]['id']}/events", params={"limit": 2000}, headers=owner.headers
    ).json()["items"]
    assert len(events) == len(expected)
    device = client.get(f"/api/v1/devices/{hub.device_id}", headers=owner.headers).json()
    assert device["last_seen_at"] is not None
    assert device["firmware"] == "sim-0.1.0"
    assert Credentials.load(creds_path).boot == 1


def test_a_second_run_is_a_new_boot_and_is_accepted(running, tmp_path):
    client, owner, hub = running
    profile = tmp_path / "p.json"
    profile.write_text(json.dumps(PIANO))
    creds_path = tmp_path / "creds.json"
    Credentials("http://unused", hub.device_id, hub.secret).save(creds_path)
    for _ in range(2):
        sim.main(
            [
                "--profile",
                str(profile),
                "--credentials",
                str(creds_path),
                "--mqtt",
                f"{BROKER_HOST}:{BROKER_PORT}",
                "--seed",
                "3",
            ]
        )
        time.sleep(1.1)  # session references include the start second
    wait_for(lambda: len(client.get("/api/v1/sessions", headers=owner.headers).json()["items"]) == 2)


def test_a_bad_payload_over_the_real_broker_is_skipped_and_the_run_continues(running):
    client, owner, hub = running
    before = outcome("bad_payload")
    with HubLink(BROKER_HOST, BROKER_PORT, hub.device_id, hub.secret) as link:
        assert link.publish(f"melophos/{hub.device_id}/notes", b"{not json")
        assert link.publish(
            f"melophos/{hub.device_id}/status",
            json.dumps({"boot": 1, "seq": 1, "firmware": "9.9.9"}).encode(),
        )
    wait_for(lambda: outcome("bad_payload") == before + 1)
    wait_for(
        lambda: (
            client.get(f"/api/v1/devices/{hub.device_id}", headers=owner.headers).json()["firmware"]
            == "9.9.9"
        )
    )


def test_a_hub_cannot_store_data_for_another_account_even_by_trying(running):
    client, owner, hub = running
    victim = sign_up(client)
    victim_hub = new_hub(client)
    assert (
        client.post(
            "/api/v1/devices/pair", json={"code": victim_hub.code}, headers=victim.headers
        ).status_code
        == 200
    )
    assert client.get("/api/v1/device", headers=victim_hub.headers).json()["paired"] is True
    report = run_session(
        BROKER_HOST,
        BROKER_PORT,
        hub.device_id,
        hub.secret,
        1,
        "piano-61",
        [{"t_ms": 0, "note": 60, "velocity": 80}],
    )
    assert report.refused == []
    with HubLink(BROKER_HOST, BROKER_PORT, hub.device_id, hub.secret) as link:
        forged = {"boot": 1, "seq": 1, "firmware": "evil"}
        assert link.publish(f"melophos/{victim_hub.device_id}/status", json.dumps(forged).encode()) is False
    time.sleep(1.0)
    row = client.get(f"/api/v1/devices/{victim_hub.device_id}", headers=victim.headers).json()
    assert row["firmware"] is None
    assert row["last_seen_at"] is None


def test_an_unclaimed_hub_has_no_broker_login_at_all(running):
    """H2: asking for a pairing code must not hand out a login that can publish to the broker."""
    from .test_broker import connect, stop

    client, _owner, _hub = running
    stranger = new_hub(client)
    c, ok = connect(stranger.device_id, broker_password(stranger.secret), cid=stranger.device_id)
    stop(c)
    assert ok is False


def test_the_server_ignores_traffic_from_a_login_whose_device_is_gone(running, broker_admin):
    client, _owner, _hub = running
    ghost = "hub-" + "ab12cd34ef"
    broker_admin.create_device(ghost, broker_password("mph_ghost-secret-for-the-test-0123456789"))
    before = outcome("unknown_device")
    try:
        with HubLink(BROKER_HOST, BROKER_PORT, ghost, "mph_ghost-secret-for-the-test-0123456789") as link:
            assert link.publish(
                f"melophos/{ghost}/status", json.dumps({"boot": 1, "seq": 1, "firmware": "1"}).encode()
            )
        wait_for(lambda: outcome("unknown_device") == before + 1)
    finally:
        broker_admin.delete_device(ghost)


def test_one_hostile_message_does_not_stop_ingest_for_another_hub(running):
    """H1 end to end: the attacker's far-future message, then the victim's normal session must still arrive."""
    client, owner, hub = running
    victim = sign_up(client)
    victim_hub = new_hub(client)
    client.post("/api/v1/devices/pair", json={"code": victim_hub.code}, headers=victim.headers)
    assert client.get("/api/v1/device", headers=victim_hub.headers).json()["paired"] is True
    hostile = {
        "boot": 1,
        "seq": 1,
        "session_ref": "x",
        "started_at": "9999-12-31T23:00:00Z",
        "profile_id": "p",
        "events": [{"t_ms": 21_600_000, "note": 60, "velocity": 70}],
    }
    before = outcome("bad_payload")
    with HubLink(BROKER_HOST, BROKER_PORT, hub.device_id, hub.secret) as link:
        assert link.publish(f"melophos/{hub.device_id}/notes", json.dumps(hostile).encode())
    wait_for(lambda: outcome("bad_payload") == before + 1)
    run_session(
        BROKER_HOST,
        BROKER_PORT,
        victim_hub.device_id,
        victim_hub.secret,
        1,
        "piano-61",
        [{"t_ms": 0, "note": 60, "velocity": 80}],
    )
    wait_for(lambda: client.get("/api/v1/sessions", headers=victim.headers).json()["items"])
    assert client.get("/ready").status_code == 200


def test_a_dead_ingest_thread_is_visible_in_readiness_and_restarted(running, monkeypatch):
    import app.mqtt_runner as runner

    client, _owner, _hub = running
    monkeypatch.setattr(runner, "CHECK_SECONDS", 0.3)
    ingest = client.app.state.ingest
    ingest._stop.set()  # stop the old supervisor and start one that checks quickly
    ingest._stop = type(ingest._stop)()
    import threading

    threading.Thread(target=ingest._watch, daemon=True).start()
    ingest._client.loop_stop()  # kill the network thread the way an escaped exception would
    assert not ingest.healthy()
    assert client.get("/ready").status_code == 503
    wait_for(lambda: ingest.healthy())
    assert ingest.restarts >= 1
    assert client.get("/ready").status_code == 200


def test_removing_a_device_removes_its_broker_login(running):
    from .test_broker import connect, stop

    client, owner, hub = running
    ok_client, ok = connect(hub.device_id, broker_password(hub.secret))
    stop(ok_client)
    assert ok is True
    assert client.delete(f"/api/v1/devices/{hub.device_id}", headers=owner.headers).status_code == 204
    gone_client, ok_after = connect(hub.device_id, broker_password(hub.secret))
    stop(gone_client)
    assert ok_after is False
