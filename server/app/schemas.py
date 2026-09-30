"""Request and response models. Field names match docs/protocol.md."""

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class NoteSource(StrEnum):
    usb_midi = "usb_midi"
    ble_midi = "ble_midi"
    midi_jack = "midi_jack"
    audio = "audio"
    network = "network"


class NoteEvent(BaseModel):
    t_ms: int = Field(ge=0, description="Milliseconds since the session started")
    note: int = Field(ge=0, le=127)
    velocity: int = Field(ge=0, le=127, description="0 means the note was released")
    channel: int = Field(default=0, ge=0, le=15)
    source: NoteSource = NoteSource.usb_midi


class PracticeSessionIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=64)
    profile_id: str = Field(min_length=1, max_length=64)
    started_at: datetime
    song_id: UUID | None = None
    mode: str | None = Field(default=None, pattern="^(melody|rhythm|listen|free)$")
    events: list[NoteEvent] = Field(max_length=200_000)


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
    started_at: datetime
    song_id: UUID | None
    mode: str | None
    summary: SessionSummary
