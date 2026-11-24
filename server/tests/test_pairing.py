import hashlib
from unittest.mock import patch

import psycopg
import pytest

from app import accounts as accounts_module

from .helpers import SESSION, new_hub, pair, send_session, sign_up


@pytest.fixture()
def proxied(settings):
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app

    with TestClient(create_app(Settings(**{**settings.__dict__, "trusted_proxy_hops": 1}))) as c:
        yield c


def claim(client, person, code, name=None):
    return client.post("/api/v1/devices/pair", json={"code": code, "name": name}, headers=person.headers)


def test_a_hub_shows_a_code_and_its_owner_types_it(client):
    owner = sign_up(client)
    hub = new_hub(client)
    assert len(hub.code.replace("-", "")) == 8
    before = client.get("/api/v1/device", headers=hub.headers).json()
    assert isinstance(before.pop("server_time"), int)  # its own test is in test_clock.py
    assert before.pop("server_time_synced") in (True, False, None)
    assert before == {
        "device_id": hub.device_id,
        "paired": False,
        "claimed_by": None,
        "undo_until": None,
        "last_boot": None,
    }

    response = claim(client, owner, hub.code.lower().replace("-", " "), name="Living room")
    assert response.status_code == 200
    assert response.json()["id"] == hub.device_id
    assert response.json()["name"] == "Living room"
    assert client.get("/api/v1/device", headers=hub.headers).json()["paired"] is True
    assert [d["id"] for d in client.get("/api/v1/devices", headers=owner.headers).json()] == [hub.device_id]


def test_a_code_works_once(client):
    first, second = sign_up(client), sign_up(client)
    hub = new_hub(client)
    assert claim(client, first, hub.code).status_code == 200
    assert claim(client, second, hub.code).status_code == 404
    assert client.get("/api/v1/devices", headers=second.headers).json() == []


def test_an_expired_code_is_refused(client, database_url):
    owner = sign_up(client)
    hub = new_hub(client)
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute("UPDATE pairing_codes SET expires_at = now() - interval '1 second'")
    assert claim(client, owner, hub.code).status_code == 404


def test_the_code_lives_ten_minutes(client):
    body = client.post("/api/v1/pairing").json()
    assert body["expires_in"] == 600


def test_codes_are_stored_keyed_and_not_readable(client, database_url):
    hub = new_hub(client)
    with psycopg.connect(database_url) as conn:
        digest = bytes(conn.execute("SELECT code_hash FROM pairing_codes").fetchone()[0])
    assert digest != hashlib.sha256(hub.code.replace("-", "").encode()).digest()
    assert len(digest) == 32


def test_the_device_credential_is_stored_hashed_and_shown_once(client, database_url):
    owner = sign_up(client)
    hub = pair(client, owner)
    with psycopg.connect(database_url) as conn:
        stored = bytes(
            conn.execute("SELECT credential_hash FROM devices WHERE id = %s", (hub.device_id,)).fetchone()[0]
        )
    assert stored == hashlib.sha256(hub.secret.encode()).digest()
    # no route hands the secret out again
    for response in (
        client.get(f"/api/v1/devices/{hub.device_id}", headers=owner.headers),
        client.get("/api/v1/devices", headers=owner.headers),
        client.get("/api/v1/device", headers=hub.headers),
    ):
        assert hub.secret not in response.text


def test_an_unpaired_hub_cannot_store_sessions(client):
    hub = new_hub(client)
    response = client.post("/api/v1/sessions", json=SESSION, headers=hub.headers)
    assert response.status_code == 403


def test_a_wrong_secret_is_401(client):
    hub = new_hub(client)
    bad = {"Authorization": f"Device {hub.device_id}:mph_{'a' * 43}"}
    assert client.get("/api/v1/device", headers=bad).status_code == 401
    unknown = {"Authorization": f"Device hub-ffffffffff:{hub.secret}"}
    assert client.get("/api/v1/device", headers=unknown).status_code == 401


def test_a_hub_can_only_store_sessions_for_itself(client):
    mine, other = pair(client, sign_up(client)), pair(client, sign_up(client))
    response = client.post(
        "/api/v1/sessions", json={**SESSION, "device_id": other.device_id}, headers=mine.headers
    )
    assert response.status_code == 403
    ok = client.post("/api/v1/sessions", json={**SESSION, "device_id": mine.device_id}, headers=mine.headers)
    assert ok.status_code == 201


def test_rotating_the_credential_ends_the_old_one(client):
    owner = sign_up(client)
    hub = pair(client, owner)
    rotated = client.post(f"/api/v1/devices/{hub.device_id}/credential", headers=owner.headers).json()
    assert rotated["device_secret"] != hub.secret
    assert client.get("/api/v1/device", headers=hub.headers).status_code == 401
    fresh = {"Authorization": f"Device {hub.device_id}:{rotated['device_secret']}"}
    assert client.get("/api/v1/device", headers=fresh).status_code == 200


def test_removing_a_device_ends_its_credential_and_data(client):
    owner = sign_up(client)
    hub = pair(client, owner)
    sid = send_session(client, hub)["id"]
    assert client.delete(f"/api/v1/devices/{hub.device_id}", headers=owner.headers).status_code == 204
    assert client.get("/api/v1/device", headers=hub.headers).status_code == 401
    assert client.get(f"/api/v1/sessions/{sid}", headers=owner.headers).status_code == 404


# guesses


def test_one_account_gets_five_wrong_codes_per_ten_minutes(client):
    owner = sign_up(client)
    hub = new_hub(client)
    wrong = ["AAAAAAAA", "BBBBBBBB", "CCCCCCCC", "DDDDDDDD", "EEEEEEEE"]
    assert [claim(client, owner, w).status_code for w in wrong] == [404] * 5
    # the sixth try is refused even though this one is right, so guessing cannot be sped up by retrying
    assert claim(client, owner, hub.code).status_code == 429


def test_malformed_codes_count_as_guesses_too(client):
    owner = sign_up(client)
    codes = ["", "short", "0000-0000", "!!!!!!!!", "ZZZZ-ZZZZ-ZZZZ"]
    assert [claim(client, owner, c).status_code for c in codes] == [404] * 5
    assert claim(client, owner, "AAAAAAAA").status_code == 429


def test_many_accounts_from_one_address_share_twenty_guesses(settings):
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app

    with TestClient(create_app(Settings(**{**settings.__dict__, "trusted_proxy_hops": 1}))) as c:
        people = []
        for i in range(6):
            r = c.post(
                "/api/v1/auth/signup",
                json={
                    "email": f"farm{i}@example.test",
                    "password": "correct horse battery",
                    "display_name": "x",
                },
                headers={"X-Forwarded-For": f"192.0.2.{i}"},
            )
            assert r.status_code == 202
            token = c.post(
                "/api/v1/auth/signin",
                json={"email": f"farm{i}@example.test", "password": "correct horse battery"},
                headers={"X-Forwarded-For": f"192.0.2.{i}"},
            ).json()["token"]
            people.append({"Authorization": f"Bearer {token}"})
        results = []
        for n in range(30):
            who = people[n % 6]
            r = c.post(
                "/api/v1/devices/pair",
                json={"code": "AAAAAAAA"},
                headers={**who, "X-Forwarded-For": "203.0.113.5"},
            )
            results.append(r.status_code)
    assert results[:20] == [404] * 20
    assert set(results[20:]) == {429}


def test_wrong_guesses_by_one_account_do_not_block_another(client):
    attacker, owner = sign_up(client), sign_up(client)
    for _ in range(6):
        claim(client, attacker, "AAAAAAAA")
    hub = new_hub(client)
    assert claim(client, owner, hub.code).status_code == 200


def test_pairing_start_is_rate_limited(client):
    with patch.object(accounts_module, "PER_ADDRESS_PENDING", 1000):  # so the hourly limit is what answers
        codes = [client.post("/api/v1/pairing").status_code for _ in range(22)]
    assert codes[:20] == [201] * 20
    assert codes[20:] == [429, 429]


def waiting(database_url):
    with psycopg.connect(database_url) as conn:
        return conn.execute(
            "SELECT count(*) FROM pairing_codes WHERE claimed_at IS NULL AND expires_at > now()"
        ).fetchone()[0]


def test_an_account_holds_a_bounded_number_of_devices(client):
    owner = sign_up(client)
    with patch.object(accounts_module, "MAX_DEVICES_PER_ACCOUNT", 2):
        assert claim(client, owner, new_hub(client).code).status_code == 200
        assert claim(client, owner, new_hub(client).code).status_code == 200
        assert claim(client, owner, new_hub(client).code).status_code == 409


def test_unclaimed_devices_are_cleaned_up(client, database_url, settings):
    new_hub(client)
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute("UPDATE pairing_codes SET expires_at = now() - interval '1 minute'")
        conn.execute("UPDATE devices SET created_at = now() - interval '2 hours'")
    removed = client.app.state.accounts.purge_unclaimed()
    assert len(removed) == 1


@pytest.mark.parametrize("budget", [(32**8, 20 * 6 * 24)])
def test_the_stated_guess_odds(budget):
    # documents the arithmetic in docs: 20 guesses per address per 10 minutes is 2 880 a day,
    # against 32 ** 8 codes and at most 1 000 live at once
    space, per_day = budget[0], 20 * 6 * 24
    assert per_day == 2880
    assert 1000 * per_day / space < 3e-6
