"""MQTT ingestion: every message from a hub is checked, then stored or skipped and counted.

A bad message never raises out of `handle`, because one broken hub must not stop the others. Each outcome
increments `melophos_mqtt_messages_total{outcome=...}` and is logged without the payload.

Who may publish is enforced twice. The broker's rules only let a hub publish under `melophos/<its own id>/`
(see broker.py). The server then also requires the id in the topic to be a paired device, so a broker
misconfiguration alone cannot store data under an id nobody owns.

Replays: every message carries (boot, seq). The server keeps the newest pair accepted per device and kind and
accepts a message only if its pair is strictly greater. A repeat from QoS 1 redelivery, an old message resent
by someone who captured it and a reordered message all fail that test and are counted as `replayed`.
"""

import logging
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from enum import StrEnum
from uuid import UUID

import psycopg
from prometheus_client import Counter
from pydantic import ValidationError

from .db import Pool, Row
from .mqtt import (
    MAX_BYTES,
    MAX_SESSION_EVENTS,
    MODELS,
    NotesMessage,
    SessionMessage,
    StatusMessage,
    parse_topic,
)
from .routers import sessions as sessions_route
from .security import RateLimiter
from .store import (
    MAX_EVENTS_PER_ACCOUNT,
    PgSessionStore,
    finalise_session,
    insert_events,
    song_belongs_to_device_owner,
    stored_events,
)

log = logging.getLogger("melophos.ingest")

MESSAGES = Counter("melophos_mqtt_messages_total", "Hub messages by outcome", ["outcome"])

MAX_BOOT_JUMP = 1000  # power-ups between two messages. A hub is not switched on a thousand times unseen
MAX_FIRST_BOOT = 1_000_000
RATE_MESSAGES = 100  # per device per window, a hub sends about 5 a second at most
RATE_WINDOW_S = 10.0
MAX_TRACKED_DEVICES = 10_000


class Outcome(StrEnum):
    stored = "stored"
    bad_topic = "bad_topic"
    too_large = "too_large"
    unknown_device = "unknown_device"
    rate_limited = "rate_limited"
    bad_payload = "bad_payload"
    replayed = "replayed"
    rejected = "rejected"
    error = "error"


class _Reject(Exception):
    def __init__(self, outcome: Outcome, why: str) -> None:
        super().__init__(why)
        self.outcome, self.why = outcome, why


def _printable(text: str) -> str:
    return "".join(c if c.isprintable() else "?" for c in text)[:80]


class IngestHandler:
    def __init__(
        self, pool: Pool, store: PgSessionStore, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._pool = pool
        self._store = store
        self._clock = clock
        self._recent: OrderedDict[str, deque[float]] = OrderedDict()
        self._limiter = RateLimiter(pool)

    def handle(self, topic: str, payload: bytes) -> Outcome:
        try:
            outcome, why = self._handle(topic, payload)
        except Exception as error:
            # whatever one message does, the loop that called this must carry on for every other hub
            outcome, why = Outcome.error, type(error).__name__
        MESSAGES.labels(outcome=outcome.value).inc()
        if outcome is Outcome.replayed:
            # a repeat is normal with QoS 1 redelivery, so it is counted and noted at info level only
            log.info("dropped a repeated hub message topic=%r", _printable(topic))
        elif outcome is not Outcome.stored:
            log.warning(
                "skipped hub message: %s (%s) topic=%r size=%d",
                outcome.value,
                why,
                _printable(topic),
                len(payload),
            )
        return outcome

    def _handle(self, topic: str, payload: bytes) -> tuple[Outcome, str]:
        parsed = parse_topic(topic)
        if parsed is None:
            return Outcome.bad_topic, "topic is not melophos/<device>/<kind>"
        if len(payload) > MAX_BYTES[parsed.kind]:
            return Outcome.too_large, f"over {MAX_BYTES[parsed.kind]} bytes"
        if self._limited(parsed.device_id):
            return Outcome.rate_limited, "too many messages from this device"
        try:
            owner = self._paired_owner(parsed.device_id)
            if owner is None:
                return Outcome.unknown_device, "no paired device has this id"
            try:
                message = MODELS[parsed.kind].model_validate_json(payload)
            except ValidationError as error:
                first = error.errors()[0]
                return Outcome.bad_payload, f"{'.'.join(str(p) for p in first['loc'])}: {first['type']}"
            with self._pool.connection() as conn, conn.transaction():
                # one message of a device at a time across every server process, so two processes sharing the
                # subscription cannot deadlock on the same session
                conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 8))", (parsed.device_id,))
                if not self._newer(conn, parsed.device_id, parsed.kind, message.boot, message.seq):
                    return Outcome.replayed, "boot and seq are not newer than the last accepted message"
                if isinstance(message, NotesMessage):
                    self._notes(conn, parsed.device_id, message)
                elif isinstance(message, SessionMessage):
                    self._session(conn, parsed.device_id, message)
                elif isinstance(message, StatusMessage):
                    self._status(conn, parsed.device_id, message)
                conn.execute("UPDATE devices SET last_seen_at = now() WHERE id = %s", (parsed.device_id,))
        except _Reject as reject:
            return reject.outcome, reject.why
        except (psycopg.Error, OSError) as error:
            return Outcome.error, type(error).__name__
        return Outcome.stored, ""

    def _limited(self, device_id: str) -> bool:
        now = self._clock()
        window = self._recent.get(device_id)
        if window is None:
            window = self._recent[device_id] = deque()
            if len(self._recent) > MAX_TRACKED_DEVICES:
                self._recent.popitem(last=False)
        else:
            self._recent.move_to_end(device_id)
        while window and now - window[0] > RATE_WINDOW_S:
            window.popleft()
        if len(window) >= RATE_MESSAGES:
            return True
        window.append(now)
        return False

    def _paired_owner(self, device_id: str) -> UUID | None:
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT owner_id FROM devices WHERE id = %s AND owner_id IS NOT NULL", (device_id,)
            ).fetchone()
        return UUID(str(row["owner_id"])) if row else None

    @staticmethod
    def _newer(conn: psycopg.Connection[Row], device_id: str, kind: str, boot: int, seq: int) -> bool:
        # one statement, so two copies of a message arriving together cannot both pass. A boot more than
        # MAX_BOOT_JUMP ahead of the last one is refused too, so a stolen secret cannot push the counter to its
        # ceiling and silence the real hub for good
        row = conn.execute(
            "INSERT INTO ingest_state (device_id, kind, boot, seq) SELECT %s,%s,%s,%s WHERE %s <= %s"
            " ON CONFLICT (device_id, kind) DO UPDATE SET boot = EXCLUDED.boot, seq = EXCLUDED.seq, updated_at = now()"
            " WHERE (ingest_state.boot, ingest_state.seq) < (EXCLUDED.boot, EXCLUDED.seq)"
            " AND EXCLUDED.boot <= ingest_state.boot + %s RETURNING 1 AS ok",
            (device_id, kind, boot, seq, boot, MAX_FIRST_BOOT, MAX_BOOT_JUMP),
        ).fetchone()
        return row is not None

    def _open(self, conn: psycopg.Connection[Row], device_id: str, m: NotesMessage | SessionMessage) -> Row:
        made = conn.execute(
            "INSERT INTO practice_sessions (device_id, session_ref, profile_id, started_at) VALUES (%s,%s,%s,%s)"
            " ON CONFLICT (device_id, session_ref) WHERE session_ref IS NOT NULL DO NOTHING RETURNING id",
            (device_id, m.session_ref, m.profile_id, m.started_at),
        ).fetchone()
        # a new session counts against the same hourly allowance as the HTTP route, so ingest cannot be used to
        # make rows without limit
        if made is not None and not self._limiter.hit(
            f"session-post:{device_id}", sessions_route.SESSIONS_PER_HOUR, 3600
        ):
            raise _Reject(Outcome.rejected, "too many new sessions from this device this hour")
        row = conn.execute(
            "SELECT id, started_at, ended_at, event_count FROM practice_sessions"
            " WHERE device_id = %s AND session_ref = %s FOR UPDATE",
            (device_id, m.session_ref),
        ).fetchone()
        assert row is not None
        if row["ended_at"] is not None:
            raise _Reject(Outcome.rejected, "that session is already finished")
        return row

    def _notes(self, conn: psycopg.Connection[Row], device_id: str, m: NotesMessage) -> None:
        row = self._open(conn, device_id, m)
        if row["event_count"] + len(m.events) > MAX_SESSION_EVENTS:
            raise _Reject(Outcome.rejected, "the session is over its event limit")
        if stored_events(conn, device_id) + len(m.events) > MAX_EVENTS_PER_ACCOUNT:
            raise _Reject(Outcome.rejected, "the account has stored as many note events as it may")
        insert_events(conn, row["id"], row["started_at"], m.events, row["event_count"])
        conn.execute(
            "UPDATE practice_sessions SET event_count = event_count + %s WHERE id = %s",
            (len(m.events), row["id"]),
        )

    def _session(self, conn: psycopg.Connection[Row], device_id: str, m: SessionMessage) -> None:
        if m.song_id is not None and not song_belongs_to_device_owner(conn, m.song_id, device_id):
            raise _Reject(Outcome.rejected, "song_id is not one of this account's songs")
        row = self._open(conn, device_id, m)
        if row["event_count"] + len(m.events) > MAX_SESSION_EVENTS:
            raise _Reject(Outcome.rejected, "the session is over its event limit")
        insert_events(conn, row["id"], row["started_at"], m.events, row["event_count"])
        conn.execute(
            "UPDATE practice_sessions SET mode = %s, song_id = %s WHERE id = %s",
            (m.mode, m.song_id, row["id"]),
        )
        finalise_session(conn, row["id"], row["started_at"])
        self._store.run_finish_hooks(conn, row["id"])

    @staticmethod
    def _status(conn: psycopg.Connection[Row], device_id: str, m: StatusMessage) -> None:
        conn.execute(
            "UPDATE devices SET firmware = %s, profile_id = %s, active_inputs = %s, dropped_events = %s,"
            " status_at = now() WHERE id = %s",
            (m.firmware, m.profile_id, list(m.inputs), m.dropped_events, device_id),
        )
