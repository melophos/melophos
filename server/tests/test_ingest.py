"""The ingest handler against a real database. No broker is needed: it is the code every message passes through."""

import json
import threading
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from prometheus_client import REGISTRY

from app.ingest import RATE_MESSAGES, IngestHandler, Outcome

from .helpers import new_hub, pair, sign_up

STARTED = (datetime.now(UTC) - timedelta(hours=3)).isoformat()


def counter(outcome: str) -> float:
    return REGISTRY.get_sample_value("melophos_mqtt_messages_total", {"outcome": outcome}) or 0.0


def message(boot=1, seq=1, **fields):
    return {"boot": boot, "seq": seq, **fields}


def notes(boot=1, seq=1, ref="s1", events=None):
    if events is None:
        events = [{"t_ms": 0, "note": 60, "velocity": 90}, {"t_ms": 100, "note": 60, "velocity": 0}]
    return message(boot, seq, session_ref=ref, started_at=STARTED, profile_id="piano-88", events=events)


def finish(boot=1, seq=1, ref="s1", **extra):
    fields = {"session_ref": ref, "started_at": STARTED, "profile_id": "piano-88", "mode": "free", **extra}
    return message(boot, seq, **fields)


@pytest.fixture()
def rig(client):
    person = sign_up(client)
    hub = pair(client, person)
    handler = IngestHandler(client.app.state.pool, client.app.state.store)

    def send(kind, body, device=None):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        return handler.handle(f"melophos/{device or hub.device_id}/{kind}", raw)

    return type(
        "Rig",
        (),
        {"client": client, "person": person, "hub": hub, "handler": handler, "send": staticmethod(send)},
    )


def db_value(database_url, sql, *args):
    with psycopg.connect(database_url) as conn:
        row = conn.execute(sql, args).fetchone()
    return row[0] if row else None


def test_notes_then_session_store_a_finished_session(rig):
    assert rig.send("notes", notes(seq=1)) is Outcome.stored
    assert (
        rig.send(
            "notes",
            notes(
                seq=2,
                events=[{"t_ms": 500, "note": 64, "velocity": 70}, {"t_ms": 900, "note": 64, "velocity": 0}],
            ),
        )
        is Outcome.stored
    )
    assert rig.send("session", finish(seq=1)) is Outcome.stored
    sessions = rig.client.get("/api/v1/sessions", headers=rig.person.headers).json()["items"]
    assert len(sessions) == 1
    assert sessions[0]["summary"]["notes_played"] == 2
    assert sessions[0]["summary"]["duration_ms"] == 900
    events = rig.client.get(
        f"/api/v1/sessions/{sessions[0]['id']}/events", headers=rig.person.headers
    ).json()["items"]
    assert [e["note"] for e in events] == [60, 60, 64, 64]


def test_a_session_message_can_carry_all_the_events(rig):
    body = finish(events=[{"t_ms": 0, "note": 61, "velocity": 80}, {"t_ms": 2000, "note": 61, "velocity": 0}])
    assert rig.send("session", body) is Outcome.stored
    item = rig.client.get("/api/v1/sessions", headers=rig.person.headers).json()["items"][0]
    assert item["summary"]["duration_ms"] == 2000


def test_status_refreshes_last_seen_and_records_the_report(rig, database_url):
    assert db_value(database_url, "SELECT last_seen_at FROM devices WHERE id = %s", rig.hub.device_id) is None
    body = message(firmware="0.4.2", profile_id="piano-88", inputs=["usb_midi", "audio"], dropped_events=3)
    assert rig.send("status", body) is Outcome.stored
    first = db_value(database_url, "SELECT last_seen_at FROM devices WHERE id = %s", rig.hub.device_id)
    assert first is not None
    row = rig.client.get(f"/api/v1/devices/{rig.hub.device_id}", headers=rig.person.headers).json()
    assert row["firmware"] == "0.4.2"
    assert db_value(database_url, "SELECT dropped_events FROM devices WHERE id = %s", rig.hub.device_id) == 3
    assert rig.send("status", message(seq=2, firmware="0.4.3")) is Outcome.stored
    assert db_value(database_url, "SELECT last_seen_at FROM devices WHERE id = %s", rig.hub.device_id) > first


@pytest.mark.parametrize(
    ("kind", "payload"),
    [
        ("notes", b"not json at all"),
        ("notes", b""),
        ("notes", b"[1,2,3]"),
        ("notes", b"null"),
        ("notes", b'{"boot":1,"seq":1}'),
        ("notes", b"\xff\xfe\x00"),
        (
            "notes",
            b'{"boot":"x","seq":1,"session_ref":"s","started_at":"2026-01-01T00:00:00Z","profile_id":"p","events":[]}',
        ),
        ("notes", json.dumps(notes(events=[{"t_ms": 0, "note": 200, "velocity": 1}])).encode()),
        ("notes", json.dumps(notes(events=[{"t_ms": -5, "note": 60, "velocity": 1}])).encode()),
        ("notes", json.dumps(notes(events=[])).encode()),
        ("notes", json.dumps(notes(ref="../../etc/passwd")).encode()),
        ("notes", json.dumps({**notes(), "started_at": "2026-01-01T00:00:00"}).encode()),
        ("notes", b'{"boot":1,"seq":1e400}'),
        ("notes", b"[" * 10000),
        ("status", json.dumps(message(firmware="x" * 100)).encode()),
        ("status", json.dumps(message(firmware="1", inputs=["telepathy"])).encode()),
        ("session", json.dumps(finish(mode="shouting")).encode()),
        ("session", json.dumps(finish(boot=-1)).encode()),
    ],
)
def test_a_bad_payload_is_skipped_counted_and_never_raises(rig, kind, payload):
    before = counter("bad_payload")
    assert rig.send(kind, payload) is Outcome.bad_payload
    assert counter("bad_payload") == before + 1
    # and the next good message is still handled
    assert rig.send("status", message(boot=2, seq=1, firmware="1.0.0")) is Outcome.stored


def test_a_bad_payload_stores_nothing_and_does_not_use_up_a_sequence_number(rig, database_url):
    rig.send("notes", b"garbage")
    assert db_value(database_url, "SELECT count(*) FROM ingest_state") == 0
    assert rig.send("notes", notes(seq=1)) is Outcome.stored


def test_oversized_messages_are_refused_before_parsing(rig):
    big = json.dumps(notes(events=[{"t_ms": i, "note": 60, "velocity": 1} for i in range(1000)])).encode()
    assert len(big) < 64 * 1024  # the maximum batch fits
    assert rig.send("notes", big) is Outcome.stored
    assert rig.send("notes", b" " * (64 * 1024 + 1)) is Outcome.too_large
    assert rig.send("status", b" " * 5000) is Outcome.too_large


def test_a_batch_over_the_event_count_is_refused(rig):
    too_many = notes(events=[{"t_ms": i, "note": 60, "velocity": 1} for i in range(1001)])
    assert rig.send("notes", too_many) is Outcome.bad_payload


def test_a_session_cannot_grow_past_the_event_limit(rig, monkeypatch):
    import app.ingest as ingest_module

    monkeypatch.setattr(ingest_module, "MAX_SESSION_EVENTS", 3)
    assert rig.send("notes", notes(seq=1)) is Outcome.stored
    assert rig.send("notes", notes(seq=2)) is Outcome.rejected


def test_bad_topics_are_counted(rig):
    before = counter("bad_topic")
    for topic in ["melophos/+/notes", "melophos/x/y", "elsewhere/hub-01/notes", "melophos/hub-01/#"]:
        assert rig.handler.handle(topic, b"{}") is Outcome.bad_topic
    assert counter("bad_topic") == before + 4


def test_an_unknown_or_unpaired_device_is_ignored(rig, database_url):
    assert rig.send("status", message(firmware="1"), device="hub-0000000000") is Outcome.unknown_device
    unpaired = new_hub(rig.client)
    assert rig.send("status", message(firmware="1"), device=unpaired.device_id) is Outcome.unknown_device
    assert db_value(database_url, "SELECT count(*) FROM ingest_state") == 0


def test_a_removed_device_is_ignored_from_then_on(rig):
    assert rig.send("status", message(firmware="1")) is Outcome.stored
    rig.client.delete(f"/api/v1/devices/{rig.hub.device_id}", headers=rig.person.headers)
    assert rig.send("status", message(seq=2, firmware="1")) is Outcome.unknown_device


# replays


def test_a_repeated_message_is_stored_once(rig):
    assert rig.send("notes", notes(seq=1)) is Outcome.stored
    assert rig.send("notes", notes(seq=1)) is Outcome.replayed
    assert rig.send("session", finish(seq=1)) is Outcome.stored
    item = rig.client.get("/api/v1/sessions", headers=rig.person.headers).json()["items"][0]
    assert item["summary"]["notes_played"] == 1


def test_an_older_message_is_refused(rig):
    assert rig.send("status", message(seq=5, firmware="1")) is Outcome.stored
    assert rig.send("status", message(seq=4, firmware="old")) is Outcome.replayed
    assert rig.send("status", message(seq=5, firmware="same")) is Outcome.replayed
    assert rig.send("status", message(seq=6, firmware="2")) is Outcome.stored


def test_a_new_boot_starts_again_but_an_old_boot_never_returns(rig):
    assert rig.send("status", message(boot=3, seq=900, firmware="1")) is Outcome.stored
    assert rig.send("status", message(boot=4, seq=1, firmware="1")) is Outcome.stored
    # a captured message from boot 3 cannot come back now, whatever its seq
    assert rig.send("status", message(boot=3, seq=901, firmware="1")) is Outcome.replayed


def test_each_kind_has_its_own_counter(rig):
    assert rig.send("status", message(seq=10, firmware="1")) is Outcome.stored
    assert rig.send("notes", notes(seq=1)) is Outcome.stored


def test_two_copies_arriving_together_store_one(client, rig):
    outcomes = []
    gate = threading.Barrier(6)

    def fire():
        gate.wait()
        outcomes.append(rig.send("notes", notes(seq=1)))

    threads = [threading.Thread(target=fire) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert outcomes.count(Outcome.stored) == 1
    assert outcomes.count(Outcome.replayed) == 5


def test_notes_for_a_finished_session_are_refused(rig):
    assert rig.send("notes", notes(seq=1)) is Outcome.stored
    assert rig.send("session", finish(seq=1)) is Outcome.stored
    assert rig.send("notes", notes(seq=2)) is Outcome.rejected
    assert rig.send("session", finish(seq=2)) is Outcome.rejected


# rate


def test_a_chatty_device_is_limited_and_others_are_not(client):
    person = sign_up(client)
    chatty, quiet = pair(client, person), pair(client, person)
    now = [0.0]
    handler = IngestHandler(client.app.state.pool, client.app.state.store, clock=lambda: now[0])

    def status(hub, seq):
        return handler.handle(
            f"melophos/{hub.device_id}/status", json.dumps(message(seq=seq, firmware="1")).encode()
        )

    results = [status(chatty, i + 1) for i in range(RATE_MESSAGES + 5)]
    assert results[:RATE_MESSAGES].count(Outcome.stored) == RATE_MESSAGES
    assert results[RATE_MESSAGES:] == [Outcome.rate_limited] * 5
    assert status(quiet, 1) is Outcome.stored
    now[0] += 11  # the window passes
    assert status(chatty, RATE_MESSAGES + 6) is Outcome.stored


def test_the_log_never_contains_the_payload(rig, caplog):
    with caplog.at_level("WARNING", logger="melophos.ingest"):
        rig.send("notes", b'{"secret":"do-not-log-me"')
    assert "do-not-log-me" not in caplog.text
    assert "bad_payload" in caplog.text


def test_a_session_still_streaming_is_not_listed_until_it_finishes(rig):
    assert rig.send("notes", notes(seq=1)) is Outcome.stored
    assert rig.client.get("/api/v1/sessions", headers=rig.person.headers).json()["items"] == []
    assert rig.send("session", finish(seq=1)) is Outcome.stored
    assert len(rig.client.get("/api/v1/sessions", headers=rig.person.headers).json()["items"]) == 1


def test_a_session_message_cannot_name_a_song_the_account_does_not_own(rig):
    other = sign_up(rig.client)
    from . import midi_writer as w

    song = rig.client.post(
        "/api/v1/songs",
        params={"title": "Theirs"},
        content=w.two_unnamed_tracks().data,
        headers={**other.headers, "Content-Type": "audio/midi"},
    ).json()
    assert rig.send("session", finish(song_id=song["id"])) is Outcome.rejected


def test_a_repeated_message_is_dropped_quietly_counted_and_never_stored_twice(rig, caplog):
    before = counter("replayed")
    assert (
        rig.send("session", finish(seq=1, events=[{"t_ms": 0, "note": 60, "velocity": 80}])) is Outcome.stored
    )
    with caplog.at_level("INFO", logger="melophos.ingest"):
        again = rig.send("session", finish(seq=1, events=[{"t_ms": 0, "note": 60, "velocity": 80}]))
    assert again is Outcome.replayed
    assert counter("replayed") == before + 1
    assert [r for r in caplog.records if r.levelname == "WARNING"] == []
    assert len(rig.client.get("/api/v1/sessions", headers=rig.person.headers).json()["items"]) == 1
    assert rig.send("status", message(boot=9, seq=1, firmware="1")) is Outcome.stored  # nothing was disturbed


# one message must never stop ingest for anyone


def test_a_far_future_start_with_a_large_offset_is_skipped_not_fatal(rig):
    """A message with started_at in the year 9999 with t_ms at its ceiling raised OverflowError out of handle."""
    body = {
        "boot": 1,
        "seq": 1,
        "session_ref": "x",
        "started_at": "9999-12-31T23:00:00Z",
        "profile_id": "p",
        "events": [{"t_ms": 21_600_000, "note": 60, "velocity": 70}],
    }
    assert rig.send("notes", body) is Outcome.bad_payload
    assert rig.send("status", message(boot=2, seq=1, firmware="1")) is Outcome.stored


@pytest.mark.parametrize(
    "when",
    ["0001-01-01T00:00:00+14:00", "1999-01-01T00:00:00Z", "9999-12-31T23:59:59Z", "2100-01-01T00:00:00Z"],
)
def test_start_times_outside_the_window_are_skipped(rig, when):
    assert rig.send("notes", {**notes(), "started_at": when}) is Outcome.bad_payload


def test_whatever_a_message_does_handle_never_raises(rig, monkeypatch):
    def boom(*args, **kwargs):
        raise OverflowError("date value out of range")

    monkeypatch.setattr(rig.handler, "_notes", boom)
    assert rig.send("notes", notes()) is Outcome.error
    assert rig.send("status", message(boot=3, seq=1, firmware="1")) is Outcome.stored


def test_http_sessions_with_unbounded_times_are_422_not_500(client):
    from .helpers import SESSION

    hub = pair(client, sign_up(client))
    for when in ["9999-12-31T23:00:00Z", "0001-01-01T00:00:00+14:00", "1900-01-01T00:00:00Z"]:
        r = client.post(
            "/api/v1/sessions",
            json={**SESSION, "started_at": when, "events": [{"t_ms": 21_600_000, "note": 60, "velocity": 1}]},
            headers=hub.headers,
        )
        assert r.status_code == 422, when
