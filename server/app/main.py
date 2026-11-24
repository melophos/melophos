"""FastAPI entry point: `uvicorn app.main:app`."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import make_asgi_app

from . import __version__
from .accounts import AccountStore
from .broker import BrokerAdmin, DynsecBroker, NullBroker
from .clock import announce_clock, check_clock, sync_status
from .config import Settings, check_secrets, get_settings
from .db import Row, check_least_privilege, make_pool, migrate, take_ingest_lock
from .ingest import IngestHandler
from .limits import BodyLimit, PeerWatch, ProtectedMetrics
from .mqtt_runner import MqttIngest
from .outbound import check_url, system_resolver
from .routers import auth, devices, health, integrations, sessions, songs, webhooks
from .scoring import choose_scorer, mark_pending_hook
from .security import Busy, PasswordService, RateLimiter
from .songs import SongStore
from .store import PgSessionStore
from .webhooks import SecretBox, WebhookStore, enqueue_hook


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    check_secrets(settings)
    check_clock()
    announce_clock(settings.clock_sync)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if settings.run_migrations:
            migrate(settings.migrations_url or settings.database_url)
        if not settings.allow_privileged_database:
            check_least_privilege(settings.database_url)
        if settings.session_webhook_url:
            if not settings.session_webhook_secret:
                raise RuntimeError("SESSION_WEBHOOK_SECRET is needed when SESSION_WEBHOOK_URL is set")
            check_url(
                settings.session_webhook_url,
                allow_private=settings.webhook_allow_private,
                resolver=app.state.resolver,
            )
        app.state.pool.open(wait=True, timeout=10)
        if settings.session_webhook_url:
            app.state.webhooks.ensure_operator(settings.session_webhook_url, settings.session_webhook_secret)
        ingest: MqttIngest | None = None
        lock: psycopg.Connection[Row] | None = None
        if isinstance(app.state.broker, DynsecBroker):
            app.state.broker.ensure_roles()
            if settings.ingest_enabled:
                # one process per instance name. The lock lives as long as this process, so a second one with the
                # same name is refused instead of taking the first one's broker connection over
                lock = take_ingest_lock(settings.database_url, settings.mqtt_instance)
                login = f"{settings.mqtt_username}-{settings.mqtt_instance}"
                app.state.broker.ensure_ingest_user(
                    login, settings.mqtt_password, clientid=login, group=settings.mqtt_group
                )
                ingest = MqttIngest(
                    settings.mqtt_host,
                    settings.mqtt_port,
                    login,
                    settings.mqtt_password,
                    IngestHandler(app.state.pool, app.state.store),
                    client_id=login,
                    group=settings.mqtt_group,
                    session_expiry=settings.mqtt_session_expiry,
                )
                ingest.start()
                app.state.ingest = ingest
        try:
            yield
        finally:
            if ingest:
                ingest.stop()
            if lock is not None:
                lock.close()
            app.state.pool.close()

    app = FastAPI(title="MELOPHOS", version=__version__, lifespan=lifespan)
    app.state.settings = settings

    @app.exception_handler(Busy)
    async def busy(_request: Request, _error: Busy) -> JSONResponse:
        return JSONResponse(
            {"detail": "the server is busy, try again in a moment"},
            status_code=503,
            headers={"Retry-After": "2"},
        )

    app.state.pool = make_pool(settings.database_url)
    app.state.store = PgSessionStore(app.state.pool)
    # sessions received while the clock is not synchronised are marked, so they can be found
    app.state.store.clock_unsynced = lambda: sync_status(settings.clock_sync) is False
    app.state.accounts = AccountStore(app.state.pool, settings.secret_key)
    app.state.limiter = RateLimiter(app.state.pool)
    app.state.passwords = PasswordService(settings.argon2_memory_kib, settings.argon2_time_cost)
    broker: BrokerAdmin = NullBroker()
    if settings.mqtt_host:
        if not (settings.mqtt_admin_username and settings.mqtt_admin_password and settings.mqtt_username):
            raise RuntimeError(
                "MQTT_HOST is set, so MQTT_USERNAME, MQTT_ADMIN_USERNAME and MQTT_ADMIN_PASSWORD are needed"
            )
        broker = DynsecBroker(
            settings.mqtt_host, settings.mqtt_port, settings.mqtt_admin_username, settings.mqtt_admin_password
        )
    app.state.broker = broker
    app.state.resolver = system_resolver
    app.state.songs = SongStore(app.state.pool)
    app.state.webhooks = WebhookStore(app.state.pool, SecretBox(settings.secret_key))
    app.state.scorer = choose_scorer(settings.allow_stand_in_scorer)
    app.state.store.finish_hooks.append(mark_pending_hook)
    app.state.store.finish_hooks.append(enqueue_hook)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.add_middleware(BodyLimit)
    app.add_middleware(PeerWatch, hops=settings.trusted_proxy_hops)
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(devices.router)
    app.include_router(sessions.router)
    app.include_router(songs.router)
    app.include_router(webhooks.router)
    app.include_router(integrations.router)
    app.mount("/metrics", ProtectedMetrics(make_asgi_app(), settings.metrics_token))
    return app


def app_factory() -> FastAPI:
    return create_app()
