"""Settings read from the environment, see deploy/.env.example."""

import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlsplit


def _split(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", ""))
    # the database owner's address, used only to apply migrations. DATABASE_URL then names a limited role that can
    # read and write its tables and nothing else. Empty means migrations use DATABASE_URL, which suits development
    migrations_url: str = field(default_factory=lambda: os.getenv("MIGRATIONS_DATABASE_URL", ""))
    cors_origins: list[str] = field(
        default_factory=lambda: _split(os.getenv("CORS_ORIGINS", "http://localhost:5173"))
    )
    spotify_client_id: str = field(default_factory=lambda: os.getenv("SPOTIFY_CLIENT_ID", ""))
    spotify_redirect_uri: str = field(default_factory=lambda: os.getenv("SPOTIFY_REDIRECT_URI", ""))
    session_webhook_url: str = field(default_factory=lambda: os.getenv("SESSION_WEBHOOK_URL", ""))
    session_webhook_secret: str = field(default_factory=lambda: os.getenv("SESSION_WEBHOOK_SECRET", ""))
    # signs stored secrets and pairing codes, so it must be long and never leave the server
    secret_key: str = field(default_factory=lambda: os.getenv("SECRET_KEY", ""))
    # how many reverse proxies sit in front of the server, so the client address is read from the right
    # place in X-Forwarded-For. 0 means the socket address is used and the header is ignored
    # X-Forwarded-For is believed only when the direct peer is one of these networks (the proxy), so a caller that
    # reaches the server directly cannot choose its own address
    trusted_proxy_cidrs: list[str] = field(
        default_factory=lambda: _split(
            os.getenv(
                "TRUSTED_PROXY_CIDRS", "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"
            )
        )
    )
    trusted_proxy_hops: int = field(default_factory=lambda: int(os.getenv("TRUSTED_PROXY_HOPS", "0")))
    migrations_dir: str = field(default_factory=lambda: os.getenv("MIGRATIONS_DIR", ""))
    # development and tests only: lets webhooks reach loopback and private addresses
    webhook_allow_private: bool = field(default_factory=lambda: _flag("WEBHOOK_ALLOW_PRIVATE"))
    # mqtt ingestion stays off while MQTT_HOST is empty
    mqtt_host: str = field(default_factory=lambda: os.getenv("MQTT_HOST", ""))
    mqtt_port: int = field(default_factory=lambda: int(os.getenv("MQTT_PORT", "1883")))
    # each server process needs an instance name of its own. The broker login and client id are built from it and the
    # broker keeps the process's queue under them
    # processes in one group share the hub traffic. The default is right for every real deployment
    mqtt_group: str = field(default_factory=lambda: os.getenv("MQTT_GROUP", "melophos-server"))
    mqtt_session_expiry: int = field(
        default_factory=lambda: int(os.getenv("MQTT_SESSION_EXPIRY", str(7 * 24 * 3600)))
    )
    mqtt_instance: str = field(default_factory=lambda: os.getenv("MQTT_INSTANCE", "main"))
    # false for a maintenance run (`docker compose run server ...`) that must not take ingest over
    ingest_enabled: bool = field(
        default_factory=lambda: os.getenv("INGEST_ENABLED", "true").lower() != "false"
    )
    mqtt_username: str = field(default_factory=lambda: os.getenv("MQTT_USERNAME", ""))
    mqtt_password: str = field(default_factory=lambda: os.getenv("MQTT_PASSWORD", ""))
    mqtt_admin_username: str = field(default_factory=lambda: os.getenv("MQTT_ADMIN_USERNAME", ""))
    mqtt_admin_password: str = field(default_factory=lambda: os.getenv("MQTT_ADMIN_PASSWORD", ""))
    allow_signup: bool = field(default_factory=lambda: os.getenv("ALLOW_SIGNUP", "true").lower() != "false")
    # auto asks the kernel whether the clock is synchronised. true or false override it (see app/clock.py)
    clock_sync: str = field(default_factory=lambda: os.getenv("CLOCK_SYNC", "auto").strip().lower() or "auto")
    # argon2id cost. The defaults are the OWASP minimum, tests lower them so the suite stays fast
    argon2_memory_kib: int = field(default_factory=lambda: int(os.getenv("ARGON2_MEMORY_KIB", "19456")))
    argon2_time_cost: int = field(default_factory=lambda: int(os.getenv("ARGON2_TIME_COST", "2")))
    # development only: lets the server start with the simple stand-in scorer when the engine is not installed
    allow_stand_in_scorer: bool = field(default_factory=lambda: _flag("ALLOW_STAND_IN_SCORER"))
    # false once migrations are run by their own one-shot service, as in the compose file
    run_migrations: bool = field(
        default_factory=lambda: os.getenv("RUN_MIGRATIONS", "true").lower() != "false"
    )
    # development only: lets the server start on a database login with more rights than it needs
    allow_privileged_database: bool = field(default_factory=lambda: _flag("ALLOW_PRIVILEGED_DATABASE"))
    metrics_token: str = field(default_factory=lambda: os.getenv("METRICS_TOKEN", ""))


def get_settings() -> Settings:
    return Settings()


# the words the example file and the documents use for a value that must be replaced
PLACEHOLDERS = (
    "change-me",
    "changeme",
    "generate-a-long",
    "replace-me",
    "your-secret",
    "example-secret",
)


def _entropy(text: str) -> float:
    counts = {c: text.count(c) for c in set(text)}
    return -sum(n / len(text) * math.log2(n / len(text)) for n in counts.values())


def weak_secret(value: str, minimum: int, published: frozenset[str] = frozenset()) -> str | None:
    """Why a secret is not acceptable or None. A published value is any value the example file or a document shows."""
    lowered = value.lower()
    if len(value) < minimum:
        return f"shorter than {minimum} characters"
    if value in published or any(word in lowered for word in PLACEHOLDERS):
        return "is a placeholder or an example value that is public"
    if len(set(value)) < 10 or _entropy(value) < 3.5:
        return "has too little variety to be random"
    return None


def published_values() -> frozenset[str]:
    """Every value the example file ships, so copying it unchanged is caught even if the words change."""
    configured = os.getenv("ENV_EXAMPLE_PATH")
    path = Path(configured) if configured else Path(__file__).resolve().parents[1] / "deploy" / ".env.example"
    if not path.is_file():
        return frozenset()
    values = set()
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            values.add(line.split("=", 1)[1].strip())
    return frozenset(v for v in values if v)


def check_secrets(settings: Settings) -> None:
    """Refuse to start with a missing, short, guessable or published secret. The message names the setting."""
    published = published_values()
    problems = []
    checks = [("SECRET_KEY", settings.secret_key, 32)]
    if settings.mqtt_host:
        checks += [
            ("MQTT_PASSWORD", settings.mqtt_password, 16),
            ("MQTT_ADMIN_PASSWORD", settings.mqtt_admin_password, 16),
        ]
    if settings.session_webhook_url:
        checks.append(("SESSION_WEBHOOK_SECRET", settings.session_webhook_secret, 16))
    for name, value, minimum in checks:
        why = weak_secret(value, minimum, published)
        if why:
            problems.append(f"{name} {why}")
    if settings.trusted_proxy_hops > 0 and not settings.trusted_proxy_cidrs:
        problems.append("TRUSTED_PROXY_HOPS needs TRUSTED_PROXY_CIDRS, the address the proxy connects from")
    for name, url in (
        ("DATABASE_URL", settings.database_url),
        ("MIGRATIONS_DATABASE_URL", settings.migrations_url),
    ):
        parts = urlsplit(url) if url else None
        if parts and parts.password and (parts.hostname or "") not in ("127.0.0.1", "localhost", "::1"):
            why = weak_secret(unquote(parts.password), 16, published)
            if why:
                problems.append(f"the password in {name} {why}")
    if problems:
        raise RuntimeError(
            "refusing to start: "
            + "; ".join(problems)
            + ". Run deploy/generate-env.sh to make .env with random values"
        )
