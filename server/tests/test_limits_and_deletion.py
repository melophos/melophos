"""Races, shared addresses, quotas, deletion and the rest. Each test fails if its
property is false: the concurrent ones really run in parallel and count how many were evaluated."""

import json
import threading
import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.outbound import UnsafeDestination, check_url

from .helpers import PASSWORD, new_hub, pair, send_session, sign_up


def parallel(count, work):
    """Run `work(i)` in `count` threads released together. Returns the results."""
    gate = threading.Barrier(count)
    results = [None] * count

    def go(i):
        gate.wait()
        results[i] = work(i)

    threads = [threading.Thread(target=go, args=(i,)) for i in range(count)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    return results


@pytest.fixture()
def proxied(settings):
    with TestClient(create_app(replace(settings, trusted_proxy_hops=1))) as c:
        yield c


# M1 races


def test_thirty_parallel_wrong_sign_ins_are_judged_against_a_limit_of_five(proxied):
    sign_up(proxied, "race@example.test")
    codes = parallel(
        30,
        lambda i: (
            proxied.post(
                "/api/v1/auth/signin",
                json={"email": "race@example.test", "password": f"wrong-guess-{i}"},
                headers={"X-Forwarded-For": "203.0.113.9"},
            ).status_code
        ),
    )
    assert codes.count(401) == 5  # only the budget was ever evaluated
    assert codes.count(429) == 25


def test_forty_parallel_wrong_pairing_codes_use_only_the_budget(client):
    owner = sign_up(client)
    codes = parallel(
        40,
        lambda i: (
            client.post(
                "/api/v1/devices/pair",
                json={"code": f"AAAAAAA{'BCDEFGHJKLMNPQRSTUVWXYZ'[i % 23]}"},
                headers=owner.headers,
            ).status_code
        ),
    )
    assert codes.count(404) == 5 and codes.count(429) == 35


def test_ten_accounts_racing_for_one_code_leave_exactly_one_owner(client):
    people = [sign_up(client) for _ in range(10)]
    hub = new_hub(client)
    results = parallel(
        10,
        lambda i: (
            client.post(
                "/api/v1/devices/pair", json={"code": hub.code}, headers=people[i].headers
            ).status_code
        ),
    )
    assert results.count(200) == 1 and results.count(404) == 9


def test_parallel_claims_cannot_pass_the_device_limit(client):
    from unittest.mock import patch

    from app import accounts as accounts_module

    owner = sign_up(client)
    with patch.object(accounts_module, "PER_ADDRESS_PENDING", 20):
        hubs = [new_hub(client) for _ in range(8)]
    with patch.object(accounts_module, "MAX_DEVICES_PER_ACCOUNT", 3):
        results = parallel(
            8,
            lambda i: (
                client.post(
                    "/api/v1/devices/pair", json={"code": hubs[i].code}, headers=owner.headers
                ).status_code
            ),
        )
    # claims past the limit are refused with 409 or with 429 when they met the guess budget while others were in flight
    assert results.count(200) == 3 and results.count(409) + results.count(429) == 5


def test_parallel_webhook_creation_cannot_pass_the_endpoint_limit(private_client):
    person = sign_up(private_client)
    results = parallel(
        12,
        lambda i: (
            private_client.post(
                "/api/v1/webhooks",
                json={"url": f"http://127.0.0.1:9/{i}", "password": PASSWORD},
                headers=person.headers,
            ).status_code
        ),
    )
    assert results.count(201) == 5 and results.count(409) + results.count(429) == 7


def test_parallel_uploads_cannot_pass_the_library_limit(client, monkeypatch):
    import app.songs as songs

    from . import midi_writer as w
    from .test_songs import MIDI

    person = sign_up(client)
    monkeypatch.setattr(songs, "MAX_SONGS_PER_ACCOUNT", 4)
    data = w.two_unnamed_tracks().data
    results = parallel(
        10,
        lambda i: (
            client.post(
                "/api/v1/songs", params={"title": f"s{i}"}, content=data, headers={**person.headers, **MIDI}
            ).status_code
        ),
    )
    assert results.count(202) == 4 and results.count(409) == 6


# M2 a household behind one address


# the household case is proved together with the spraying ceiling in test_floods_and_broker_upgrade.py


# M3 addresses


def test_every_address_in_an_ipv6_64_counts_as_one_caller(proxied):
    sign_up(proxied, "six@example.test")
    codes = [
        proxied.post(
            "/api/v1/auth/signin",
            json={"email": "six@example.test", "password": f"wrong-guess-{i}"},
            headers={"X-Forwarded-For": f"2001:db8:aaaa:bbbb:{i:x}::1"},
        ).status_code
        for i in range(8)
    ]
    assert codes[:5] == [401] * 5 and codes[5:] == [429] * 3


def test_forwarded_for_is_ignored_when_the_peer_is_not_a_trusted_proxy(settings):
    from app.auth import client_ip

    class Req:
        def __init__(self, peer):
            self.client = type("C", (), {"host": peer})()
            self.headers = {"x-forwarded-for": "203.0.113.200"}
            self.app = type(
                "A",
                (),
                {
                    "state": type(
                        "S",
                        (),
                        {
                            "settings": replace(
                                settings, trusted_proxy_hops=1, trusted_proxy_cidrs=["172.16.0.0/12"]
                            )
                        },
                    )()
                },
            )()

    assert client_ip(Req("8.8.8.8")) == "8.8.8.8"  # a direct caller cannot pick its address
    assert client_ip(Req("172.18.0.3")) == "203.0.113.200"  # the proxy's header is believed


def test_the_ipv6_key_is_a_64():
    from app.auth import _bucket_address

    assert _bucket_address("2001:db8:1:2:aaaa:bbbb:cccc:dddd") == "2001:db8:1:2::/64"
    assert _bucket_address("::ffff:192.0.2.1") == "192.0.2.1"
    assert _bucket_address("192.0.2.1") == "192.0.2.1"


# M5 sessions


def test_the_hourly_session_limit_per_hub(client, monkeypatch):
    import app.routers.sessions as route

    monkeypatch.setattr(route, "SESSIONS_PER_HOUR", 3)
    hub = pair(client, sign_up(client))
    codes = [
        client.post(
            "/api/v1/sessions",
            json={
                "profile_id": "p",
                "started_at": (datetime.now(UTC) - timedelta(hours=i)).isoformat(),
                "events": [],
            },
            headers=hub.headers,
        ).status_code
        for i in range(5)
    ]
    assert codes == [201, 201, 201, 429, 429]


def test_an_account_cannot_store_more_note_events_than_its_quota(client, monkeypatch):
    import app.store as store

    monkeypatch.setattr(store, "MAX_EVENTS_PER_ACCOUNT", 10)
    hub = pair(client, sign_up(client))
    events = [{"t_ms": i, "note": 60, "velocity": 1} for i in range(6)]
    assert (
        client.post(
            "/api/v1/sessions",
            json={"profile_id": "p", "started_at": datetime.now(UTC).isoformat(), "events": events},
            headers=hub.headers,
        ).status_code
        == 201
    )
    r = client.post(
        "/api/v1/sessions",
        json={"profile_id": "p", "started_at": datetime.now(UTC).isoformat(), "events": events},
        headers=hub.headers,
    )
    assert r.status_code == 413


def test_sessions_over_mqtt_count_against_the_same_limits(client, monkeypatch):
    import app.routers.sessions as route
    from app.ingest import IngestHandler, Outcome

    monkeypatch.setattr(route, "SESSIONS_PER_HOUR", 2)
    hub = pair(client, sign_up(client))
    handler = IngestHandler(client.app.state.pool, client.app.state.store)
    start = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    outcomes = [
        handler.handle(
            f"melophos/{hub.device_id}/notes",
            json.dumps(
                {
                    "boot": 1,
                    "seq": i + 1,
                    "session_ref": f"r{i}",
                    "started_at": start,
                    "profile_id": "p",
                    "events": [{"t_ms": 0, "note": 60, "velocity": 1}],
                }
            ).encode(),
        )
        for i in range(4)
    ]
    assert outcomes == [Outcome.stored, Outcome.stored, Outcome.rejected, Outcome.rejected]


def test_a_session_can_be_deleted_by_its_owner_only(client):
    a, b = sign_up(client), sign_up(client)
    hub = pair(client, a)
    sid = send_session(client, hub)["id"]
    assert client.delete(f"/api/v1/sessions/{sid}", headers=b.headers).status_code == 404
    assert client.get(f"/api/v1/sessions/{sid}", headers=a.headers).status_code == 200
    assert client.delete(f"/api/v1/sessions/{sid}", headers=a.headers).status_code == 204
    assert client.get(f"/api/v1/sessions/{sid}", headers=a.headers).status_code == 404


def test_deleting_a_session_removes_its_note_events(client, database_url):
    a = sign_up(client)
    sid = send_session(client, pair(client, a))["id"]
    client.delete(f"/api/v1/sessions/{sid}", headers=a.headers)
    with psycopg.connect(database_url) as conn:
        assert conn.execute("SELECT count(*) FROM note_events").fetchone()[0] == 0


# deletion and revocation


def test_deleting_an_account_removes_everything_it_owned(client, database_url):
    from . import midi_writer as w
    from .test_songs import MIDI

    a, b = sign_up(client), sign_up(client)
    hub = pair(client, a)
    send_session(client, hub)
    client.post(
        "/api/v1/songs",
        params={"title": "x"},
        content=w.two_unnamed_tracks().data,
        headers={**a.headers, **MIDI},
    )
    pair(client, b)
    wrong = client.request(
        "DELETE", "/api/v1/auth/account", json={"password": "not the password"}, headers=a.headers
    )
    assert wrong.status_code == 401
    assert (
        client.request(
            "DELETE", "/api/v1/auth/account", json={"password": PASSWORD}, headers=a.headers
        ).status_code
        == 204
    )
    assert client.get("/api/v1/auth/me", headers=a.headers).status_code == 401
    assert client.get("/api/v1/device", headers=hub.headers).status_code == 401
    with psycopg.connect(database_url) as conn:
        for table in (
            "practice_sessions",
            "note_events",
            "songs",
            "song_files",
            "song_notes",
            "auth_sessions",
        ):
            owners = conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]  # noqa: S608
            assert owners == (1 if table == "auth_sessions" else 0), table
        assert conn.execute("SELECT count(*) FROM devices").fetchone()[0] == 1  # only B's hub is left
    assert client.get("/api/v1/auth/me", headers=b.headers).status_code == 200


def test_an_account_delete_needs_the_password_and_is_rate_limited(client):
    a = sign_up(client)
    codes = [
        client.request(
            "DELETE", "/api/v1/auth/account", json={"password": f"wrong-guess-{i}"}, headers=a.headers
        ).status_code
        for i in range(7)
    ]
    assert codes == [401] * 5 + [429] * 2


def test_a_stolen_token_cannot_add_a_webhook_without_the_password(private_client):
    a = sign_up(private_client)
    r = private_client.post(
        "/api/v1/webhooks",
        json={"url": "http://127.0.0.1:9/h", "password": "guess guess guess"},
        headers=a.headers,
    )
    assert r.status_code == 401
    assert private_client.get("/api/v1/webhooks", headers=a.headers).json() == []


def test_revoking_sign_ins_switches_webhooks_off_until_confirmed(private_client):
    a = sign_up(private_client)
    ep = private_client.post(
        "/api/v1/webhooks", json={"url": "http://127.0.0.1:9/h", "password": PASSWORD}, headers=a.headers
    ).json()
    # change password ends other sign-ins and the endpoint stops
    other = private_client.post("/api/v1/auth/signin", json={"email": a.email, "password": PASSWORD}).json()
    r = private_client.post(
        "/api/v1/auth/password",
        json={"current_password": PASSWORD, "new_password": "a brand new password"},
        headers=a.headers,
    )
    assert r.status_code == 204
    row = private_client.get(f"/api/v1/webhooks/{ep['id']}", headers=a.headers).json()
    assert row["enabled"] is False and "confirm" in row["disabled_reason"]
    assert (
        private_client.post(
            f"/api/v1/webhooks/{ep['id']}/enable", json={"password": PASSWORD}, headers=a.headers
        ).status_code
        == 401
    )
    ok = private_client.post(
        f"/api/v1/webhooks/{ep['id']}/enable", json={"password": "a brand new password"}, headers=a.headers
    )
    assert ok.status_code == 200 and ok.json()["enabled"] is True
    assert other["token"]


def test_signing_out_everywhere_ends_every_sign_in_and_the_webhooks(private_client):
    a = sign_up(private_client)
    ep = private_client.post(
        "/api/v1/webhooks", json={"url": "http://127.0.0.1:9/h", "password": PASSWORD}, headers=a.headers
    ).json()
    second = private_client.post("/api/v1/auth/signin", json={"email": a.email, "password": PASSWORD}).json()
    assert private_client.post("/api/v1/auth/signout-everywhere", headers=a.headers).status_code == 204
    assert private_client.get("/api/v1/auth/me", headers=a.headers).status_code == 401
    assert (
        private_client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {second['token']}"}
        ).status_code
        == 401
    )
    fresh = private_client.post("/api/v1/auth/signin", json={"email": a.email, "password": PASSWORD}).json()
    row = private_client.get(
        f"/api/v1/webhooks/{ep['id']}", headers={"Authorization": f"Bearer {fresh['token']}"}
    ).json()
    assert row["enabled"] is False


# the hub's side of a claim


def test_the_hub_learns_who_claimed_it_and_can_undo_a_claim_it_did_not_expect(client):
    stranger = sign_up(client, "stranger@example.test")
    hub = new_hub(client)
    client.post("/api/v1/devices/pair", json={"code": hub.code}, headers=stranger.headers)
    status = client.get("/api/v1/device", headers=hub.headers).json()
    assert status["paired"] is True and status["claimed_by"] == "s***@example.test" and status["undo_until"]
    assert client.delete("/api/v1/device/claim", headers=hub.headers).status_code == 204
    assert client.get("/api/v1/device", headers=hub.headers).status_code == 401  # the identity is gone
    assert client.get("/api/v1/devices", headers=stranger.headers).json() == []


def test_a_claim_cannot_be_undone_after_the_window(client, database_url):
    owner = sign_up(client)
    hub = pair(client, owner)
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute("UPDATE devices SET paired_at = now() - interval '16 minutes'")
    assert client.delete("/api/v1/device/claim", headers=hub.headers).status_code == 403
    assert client.get("/api/v1/device", headers=hub.headers).status_code == 200


def test_an_unpaired_hub_cannot_use_the_undo(client):
    assert client.delete("/api/v1/device/claim", headers=new_hub(client).headers).status_code == 403


# replay state


def test_a_stolen_secret_cannot_push_boot_to_its_ceiling(client):
    from app.ingest import IngestHandler, Outcome

    hub = pair(client, sign_up(client))
    handler = IngestHandler(client.app.state.pool, client.app.state.store)

    def status(boot, seq=1):
        return handler.handle(
            f"melophos/{hub.device_id}/status",
            json.dumps({"boot": boot, "seq": seq, "firmware": "1"}).encode(),
        )

    assert status(5) is Outcome.stored
    assert status(2**53 - 1) is Outcome.replayed  # a jump this large is refused and the counter stays at 5
    assert status(6) is Outcome.stored
    assert status(10_000_000) is Outcome.replayed


def test_rotating_the_secret_clears_the_replay_state(client):
    from app.ingest import IngestHandler, Outcome

    owner = sign_up(client)
    hub = pair(client, owner)
    handler = IngestHandler(client.app.state.pool, client.app.state.store)

    def send(boot):
        return handler.handle(
            f"melophos/{hub.device_id}/status", json.dumps({"boot": boot, "seq": 1, "firmware": "1"}).encode()
        )

    assert send(900) is Outcome.stored
    assert send(3) is Outcome.replayed
    client.post(f"/api/v1/devices/{hub.device_id}/credential", headers=owner.headers)
    assert send(3) is Outcome.stored  # the hub starts again with its new secret


# smaller things


def test_cors_allows_the_put_the_studio_uses_to_correct_a_split(client):
    r = client.options(
        "/api/v1/songs/00000000-0000-0000-0000-000000000000/hands",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert r.status_code == 200 and "PUT" in r.headers["access-control-allow-methods"]


@pytest.mark.parametrize(
    "host",
    [
        "[::127.0.0.1]",
        "[::ffff:0:7f00:1]",
        "[::ffff:7f00:1]",
        "[::1]",
        "[::]",
        "[::10.0.0.1]",
        "[::ffff:0:a00:1]",
        "[64:ff9b::a00:1]",
        "[2002:a00:1::]",
        "[fec0::1]",
        "[100::1]",
        "[2001:db8::1]",
        "[fd12:3456::1]",
        "[fe80::1%25eth0]",
    ],
)
def test_every_ipv6_form_of_an_internal_address_is_refused(host):
    with pytest.raises(UnsafeDestination):
        check_url(f"https://{host}/hook")


def test_a_public_ipv6_address_is_still_allowed():
    check_url("https://[2001:4860:4860::8888]/hook")


def test_the_worker_loops_are_separate_and_one_failing_does_not_stop_the_others():
    from worker.main import loop

    stop = threading.Event()
    calls = {"bad": 0, "good": 0}

    def bad():
        calls["bad"] += 1
        raise RuntimeError("boom")

    def good():
        calls["good"] += 1
        time.sleep(0.03)
        if calls["good"] >= 8:
            stop.set()
        return True

    threads = [
        threading.Thread(target=loop, args=("bad", bad, stop, False, 0.01)),
        threading.Thread(target=loop, args=("good", good, stop, False, 0.01)),
    ]
    [t.start() for t in threads]
    [t.join(5) for t in threads]
    assert calls["good"] >= 8 and calls["bad"] >= 2
