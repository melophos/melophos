"""Review finding H4: nothing public may be accepted as a secret and nothing is exposed by default."""

import re
import shutil
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest

from app.config import check_secrets, published_values, weak_secret
from app.main import create_app

DEPLOY = Path(__file__).resolve().parents[1] / "deploy"
EXAMPLE = DEPLOY / ".env.example"


def env_values(path: Path) -> dict[str, str]:
    out = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            out[key] = value
    return out


@pytest.mark.parametrize(
    "value",
    [
        "",
        "short",
        "change-me",
        "generate-a-long-random-string-of-at-least-32-characters",
        "a" * 40,
        "abababababababababababababababab12",
        "0123456789" * 4,
    ],
)
def test_weak_and_placeholder_secrets_are_refused(value):
    assert weak_secret(value, 32, published_values()) is not None


def test_a_long_random_secret_is_accepted():
    assert weak_secret("Kq3vN8xTz0LmW5RjY2bH7cD9fGaP4sUe6iOtV1nXwZ", 32) is None


def test_every_secret_in_the_example_file_is_refused():
    values = env_values(EXAMPLE)
    for key in (
        "SECRET_KEY",
        "MQTT_PASSWORD",
        "MQTT_ADMIN_PASSWORD",
        "POSTGRES_PASSWORD",
        "POSTGRES_APP_PASSWORD",
    ):
        assert weak_secret(values[key], 16, published_values()) is not None, key


def test_the_server_refuses_to_start_with_the_example_values(settings):
    values = env_values(EXAMPLE)
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_app(replace(settings, secret_key=values["SECRET_KEY"]))
    for field, key in (("mqtt_password", "MQTT_PASSWORD"), ("mqtt_admin_password", "MQTT_ADMIN_PASSWORD")):
        with pytest.raises(RuntimeError, match=key):
            create_app(
                replace(
                    settings,
                    mqtt_host="127.0.0.1",
                    mqtt_username="melophos-server",
                    mqtt_admin_username="melophos-admin",
                    **{
                        "mqtt_password": "x" * 0 + "Zq81LmXv0TgR5aYb3NcWd7",
                        "mqtt_admin_password": "Zq81LmXv0TgR5aYb3NcWd7",
                        field: values[key],
                    },
                )
            )


def test_a_short_secret_key_is_refused(settings):
    with pytest.raises(RuntimeError, match="shorter than 32"):
        check_secrets(replace(settings, secret_key="Kq3vN8xTz0LmW5RjY2bH7"))


def test_the_example_publishes_the_api_and_the_plain_broker_port_on_this_machine_only():
    compose = (DEPLOY / "docker-compose.yml").read_text()
    assert '"${API_BIND:-127.0.0.1}:${API_PORT:-8000}:8000"' in compose
    assert '"${MQTT_PLAIN_BIND:-127.0.0.1}:${MQTT_PLAIN_PORT:-1883}:1883"' in compose
    assert not re.search(r'^\s*- "(0\.0\.0\.0:)?(8000|1883|5432|6379|9001):', compose, re.M)
    assert env_values(EXAMPLE)["MQTT_PLAIN_BIND"] == "127.0.0.1"


@pytest.mark.skipif(shutil.which("openssl") is None, reason="openssl is needed to make random secrets")
def test_the_generator_makes_an_env_file_the_server_accepts(tmp_path):
    copy = tmp_path / "deploy"
    shutil.copytree(DEPLOY, copy, ignore=shutil.ignore_patterns("certs", "monitoring"))
    subprocess.run([str(copy / "generate-env.sh")], check=True, capture_output=True)
    made = env_values(copy / ".env")
    assert (copy / ".env").stat().st_mode & 0o077 == 0  # owner only
    for key in (
        "SECRET_KEY",
        "MQTT_PASSWORD",
        "MQTT_ADMIN_PASSWORD",
        "POSTGRES_PASSWORD",
        "POSTGRES_OWNER_PASSWORD",
        "METRICS_TOKEN",
        "GRAFANA_ADMIN_PASSWORD",
    ):
        assert weak_secret(made[key], 16, published_values()) is None, key
    assert "DATABASE_URL" not in made and "MIGRATIONS_DATABASE_URL" not in made  # each service builds its own
    assert (
        len({made[k] for k in ("POSTGRES_PASSWORD", "POSTGRES_OWNER_PASSWORD", "POSTGRES_APP_PASSWORD")}) == 3
    )
    # a second run does not overwrite it
    assert subprocess.run([str(copy / "generate-env.sh")], capture_output=True).returncode != 0
