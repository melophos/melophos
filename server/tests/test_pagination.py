from datetime import UTC, datetime, timedelta

import pytest

from .helpers import SESSION, pair, sign_up


@pytest.fixture()
def me(client):
    person = sign_up(client)
    return person, pair(client, person)


def make(client, hub, count, start_minute=0):
    ids = []
    for i in range(count):
        started = (datetime.now(UTC) - timedelta(days=2, minutes=-(start_minute + i))).isoformat()
        body = {**SESSION, "started_at": started}
        ids.append(client.post("/api/v1/sessions", json=body, headers=hub.headers).json()["id"])
    return ids


def walk(client, person, url, params):
    seen, cursor = [], None
    for _ in range(100):
        extra = {"cursor": cursor} if cursor else {}
        page = client.get(url, params={**params, **extra}, headers=person.headers).json()
        seen += page["items"]
        cursor = page["next_cursor"]
        if cursor is None:
            return seen
    raise AssertionError("pagination did not end")


def test_walking_pages_returns_every_session_once_newest_first(client, me):
    person, hub = me
    make(client, hub, 7)
    items = walk(client, person, "/api/v1/sessions", {"limit": 3})
    assert len(items) == 7
    assert len({i["id"] for i in items}) == 7
    starts = [i["started_at"] for i in items]
    assert starts == sorted(starts, reverse=True)


def test_identical_start_times_keep_a_stable_order_across_pages(client, me):
    person, hub = me
    for _ in range(5):
        client.post("/api/v1/sessions", json=SESSION, headers=hub.headers)
    first = [s["id"] for s in walk(client, person, "/api/v1/sessions", {"limit": 2})]
    again = [s["id"] for s in walk(client, person, "/api/v1/sessions", {"limit": 2})]
    assert first == again
    assert len(set(first)) == 5


def test_a_new_session_does_not_shift_the_pages_already_read(client, me):
    person, hub = me
    make(client, hub, 4)
    page = client.get("/api/v1/sessions", params={"limit": 2}, headers=person.headers).json()
    make(client, hub, 1, start_minute=30)  # newer than everything read so far
    rest = walk(client, person, "/api/v1/sessions", {"limit": 2, "cursor": page["next_cursor"]})
    assert {s["id"] for s in rest}.isdisjoint({s["id"] for s in page["items"]})
    assert len(rest) == 2


def test_the_page_size_has_a_maximum(client, me):
    person, _ = me
    assert client.get("/api/v1/sessions", params={"limit": 201}, headers=person.headers).status_code == 422
    assert client.get("/api/v1/sessions", params={"limit": 0}, headers=person.headers).status_code == 422
    assert len(client.get("/api/v1/sessions", headers=person.headers).json()["items"]) <= 50


def test_a_forged_cursor_is_a_clear_400(client, me):
    person, _ = me
    for bad in ["not-base64!!", "e30", "WyJhIl0"]:
        response = client.get("/api/v1/sessions", params={"cursor": bad}, headers=person.headers)
        assert response.status_code == 400, bad
        assert "cursor" in response.json()["detail"]


def event_pages(client, person, sid, limit):
    seen, cursor = [], None
    while True:
        extra = {"cursor": cursor} if cursor else {}
        page = client.get(
            f"/api/v1/sessions/{sid}/events", params={"limit": limit, **extra}, headers=person.headers
        ).json()
        seen += page["items"]
        cursor = page["next_cursor"]
        if not cursor:
            return seen


def test_event_pages_cover_every_event_in_order(client, me):
    person, hub = me
    events = [{"t_ms": i * 10, "note": 60 + i % 5, "velocity": 50 + i % 7} for i in range(23)]
    sid = client.post("/api/v1/sessions", json={**SESSION, "events": events}, headers=hub.headers).json()[
        "id"
    ]
    assert [e["t_ms"] for e in event_pages(client, person, sid, 5)] == [e["t_ms"] for e in events]


def test_events_with_the_same_timestamp_are_not_lost_between_pages(client, me):
    person, hub = me
    events = [{"t_ms": 100, "note": 60 + i, "velocity": 70} for i in range(7)]
    sid = client.post("/api/v1/sessions", json={**SESSION, "events": events}, headers=hub.headers).json()[
        "id"
    ]
    assert [e["note"] for e in event_pages(client, person, sid, 3)] == [60 + i for i in range(7)]
