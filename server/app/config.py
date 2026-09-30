"""Settings read from the environment, see .env.example at the repository root."""

import os
from dataclasses import dataclass, field


def _split(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", ""))
    cors_origins: list[str] = field(
        default_factory=lambda: _split(os.getenv("CORS_ORIGINS", "http://localhost:5173"))
    )
    spotify_client_id: str = field(default_factory=lambda: os.getenv("SPOTIFY_CLIENT_ID", ""))
    spotify_redirect_uri: str = field(default_factory=lambda: os.getenv("SPOTIFY_REDIRECT_URI", ""))
    session_webhook_url: str = field(default_factory=lambda: os.getenv("SESSION_WEBHOOK_URL", ""))


def get_settings() -> Settings:
    return Settings()
