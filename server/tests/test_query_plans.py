"""Query plans on a table of a stated size, proving the list routes use their indexes.

100 000 sessions across 1 000 devices (about 100 each) and 1 000 000 note events are loaded with generate_series, then the exact
statements the store runs are explained. The plan text is printed so `pytest -s` shows it.
"""

import json

import psycopg
import pytest

from app.db import migrate

from .conftest import scratch_database

SESSIONS = 100_000
DEVICES = 1000
EVENTS_PER_BIG_SESSION = 1_000_000
pytestmark = [pytest.mark.slow, pytest.mark.no_clean]


@pytest.fixture(scope="module")
def database_url():
    with scratch_database("melophos_test_plan_") as url:
        migrate(url)
        yield url


@pytest.fixture(scope="module")
def loaded(database_url):
    with psycopg.connect(database_url, autocommit=True) as conn:
        owner = conn.execute(
            "INSERT INTO users (email, display_name, password_hash) VALUES ('plan@example.test','p','x') RETURNING id"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO devices (id, owner_id, name) SELECT 'plan-' || g,"
            " CASE WHEN g <= 3 THEN %s ELSE NULL END, 'd' FROM generate_series(1, %s) g",
            (owner, DEVICES),
        )
        conn.execute(
            "INSERT INTO practice_sessions (device_id, profile_id, started_at, ended_at, notes_played)"
            " SELECT 'plan-' || (1 + g %% %s), 'piano-88', timestamptz '2026-01-01' + g * interval '3 minutes', timestamptz '2026-01-01' + g * interval '3 minutes', 10"
            " FROM generate_series(1, %s) g",
            (DEVICES, SESSIONS),
        )
        big = conn.execute(
            "SELECT id, started_at FROM practice_sessions ORDER BY started_at LIMIT 1"
        ).fetchone()
        conn.execute(
            "INSERT INTO note_events (session_id, at, idx, note, velocity, channel, source)"
            " SELECT s.id, s.started_at + (g %% 100000) * interval '1 millisecond', g, 60, 80, 0, 'usb_midi'"
            " FROM (SELECT id, started_at FROM practice_sessions ORDER BY started_at LIMIT 20) s,"
            " generate_series(1, %s) g",
            (EVENTS_PER_BIG_SESSION // 20,),
        )
        conn.execute("ANALYZE")
        yield owner, big


def plan(conn, sql, args):
    rows = conn.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, args).fetchone()[0]
    text = json.dumps(rows)
    return rows[0], text


def test_list_by_owner_uses_indexes_and_stops_early(database_url, loaded):
    owner, _ = loaded
    sql = (
        "SELECT s.id FROM practice_sessions s JOIN devices d ON d.id = s.device_id"
        " WHERE s.ended_at IS NOT NULL AND d.owner_id = %s ORDER BY s.started_at DESC, s.id DESC LIMIT 51"
    )
    with psycopg.connect(database_url) as conn:
        result, text = plan(conn, sql, (owner,))
        print(
            "\nlist by owner, 100k sessions:\n", conn.execute("EXPLAIN (ANALYZE) " + sql, (owner,)).fetchall()
        )
    # the account owns 3 of the 1 000 devices, so only their rows are read and sorted, never the whole table
    assert "Seq Scan on practice_sessions" not in text
    assert "practice_sessions_device_started" in text
    assert result["Execution Time"] < 50


def test_list_by_device_is_an_index_scan_with_no_sort(database_url, loaded):
    sql = (
        "SELECT s.id FROM practice_sessions s WHERE s.ended_at IS NOT NULL AND s.device_id = 'plan-7'"
        " ORDER BY s.started_at DESC, s.id DESC LIMIT 51"
    )
    with psycopg.connect(database_url) as conn:
        result, text = plan(conn, sql, ())
        print("\nlist by device, 100k sessions:\n", conn.execute("EXPLAIN (ANALYZE) " + sql).fetchall())
    assert "Index" in text and "Seq Scan" not in text and '"Sort"' not in text
    assert result["Execution Time"] < 50


def test_event_read_uses_the_session_time_index(database_url, loaded):
    _, big = loaded
    sid, started = big
    sql = (
        "SELECT at, idx, note FROM note_events WHERE session_id = %s AND at >= %s"
        " AND at <= %s + interval '6 hours' AND (at, idx) > (%s, -1) ORDER BY at, idx LIMIT 501"
    )
    args = (sid, started, started, started)
    with psycopg.connect(database_url) as conn:
        result, text = plan(conn, sql, args)
        print("\nevent page, 1M events:\n", conn.execute("EXPLAIN (ANALYZE) " + sql, args).fetchall())
    assert "note_events_session_at" in text and "Seq Scan" not in text
    assert result["Execution Time"] < 100
