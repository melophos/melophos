"""Scoring runs in the worker, under a time limit, with no database transaction held open."""

import threading
import time

import psycopg
import pytest

from app.config import Settings
from app.main import create_app
from app.scoring import (
    MAX_ATTEMPTS,
    STAND_IN,
    Score,
    ScoreRunner,
    StandInScorer,
    choose_scorer,
    scorer_name,
)

from . import midi_writer as w
from .helpers import SESSION, pair, send_session, sign_up
from .test_songs import MIDI, run_worker

SCALE = w.smf([w.notes_track([(i * 480, 400, 60 + i) for i in range(4)])], fmt=0)


def test_the_stand_in_scorer_counts_hits_misses_and_wrong_notes():
    result = StandInScorer(window_ms=100).score(
        [(0, 60), (500, 62), (1000, 64)], [(30, 60), (520, 63), (1090, 64)]
    )
    assert (result.hits, result.misses, result.wrong, result.accuracy) == (2, 1, 1, 0.667)
    assert result.mean_timing_error_ms is None


def test_a_press_cannot_match_two_expected_notes():
    result = StandInScorer().score([(0, 60), (50, 60)], [(25, 60)])
    assert (result.hits, result.misses, result.wrong) == (1, 1, 0)


def test_empty_inputs_are_fine():
    assert StandInScorer().score([], []).accuracy == 0.0
    assert StandInScorer().score([(0, 60)], []).misses == 1
    assert StandInScorer().score([], [(0, 60)]).wrong == 1


@pytest.fixture()
def song_and_hub(client):
    person = sign_up(client)
    song = client.post(
        "/api/v1/songs", params={"title": "Scale"}, content=SCALE, headers={**person.headers, **MIDI}
    ).json()
    run_worker(client)
    return person, song, pair(client, person)


def played(n=3):
    return [
        {"t_ms": i * 500 + 20, "note": 60 + i, "velocity": 80} for i in range(n)
    ]  # the 4th note is missed


def state(client, person, session_id):
    return client.get(f"/api/v1/sessions/{session_id}", headers=person.headers).json()


def test_finishing_a_session_only_queues_the_score(client, song_and_hub):
    person, song, hub = song_and_hub
    stored = send_session(client, hub, song_id=song["id"], events=played())
    body = state(client, person, stored["id"])
    assert body["score_state"] == "pending"
    assert (body["accuracy"], body["mean_timing_error_ms"], body["final_speed_ppm"]) == (None, None, None)


def test_the_worker_scores_and_stores_every_figure_the_engine_returns(client, song_and_hub):
    person, song, hub = song_and_hub
    stored = send_session(client, hub, song_id=song["id"], events=played())

    class Fixed:
        def score(self, expected, played, hands=None, hints=None):
            return Score(3, 1, 0, 0.75, 12.5, 987_000)

    assert ScoreRunner(client.app.state.pool, Fixed()).run_once().scored == 1
    body = state(client, person, stored["id"])
    assert (body["score_state"], body["accuracy"], body["mean_timing_error_ms"], body["final_speed_ppm"]) == (
        "scored",
        0.75,
        12.5,
        987_000,
    )


def test_the_stand_in_gives_an_accuracy_and_no_timing_figures(client, song_and_hub):
    person, song, hub = song_and_hub
    stored = send_session(client, hub, song_id=song["id"], events=played())
    ScoreRunner(client.app.state.pool, StandInScorer()).run_once()
    body = state(client, person, stored["id"])
    assert body["accuracy"] == 0.75 and body["mean_timing_error_ms"] is None


def test_a_session_without_a_song_is_never_scored(client):
    person = sign_up(client)
    stored = send_session(client, pair(client, person))
    assert state(client, person, stored["id"])["score_state"] == "none"
    assert ScoreRunner(client.app.state.pool, StandInScorer()).run_once().scored == 0


def test_a_slow_engine_cannot_slow_the_request_or_hold_a_transaction(client, song_and_hub, database_url):
    person, song, hub = song_and_hub
    release = threading.Event()
    seen = {}

    class Slow:
        def score(self, expected, played, hands=None, hints=None):
            # while the engine is busy, no connection may be sitting in a transaction on the scoring session's behalf
            with psycopg.connect(database_url) as conn:
                seen["open"] = conn.execute(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"
                    " AND state IN ('idle in transaction', 'active') AND pid <> pg_backend_pid()"
                ).fetchone()[0]
            release.wait(5)
            return Score(1, 0, 0, 1.0)

    started = time.monotonic()
    stored = send_session(client, hub, song_id=song["id"], events=played())
    assert time.monotonic() - started < 2.0  # the request did not wait for any scoring
    runner = ScoreRunner(client.app.state.pool, Slow(), timeout=0.5)
    began = time.monotonic()
    report = runner.run_once()
    release.set()
    assert time.monotonic() - began < 3.0
    assert (report.scored, report.retrying) == (0, 1)
    assert seen["open"] == 0
    body = state(client, person, stored["id"])
    assert body["score_state"] == "pending" and body["accuracy"] is None


def test_a_failing_engine_retries_then_fails_and_never_invents_a_score(client, song_and_hub, database_url):
    person, song, hub = song_and_hub
    stored = send_session(client, hub, song_id=song["id"], events=played())

    class Broken:
        calls = 0

        def score(self, expected, played, hands=None, hints=None):
            Broken.calls += 1
            raise RuntimeError("engine fell over")

    runner = ScoreRunner(client.app.state.pool, Broken())
    for attempt in range(1, MAX_ATTEMPTS + 1):
        with psycopg.connect(database_url, autocommit=True) as conn:
            conn.execute("UPDATE practice_sessions SET score_after = now() - interval '1 second'")
        report = runner.run_once()
        assert (report.retrying, report.failed) == ((1, 0) if attempt < MAX_ATTEMPTS else (0, 1))
        assert state(client, person, stored["id"])["score_state"] == (
            "pending" if attempt < MAX_ATTEMPTS else "failed"
        )
    body = state(client, person, stored["id"])
    assert body["accuracy"] is None and body["final_speed_ppm"] is None
    assert Broken.calls == MAX_ATTEMPTS
    with psycopg.connect(database_url) as conn:
        error = conn.execute("SELECT score_error FROM practice_sessions").fetchone()[0]
    assert error == "scoring failed: RuntimeError"
    assert runner.run_once().failed == 0  # a failed one is not tried again


def test_a_retry_is_not_due_until_its_delay_passes(client, song_and_hub):
    person, song, hub = song_and_hub
    send_session(client, hub, song_id=song["id"], events=played())

    class Broken:
        def score(self, expected, played, hands=None, hints=None):
            raise RuntimeError("no")

    runner = ScoreRunner(client.app.state.pool, Broken())
    assert runner.run_once().retrying == 1
    assert runner.run_once() == type(runner.run_once())()  # nothing due for the next 60 seconds


def test_input_the_engine_refuses_fails_at_once_with_its_words(client, song_and_hub):
    person, song, hub = song_and_hub
    stored = send_session(client, hub, song_id=song["id"], events=played())

    class Refuses:
        def score(self, expected, played, hands=None, hints=None):
            raise ValueError("played[3] note must be a whole number from 0 to 127")

    report = ScoreRunner(client.app.state.pool, Refuses()).run_once()
    assert report.failed == 1
    assert state(client, person, stored["id"])["score_state"] == "failed"


def test_two_workers_never_score_the_same_session_at_once(client, song_and_hub):
    person, song, hub = song_and_hub
    send_session(client, hub, song_id=song["id"], events=played())
    a, b = (
        ScoreRunner(client.app.state.pool, StandInScorer()),
        ScoreRunner(client.app.state.pool, StandInScorer()),
    )
    assert a.run_once().scored + b.run_once().scored == 1


def test_a_session_cannot_name_another_accounts_song(client):
    owner, other = sign_up(client), sign_up(client)
    song = client.post(
        "/api/v1/songs",
        params={"title": "Mine"},
        content=w.two_unnamed_tracks().data,
        headers={**owner.headers, **MIDI},
    ).json()
    hub = pair(client, other)
    assert (
        client.post(
            "/api/v1/sessions", json={**SESSION, "song_id": song["id"]}, headers=hub.headers
        ).status_code
        == 422
    )


def test_the_engine_module_agrees_with_the_stand_in_on_a_simple_case():
    pytest.importorskip("melophos_core", reason="the engine's wheel is built from core/python")
    from app.scoring import CoreScorer

    expected, played_notes = [(0, 60), (500, 62), (1000, 64)], [(30, 60), (520, 63), (1090, 64)]
    engine = CoreScorer().score(expected, played_notes)
    assert (engine.hits, engine.misses) == (2, 1)
    assert engine.final_speed_ppm is not None


def test_the_real_engine_fills_every_stored_figure(client, song_and_hub):
    pytest.importorskip("melophos_core")
    from app.scoring import CoreScorer

    person, song, hub = song_and_hub
    stored = send_session(client, hub, song_id=song["id"], events=played())
    assert ScoreRunner(client.app.state.pool, CoreScorer()).run_once().scored == 1
    body = state(client, person, stored["id"])
    assert (
        body["score_state"] == "scored"
        and body["accuracy"] is not None
        and body["final_speed_ppm"] is not None
    )


# production start-up


def test_the_server_refuses_to_start_with_the_stand_in_unless_allowed(settings, monkeypatch):
    import app.scoring as scoring

    monkeypatch.setattr(scoring, "default_scorer", lambda: StandInScorer())
    strict = Settings(**{**settings.__dict__, "allow_stand_in_scorer": False})
    with pytest.raises(RuntimeError, match="ALLOW_STAND_IN_SCORER"):
        create_app(strict)
    create_app(Settings(**{**settings.__dict__, "allow_stand_in_scorer": True}))


def test_health_says_which_scorer_is_in_use(client, settings, monkeypatch):
    from fastapi.testclient import TestClient

    import app.scoring as scoring

    assert client.get("/health").json()["scorer"] == scorer_name(client.app.state.scorer)
    monkeypatch.setattr(scoring, "default_scorer", lambda: StandInScorer())
    with TestClient(create_app(settings)) as c:
        assert c.get("/health").json()["scorer"] == STAND_IN


def test_choose_scorer_prefers_the_engine_when_it_is_installed():
    pytest.importorskip("melophos_core")
    assert scorer_name(choose_scorer(False)) == "engine"


# the engine's hands and late figures


def test_the_runner_gives_the_engine_each_notes_hand_and_stores_the_new_figures(client, song_and_hub):
    person, song, hub = song_and_hub
    stored = send_session(client, hub, song_id=song["id"], events=played())
    seen = {}

    class Spy:
        def score(self, expected, played, hands=None, hints=None):
            seen["hands"] = hands
            seen["n"] = len(expected)
            return Score(
                3, 1, 0, 0.75, 12.5, 987_000, late=1, hands="right", played_expected=4, played_accuracy=0.75
            )

    ScoreRunner(client.app.state.pool, Spy()).run_once()
    assert len(seen["hands"]) == seen["n"] and set(seen["hands"]) <= {"left", "right"}
    body = state(client, person, stored["id"])
    assert (body["late"], body["hands"], body["played_expected"], body["played_accuracy"]) == (
        1,
        "right",
        4,
        0.75,
    )


def test_played_accuracy_is_shown_only_for_a_one_hand_session(client, song_and_hub):
    person, song, hub = song_and_hub
    stored = send_session(client, hub, song_id=song["id"], events=played())

    class Both:
        def score(self, expected, played, hands=None, hints=None):
            return Score(
                3, 1, 0, 0.75, None, 1_000_000, late=0, hands="both", played_expected=4, played_accuracy=0.75
            )

    ScoreRunner(client.app.state.pool, Both()).run_once()
    body = state(client, person, stored["id"])
    assert body["hands"] == "both" and body["played_accuracy"] is None and body["accuracy"] == 0.75


def test_a_session_with_too_many_presses_is_refused_before_the_engine(client, song_and_hub, monkeypatch):
    import app.scoring as scoring

    person, song, hub = song_and_hub
    stored = send_session(client, hub, song_id=song["id"], events=played())
    monkeypatch.setattr(scoring, "MAX_PLAYED", 2)
    report = ScoreRunner(client.app.state.pool, StandInScorer()).run_once()
    assert report.failed == 1 and state(client, person, stored["id"])["score_state"] == "failed"


def test_the_real_engine_reports_late_and_a_one_hand_session(client):
    pytest.importorskip("melophos_core")
    from app.scoring import CoreScorer

    expected = [(0, 60), (500, 62), (1000, 64), (1500, 65)]
    hands = ["right", "right", "left", "left"]
    result = CoreScorer().score(expected, [(10, 60), (520, 62), (1900, 99 - 35)], hands)
    assert (
        result.hands in {"right", "both", "left"}
        and result.late is not None
        and result.played_expected is not None
    )
    right_only = CoreScorer().score(expected, [(5, 60), (505, 62)], hands)
    assert (
        right_only.hands == "right" and right_only.played_accuracy == 1.0 and right_only.played_expected == 2
    )


# the third verdict, unsure


def test_unsure_is_stored_and_returned_and_the_accuracy_is_exactly_the_engines(client, song_and_hub):
    person, song, hub = song_and_hub
    stored = send_session(client, hub, song_id=song["id"], events=played())

    class Engine:
        def score(self, expected, played, hands=None, hints=None):
            # 3 unsure presses and an accuracy that only the engine could have worked out
            return Score(
                2,
                2,
                1,
                0.4,
                20.0,
                1_000_000,
                late=0,
                hands="both",
                played_expected=4,
                played_accuracy=0.4,
                unsure=3,
            )

    ScoreRunner(client.app.state.pool, Engine()).run_once()
    body = state(client, person, stored["id"])
    assert body["unsure"] == 3 and body["accuracy"] == 0.4 and body["late"] == 0
    listed = client.get("/api/v1/sessions", headers=person.headers).json()["items"]
    assert next(s for s in listed if s["id"] == stored["id"])["unsure"] == 3


def test_the_server_never_works_accuracy_out_again(client, song_and_hub):
    """Whatever the counts say, the stored accuracy is the engine's figure to the last bit."""
    person, song, hub = song_and_hub
    stored = send_session(client, hub, song_id=song["id"], events=played())

    class Odd:
        def score(self, expected, played, hands=None, hints=None):
            return Score(
                1,
                3,
                0,
                0.123456,
                None,
                None,
                late=0,
                hands="both",
                played_expected=4,
                played_accuracy=0.654321,
                unsure=9,
            )

    ScoreRunner(client.app.state.pool, Odd()).run_once()
    body = state(client, person, stored["id"])
    assert body["accuracy"] == pytest.approx(0.123456, abs=1e-6) and body["unsure"] == 9


def test_the_stand_in_reports_no_unsure_figure_at_all(client, song_and_hub):
    person, song, hub = song_and_hub
    stored = send_session(client, hub, song_id=song["id"], events=played())
    ScoreRunner(client.app.state.pool, StandInScorer()).run_once()
    assert state(client, person, stored["id"])["unsure"] is None


def test_the_real_engine_counts_unsure_and_a_clean_performance_has_none():
    pytest.importorskip("melophos_core")
    from app.scoring import CoreScorer

    expected = [(0, 60), (500, 62), (1000, 64), (1500, 65)]
    perfect = CoreScorer().score(expected, [(10, 60), (510, 62), (1010, 64), (1510, 65)])
    assert perfect.unsure == 0 and perfect.accuracy == 1.0
    # the learner starts in the middle: until the engine has found the place a press is unsure, not wrong
    lost = CoreScorer().score(expected, [(0, 64), (500, 65)])
    assert lost.unsure is not None and lost.wrong == 0


def test_the_hints_reach_the_engine_through_the_one_call():
    pytest.importorskip("melophos_core")
    from app.scoring import CoreScorer, ScoreHints

    expected = [(0, 60), (500, 62), (1000, 64), (1500, 65)]
    hands = ["right", "right", "left", "left"]
    named = CoreScorer().score(expected, [(0, 60), (500, 62)], hands, ScoreHints(practise="right"))
    assert named.hands == "right" and named.played_expected == 2
    started = CoreScorer().score(expected, [(1000, 64), (1500, 65)], hands, ScoreHints(start_ms=1000))
    assert started.hits == 2 and started.unsure == 0
    with pytest.raises(ValueError):
        CoreScorer().score(
            expected, [(0, 60)], None, ScoreHints(practise="right")
        )  # naming a hand needs hand labels


def test_the_worker_passes_empty_hints_because_nothing_records_them(client, song_and_hub):
    person, song, hub = song_and_hub
    send_session(client, hub, song_id=song["id"], events=played())
    seen = {}

    class Spy:
        def score(self, expected, played, hands=None, hints=None):
            seen["hints"] = hints
            return Score(
                4,
                0,
                0,
                1.0,
                0.0,
                1_000_000,
                late=0,
                hands="both",
                played_expected=4,
                played_accuracy=1.0,
                unsure=0,
            )

    ScoreRunner(client.app.state.pool, Spy()).run_once()
    from app.scoring import ScoreHints

    assert seen["hints"] == ScoreHints(practise=None, start_ms=None, jumps=None)


def test_migration_013_adds_the_column_and_puts_scored_sessions_back_in_the_queue(settings):
    import psycopg

    from app.db import migrations_dir

    text = (migrations_dir() / "013_unsure.sql").read_text()
    assert (
        "ADD COLUMN unsure" in text
        and "score_state = 'pending'" in text
        and "WHERE score_state = 'scored'" in text
    )
    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        columns = {
            r[0]
            for r in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'practice_sessions'"
            )
        }
    assert "unsure" in columns
