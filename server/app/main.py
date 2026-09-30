"""FastAPI entry point: `uvicorn app.main:app --reload`."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import make_asgi_app

from . import __version__
from .config import get_settings
from .routers import health, integrations, sessions
from .store import MemorySessionStore


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="MELOPHOS", version=__version__)
    app.state.store = MemorySessionStore()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(sessions.router)
    app.include_router(integrations.router)
    app.mount("/metrics", make_asgi_app())
    return app


app = create_app()
