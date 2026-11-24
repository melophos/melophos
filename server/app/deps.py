"""Shared request dependencies."""

from typing import Annotated, cast

from fastapi import Depends, Request

from .db import Pool
from .security import PasswordService
from .store import PgSessionStore


def get_pool(request: Request) -> Pool:
    return cast(Pool, request.app.state.pool)


def get_passwords(request: Request) -> PasswordService:
    return cast(PasswordService, request.app.state.passwords)


def get_store(request: Request) -> PgSessionStore:
    return cast(PgSessionStore, request.app.state.store)


PoolDep = Annotated[Pool, Depends(get_pool)]
Store = Annotated[PgSessionStore, Depends(get_store)]
PasswordsDep = Annotated[PasswordService, Depends(get_passwords)]
