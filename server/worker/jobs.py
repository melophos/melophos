"""Import jobs. Parsing runs in the worker, away from the request path.

Only MIDI is implemented. Audio and video imports are separate roadmap items and stay unavailable.
"""

import logging
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from app.db import Pool
from app.hands import difficulty, split_hands
from app.midi import MidiError, parse

log = logging.getLogger("melophos.import")

# a job still running after this long was lost with its worker. It is failed rather than retried, because a file
# that kills a worker would otherwise kill the next one too
STUCK_MINUTES = 10


class ImportKind(StrEnum):
    midi = "midi"  # parsed directly, no model needed
    audio = "audio"  # polyphonic transcription (Basic Pitch or Transkun)
    video = "video"  # falling-note tutorial video, read by computer vision


@dataclass(frozen=True)
class ImportJob:
    song_id: str
    kind: ImportKind
    source: Path


SUFFIXES = {
    ".mid": ImportKind.midi,
    ".midi": ImportKind.midi,
    ".wav": ImportKind.audio,
    ".mp3": ImportKind.audio,
    ".flac": ImportKind.audio,
    ".mp4": ImportKind.video,
    ".mkv": ImportKind.video,
    ".webm": ImportKind.video,
}


def kind_for(path: Path) -> ImportKind | None:
    return SUFFIXES.get(path.suffix.lower())


def fail_stuck(pool: Pool) -> int:
    with pool.connection() as conn:
        return conn.execute(
            "UPDATE songs SET import_state = 'failed', import_error = 'the import took too long and was stopped'"
            " WHERE import_state = 'running' AND import_started_at < now() - make_interval(mins => %s)",
            (STUCK_MINUTES,),
        ).rowcount


def process_next(pool: Pool) -> bool:
    """Import the oldest queued MIDI song. Returns False when the queue is empty."""
    with pool.connection() as conn, conn.transaction():
        job = conn.execute(
            "SELECT s.id, f.data FROM songs s JOIN song_files f ON f.song_id = s.id"
            " WHERE s.import_state = 'queued' AND s.source_kind = 'midi'"
            " ORDER BY s.created_at, s.id LIMIT 1 FOR UPDATE OF s SKIP LOCKED"
        ).fetchone()
        if job is None:
            return False
        conn.execute(
            "UPDATE songs SET import_state = 'running', import_started_at = now() WHERE id = %s", (job["id"],)
        )
    _import_midi(pool, job["id"], bytes(job["data"]))
    return True


def _import_midi(pool: Pool, song_id: object, data: bytes) -> None:
    try:
        song = parse(data)
        split = split_hands(song)
        rating = difficulty(song, split.hands)
    except MidiError as error:
        _fail(pool, song_id, str(error))
        return
    except Exception:
        # a parser bug must not kill the worker or leak details, so the person gets a plain message
        log.exception("unexpected error importing song %s", song_id)
        _fail(pool, song_id, "the file could not be read")
        return
    with pool.connection() as conn, conn.transaction():
        with conn.cursor().copy(
            "COPY song_notes (song_id, idx, t_ms, dur_ms, note, velocity, hand, auto_hand, track, channel) FROM STDIN"
        ) as copy:
            for i, (n, hand) in enumerate(zip(song.notes, split.hands, strict=True)):
                copy.write_row(
                    (song_id, i, n.t_ms, n.dur_ms, n.note, n.velocity, hand, hand, n.track, n.channel)
                )
        conn.execute(
            "UPDATE songs SET import_state = 'ready', length_ms = %s, note_count = %s, difficulty = %s,"
            " hands_method = %s, import_error = NULL WHERE id = %s",
            (song.length_ms, len(song.notes), rating, split.method, song_id),
        )


def _fail(pool: Pool, song_id: object, message: str) -> None:
    with pool.connection() as conn:
        conn.execute(
            "UPDATE songs SET import_state = 'failed', import_error = %s WHERE id = %s",
            (message[:300], song_id),
        )


def run(job: ImportJob) -> None:
    # each importer lands as its own milestone in docs/roadmap.md
    raise NotImplementedError(f"{job.kind} import is not implemented yet")
