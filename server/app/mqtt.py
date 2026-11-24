"""Hub traffic over MQTT: topic and payload checks, see docs/protocol.md.

Everything here is untrusted input from the network, so each check has a bound and a reason.
"""

import re
from dataclasses import dataclass
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, AwareDatetime, BaseModel, Field

from .schemas import NoteEvent, bounded_start

TOPIC_ROOT = "melophos"
KINDS = {"notes", "session", "status"}
MAX_TOPIC_LENGTH = 128
DEVICE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")

# the largest message the server will even parse, per kind. A notes batch is a quarter of a second of playing
MAX_BYTES = {"notes": 64 * 1024, "status": 4 * 1024, "session": 128 * 1024}
MAX_NOTES_PER_BATCH = 1000
MAX_SESSION_EVENTS = 50_000  # in all, over the notes batches and the session message
MAX_EVENTS_IN_SESSION_MESSAGE = 1000
INPUTS = Literal["usb_midi", "ble_midi", "midi_jack", "audio", "network"]
BIG = 2**53  # counters stay inside the range every JSON reader keeps exactly


@dataclass(frozen=True)
class Topic:
    device_id: str
    kind: str


def parse_topic(topic: str) -> Topic | None:
    """Split `melophos/<device_id>/<kind>`. Device ids are untrusted, so wildcards and odd characters are refused."""
    if len(topic) > MAX_TOPIC_LENGTH:
        return None
    parts = topic.split("/")
    if len(parts) != 3 or parts[0] != TOPIC_ROOT:
        return None
    device_id, kind = parts[1], parts[2]
    if not DEVICE_ID_RE.match(device_id) or kind not in KINDS:
        return None
    return Topic(device_id=device_id, kind=kind)


class Stamp(BaseModel):
    """Every message carries (boot, seq). `boot` counts power-ups and `seq` counts messages of one kind."""

    boot: int = Field(ge=0, lt=BIG)
    seq: int = Field(ge=0, lt=BIG)


class NotesMessage(Stamp):
    session_ref: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    started_at: Annotated[AwareDatetime, AfterValidator(bounded_start)]
    profile_id: str = Field(min_length=1, max_length=64)
    events: list[NoteEvent] = Field(min_length=1, max_length=MAX_NOTES_PER_BATCH)


class SessionMessage(Stamp):
    session_ref: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    started_at: Annotated[AwareDatetime, AfterValidator(bounded_start)]
    profile_id: str = Field(min_length=1, max_length=64)
    mode: str | None = Field(default=None, pattern="^(melody|rhythm|listen|free)$")
    song_id: UUID | None = None
    events: list[NoteEvent] = Field(default_factory=list, max_length=MAX_EVENTS_IN_SESSION_MESSAGE)


class StatusMessage(Stamp):
    firmware: str = Field(min_length=1, max_length=32)
    profile_id: str | None = Field(default=None, min_length=1, max_length=64)
    inputs: list[INPUTS] = Field(default_factory=list, max_length=8)
    dropped_events: int = Field(default=0, ge=0, lt=BIG)


MODELS: dict[str, type[Stamp]] = {"notes": NotesMessage, "session": SessionMessage, "status": StatusMessage}
