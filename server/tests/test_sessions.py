from .helpers import SESSION, pair, send_session, sign_up


def test_create_then_fetch_session(client):
    person = sign_up(client)
    hub = pair(client, person)
    body = send_session(client, hub)
    assert body["summary"]["notes_played"] == 3
    assert body["summary"]["most_played_note"] == 60
    assert body["device_id"] == hub.device_id

    fetched = client.get(f"/api/v1/sessions/{body['id']}", headers=person.headers)
    assert fetched.status_code == 200
    assert fetched.json()["id"] == body["id"]


def test_list_filters_by_device(client):
    person = sign_up(client)
    one, two = pair(client, person), pair(client, person)
    send_session(client, one)
    send_session(client, two)
    listed = client.get("/api/v1/sessions", params={"device_id": one.device_id}, headers=person.headers)
    assert [s["device_id"] for s in listed.json()["items"]] == [one.device_id]


def test_invalid_note_is_rejected(client):
    hub = pair(client, sign_up(client))
    bad = {**SESSION, "events": [{"t_ms": 0, "note": 128, "velocity": 90}]}
    assert client.post("/api/v1/sessions", json=bad, headers=hub.headers).status_code == 422


def test_unknown_session_is_404(client):
    person = sign_up(client)
    missing = client.get("/api/v1/sessions/00000000-0000-0000-0000-000000000000", headers=person.headers)
    assert missing.status_code == 404


def test_naive_timestamps_are_rejected(client):
    hub = pair(client, sign_up(client))
    body = {**SESSION, "started_at": "2026-09-30T18:00:00"}
    assert client.post("/api/v1/sessions", json=body, headers=hub.headers).status_code == 422


def test_a_session_over_the_event_limit_is_refused(client):
    hub = pair(client, sign_up(client))
    events = [{"t_ms": i, "note": 60, "velocity": 50} for i in range(50_001)]
    assert (
        client.post("/api/v1/sessions", json={**SESSION, "events": events}, headers=hub.headers).status_code
        == 422
    )


def test_an_oversized_body_is_refused_before_it_is_read(client):
    hub = pair(client, sign_up(client))
    response = client.post(
        "/api/v1/sessions",
        content=b"x" * (9 * 1024 * 1024),
        headers={**hub.headers, "content-type": "application/json"},
    )
    assert response.status_code == 413
