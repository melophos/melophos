"""Session storage in Postgres and TimescaleDB.

Every query is written so the planner can use an index: lists walk (device_id, started_at, id) and events walk
(session_id, at, idx) with a time bound, which lets TimescaleDB skip chunks outside the session.
"""

import base64
import binascii
import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg

from .db import Pool, Row
from .schemas import MAX_EVENT_MS, NoteEvent, Page, PracticeSessionIn, PracticeSessionOut, SessionSummary
from .stats import summarise

MAX_PAGE = 200
DEFAULT_PAGE = 50
MAX_EVENT_PAGE = 2000


class BadCursor(ValueError):
    pass


class UnknownSong(ValueError):
    pass


class StorageFull(ValueError):
    pass


# the most note events one account may keep. A 50 000-event session is about an hour of dense playing, so this is
# 100 of them. Delete sessions to make room
MAX_EVENTS_PER_ACCOUNT = 5_000_000


def encode_cursor(*parts: Any) -> str:
    raw = json.dumps([p.isoformat() if isinstance(p, datetime) else str(p) for p in parts])
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str, count: int) -> list[str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        parts = json.loads(base64.urlsafe_b64decode(padded.encode()))
    except (ValueError, binascii.Error) as error:
        raise BadCursor("the cursor is not valid") from error
    if not isinstance(parts, list) or len(parts) != count or not all(isinstance(p, str) for p in parts):
        raise BadCursor("the cursor is not valid")
    return [str(p) for p in parts]


def _clamp(limit: int | None, default: int, maximum: int) -> int:
    if limit is None:
        return default
    return max(1, min(limit, maximum))


def _session_out(row: Row) -> PracticeSessionOut:
    return PracticeSessionOut(
        id=row["id"],
        device_id=row["device_id"],
        profile_id=row["profile_id"],
        started_at=row["started_at"],
        song_id=row["song_id"],
        mode=row["mode"],
        accuracy=row["accuracy"],
        mean_timing_error_ms=row["mean_timing_error_ms"],
        final_speed_ppm=row["final_speed_ppm"],
        score_state=row["score_state"],
        clock_unsynced=row["clock_unsynced"],
        late=row["late"],
        unsure=row["unsure"],
        hands=row["score_hands"],
        played_expected=row["played_expected"],
        # shown only for a one-hand session, where it is the honest figure. For both hands it is the accuracy
        played_accuracy=row["played_accuracy"] if row["score_hands"] in ("left", "right") else None,
        summary=SessionSummary(
            duration_ms=row["duration_ms"],
            notes_played=row["notes_played"],
            unique_notes=row["unique_notes"],
            most_played_note=row["most_played_note"],
            mean_velocity=row["mean_velocity"],
            notes_per_minute=row["notes_per_minute"],
        ),
    )


SESSION_COLUMNS = (
    "s.id, s.device_id, s.profile_id, s.started_at, s.song_id, s.mode, s.accuracy, s.mean_timing_error_ms,"
    " s.final_speed_ppm, s.score_state, s.late, s.unsure, s.score_hands, s.played_expected, s.played_accuracy, s.duration_ms,"
    " s.notes_played, s.unique_notes, s.most_played_note, s.mean_velocity, s.notes_per_minute, s.clock_unsynced"
)


FinishHook = Callable[[psycopg.Connection[Row], PracticeSessionOut, UUID], None]


class PgSessionStore:
    def __init__(self, pool: Pool) -> None:
        self._pool = pool
        # called inside the transaction that finishes a session, with the owner, so a webhook is queued atomically
        self.finish_hooks: list[FinishHook] = []
        self.clock_unsynced: Callable[[], bool] = lambda: False

    def run_finish_hooks(self, conn: psycopg.Connection[Row], session_id: UUID) -> PracticeSessionOut | None:
        row = conn.execute(
            f"SELECT {SESSION_COLUMNS}, d.owner_id FROM practice_sessions s JOIN devices d ON d.id = s.device_id"  # noqa: S608
            " WHERE s.id = %s",
            (session_id,),
        ).fetchone()
        if row is None or row["owner_id"] is None:
            return None
        out = _session_out(row)
        for hook in self.finish_hooks:
            hook(conn, out, row["owner_id"])
        return out

    def add(self, session: PracticeSessionIn, device_id: str) -> PracticeSessionOut:
        summary = summarise(session.events)
        events = sorted(session.events, key=lambda e: e.t_ms)
        with self._pool.connection() as conn, conn.transaction():
            if stored_events(conn, device_id) + len(events) > MAX_EVENTS_PER_ACCOUNT:
                raise StorageFull(
                    "this account has stored as many note events as it may, delete some sessions"
                )
            if session.song_id is not None and not song_belongs_to_device_owner(
                conn, session.song_id, device_id
            ):
                raise UnknownSong("song_id is not one of this account's songs")
            row = conn.execute(
                "INSERT INTO practice_sessions (device_id, profile_id, song_id, mode, started_at, ended_at,"
                " notes_played, duration_ms, unique_notes, most_played_note, mean_velocity, notes_per_minute,"
                " event_count, clock_unsynced) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (
                    device_id,
                    session.profile_id,
                    session.song_id,
                    session.mode,
                    session.started_at,
                    session.started_at + timedelta(milliseconds=summary.duration_ms),
                    summary.notes_played,
                    summary.duration_ms,
                    summary.unique_notes,
                    summary.most_played_note,
                    summary.mean_velocity,
                    summary.notes_per_minute,
                    len(events),
                    self.clock_unsynced(),
                ),
            ).fetchone()
            assert row is not None
            session_id: UUID = row["id"]
            insert_events(conn, session_id, session.started_at, events, 0)
            self.run_finish_hooks(conn, session_id)
        stored = self.get(session_id)
        assert stored is not None
        return stored

    def delete(self, session_id: UUID, owner_id: UUID) -> bool:
        with self._pool.connection() as conn:
            return (
                conn.execute(
                    "DELETE FROM practice_sessions s USING devices d WHERE s.id = %s AND d.id = s.device_id"
                    " AND d.owner_id = %s",
                    (session_id, owner_id),
                ).rowcount
                == 1
            )

    def get(self, session_id: UUID, owner_id: UUID | None = None) -> PracticeSessionOut | None:
        sql = f"SELECT {SESSION_COLUMNS} FROM practice_sessions s"  # noqa: S608 (constant column list)
        args: list[Any] = [session_id]
        if owner_id is not None:
            sql += " JOIN devices d ON d.id = s.device_id AND d.owner_id = %s"
            args = [owner_id, session_id]
        # a session still being streamed over MQTT has no summary yet, so it is not shown until it finishes
        sql += " WHERE s.id = %s AND s.ended_at IS NOT NULL"
        with self._pool.connection() as conn:
            row = conn.execute(sql, args).fetchone()
        return _session_out(row) if row else None

    def list(
        self,
        *,
        owner_id: UUID | None = None,
        device_id: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> Page[PracticeSessionOut]:
        size = _clamp(limit, DEFAULT_PAGE, MAX_PAGE)
        where: list[str] = ["s.ended_at IS NOT NULL"]
        args: list[Any] = []
        join = ""
        if owner_id is not None:
            join = " JOIN devices d ON d.id = s.device_id"
            where.append("d.owner_id = %s")
            args.append(owner_id)
        if device_id is not None:
            where.append("s.device_id = %s")
            args.append(device_id)
        if cursor:
            started, last_id = decode_cursor(cursor, 2)
            try:
                where.append("(s.started_at, s.id) < (%s, %s)")
                args += [datetime.fromisoformat(started), UUID(last_id)]
            except ValueError as error:
                raise BadCursor("the cursor is not valid") from error
        clause = (" WHERE " + " AND ".join(where)) if where else ""
        sql = (  # noqa: S608 (clauses are constants, values are bound)
            f"SELECT {SESSION_COLUMNS} FROM practice_sessions s{join}{clause}"
            " ORDER BY s.started_at DESC, s.id DESC LIMIT %s"
        )
        args.append(size + 1)
        with self._pool.connection() as conn:
            rows = conn.execute(sql, args).fetchall()
        items = [_session_out(r) for r in rows[:size]]
        more = len(rows) > size
        nxt = encode_cursor(items[-1].started_at.astimezone(UTC), items[-1].id) if more else None
        return Page(items=items, next_cursor=nxt)

    def events(
        self,
        session_id: UUID,
        owner_id: UUID | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> Page[NoteEvent] | None:
        session = self.get(session_id, owner_id)
        if session is None:
            return None
        size = _clamp(limit, 500, MAX_EVENT_PAGE)
        after_at, after_idx = session.started_at - timedelta(milliseconds=1), -1
        if cursor:
            at_text, idx_text = decode_cursor(cursor, 2)
            try:
                after_at, after_idx = datetime.fromisoformat(at_text), int(idx_text)
            except ValueError as error:
                raise BadCursor("the cursor is not valid") from error
        # the time bounds are what let TimescaleDB leave other chunks alone
        sql = (
            "SELECT at, idx, note, velocity, channel, source FROM note_events"
            " WHERE session_id = %s AND at >= %s AND at <= %s AND (at, idx) > (%s, %s)"
            " ORDER BY at, idx LIMIT %s"
        )
        args = (
            session_id,
            session.started_at,
            session.started_at + timedelta(milliseconds=MAX_EVENT_MS),
            after_at,
            after_idx,
            size + 1,
        )
        with self._pool.connection() as conn:
            rows = conn.execute(sql, args).fetchall()
        page = rows[:size]
        items = [
            NoteEvent(
                t_ms=round((r["at"] - session.started_at).total_seconds() * 1000),
                note=r["note"],
                velocity=r["velocity"],
                channel=r["channel"],
                source=r["source"],
            )
            for r in page
        ]
        nxt = encode_cursor(page[-1]["at"].astimezone(UTC), page[-1]["idx"]) if len(rows) > size else None
        return Page(items=items, next_cursor=nxt)


def insert_events(
    conn: psycopg.Connection[Row],
    session_id: UUID,
    started_at: datetime,
    events: list[NoteEvent],
    first_idx: int,
) -> None:
    if not events:
        return
    with conn.cursor().copy(
        "COPY note_events (session_id, at, idx, note, velocity, channel, source) FROM STDIN"
    ) as copy:
        for offset, e in enumerate(events):
            copy.write_row(
                (
                    session_id,
                    started_at + timedelta(milliseconds=e.t_ms),
                    first_idx + offset,
                    e.note,
                    e.velocity,
                    e.channel,
                    e.source.value,
                )
            )


def finalise_session(conn: psycopg.Connection[Row], session_id: UUID, started_at: datetime) -> None:
    """Summarise the events stored so far and close the session. Used when a hub reports it over MQTT."""
    rows = conn.execute(
        "SELECT at, note, velocity, channel, source FROM note_events WHERE session_id = %s AND at >= %s"
        " AND at <= %s ORDER BY at, idx",
        (session_id, started_at, started_at + timedelta(milliseconds=MAX_EVENT_MS)),
    ).fetchall()
    events = [
        NoteEvent(
            t_ms=round((r["at"] - started_at).total_seconds() * 1000),
            note=r["note"],
            velocity=r["velocity"],
            channel=r["channel"],
            source=r["source"],
        )
        for r in rows
    ]
    summary = summarise(events)
    conn.execute(
        "UPDATE practice_sessions SET ended_at = %s, notes_played = %s, duration_ms = %s, unique_notes = %s,"
        " most_played_note = %s, mean_velocity = %s, notes_per_minute = %s, event_count = %s WHERE id = %s",
        (
            started_at + timedelta(milliseconds=summary.duration_ms),
            summary.notes_played,
            summary.duration_ms,
            summary.unique_notes,
            summary.most_played_note,
            summary.mean_velocity,
            summary.notes_per_minute,
            len(events),
            session_id,
        ),
    )


def song_belongs_to_device_owner(conn: psycopg.Connection[Row], song_id: UUID, device_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 AS ok FROM songs s JOIN devices d ON d.owner_id = s.owner_id WHERE s.id = %s AND d.id = %s",
        (song_id, device_id),
    ).fetchone()
    return row is not None


def stored_events(conn: psycopg.Connection[Row], device_id: str) -> int:
    """Note events the device's owner has stored so far, over all their devices. A running total kept by triggers,
    so one message does not have to add up every session."""
    row = conn.execute(
        "SELECT u.stored_events FROM devices d JOIN users u ON u.id = d.owner_id WHERE d.id = %s",
        (device_id,),
    ).fetchone()
    return int(row["stored_events"]) if row else 0
