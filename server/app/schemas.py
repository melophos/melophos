"""Request and response models. Field names match docs/protocol.md."""

from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, AwareDatetime, BaseModel, Field

# a session must have started inside this window around now. A hub can queue a session for a month while offline,
# but a start time years away would create chunks in the time-series table and overflow date arithmetic
MAX_PAST = timedelta(days=366)
MAX_FUTURE = timedelta(days=1)


def bounded_start(value: datetime) -> datetime:
    now = datetime.now(UTC)
    if not now - MAX_PAST <= value <= now + MAX_FUTURE:
        raise ValueError("started_at must be within the last 366 days and no more than a day ahead")
    return value


MAX_EVENTS = 50_000  # one hour of dense playing is about 20 000 events
MAX_EVENT_MS = 6 * 3600 * 1000  # a session longer than six hours is a stuck hub, not practice


class NoteSource(StrEnum):
    usb_midi = "usb_midi"
    ble_midi = "ble_midi"
    midi_jack = "midi_jack"
    audio = "audio"
    network = "network"


class NoteEvent(BaseModel):
    t_ms: int = Field(ge=0, le=MAX_EVENT_MS, description="Milliseconds since the session started")
    note: int = Field(ge=0, le=127)
    velocity: int = Field(ge=0, le=127, description="0 means the note was released")
    channel: int = Field(default=0, ge=0, le=15)
    source: NoteSource = NoteSource.usb_midi


class PracticeSessionIn(BaseModel):
    # the device is known from its credential, so this is optional and, if sent, has to match it
    device_id: str | None = Field(default=None, min_length=1, max_length=64)
    profile_id: str = Field(min_length=1, max_length=64)
    started_at: Annotated[AwareDatetime, AfterValidator(bounded_start)]
    song_id: UUID | None = None
    mode: str | None = Field(default=None, pattern="^(melody|rhythm|listen|free)$")
    events: list[NoteEvent] = Field(max_length=MAX_EVENTS)


class SessionSummary(BaseModel):
    duration_ms: int
    notes_played: int
    unique_notes: int
    most_played_note: int | None
    mean_velocity: float | None
    notes_per_minute: float


class PracticeSessionOut(BaseModel):
    id: UUID
    device_id: str
    profile_id: str
    started_at: AwareDatetime
    song_id: UUID | None
    mode: str | None
    summary: SessionSummary
    clock_unsynced: bool = Field(
        default=False,
        description="True when the server's clock was not synchronised as it received this session, so its date may be wrong by the length of a power cut",
    )
    accuracy: float | None = None
    mean_timing_error_ms: float | None = None
    final_speed_ppm: int | None = Field(default=None, description="1 000 000 is the written speed")
    late: int | None = Field(
        default=None,
        description="Notes matched outside the timing window, early or late. They are not hits, not misses and not wrong presses",
    )
    unsure: int | None = Field(
        default=None,
        description="Presses the engine could not place with confidence. They count neither for nor against the player",
    )
    hands: str | None = Field(
        default=None,
        description="Which hand or hands the session played: unknown, neither, left, right or both",
    )
    played_expected: int | None = Field(
        default=None, description="How many expected notes belong to the hand or hands played"
    )
    played_accuracy: float | None = Field(
        default=None,
        description="Accuracy over the hand played. Only set when the session was played with one hand",
    )
    score_state: str = Field(
        default="none", description="none, pending, scored or failed. Never filled in by guesswork"
    )


class Page[T](BaseModel):
    """A page of results. Pass `next_cursor` back as `cursor` for the next page, null means the end."""

    items: list[T]
    next_cursor: str | None
