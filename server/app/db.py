"""Connection pool and the migration runner.

Migrations are plain SQL files in db/migrations. Each runs once, inside one transaction and is recorded in
schema_migrations with a checksum. Running the runner again does nothing and a changed file that already ran
is refused so history cannot be rewritten quietly.
"""

import hashlib
import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

Row = dict[str, Any]
Pool = ConnectionPool[psycopg.Connection[Row]]

APP_ROLE = os.getenv("APP_DB_ROLE", "melophos_app")
OWNER_ROLE = os.getenv("OWNER_DB_ROLE", "melophos_owner")
LOCK_ID = 727_001  # arbitrary key for the advisory lock that serialises concurrent starts
BASELINE = "001_initial_schema.sql"


class MigrationError(RuntimeError):
    pass


def make_pool(url: str, max_size: int = 10) -> Pool:
    # the pool is opened by the app lifespan, a wait of 5 s stops a stuck database hanging every request
    return ConnectionPool(
        url,
        min_size=1,
        max_size=max_size,
        timeout=5,
        open=False,
        kwargs={"row_factory": dict_row, "connect_timeout": 5},
    )


@contextmanager
def connection(pool: Pool) -> Iterator[psycopg.Connection[Row]]:
    with pool.connection() as conn:
        yield conn


def migrations_dir() -> Path:
    configured = os.getenv("MIGRATIONS_DIR")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[1] / "db" / "migrations"


def _checksum(sql: str) -> str:
    return hashlib.sha256(sql.encode()).hexdigest()


def migrate(url: str, directory: Path | None = None, app_role: str = APP_ROLE) -> list[str]:
    """Apply every pending migration and return the names that ran."""
    directory = directory or migrations_dir()
    files = sorted(directory.glob("[0-9][0-9][0-9]_*.sql"))
    if not files:
        raise MigrationError(f"no migrations found in {directory}")
    applied_now: list[str] = []
    with psycopg.connect(url, autocommit=True, row_factory=dict_row, connect_timeout=5) as conn:
        conn.execute("SELECT pg_advisory_lock(%s)", (LOCK_ID,))
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                " name text PRIMARY KEY, checksum text NOT NULL,"
                " applied_at timestamptz NOT NULL DEFAULT now())"
            )
            _hide_migration_record(conn, app_role)
            recorded = {
                r["name"]: r["checksum"] for r in conn.execute("SELECT name, checksum FROM schema_migrations")
            }
            legacy = conn.execute("SELECT to_regclass('public.users') AS t").fetchone()
            if not recorded and legacy and legacy["t"]:
                # the old container init script ran 001 without recording it, so adopt that database
                first = directory / BASELINE
                conn.execute(
                    "INSERT INTO schema_migrations (name, checksum) VALUES (%s, %s)",
                    (BASELINE, _checksum(first.read_text())),
                )
                recorded[BASELINE] = _checksum(first.read_text())
            for path in files:
                sql = path.read_text()
                digest = _checksum(sql)
                if path.name in recorded:
                    if recorded[path.name] != digest:
                        raise MigrationError(
                            f"{path.name} changed after it was applied: add a new migration instead"
                        )
                    continue
                with conn.transaction():
                    conn.execute(sql)
                    conn.execute(
                        "INSERT INTO schema_migrations (name, checksum) VALUES (%s, %s)", (path.name, digest)
                    )
                applied_now.append(path.name)
            _protect_counters(conn, app_role)
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_ID,))
    return applied_now


def _hide_migration_record(conn: psycopg.Connection[Row], app_role: str) -> None:
    """The application role has no rights on the record of which migrations ran, so it cannot rewrite history."""
    exists = conn.execute("SELECT 1 AS ok FROM pg_roles WHERE rolname = %s", (app_role,)).fetchone()
    record = conn.execute("SELECT to_regclass('public.schema_migrations') AS t").fetchone()
    if exists and record and record["t"]:
        conn.execute(
            sql.SQL("REVOKE ALL ON TABLE schema_migrations FROM {}").format(sql.Identifier(app_role))
        )


def _protect_counters(conn: psycopg.Connection[Row], app_role: str) -> None:
    """The application may change a user's name and password hash and nothing else on that table, so it cannot
    touch the stored-events counter. The triggers that keep it run as the table owner."""
    exists = conn.execute("SELECT 1 AS ok FROM pg_roles WHERE rolname = %s", (app_role,)).fetchone()
    users = conn.execute("SELECT to_regclass('public.users') AS t").fetchone()
    if exists and users and users["t"]:
        app = sql.Identifier(app_role)
        conn.execute(sql.SQL("REVOKE UPDATE ON TABLE users FROM {}").format(app))
        conn.execute(sql.SQL("GRANT UPDATE (display_name, password_hash) ON TABLE users TO {}").format(app))


def ensure_roles(
    url: str,
    owner_password: str,
    app_password: str,
    owner_role: str = OWNER_ROLE,
    app_role: str = APP_ROLE,
) -> None:
    """Make the two database roles and give them exactly their rights. Safe to run on every start, on a new
    database and on one made by an older version, so existing installs are moved onto the limited role too.

    - the owner owns the database and every table and runs the migrations. It is not a superuser
    - the application role can read and write its tables and nothing else: no schema changes, no extensions, no
      roles and no rights at all on the migration record
    Run by a superuser, from the one-shot `db-roles` service. Extensions are created here because only a
    superuser may.
    """
    with psycopg.connect(url, autocommit=True, row_factory=dict_row, connect_timeout=5) as conn:
        database = conn.execute("SELECT current_database() AS d").fetchone()
        assert database is not None
        for role, password, extra in ((owner_role, owner_password, ""), (app_role, app_password, "")):
            exists = conn.execute("SELECT 1 AS ok FROM pg_roles WHERE rolname = %s", (role,)).fetchone()
            ident = sql.Identifier(role)
            if not exists:
                conn.execute(
                    sql.SQL("CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION").format(
                        ident
                    )
                )
            conn.execute(sql.SQL("ALTER ROLE {} PASSWORD {}").format(ident, sql.Literal(password)))
            assert not extra
        owner, app = sql.Identifier(owner_role), sql.Identifier(app_role)
        conn.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
        conn.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        conn.execute(sql.SQL("ALTER DATABASE {} OWNER TO {}").format(sql.Identifier(database["d"]), owner))
        conn.execute(sql.SQL("ALTER SCHEMA public OWNER TO {}").format(owner))
        # a database made by an older version has tables owned by the superuser. Move them to the owner
        rows = conn.execute(
            "SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
            " WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S', 'v') AND NOT EXISTS"
            " (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('e', 'a'))"
        ).fetchall()
        for row in rows:
            kind = "SEQUENCE" if row["relkind"] == "S" else "TABLE"
            conn.execute(
                sql.SQL("ALTER {} {} OWNER TO {}").format(
                    sql.SQL(kind), sql.Identifier(row["relname"]), owner
                )
            )
        conn.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(app))
        conn.execute(sql.SQL("REVOKE CREATE ON SCHEMA public FROM PUBLIC, {}").format(app))
        conn.execute(
            sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {}").format(app)
        )
        conn.execute(sql.SQL("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {}").format(app))
        # tables a later migration creates get the same four rights, so a new migration needs no manual grant
        conn.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {}"
            ).format(owner, app)
        )
        conn.execute(
            sql.SQL(
                "ALTER DEFAULT PRIVILEGES FOR ROLE {} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {}"
            ).format(owner, app)
        )
        _hide_migration_record(conn, app_role)
        _protect_counters(conn, app_role)


def least_privilege_problems(url: str) -> list[str]:
    """What the application's own connection can do that it should not. Empty when it has only its rights."""
    problems: list[str] = []
    with psycopg.connect(url, autocommit=True, row_factory=dict_row, connect_timeout=5) as conn:
        who = conn.execute(
            "SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, current_user AS name FROM pg_roles"
            " WHERE rolname = current_user"
        ).fetchone()
        assert who is not None
        for flag, why in (
            ("rolsuper", "is a superuser"),
            ("rolcreaterole", "can create roles"),
            ("rolcreatedb", "can create databases"),
            ("rolreplication", "can replicate"),
        ):
            if who[flag]:
                problems.append(f"{who['name']} {why}")
        if conn.execute("SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS ok").fetchone()[
            "ok"
        ]:  # type: ignore[index]
            problems.append("it can create objects in the public schema")
        owns = conn.execute(
            "SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user"
        ).fetchone()
        if owns and owns["n"]:
            problems.append("it owns tables, so it can change or drop them")
        record = conn.execute("SELECT to_regclass('public.schema_migrations') AS t").fetchone()
        if record and record["t"]:
            for right in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                allowed = conn.execute(
                    "SELECT has_table_privilege(current_user, 'public.schema_migrations', %s) AS ok", (right,)
                ).fetchone()
                if allowed and allowed["ok"]:
                    problems.append(f"it has {right} on the migration record")
    return problems


def check_least_privilege(url: str) -> None:
    problems = least_privilege_problems(url)
    if problems:
        raise RuntimeError(
            "refusing to start: the application's database login has more rights than it needs ("
            + "; ".join(problems)
            + "). Use the limited role from `python -m app.db roles`, see docs/self-hosting.md"
        )


def main() -> None:
    """`python -m app.db migrate` applies pending migrations as the owner. `python -m app.db roles` makes the
    roles as a superuser. Both are one-shot services in the compose file, so only they ever hold those logins."""
    import sys

    command = sys.argv[1] if len(sys.argv) > 1 else "migrate"
    if command == "roles":
        url = os.getenv("ROLES_DATABASE_URL", "")
        owner_password, app_password = (
            os.getenv("OWNER_ROLE_PASSWORD", ""),
            os.getenv("APP_ROLE_PASSWORD", ""),
        )
        if not (url and owner_password and app_password):
            raise SystemExit("ROLES_DATABASE_URL, OWNER_ROLE_PASSWORD and APP_ROLE_PASSWORD are needed")
        ensure_roles(url, owner_password, app_password)
        print("database roles are in place")
        return
    owner_url = os.getenv("MIGRATE_DATABASE_URL") or os.getenv("DATABASE_URL", "")
    if not owner_url:
        raise SystemExit("MIGRATE_DATABASE_URL is not set")
    done = migrate(owner_url)
    print("applied:", ", ".join(done) if done else "nothing to do")


def take_ingest_lock(url: str, instance: str) -> "psycopg.Connection[Row]":
    """Hold a database lock named for this ingest instance for as long as the returned connection stays open.

    Raises when another process already holds it, so two processes can never run ingest under one name (which would
    make them take each other's broker connection over, over and over). Give the second process its own
    MQTT_INSTANCE or set INGEST_ENABLED=false for a maintenance run.
    """
    conn: psycopg.Connection[Row] = psycopg.connect(
        url, autocommit=True, row_factory=dict_row, connect_timeout=5
    )
    row = conn.execute(
        "SELECT pg_try_advisory_lock(hashtextextended(%s, 7)) AS got", (f"ingest:{instance}",)
    ).fetchone()
    if not row or not row["got"]:
        conn.close()
        raise RuntimeError(
            f"another process is already running ingest as {instance}. Give this process its own MQTT_INSTANCE"
            " (it then shares the work) or set INGEST_ENABLED=false for a maintenance run"
        )
    return conn


if __name__ == "__main__":
    main()
