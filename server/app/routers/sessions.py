from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response, status

from ..auth import AccountDep, DeviceDep, LimiterDep, access
from ..deps import Store
from ..schemas import NoteEvent, Page, PracticeSessionIn, PracticeSessionOut
from ..store import MAX_EVENT_PAGE, MAX_PAGE, BadCursor, StorageFull, UnknownSong

SESSIONS_PER_HOUR = 120  # per hub in any hour: more than a person can finish
router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])

Limit = Annotated[int | None, Query(ge=1, le=MAX_PAGE, description=f"Page size, at most {MAX_PAGE}")]
Cursor = Annotated[str | None, Query(max_length=256, description="`next_cursor` from the previous page")]


@router.post("", status_code=status.HTTP_201_CREATED, **access("device"))
def create_session(
    session: PracticeSessionIn, device: DeviceDep, store: Store, limiter: LimiterDep
) -> PracticeSessionOut:
    """A paired hub stores a finished session. The owner is the hub's owner, whatever the body says."""
    if session.device_id not in (None, device.id):
        raise HTTPException(status_code=403, detail="a hub can only store sessions for itself")
    if not limiter.hit(f"session-post:{device.id}", SESSIONS_PER_HOUR, 3600):
        raise HTTPException(status_code=429, detail="too many sessions", headers={"Retry-After": "600"})
    try:
        return store.add(session, device.id)
    except UnknownSong as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except StorageFull as error:
        raise HTTPException(status_code=413, detail=str(error)) from error


@router.get("", **access("account"))
def list_sessions(
    account: AccountDep,
    store: Store,
    device_id: str | None = None,
    limit: Limit = None,
    cursor: Cursor = None,
) -> Page[PracticeSessionOut]:
    try:
        return store.list(owner_id=account.id, device_id=device_id, limit=limit, cursor=cursor)
    except BadCursor as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/{session_id}", **access("account"))
def get_session(session_id: UUID, account: AccountDep, store: Store) -> PracticeSessionOut:
    session = store.get(session_id, account.id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT, **access("account"))
def delete_session(session_id: UUID, account: AccountDep, store: Store) -> Response:
    """Delete one session and its note events."""
    if not store.delete(session_id, account.id):
        raise HTTPException(status_code=404, detail="session not found")
    return Response(status_code=204)


@router.get("/{session_id}/events", **access("account"))
def session_events(
    session_id: UUID,
    account: AccountDep,
    store: Store,
    limit: Annotated[int | None, Query(ge=1, le=MAX_EVENT_PAGE)] = None,
    cursor: Cursor = None,
) -> Page[NoteEvent]:
    try:
        page = store.events(session_id, account.id, limit=limit, cursor=cursor)
    except BadCursor as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if page is None:
        raise HTTPException(status_code=404, detail="session not found")
    return page
