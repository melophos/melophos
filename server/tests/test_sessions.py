SESSION = {
    "device_id": "hub-test",
    "profile_id": "piano-88",
    "started_at": "2026-09-30T18:00:00Z",
    "mode": "free",
    "events": [
        {"t_ms": 0, "note": 60, "velocity": 90},
        {"t_ms": 400, "note": 60, "velocity": 0},
        {"t_ms": 500, "note": 64, "velocity": 70},
        {"t_ms": 900, "note": 64, "velocity": 0},
        {"t_ms": 1000, "note": 60, "velocity": 80},
        {"t_ms": 60000, "note": 60, "velocity": 0},
    ],
}


def test_create_then_fetch_session(client):
    created = client.post("/api/v1/sessions", json=SESSION)
    assert created.status_code == 201
    body = created.json()
    assert body["summary"]["notes_played"] == 3
    assert body["summary"]["most_played_note"] == 60

    fetched = client.get(f"/api/v1/sessions/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == body["id"]


def test_list_filters_by_device(client):
    client.post("/api/v1/sessions", json=SESSION)
    client.post("/api/v1/sessions", json={**SESSION, "device_id": "hub-other"})
    listed = client.get("/api/v1/sessions", params={"device_id": "hub-test"}).json()
    assert [s["device_id"] for s in listed] == ["hub-test"]


def test_invalid_note_is_rejected(client):
    bad = {**SESSION, "events": [{"t_ms": 0, "note": 128, "velocity": 90}]}
    assert client.post("/api/v1/sessions", json=bad).status_code == 422


def test_unknown_session_is_404(client):
    missing = client.get("/api/v1/sessions/00000000-0000-0000-0000-000000000000")
    assert missing.status_code == 404
