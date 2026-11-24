"""Written from the attacker's side: account B asks for each of account A's things by id."""

import pytest

from .helpers import SESSION, pair, send_session, sign_up


@pytest.fixture()
def world(client):
    a, b = sign_up(client, "alice@example.test"), sign_up(client, "bob@example.test")
    hub_a = pair(client, a, "Alice's hub")
    hub_b = pair(client, b, "Bob's hub")
    session_a = send_session(client, hub_a)
    send_session(client, hub_b)
    return {"a": a, "b": b, "hub_a": hub_a, "hub_b": hub_b, "session_a": session_a}


def test_b_cannot_read_a_session_by_id(client, world):
    sid = world["session_a"]["id"]
    assert client.get(f"/api/v1/sessions/{sid}", headers=world["b"].headers).status_code == 404
    assert client.get(f"/api/v1/sessions/{sid}/events", headers=world["b"].headers).status_code == 404


def test_the_answer_for_a_stranger_session_matches_one_that_does_not_exist(client, world):
    real = client.get(f"/api/v1/sessions/{world['session_a']['id']}", headers=world["b"].headers)
    absent = client.get("/api/v1/sessions/00000000-0000-0000-0000-000000000000", headers=world["b"].headers)
    assert (real.status_code, real.json()) == (absent.status_code, absent.json())


def test_b_listing_never_contains_a_sessions(client, world):
    ids_a = {world["session_a"]["id"]}
    listed = client.get("/api/v1/sessions", headers=world["b"].headers).json()["items"]
    assert listed
    assert ids_a.isdisjoint({s["id"] for s in listed})
    by_device = client.get(
        "/api/v1/sessions", params={"device_id": world["hub_a"].device_id}, headers=world["b"].headers
    )
    assert by_device.json()["items"] == []


def test_b_cannot_see_or_change_a_device(client, world):
    device_id = world["hub_a"].device_id
    headers = world["b"].headers
    assert client.get(f"/api/v1/devices/{device_id}", headers=headers).status_code == 404
    assert client.post(f"/api/v1/devices/{device_id}/credential", headers=headers).status_code == 404
    assert client.delete(f"/api/v1/devices/{device_id}", headers=headers).status_code == 404
    assert [d["id"] for d in client.get("/api/v1/devices", headers=headers).json()] == [
        world["hub_b"].device_id
    ]
    # and A's hub is untouched: same credential, same session
    assert client.get("/api/v1/device", headers=world["hub_a"].headers).status_code == 200
    assert (
        client.get(f"/api/v1/sessions/{world['session_a']['id']}", headers=world["a"].headers).status_code
        == 200
    )


def test_b_cannot_end_a_sign_in(client, world):
    a_sign_ins = client.get("/api/v1/auth/sessions", headers=world["a"].headers).json()
    for item in a_sign_ins:
        assert (
            client.delete(f"/api/v1/auth/sessions/{item['id']}", headers=world["b"].headers).status_code
            == 404
        )
    assert client.get("/api/v1/auth/me", headers=world["a"].headers).status_code == 200


def test_b_cannot_take_a_hub_by_pairing_code_after_a_did(client, world):
    # the code from A's pairing was consumed, so it names nothing now
    assert pair  # fixture already paired; try a fresh code claimed twice
    from .helpers import new_hub

    hub = new_hub(client)
    assert (
        client.post("/api/v1/devices/pair", json={"code": hub.code}, headers=world["a"].headers).status_code
        == 200
    )
    assert (
        client.post("/api/v1/devices/pair", json={"code": hub.code}, headers=world["b"].headers).status_code
        == 404
    )
    mine = [d["id"] for d in client.get("/api/v1/devices", headers=world["b"].headers).json()]
    assert hub.device_id not in mine


def test_a_hub_cannot_write_into_another_account_by_naming_its_device(client, world):
    response = client.post(
        "/api/v1/sessions",
        json={**SESSION, "device_id": world["hub_b"].device_id},
        headers=world["hub_a"].headers,
    )
    assert response.status_code == 403
    listed = client.get("/api/v1/sessions", headers=world["b"].headers).json()["items"]
    assert len(listed) == 1


def test_a_hub_credential_cannot_read_anything(client, world):
    sid = world["session_a"]["id"]
    assert client.get(f"/api/v1/sessions/{sid}", headers=world["hub_a"].headers).status_code == 401
    assert client.get("/api/v1/sessions", headers=world["hub_a"].headers).status_code == 401


def test_a_revoked_token_reads_nothing(client, world):
    client.post("/api/v1/auth/signout", headers=world["a"].headers)
    assert (
        client.get(f"/api/v1/sessions/{world['session_a']['id']}", headers=world["a"].headers).status_code
        == 401
    )
