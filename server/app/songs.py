"""The song library: uploads, the import queue and reads, always scoped to the owner."""

from datetime import datetime
from typing import Any
from uuid import UUID

from .db import Pool
from .store import BadCursor, decode_cursor, encode_cursor

MAX_UPLOAD = 1024 * 1024
MAX_SONGS_PER_ACCOUNT = 200
MAX_NOTE_PAGE = 2000

SONG_COLUMNS = (
    "id, title, artist, source_kind, import_state, length_ms, note_count, difficulty, hands_method, hands_edited,"
    " import_error, created_at"
)


class LibraryFull(Exception):
    pass


class NotCorrectable(Exception):
    """The song is not ready or a note number in the correction does not exist."""


MAX_CORRECTIONS = 50_000


class SongStore:
    def __init__(self, pool: Pool) -> None:
        self._pool = pool

    def add(self, owner_id: UUID, title: str, artist: str | None, data: bytes) -> dict[str, Any]:
        with self._pool.connection() as conn, conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 2))", (str(owner_id),))
            n = conn.execute("SELECT count(*) AS n FROM songs WHERE owner_id = %s", (owner_id,)).fetchone()
            assert n is not None
            if n["n"] >= MAX_SONGS_PER_ACCOUNT:
                raise LibraryFull
            row = conn.execute(
                "INSERT INTO songs (owner_id, title, artist, source_kind) VALUES (%s,%s,%s,'midi')"
                f" RETURNING {SONG_COLUMNS}",  # noqa: S608
                (owner_id, title, artist),
            ).fetchone()
            assert row is not None
            conn.execute("INSERT INTO song_files (song_id, data) VALUES (%s, %s)", (row["id"], data))
        return row

    def get(self, owner_id: UUID, song_id: UUID) -> dict[str, Any] | None:
        with self._pool.connection() as conn:
            return conn.execute(
                f"SELECT {SONG_COLUMNS} FROM songs WHERE owner_id = %s AND id = %s",  # noqa: S608
                (owner_id, song_id),
            ).fetchone()

    def list_for(
        self, owner_id: UUID, limit: int, cursor: str | None
    ) -> tuple[list[dict[str, Any]], str | None]:
        args: list[Any] = [owner_id]
        clause = ""
        if cursor:
            created, last = decode_cursor(cursor, 2)
            try:
                clause = " AND (created_at, id) < (%s, %s)"
                args += [datetime.fromisoformat(created), UUID(last)]
            except ValueError as error:
                raise BadCursor("the cursor is not valid") from error
        args.append(limit + 1)
        with self._pool.connection() as conn:
            rows = conn.execute(
                f"SELECT {SONG_COLUMNS} FROM songs WHERE owner_id = %s{clause}"  # noqa: S608
                " ORDER BY created_at DESC, id DESC LIMIT %s",
                args,
            ).fetchall()
        page = rows[:limit]
        nxt = encode_cursor(page[-1]["created_at"], page[-1]["id"]) if len(rows) > limit else None
        return page, nxt

    def file(self, owner_id: UUID, song_id: UUID) -> bytes | None:
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT f.data FROM song_files f JOIN songs s ON s.id = f.song_id WHERE s.owner_id = %s AND s.id = %s",
                (owner_id, song_id),
            ).fetchone()
        return bytes(row["data"]) if row else None

    def notes(
        self, owner_id: UUID, song_id: UUID, limit: int, after: int
    ) -> tuple[list[dict[str, Any]], int | None] | None:
        if self.get(owner_id, song_id) is None:
            return None
        with self._pool.connection() as conn:
            rows = conn.execute(
                "SELECT idx, t_ms, dur_ms, note, velocity, hand FROM song_notes"
                " WHERE song_id = %s AND idx > %s ORDER BY idx LIMIT %s",
                (song_id, after, limit + 1),
            ).fetchall()
        page = rows[:limit]
        return page, (page[-1]["idx"] if len(rows) > limit else None)

    def correct_hands(self, owner_id: UUID, song_id: UUID, changes: dict[int, str]) -> dict[str, Any] | None:
        """Store a corrected split. Only the notes named change and the importer's own answer is kept for a reset."""
        with self._pool.connection() as conn, conn.transaction():
            song = conn.execute(
                "SELECT id, import_state, note_count FROM songs WHERE owner_id = %s AND id = %s FOR UPDATE",
                (owner_id, song_id),
            ).fetchone()
            if song is None:
                return None
            if song["import_state"] != "ready":
                raise NotCorrectable("the song has not finished importing")
            if any(i < 0 or i >= (song["note_count"] or 0) for i in changes):
                raise NotCorrectable("a note number is outside the song")
            idxs, hands = list(changes), list(changes.values())
            conn.execute(
                "UPDATE song_notes n SET hand = c.hand FROM unnest(%s::int[], %s::text[]) AS c(idx, hand)"
                " WHERE n.song_id = %s AND n.idx = c.idx",
                (idxs, hands, song_id),
            )
            conn.execute(
                "UPDATE songs SET hands_edited = EXISTS (SELECT 1 FROM song_notes WHERE song_id = %s"
                " AND hand <> auto_hand) WHERE id = %s",
                (song_id, song_id),
            )
        return self.get(owner_id, song_id)

    def reset_hands(self, owner_id: UUID, song_id: UUID) -> dict[str, Any] | None:
        with self._pool.connection() as conn, conn.transaction():
            row = conn.execute(
                "UPDATE songs SET hands_edited = false WHERE owner_id = %s AND id = %s RETURNING id",
                (owner_id, song_id),
            ).fetchone()
            if row is None:
                return None
            conn.execute(
                "UPDATE song_notes SET hand = auto_hand WHERE song_id = %s AND hand <> auto_hand", (song_id,)
            )
        return self.get(owner_id, song_id)

    def delete(self, owner_id: UUID, song_id: UUID) -> bool:
        with self._pool.connection() as conn:
            return (
                conn.execute(
                    "DELETE FROM songs WHERE owner_id = %s AND id = %s", (owner_id, song_id)
                ).rowcount
                == 1
            )
