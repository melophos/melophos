"""Sessions and note events survive a restart: a second app on the same database sees what the first stored."""

from fastapi.testclient import TestClient

from app.main import create_app

from .helpers import SESSION, Person, pair, send_session, sign_up


def test_sessions_and_events_survive_a_restart(settings):
    with TestClient(create_app(settings)) as first:
        person = sign_up(first)
        created = send_session(first, pair(first, person))

    with TestClient(create_app(settings)) as second:
        signed_in = second.post(
            "/api/v1/auth/signin", json={"email": person.email, "password": "correct horse battery"}
        )
        headers = {"Authorization": f"Bearer {signed_in.json()['token']}"}
        fetched = second.get(f"/api/v1/sessions/{created['id']}", headers=headers)
        assert fetched.status_code == 200
        assert fetched.json() == created
        events = second.get(f"/api/v1/sessions/{created['id']}/events", headers=headers).json()["items"]
    assert [(e["t_ms"], e["note"], e["velocity"]) for e in events] == [
        (e["t_ms"], e["note"], e["velocity"]) for e in SESSION["events"]
    ]


def test_a_sign_in_token_still_works_after_a_restart(settings):
    with TestClient(create_app(settings)) as first:
        person = sign_up(first)
    with TestClient(create_app(settings)) as second:
        assert second.get("/api/v1/auth/me", headers=person.headers).status_code == 200


def test_events_come_back_with_every_field(client):
    hub = pair(client, person := sign_up(client))
    event = {"t_ms": 5, "note": 61, "velocity": 33, "channel": 9, "source": "ble_midi"}
    sid = send_session(client, hub, events=[event])["id"]
    assert client.get(f"/api/v1/sessions/{sid}/events", headers=person.headers).json()["items"] == [event]


def test_readiness_follows_the_database(client):
    assert client.get("/ready").json() == {"status": "ready"}


def test_person_type_is_exported():
    assert Person
