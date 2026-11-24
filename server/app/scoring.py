"""Scoring a played session against a song.

The scoring engine is the Rust crate in core/, used through its Python module `melophos_core`. The server needs
only the small interface below, so the engine's module and the stand-in are interchangeable in tests.

Scoring never runs on the request path or inside a database transaction. Finishing a session only marks it
`pending`. The worker then reads the notes, calls the scorer under a time limit with no connection held and writes
the result in a short transaction. If the engine fails or is too slow the session stays saved with empty figures and
the state says what happened (`pending` while retries remain, `failed` after the last). A score is never invented.

What the server needs from the engine's Python module:

    follow(expected, played, *, hands=None, practise=None, start_ms=None, jumps=None) -> result

where each pair is (t_ms, note) in milliseconds from the start and `result.score` has `hits`, `misses`, `wrong`,
`late`, `unsure`, `accuracy`, `mean_timing_error_ms` (or None), `final_speed_ppm`, `hands`, `played_expected` and
`played_accuracy`. The accuracy figures are the engine's and are never worked out again here, so an unsure press can
never be counted for or against a player by this code. A piece over 100 000 notes is refused here before it reaches
the engine.

The one call into the engine is `CoreScorer.score` below. What the caller knows about the session (which hand was
practised, where the learner started, jumps they asked for) goes in as `ScoreHints`. No hub message or session field
carries any of the three today, so the worker passes empty hints: see docs/protocol.md.
"""

from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass
from typing import Any, Literal, Protocol
from uuid import UUID

import psycopg

from .db import Pool, Row
from .schemas import PracticeSessionOut

WINDOW_MS = 150


@dataclass(frozen=True)
class Score:
    hits: int
    misses: int
    wrong: int
    accuracy: float
    mean_timing_error_ms: float | None = None
    final_speed_ppm: int | None = None
    # `late` is a note matched outside the window, early or late. It is not a hit and not a miss or a wrong press
    late: int | None = None
    hands: str | None = None  # unknown, neither, left, right or both
    played_expected: int | None = None
    played_accuracy: float | None = None  # accuracy over the notes of the hand played, for a one-hand session
    # a press the engine cannot place with confidence. It counts neither for nor against the player
    unsure: int | None = None


@dataclass(frozen=True)
class ScoreHints:
    """What the caller knows about the session, so the engine need not guess it. Each is None when not known."""

    practise: Literal["left", "right", "both"] | None = None  # needs the song's hand labels
    start_ms: int | None = None  # the written time the learner started from
    jumps: Sequence[tuple[int, int]] | None = (
        None  # (press index, written time) the learner asked to go on from
    )


class Scorer(Protocol):
    def score(
        self,
        expected: Sequence[tuple[int, int]],
        played: Sequence[tuple[int, int]],
        hands: Sequence[str | None] | None = None,
        hints: ScoreHints | None = None,
    ) -> Score: ...


class StandInScorer:
    """Matches each expected note to the nearest unused press of the same pitch inside a timing window."""

    def __init__(self, window_ms: int = WINDOW_MS) -> None:
        self._window = window_ms

    def score(
        self,
        expected: Sequence[tuple[int, int]],
        played: Sequence[tuple[int, int]],
        hands: Sequence[str | None] | None = None,
        hints: ScoreHints | None = None,
    ) -> Score:
        if not expected:
            return Score(0, 0, len(played), 0.0)
        by_note: dict[int, list[int]] = {}
        for t, note in sorted(played):
            by_note.setdefault(note, []).append(t)
        hits = 0
        used: dict[int, set[int]] = {}
        for t, note in sorted(expected):
            candidates = by_note.get(note, [])
            taken = used.setdefault(note, set())
            best = None
            for i, pressed in enumerate(candidates):
                if i in taken or abs(pressed - t) > self._window:
                    continue
                if best is None or abs(pressed - t) < abs(candidates[best] - t):
                    best = i
            if best is not None:
                taken.add(best)
                hits += 1
        wrong = len(played) - hits
        return Score(hits, len(expected) - hits, wrong, round(hits / len(expected), 3))


class CoreScorer:
    """The Rust engine through its Python module `melophos_core`, which gives the same answer as the Studio."""

    def __init__(self) -> None:
        import melophos_core  # type: ignore[import-not-found,unused-ignore]

        self._core = melophos_core

    def score(
        self,
        expected: Sequence[tuple[int, int]],
        played: Sequence[tuple[int, int]],
        hands: Sequence[str | None] | None = None,
        hints: ScoreHints | None = None,
    ) -> Score:
        labels: Any = None if hands is None else list(hands)  # the engine checks each label itself
        known = hints or ScoreHints()
        result = self._core.follow(
            list(expected),
            sorted(played),
            hands=labels,
            practise=known.practise,
            start_ms=known.start_ms,
            jumps=None if known.jumps is None else [(int(at), int(to)) for at, to in known.jumps],
        )
        s = result.score
        error = s.mean_timing_error_ms
        return Score(
            int(s.hits),
            int(s.misses),
            int(s.wrong),
            float(s.accuracy),
            None if error is None else float(error),
            None if s.final_speed_ppm is None else int(s.final_speed_ppm),
            int(s.late),
            str(s.hands),
            int(s.played_expected),
            None if s.played_accuracy is None else float(s.played_accuracy),
            int(s.unsure),
        )


STAND_IN = "stand-in"
ENGINE = "engine"


def default_scorer() -> Scorer:
    """The engine when its module is installed, the stand-in otherwise."""
    try:
        return CoreScorer()
    except ImportError:
        return StandInScorer()


def scorer_name(scorer: Scorer) -> str:
    return STAND_IN if isinstance(scorer, StandInScorer) else ENGINE


def choose_scorer(allow_stand_in: bool) -> Scorer:
    """The scorer to use, refusing the stand-in unless it was explicitly allowed.

    The stand-in is a simple matcher that does not follow tempo, so it would give a learner a different score from
    the Studio. A server that cannot load the engine therefore stops instead of quietly scoring with it.
    """
    scorer = default_scorer()
    if scorer_name(scorer) == STAND_IN and not allow_stand_in:
        raise RuntimeError(
            "the scoring engine (melophos_core) is not installed. Install its wheel or set ALLOW_STAND_IN_SCORER=true"
            " for development only"
        )
    return scorer


def mark_pending_hook(conn: psycopg.Connection[Row], session: PracticeSessionOut, owner_id: UUID) -> None:
    """Finish hook: a session that names a song is queued for scoring. Cheap and no engine is called."""
    if session.song_id is not None:
        conn.execute(
            "UPDATE practice_sessions SET score_state = 'pending', score_after = now() WHERE id = %s",
            (session.id,),
        )


SCORE_TIMEOUT = 10.0  # seconds one engine call may take before the attempt is abandoned
RETRY_DELAYS = (60, 600)  # seconds before the 2nd and 3rd attempt
MAX_ATTEMPTS = len(RETRY_DELAYS) + 1
MAX_PIECE_NOTES = 100_000  # the engine's own limit
MAX_PLAYED = 216_000  # presses the engine accepts. A session here holds at most 50 000 events
LEASE_EXTRA = 30  # a claimed job stays hidden from other workers for the time-out plus this


@dataclass
class ScoreReport:
    scored: int = 0
    retrying: int = 0
    failed: int = 0


class ScoreRunner:
    def __init__(self, pool: Pool, scorer: Scorer, timeout: float = SCORE_TIMEOUT) -> None:
        self._pool = pool
        self._scorer = scorer
        self._timeout = timeout
        self._threads = ThreadPoolExecutor(max_workers=2, thread_name_prefix="score")

    def run_once(self, limit: int = 5) -> ScoreReport:
        report = ScoreReport()
        for job in self._claim(limit):
            self._score(job, report)
        return report

    def _claim(self, limit: int) -> list[Row]:
        with self._pool.connection() as conn, conn.transaction():
            return conn.execute(
                "WITH due AS (SELECT id FROM practice_sessions WHERE score_state = 'pending' AND score_after <= now()"
                " ORDER BY score_after, id LIMIT %s FOR UPDATE SKIP LOCKED)"
                " UPDATE practice_sessions s SET score_after = now() + make_interval(secs => %s)"
                " FROM due, devices d WHERE s.id = due.id AND d.id = s.device_id"
                " RETURNING s.id, s.song_id, s.started_at, s.score_attempts, d.owner_id",
                (limit, self._timeout + LEASE_EXTRA),
            ).fetchall()

    def _inputs(self, job: Row) -> tuple[list[tuple[int, int]], list[tuple[int, int]], list[str | None]]:
        # a connection is held only while reading and is back in the pool before the engine is called
        with self._pool.connection() as conn:
            expected = conn.execute(
                "SELECT n.t_ms, n.note, n.hand FROM song_notes n JOIN songs s ON s.id = n.song_id"
                " WHERE s.id = %s AND s.owner_id = %s ORDER BY n.idx",
                (job["song_id"], job["owner_id"]),
            ).fetchall()
            played = conn.execute(
                "SELECT round(extract(epoch FROM (e.at - %s)) * 1000)::int AS t_ms, e.note FROM note_events e"
                " WHERE e.session_id = %s AND e.velocity > 0 AND e.at >= %s AND e.at <= %s + interval '6 hours'"
                " ORDER BY e.at, e.idx",
                (job["started_at"], job["id"], job["started_at"], job["started_at"]),
            ).fetchall()
        return (
            [(r["t_ms"], r["note"]) for r in expected],
            [(r["t_ms"], r["note"]) for r in played],
            [r["hand"] for r in expected],  # the song's hands, with any correction the player made
        )

    def _hints(self, job: Row) -> ScoreHints:
        """What the session records about where and how it was played. Nothing does yet: the protocol has no field
        for the hand practised, the start position or a jump, so the engine finds them itself."""
        return ScoreHints()

    def _score(self, job: Row, report: ScoreReport) -> None:
        try:
            expected, played, hands = self._inputs(job)
            if not expected:
                self._finish_failed(job, "the song has no notes to score against", report, final=True)
                return
            if len(expected) > MAX_PIECE_NOTES:
                self._finish_failed(job, "the song is longer than the engine accepts", report, final=True)
                return
            if len(played) > MAX_PLAYED:
                self._finish_failed(
                    job, "the session has more presses than the engine accepts", report, final=True
                )
                return
            future = self._threads.submit(self._scorer.score, expected, played, hands, self._hints(job))
            try:
                result = future.result(timeout=self._timeout)
            except FutureTimeout:
                future.cancel()
                self._finish_failed(job, f"scoring took longer than {self._timeout:g} seconds", report)
                return
        except (ValueError, TypeError) as error:
            # the engine refused its input. Another attempt would get the same answer, so this one is final
            self._finish_failed(job, f"the engine refused the input: {str(error)[:150]}", report, final=True)
            return
        except Exception as error:
            self._finish_failed(job, f"scoring failed: {type(error).__name__}", report)
            return
        with self._pool.connection() as conn:
            conn.execute(
                "UPDATE practice_sessions SET score_state = 'scored', accuracy = %s, mean_timing_error_ms = %s,"
                " final_speed_ppm = %s, late = %s, unsure = %s, score_hands = %s, played_expected = %s, played_accuracy = %s,"
                " score_error = NULL, score_attempts = score_attempts + 1 WHERE id = %s",
                (
                    result.accuracy,
                    result.mean_timing_error_ms,
                    result.final_speed_ppm,
                    result.late,
                    result.unsure,
                    result.hands,
                    result.played_expected,
                    result.played_accuracy,
                    job["id"],
                ),
            )
        report.scored += 1

    def _finish_failed(self, job: Row, message: str, report: ScoreReport, final: bool = False) -> None:
        attempts = job["score_attempts"] + 1
        last = final or attempts >= MAX_ATTEMPTS
        with self._pool.connection() as conn:
            if last:
                conn.execute(
                    "UPDATE practice_sessions SET score_state = 'failed', score_attempts = %s, score_error = %s"
                    " WHERE id = %s",
                    (attempts, message, job["id"]),
                )
                report.failed += 1
            else:
                conn.execute(
                    "UPDATE practice_sessions SET score_attempts = %s, score_error = %s,"
                    " score_after = now() + make_interval(secs => %s) WHERE id = %s",
                    (attempts, message, RETRY_DELAYS[attempts - 1], job["id"]),
                )
                report.retrying += 1
