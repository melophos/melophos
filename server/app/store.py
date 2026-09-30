"""Session storage. In memory until the Postgres store behind the same protocol lands."""

from typing import Protocol, cast
from uuid import UUID, uuid4

from fastapi import Request

from .schemas import PracticeSessionIn, PracticeSessionOut
from .stats import summarise


class SessionStore(Protocol):
    def add(self, session: PracticeSessionIn) -> PracticeSessionOut: ...

    def get(self, session_id: UUID) -> PracticeSessionOut | None: ...

    def list(self, device_id: str | None = None) -> list[PracticeSessionOut]: ...


class MemorySessionStore:
    def __init__(self) -> None:
        self._sessions: dict[UUID, PracticeSessionOut] = {}

    def add(self, session: PracticeSessionIn) -> PracticeSessionOut:
        stored = PracticeSessionOut(
            id=uuid4(),
            device_id=session.device_id,
            profile_id=session.profile_id,
            started_at=session.started_at,
            song_id=session.song_id,
            mode=session.mode,
            summary=summarise(session.events),
        )
        self._sessions[stored.id] = stored
        return stored

    def get(self, session_id: UUID) -> PracticeSessionOut | None:
        return self._sessions.get(session_id)

    def list(self, device_id: str | None = None) -> list[PracticeSessionOut]:
        matching = [s for s in self._sessions.values() if device_id is None or s.device_id == device_id]
        return sorted(matching, key=lambda s: s.started_at, reverse=True)


def get_store(request: Request) -> SessionStore:
    return cast(SessionStore, request.app.state.store)
