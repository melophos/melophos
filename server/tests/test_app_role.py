"""The application signs in as a limited role. Migrations run as an owner that is not a superuser. The roles used
here have names of their own, so a test run never touches a role a real server on the same cluster uses."""

import os
import secrets
import shutil
import subprocess
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import check_least_privilege, ensure_roles, least_privilege_problems, migrate
from app.main import create_app

from .conftest import ADMIN_URL, scratch_database
from .helpers import pair, send_session, sign_up

ADMIN_ROLE = urlsplit(ADMIN_URL).username or "postgres"  # the cluster's own superuser, from the test URL
OWNER_PASSWORD = "Wn40PzKs7RtUq2LcYh9XeB"
APP_PASSWORD = "Zq81LmXv0TgR5aYb3NcWd7"
DEPLOY = Path(__file__).resolve().parents[1] / "deploy"


def as_role(url, role, password):
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, f"{role}:{password}@{parts.hostname}:{parts.port}", parts.path, "", ""))


@contextmanager
def roles_world(upgrade=False):
    """A database made the way a deployment makes it. With upgrade=True it is first migrated by the superuser, which
    is how installs made by earlier versions look."""
    tag = secrets.token_hex(4)
    owner_role, app_role = f"mt_owner_{tag}", f"mt_app_{tag}"
    with scratch_database("melophos_test_role_") as super_url:
        if upgrade:
            migrate(super_url)
        ensure_roles(super_url, OWNER_PASSWORD, APP_PASSWORD, owner_role, app_role)
        owner_url = as_role(super_url, owner_role, OWNER_PASSWORD)
        migrate(owner_url, app_role=app_role)
        ensure_roles(
            super_url, OWNER_PASSWORD, APP_PASSWORD, owner_role, app_role
        )  # the second start changes nothing
        try:
            yield super_url, owner_url, as_role(super_url, app_role, APP_PASSWORD), owner_role, app_role
        finally:
            name = urlsplit(super_url).path.lstrip("/")
            with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
                conn.execute(f'ALTER DATABASE "{name}" OWNER TO "{ADMIN_ROLE}"')  # type: ignore[arg-type]
            with psycopg.connect(super_url, autocommit=True) as conn:
                conn.execute(f'REASSIGN OWNED BY "{owner_role}" TO "{ADMIN_ROLE}"')  # type: ignore[arg-type]
                for role in (app_role, owner_role):
                    conn.execute(f'DROP OWNED BY "{role}"')  # type: ignore[arg-type]
            with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
                for role in (app_role, owner_role):
                    conn.execute(f'DROP ROLE IF EXISTS "{role}"')  # type: ignore[arg-type]


@pytest.fixture()
def world():
    with roles_world() as w:
        yield w


def test_the_owner_is_not_a_superuser_and_still_ran_every_migration(world):
    _, owner_url, _, owner_role, _ = world
    with psycopg.connect(owner_url) as conn:
        assert (
            conn.execute("SELECT rolsuper FROM pg_roles WHERE rolname = current_user").fetchone()[0] is False
        )
        assert conn.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] >= 9
        assert (
            conn.execute("SELECT tableowner FROM pg_tables WHERE tablename = 'users'").fetchone()[0]
            == owner_role
        )


def test_the_application_runs_on_the_limited_role(world, settings):
    _, _, app_url, _, _ = world
    config = replace(settings, database_url=app_url, run_migrations=False, allow_privileged_database=False)
    with TestClient(create_app(config)) as c:
        person = sign_up(c)
        sid = send_session(c, pair(c, person))["id"]
        assert c.get(f"/api/v1/sessions/{sid}", headers=person.headers).status_code == 200
        assert (
            c.delete(f"/api/v1/sessions/{sid}", headers=person.headers).status_code == 204
        )  # the counters' triggers too
        assert c.get("/ready").status_code == 200


@pytest.mark.parametrize(
    "statement",
    [
        "DROP TABLE users",
        "CREATE TABLE evil (x int)",
        "CREATE EXTENSION IF NOT EXISTS hstore",
        "ALTER TABLE users ADD COLUMN x int",
        "CREATE ROLE sneaky",
        "ALTER ROLE CURRENT_USER SUPERUSER",
        "TRUNCATE users",
        "COPY users TO PROGRAM 'id'",
        "CREATE SCHEMA evil",
        "DELETE FROM schema_migrations",
        "UPDATE schema_migrations SET checksum = 'x'",
        "INSERT INTO schema_migrations (name, checksum) VALUES ('999_x.sql', 'x')",
        "SELECT * FROM schema_migrations",
        "DROP TABLE schema_migrations",
        "UPDATE users SET stored_events = -999999999",
        "UPDATE users SET stored_events = 999999999999",
        "UPDATE users SET email = 'x@example.test'",
        "UPDATE users SET id = gen_random_uuid()",
    ],
)
def test_the_limited_role_cannot_change_the_schema_or_the_migration_record(world, statement):
    _, _, app_url, _, _ = world
    with psycopg.connect(app_url, autocommit=True) as conn, pytest.raises(psycopg.errors.Error):
        conn.execute(statement)  # type: ignore[arg-type]


def test_the_limited_role_has_the_four_rights_on_its_tables(world):
    _, _, app_url, _, _ = world
    with psycopg.connect(app_url, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO users (email, display_name, password_hash) VALUES ('a@example.test', 'a', 'x')"
        )
        conn.execute("UPDATE users SET display_name = 'b'")
        assert conn.execute("SELECT count(*) FROM users").fetchone()[0] == 1
        conn.execute("DELETE FROM users")


def test_a_migration_added_later_is_usable_without_a_manual_grant(world):
    _, owner_url, app_url, _, _ = world
    with psycopg.connect(owner_url, autocommit=True) as conn:
        conn.execute("CREATE TABLE later_table (id serial PRIMARY KEY, v text)")
    with psycopg.connect(app_url, autocommit=True) as conn:
        conn.execute("INSERT INTO later_table (v) VALUES ('ok')")
        assert conn.execute("SELECT v FROM later_table").fetchone()[0] == "ok"


def test_the_start_up_check_passes_for_the_limited_role_and_names_every_extra_right(world, settings):
    super_url, owner_url, app_url, _, app_role = world
    assert least_privilege_problems(app_url) == []
    check_least_privilege(app_url)
    assert any("superuser" in p for p in least_privilege_problems(super_url))
    assert any("owns tables" in p for p in least_privilege_problems(owner_url))
    with psycopg.connect(super_url, autocommit=True) as conn:
        conn.execute(f'GRANT DELETE ON schema_migrations TO "{app_role}"')  # type: ignore[arg-type]
        conn.execute(f'GRANT CREATE ON SCHEMA public TO "{app_role}"')  # type: ignore[arg-type]
    problems = least_privilege_problems(app_url)
    assert any("DELETE on the migration record" in p for p in problems)
    assert any("create objects" in p for p in problems)
    with pytest.raises(RuntimeError, match="more rights than it needs"):
        check_least_privilege(app_url)


def test_the_server_refuses_to_start_on_a_login_with_more_rights(world, settings):
    super_url, _, app_url, _, _ = world
    strict = replace(settings, database_url=super_url, run_migrations=False, allow_privileged_database=False)
    with pytest.raises(RuntimeError, match="more rights than it needs"), TestClient(create_app(strict)):
        pass
    fine = replace(settings, database_url=app_url, run_migrations=False, allow_privileged_database=False)
    with TestClient(create_app(fine)) as c:
        assert c.get("/health").status_code == 200


def test_an_install_made_by_the_old_version_is_moved_onto_the_limited_role():
    """Upgrade: the superuser made every table and the application used it. One run of the roles step fixes it."""
    with roles_world(upgrade=True) as (super_url, owner_url, app_url, owner_role, app_role):
        with psycopg.connect(super_url) as conn:
            owners = {
                r[0] for r in conn.execute("SELECT tableowner FROM pg_tables WHERE schemaname = 'public'")
            }
            assert owners == {owner_role}
        assert least_privilege_problems(app_url) == []
        with psycopg.connect(app_url) as conn, pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("DELETE FROM schema_migrations")


@pytest.mark.skipif(
    shutil.which("docker") is None or shutil.which("openssl") is None, reason="docker and openssl are needed"
)
def test_only_the_one_shot_services_hold_the_owner_or_superuser_logins(tmp_path):
    copy = tmp_path / "deploy"
    shutil.copytree(DEPLOY, copy, ignore=shutil.ignore_patterns("certs"))
    shutil.copytree(DEPLOY.parent / "db", tmp_path / "db")
    subprocess.run([str(copy / "generate-env.sh")], check=True, capture_output=True)
    env = dict(
        line.split("=", 1)
        for line in (copy / ".env").read_text().splitlines()
        if "=" in line and not line.startswith("#")
    )
    done = subprocess.run(
        [
            "docker",
            "compose",
            "--env-file",
            str(copy / ".env"),
            "-f",
            str(copy / "docker-compose.yml"),
            "--profile",
            "monitoring",
            "config",
            "--format",
            "json",
        ],
        env={
            **os.environ,
            "MELOPHOS_SERVER_DIGEST": "sha256:" + "0" * 64,
            "MELOPHOS_MQTT_DIGEST": "sha256:" + "1" * 64,
        },
        capture_output=True,
        check=True,
        text=True,
    )
    import json

    services = json.loads(done.stdout)["services"]
    secret_values = {"owner": env["POSTGRES_OWNER_PASSWORD"], "super": env["POSTGRES_PASSWORD"]}
    holders = {
        name: [
            k
            for k, v in (s.get("environment") or {}).items()
            if v and any(x in str(v) for x in secret_values.values())
        ]
        for name, s in services.items()
    }
    assert {n for n, keys in holders.items() if keys} <= {"db", "db-roles", "migrate"}, holders
    for name in ("server", "worker"):
        assert services[name]["environment"]["DATABASE_URL"].startswith("postgresql://melophos_app:")
        assert services[name]["environment"]["RUN_MIGRATIONS"] == "false"
        assert "env_file" not in services[name]
        assert "MIGRATE_DATABASE_URL" not in services[name]["environment"]
        assert services[name]["depends_on"]["migrate"]["condition"] == "service_completed_successfully"
    assert services["migrate"]["depends_on"]["db-roles"]["condition"] == "service_completed_successfully"
    assert Settings  # imported for the type of the settings the services build


def test_the_limited_role_can_still_change_a_name_and_a_password_hash_and_the_triggers_still_count(
    world, settings
):
    _, _, app_url, _, _ = world
    with psycopg.connect(app_url, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO users (email, display_name, password_hash) VALUES ('n@example.test', 'n', 'x')"
        )
        conn.execute("UPDATE users SET display_name = 'new', password_hash = 'y'")
        assert conn.execute("SELECT display_name FROM users").fetchone()[0] == "new"
    config = replace(settings, database_url=app_url, run_migrations=False, allow_privileged_database=False)
    with TestClient(create_app(config)) as c:
        person = sign_up(c)
        hub = pair(c, person)
        sid = send_session(c, hub)["id"]
        assert c.get("/api/v1/auth/me", headers=person.headers).json()["events_used"] == 6
        c.delete(f"/api/v1/sessions/{sid}", headers=person.headers)
        assert c.get("/api/v1/auth/me", headers=person.headers).json()["events_used"] == 0
