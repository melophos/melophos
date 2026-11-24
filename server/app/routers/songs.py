from datetime import datetime
from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from ..auth import AccountDep, LimiterDep, access
from ..hands import EXPLANATIONS
from ..schemas import Page
from ..songs import MAX_CORRECTIONS, MAX_NOTE_PAGE, MAX_UPLOAD, LibraryFull, NotCorrectable, SongStore
from ..store import MAX_PAGE, BadCursor

router = APIRouter(prefix="/api/v1/songs", tags=["songs"])

UPLOAD_LIMIT = 20  # uploads per account per hour
MIDI_TYPES = {"audio/midi", "audio/x-midi", "audio/mid", "application/octet-stream", "application/x-midi"}


class SongOut(BaseModel):
    id: UUID
    title: str
    artist: str | None
    import_state: str = Field(description="queued, running, ready or failed")
    length_ms: int | None
    note_count: int | None
    difficulty: float | None = Field(
        description="1 (easy) to 10 (hard), see the README for how it is worked out"
    )
    hands_method: str | None
    hands_edited: bool = Field(description="True once the player has corrected the split")
    hands_explanation: str | None = Field(
        description="How the hands were split. The split is a first guess the player can correct"
    )
    import_error: str | None = Field(
        description="Why a failed import failed, in words the uploader can act on"
    )
    created_at: datetime


class SongNote(BaseModel):
    idx: int
    t_ms: int
    dur_ms: int
    note: int
    velocity: int
    hand: str


def library(request: Request) -> SongStore:
    return cast(SongStore, request.app.state.songs)


def out(row: dict[str, Any]) -> SongOut:
    method = row["hands_method"]
    keep = {k: row[k] for k in SongOut.model_fields if k in row}
    if method is None:
        explanation = None
    elif row["hands_edited"]:
        explanation = "You corrected this split. " + EXPLANATIONS.get(method, "")
    else:
        explanation = EXPLANATIONS.get(method, "") + " This is a first guess. You can correct it."
    return SongOut(**{**keep, "hands_explanation": explanation})


def clean_text(value: str | None, name: str, required: bool) -> str | None:
    text = (value or "").strip()
    if not text:
        if required:
            raise HTTPException(status_code=422, detail=f"{name} is required")
        return None
    if len(text) > 120 or any(not c.isprintable() for c in text):
        raise HTTPException(status_code=422, detail=f"{name} must be 120 printable characters or fewer")
    return text


@router.post("", status_code=status.HTTP_202_ACCEPTED, **access("account"))
async def upload_song(
    request: Request,
    account: AccountDep,
    limiter: LimiterDep,
    title: Annotated[str, Query(max_length=200)],
    artist: Annotated[str | None, Query(max_length=200)] = None,
) -> SongOut:
    """Upload a MIDI file as the request body (at most 1 MiB). It is parsed by the worker, so the answer is 202."""
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_UPLOAD:
        raise HTTPException(status_code=413, detail="the file is larger than 1 MiB")
    if request.headers.get("content-type", "").split(";")[0].strip().lower() not in MIDI_TYPES:
        raise HTTPException(
            status_code=415, detail="send the MIDI file as the body with Content-Type audio/midi"
        )
    clean_title = clean_text(title, "title", True)
    assert clean_title is not None
    clean_artist = clean_text(artist, "artist", False)
    if not await run_in_threadpool(limiter.hit, f"song-upload:{account.id}", UPLOAD_LIMIT, 3600):
        raise HTTPException(
            status_code=429, detail="too many uploads, try again later", headers={"Retry-After": "3600"}
        )
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > MAX_UPLOAD:
            raise HTTPException(status_code=413, detail="the file is larger than 1 MiB")
    if data[:4] != b"MThd":
        raise HTTPException(status_code=422, detail="this is not a MIDI file (it does not start with MThd)")
    try:
        row = await run_in_threadpool(
            library(request).add, account.id, clean_title, clean_artist, bytes(data)
        )
    except LibraryFull as error:
        raise HTTPException(status_code=409, detail="the library is full, delete a song first") from error
    return out(row)


@router.get("", **access("account"))
def list_songs(
    request: Request,
    account: AccountDep,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 50,
    cursor: Annotated[str | None, Query(max_length=256)] = None,
) -> Page[SongOut]:
    try:
        rows, nxt = library(request).list_for(account.id, limit, cursor)
    except BadCursor as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return Page(items=[out(r) for r in rows], next_cursor=nxt)


@router.get("/{song_id}", **access("account"))
def get_song(song_id: UUID, request: Request, account: AccountDep) -> SongOut:
    row = library(request).get(account.id, song_id)
    if row is None:
        raise HTTPException(status_code=404, detail="song not found")
    return out(row)


@router.get("/{song_id}/notes", **access("account"))
def song_notes(
    song_id: UUID,
    request: Request,
    account: AccountDep,
    limit: Annotated[int, Query(ge=1, le=MAX_NOTE_PAGE)] = 500,
    after: Annotated[int, Query(ge=-1)] = -1,
) -> dict[str, Any]:
    """The notes with their hand. `after` is the `next_after` of the previous page."""
    result = library(request).notes(account.id, song_id, limit, after)
    if result is None:
        raise HTTPException(status_code=404, detail="song not found")
    rows, nxt = result
    return {"items": [SongNote(**r) for r in rows], "next_after": nxt}


class HandChange(BaseModel):
    idx: int = Field(ge=0, description="The note's number, as given by the notes route")
    hand: Literal["left", "right"]


class HandCorrection(BaseModel):
    changes: list[HandChange] = Field(min_length=1, max_length=MAX_CORRECTIONS)


@router.put("/{song_id}/hands", **access("account"))
def correct_hands(song_id: UUID, body: HandCorrection, request: Request, account: AccountDep) -> SongOut:
    """Set the hand of the notes named. Other notes keep theirs. The split made at import is only a first guess, so
    the Studio offers this to the player. Send up to 50 000 changes."""
    try:
        row = library(request).correct_hands(account.id, song_id, {c.idx: c.hand for c in body.changes})
    except NotCorrectable as error:
        raise HTTPException(
            status_code=409 if "finished" in str(error) else 422, detail=str(error)
        ) from error
    if row is None:
        raise HTTPException(status_code=404, detail="song not found")
    return out(row)


@router.post("/{song_id}/hands/reset", **access("account"))
def reset_hands(song_id: UUID, request: Request, account: AccountDep) -> SongOut:
    """Undo every correction and go back to the split made at import."""
    row = library(request).reset_hands(account.id, song_id)
    if row is None:
        raise HTTPException(status_code=404, detail="song not found")
    return out(row)


@router.get("/{song_id}/file", **access("account"))
def song_file(song_id: UUID, request: Request, account: AccountDep) -> Response:
    data = library(request).file(account.id, song_id)
    if data is None:
        raise HTTPException(status_code=404, detail="song not found")
    # a fixed file name, so nothing from the upload is ever echoed into a header or a path
    return Response(
        data,
        media_type="audio/midi",
        headers={
            "Content-Disposition": f'attachment; filename="song-{song_id}.mid"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.delete("/{song_id}", status_code=status.HTTP_204_NO_CONTENT, **access("account"))
def delete_song(song_id: UUID, request: Request, account: AccountDep) -> Response:
    if not library(request).delete(account.id, song_id):
        raise HTTPException(status_code=404, detail="song not found")
    return Response(status_code=204)
