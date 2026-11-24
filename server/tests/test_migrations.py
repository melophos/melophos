import shutil
from pathlib import Path

import psycopg
import pytest

from app.db import MigrationError, migrate, migrations_dir

from .conftest import scratch_database

pytestmark = pytest.mark.no_clean


@pytest.fixture()
def scratch_db():
    with scratch_database("melophos_test_mig_") as url:
        yield url


def recorded(url: str) -> list[str]:
    with psycopg.connect(url) as conn:
        return [r[0] for r in conn.execute("SELECT name FROM schema_migrations ORDER BY name")]


def test_every_migration_runs_once_and_is_recorded(scratch_db):
    first = migrate(scratch_db)
    assert first == sorted(p.name for p in migrations_dir().glob("[0-9]*.sql"))
    assert recorded(scratch_db) == first


def test_running_twice_changes_nothing(scratch_db):
    migrate(scratch_db)
    before = recorded(scratch_db)
    assert migrate(scratch_db) == []
    assert recorded(scratch_db) == before


def test_a_changed_applied_migration_is_refused(scratch_db, tmp_path: Path):
    shutil.copytree(migrations_dir(), tmp_path / "m")
    migrate(scratch_db, tmp_path / "m")
    first = next((tmp_path / "m").glob("001_*.sql"))
    first.write_text(first.read_text() + "\n-- edited later\n")
    with pytest.raises(MigrationError, match="changed after it was applied"):
        migrate(scratch_db, tmp_path / "m")


def test_a_failing_migration_leaves_no_partial_state(scratch_db, tmp_path: Path):
    shutil.copytree(migrations_dir(), tmp_path / "m")
    migrate(scratch_db, tmp_path / "m")
    (tmp_path / "m" / "999_broken.sql").write_text("CREATE TABLE half_done (x int); SELECT 1/0;")
    with pytest.raises(psycopg.errors.DivisionByZero):
        migrate(scratch_db, tmp_path / "m")
    with psycopg.connect(scratch_db) as conn:
        assert conn.execute("SELECT to_regclass('public.half_done')").fetchone()[0] is None
    assert "999_broken.sql" not in recorded(scratch_db)


def test_a_database_from_the_old_init_script_is_adopted(scratch_db, tmp_path: Path):
    # the compose file used to mount 001 into the container init folder, which ran it without a record
    with psycopg.connect(scratch_db, autocommit=True) as conn:
        conn.execute((migrations_dir() / "001_initial_schema.sql").read_text())  # type: ignore[arg-type]
    migrate(scratch_db)
    assert recorded(scratch_db)[0] == "001_initial_schema.sql"


def test_sessions_scored_before_the_hands_migration_go_back_in_the_queue(scratch_db, tmp_path: Path):
    shutil.copytree(migrations_dir(), tmp_path / "m")
    newest = tmp_path / "m" / "010_score_hands.sql"
    held_back = newest.read_text()
    newest.unlink()
    migrate(scratch_db, tmp_path / "m")  # an install as it was before the change
    with psycopg.connect(scratch_db, autocommit=True) as conn:
        conn.execute("INSERT INTO devices (id, name) VALUES ('hub-aaaaaaaaaa', 'h')")
        for state in ("scored", "pending", "none", "failed"):
            conn.execute(
                "INSERT INTO practice_sessions (device_id, profile_id, started_at, ended_at, score_state)"
                " VALUES ('hub-aaaaaaaaaa', 'p', now(), now(), %s)",
                (state,),
            )
        conn.execute("UPDATE practice_sessions SET accuracy = 0.5 WHERE score_state = 'scored'")
    newest.write_text(held_back)
    assert migrate(scratch_db, tmp_path / "m") == ["010_score_hands.sql"]
    with psycopg.connect(scratch_db) as conn:
        states = sorted(r[0] for r in conn.execute("SELECT score_state FROM practice_sessions"))
    assert states == [
        "failed",
        "none",
        "pending",
        "pending",
    ]  # the scored one is queued again, the rest are untouched
