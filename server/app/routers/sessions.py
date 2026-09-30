from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from ..schemas import PracticeSessionIn, PracticeSessionOut
from ..store import SessionStore, get_store

router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])

Store = Annotated[SessionStore, Depends(get_store)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_session(session: PracticeSessionIn, store: Store) -> PracticeSessionOut:
    return store.add(session)


@router.get("")
def list_sessions(store: Store, device_id: str | None = None) -> list[PracticeSessionOut]:
    return store.list(device_id)


@router.get("/{session_id}")
def get_session(session_id: UUID, store: Store) -> PracticeSessionOut:
    session = store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session
