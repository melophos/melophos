"""Backup and restore against a real TimescaleDB, in an install folder of their own under a project name of their own.

The restore is attacked at every step. After each failure the running database must hold exactly what it held before
and no half-restored database may be left behind. A stand-in `docker` in front of the real one makes a chosen command
fail and it keeps the final start to the database service because these tests have no server images."""

import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[1]
DEPLOY = SERVER / "deploy"
PROJECT = "melophos-rtest"
# the first line of every file age writes, from the age v1 format specification
AGE_HEADER = b"age-encryption.org/v1"
REAL_DOCKER = shutil.which("docker")

pytestmark = [pytest.mark.no_clean, pytest.mark.skipif(REAL_DOCKER is None, reason="docker is needed")]

SHIM = """#!/bin/sh
args="$*"
echo "$args" >> "${SHIM_LOG:-/dev/null}"
if [ -n "${FAIL_AT:-}" ]; then
    case "$args" in
        *"$FAIL_AT"*)
            n="$(cat "$FAIL_COUNT" 2> /dev/null || echo 0)"
            n=$((n + 1))
            echo "$n" > "$FAIL_COUNT"
            if [ "$n" -eq "${FAIL_NTH:-1}" ] || { [ -n "${FAIL_FROM:-}" ] && [ "$n" -ge "${FAIL_NTH:-1}" ]; }; then echo "injected failure at: $FAIL_AT" >&2; exit 1; fi ;;
    esac
fi
# this test has no server or worker image. The stand-in says they are running so that the restore stops them and has
# to start them again and it records the start. The real thing is shown on a full stack by hand (see the journal)
if [ -n "${FAKE_RUNNING:-}" ]; then
    case "$args" in
        *"ps --status running --services"*) printf 'db\nserver\nworker\n'; exit 0 ;;
        *" start server worker"*) echo "STARTED-SERVER-AND-WORKER" >> "${SHIM_LOG:-/dev/null}"; exit 0 ;;
    esac
fi
case "$args" in
    *"up -d --wait") exec REAL "$@" db ;;
esac
exec REAL "$@"
"""


def run(*args, cwd=None, env=None, input_text=None, timeout=None):
    return subprocess.run(
        list(args), capture_output=True, text=True, cwd=cwd, env=env, input=input_text, timeout=timeout
    )


class Stack:
    def __init__(self, folder: Path, shims: Path, project: str = PROJECT):
        self.project = project
        self.dir = folder
        self.shims = shims
        self.count = shims / "count"
        (shims / "docker").write_text(SHIM.replace("REAL", REAL_DOCKER or "docker"))
        (shims / "docker").chmod(0o755)

    def env(self, **extra):
        return {
            **os.environ,
            "PATH": f"{self.shims}:{os.environ['PATH']}",
            "COMPOSE_PROJECT_NAME": self.project,
            "FAIL_COUNT": str(self.count),
            "SHIM_LOG": str(self.shims / "calls.log"),
            "FAKE_RUNNING": "1",
            **extra,
        }

    def calls(self):
        log = self.shims / "calls.log"
        return log.read_text() if log.exists() else ""

    def dump_left_in_container(self):
        done = run(
            "docker", "compose", "--env-file", ".env", "-f", "docker-compose.yml", "exec", "-T", "db", "sh", "-c",
            "ls /tmp/restore.dump /tmp/restore.list 2>/dev/null", cwd=self.dir, env={**os.environ, "COMPOSE_PROJECT_NAME": self.project},
        )  # fmt: skip
        return done.stdout.strip()

    def script(self, name, *args, answer=None, timeout=None, **extra):
        (self.shims / "calls.log").unlink(missing_ok=True)
        if self.count.exists():
            self.count.unlink()
        return run(
            "sh",
            str(self.dir / name),
            *args,
            cwd=self.dir,
            env=self.env(**extra),
            input_text=answer,
            timeout=timeout,
        )

    def env_value(self, key):
        return re.search(rf"^{key}=(.*)$", (self.dir / ".env").read_text(), re.M).group(1)

    def sql(self, query, database=None):
        done = run(
            "docker", "compose", "--env-file", ".env", "-f", "docker-compose.yml", "exec", "-T", "db", "psql", "-tAX",
            "-U", self.env_value("POSTGRES_USER"), "-d", database or self.env_value("POSTGRES_DB"), "-c", query,
            cwd=self.dir, env={**os.environ, "COMPOSE_PROJECT_NAME": self.project},
        )  # fmt: skip
        assert done.returncode == 0, done.stderr
        return done.stdout.strip()

    def databases(self):
        return set(self.sql("SELECT datname FROM pg_database", "postgres").split())

    def seed(self, label: str):
        self.sql(
            "DROP TABLE IF EXISTS marker; CREATE TABLE marker (label text); "
            f"INSERT INTO marker VALUES ('{label}'); "
            "DROP TABLE IF EXISTS readings; CREATE TABLE readings (t timestamptz NOT NULL, v int); "
            "SELECT create_hypertable('readings', 't'); "
            f"INSERT INTO readings SELECT now() - (g || ' minutes')::interval, g FROM generate_series(1, 50) g"
        )

    def state(self):
        return self.sql("SELECT (SELECT string_agg(label, ',') FROM marker), (SELECT count(*) FROM readings)")

    def backups(self):
        return (
            sorted((self.dir / "backups").glob("melophos-*.version"))
            if (self.dir / "backups").exists()
            else []
        )

    def drop_leftovers(self):
        for name in self.databases():
            if "_replaced_" in name or "_restore_" in name or name.startswith("scratch_"):
                self.sql(f'DROP DATABASE "{name}" WITH (FORCE)', "postgres")


def make_stack(tmp_path_factory, project, small_volume_mb=None):
    base = tmp_path_factory.mktemp("restore")
    out = base / "release"
    done = run(
        str(DEPLOY / "pin-release.sh"), "--version", "v1.2.3", "--server-digest", "sha256:" + "a" * 64,
        "--mqtt-digest", "sha256:" + "b" * 64, "--registry", "127.0.0.1:26999/melophos", "--out", str(out),
    )  # fmt: skip
    assert done.returncode == 0, done.stderr
    folder = base / "install"
    folder.mkdir()
    for name, dest in (
        ("docker-compose.yml", None),
        ("generate-env.sh", None),
        ("env.example", ".env.example"),
        ("backup.sh", None),
        ("restore.sh", None),
    ):
        shutil.copy(out / name, folder / (dest or name))
    (folder / "VERSION").write_text("v1.2.3\n")
    assert run("sh", str(folder / "generate-env.sh")).returncode == 0
    shims = base / "shims"
    shims.mkdir()
    if small_volume_mb:
        # a volume of a fixed small size, so that a restore can really run out of room
        run("docker", "volume", "rm", "-f", f"{project}_db-data")
        made = run(
            "docker",
            "volume",
            "create",
            "--driver",
            "local",
            "--opt",
            "type=tmpfs",
            "--opt",
            "device=tmpfs",
            "--opt",
            f"o=size={small_volume_mb}m",
            f"{project}_db-data",
        )
        assert made.returncode == 0, made.stderr
    s = Stack(folder, shims, project)
    up = run(
        "docker",
        "compose",
        "--env-file",
        ".env",
        "-f",
        "docker-compose.yml",
        "up",
        "-d",
        "--wait",
        "db",
        cwd=folder,
        env={**os.environ, "COMPOSE_PROJECT_NAME": project},
    )
    assert up.returncode == 0, up.stderr
    for _ in range(20):
        try:
            s.sql("SELECT 1")
            break
        except AssertionError:
            time.sleep(1)
    yield s
    run(
        "docker",
        "compose",
        "--env-file",
        ".env",
        "-f",
        "docker-compose.yml",
        "down",
        "-v",
        cwd=folder,
        env={**os.environ, "COMPOSE_PROJECT_NAME": project},
    )


@pytest.fixture(scope="module")
def stack(tmp_path_factory):
    yield from make_stack(tmp_path_factory, PROJECT)


@pytest.fixture(scope="module")
def small_stack(tmp_path_factory):
    yield from make_stack(tmp_path_factory, "melophos-rfull", small_volume_mb=220)


@pytest.fixture()
def fresh(stack):
    """Starts each test from known data, with no backups and no leftover databases."""
    shutil.rmtree(stack.dir / "backups", ignore_errors=True)
    for leftover in stack.dir.glob(".env.before-restore*"):
        leftover.unlink()
    stack.drop_leftovers()
    stack.seed("original")
    yield stack
    stack.drop_leftovers()


def backup(stack, *args, **extra):
    done = stack.script("backup.sh", "--allow-missing-broker", *args, **extra)
    assert done.returncode == 0, done.stderr + done.stdout
    return Path(stack.dir / re.search(r"backup written: (\S+)", done.stdout).group(1))


def test_a_backup_holds_the_dump_the_env_and_the_version_and_is_private(fresh):
    base = backup(fresh)
    for suffix in (".dump", ".env", ".version"):
        assert Path(f"{base}{suffix}").stat().st_size > 0, suffix
    assert (fresh.dir / "backups").stat().st_mode & 0o077 == 0
    assert (
        Path(f"{base}.env").stat().st_mode & 0o077 == 0 and Path(f"{base}.dump").stat().st_mode & 0o077 == 0
    )
    version = Path(f"{base}.version").read_text()
    assert "version=v1.2.3" in version and "melophos-server@sha256:" in version and "encrypted=no" in version
    assert Path(f"{base}.env").read_text() == (fresh.dir / ".env").read_text()


def test_a_backup_that_cannot_be_taken_leaves_no_files(fresh):
    done = fresh.script("backup.sh", "--allow-missing-broker", FAIL_AT="pg_dump")
    assert done.returncode != 0 and "could not take dump" in done.stderr
    assert not list((fresh.dir / "backups").glob("melophos-*")) and not list(
        (fresh.dir / "backups").glob(".partial*")
    )


def test_a_backup_without_the_broker_refuses_unless_told_otherwise(fresh):
    done = fresh.script("backup.sh")
    assert done.returncode != 0 and "broker is not running" in done.stderr
    assert not list((fresh.dir / "backups").glob("melophos-*"))


def test_a_restore_brings_the_data_back_and_keeps_the_database_it_replaced(fresh):
    base = backup(fresh)
    fresh.sql("DELETE FROM marker; INSERT INTO marker VALUES ('changed'); DELETE FROM readings")
    assert fresh.state() == "changed|0"
    done = fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n")
    assert done.returncode == 0, done.stderr + done.stdout
    assert fresh.state() == "original|50"
    assert (
        fresh.sql(
            "SELECT count(*) FROM timescaledb_information.hypertables WHERE hypertable_name = 'readings'"
        )
        == "1"
    )
    names = fresh.databases()
    assert any("_replaced_" in n for n in names) and not any("_restore_" in n for n in names)
    old = next(n for n in names if "_replaced_" in n)
    assert fresh.sql("SELECT label FROM marker", old) == "changed"  # nothing was deleted
    assert list(
        (fresh.dir / "backups").glob("pre-restore-melophos-*.dump")
    )  # the safety backup of the data it replaced
    assert "restored" in done.stdout and "DROP DATABASE" in done.stdout


def test_the_restore_asks_first_and_does_nothing_without_a_yes(fresh):
    base = backup(fresh)
    fresh.sql("INSERT INTO marker VALUES ('later')")
    before = fresh.state()
    done = fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="no\n")
    assert done.returncode != 0 and "did not type yes" in done.stderr
    assert fresh.state() == before and not any("_restore_" in n for n in fresh.databases())
    assert not list((fresh.dir / "backups").glob("pre-restore-*"))


def test_a_damaged_dump_is_refused_before_anything_changes(fresh):
    base = backup(fresh)
    dump = Path(f"{base}.dump")
    dump.write_bytes(dump.read_bytes()[:200])
    fresh.sql("INSERT INTO marker VALUES ('later')")
    before = fresh.state()
    done = fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n")
    assert (
        done.returncode != 0
        and "not a readable backup" in done.stderr
        and "Nothing was changed" in done.stderr
    )
    assert fresh.state() == before and not any(
        "_restore_" in n or "_replaced_" in n for n in fresh.databases()
    )
    assert not list((fresh.dir / "backups").glob("pre-restore-*"))


def test_a_file_that_is_not_a_dump_is_refused(fresh):
    base = backup(fresh)
    Path(f"{base}.dump").write_text("this is not a database dump\n")
    done = fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n")
    assert done.returncode != 0 and "not a readable backup" in done.stderr


@pytest.mark.parametrize(
    ("step", "fail_at", "nth"),
    [
        ("copying the dump in", "cp ", 1),
        ("reading the dump", "pg_restore --list", 1),
        ("the safety backup", "pg_dump", 1),
        ("making the new database", "CREATE DATABASE", 1),
        ("preparing the new database", "timescaledb_pre_restore", 1),
        ("the restore itself", "--exit-on-error", 1),
        ("finishing the restore", "timescaledb_post_restore", 1),
        ("clearing the old connections", "pg_terminate_backend", 1),
        ("setting the old database aside", 'RENAME TO "melophos_replaced_', 1),
    ],
)
def test_a_failure_at_every_step_leaves_the_running_database_as_it_was_and_the_stack_up(
    fresh, step, fail_at, nth
):
    base = backup(fresh)
    fresh.sql("INSERT INTO marker VALUES ('later')")
    before = fresh.state()
    done = fresh.script(
        "restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n", FAIL_AT=fail_at, FAIL_NTH=str(nth)
    )
    assert done.returncode != 0, step
    assert "stopped:" in done.stderr and "injected failure" in done.stderr, (step, done.stderr)
    assert fresh.state() == before, step  # serving the old data
    assert not any("_restore_" in n or "_replaced_" in n for n in fresh.databases()), step
    assert not list(fresh.dir.glob(".env.before-restore*")), step
    assert fresh.dump_left_in_container() == "", (
        step
    )  # the plain dump is not left inside the database service
    calls = fresh.calls()
    stopped = "stop server worker" in calls
    # whatever was stopped is started again and nothing is started that was not stopped
    assert ("STARTED-SERVER-AND-WORKER" in calls) == stopped, (step, calls)
    if step in {
        "making the new database",
        "preparing the new database",
        "the restore itself",
        "finishing the restore",
        "clearing the old connections",
        "setting the old database aside",
    }:
        assert stopped, step


def test_a_failure_in_the_second_rename_puts_the_first_back_and_says_so_only_after_checking(fresh):
    base = backup(fresh)
    fresh.sql("INSERT INTO marker VALUES ('later')")
    before = fresh.state()
    # the second rename is the first command that renames something to the plain name. Its undo is the second match
    done = fresh.script(
        "restore.sh",
        str(base.relative_to(fresh.dir)),
        answer="yes\n",
        FAIL_AT='RENAME TO "melophos"',
        FAIL_NTH="1",
    )
    assert done.returncode != 0 and "The old one is back, checked" in done.stderr
    assert fresh.state() == before
    assert not any("_restore_" in n or "_replaced_" in n for n in fresh.databases())
    assert "STARTED-SERVER-AND-WORKER" in fresh.calls()


def test_when_the_old_database_cannot_be_put_back_it_is_not_claimed_to_be_and_nothing_is_started(fresh):
    base = backup(fresh)
    fresh.sql("INSERT INTO marker VALUES ('later')")
    done = fresh.script(
        "restore.sh",
        str(base.relative_to(fresh.dir)),
        answer="yes\n",
        FAIL_AT='RENAME TO "melophos"',
        FAIL_NTH="1",
        FAIL_FROM="1",
    )
    assert done.returncode != 0 and "could not put the old one back" in done.stderr
    assert "The old one is back" not in done.stderr
    assert (
        "RENAME TO" in done.stderr and "melophos_replaced_" in done.stderr
    )  # the exact command that restores it
    assert "STARTED-SERVER-AND-WORKER" not in fresh.calls()
    old = next(n for n in fresh.databases() if "_replaced_" in n)
    assert (
        fresh.sql("SELECT string_agg(label, ',') FROM marker", old) == "original,later"
    )  # the data is safe under its new name
    assert "melophos" not in fresh.databases()
    fresh.sql(f'ALTER DATABASE "{old}" RENAME TO "melophos"', "postgres")  # the command the message gives


def test_a_second_restore_never_overwrites_the_env_kept_by_the_first(fresh):
    base = backup(fresh)
    env = fresh.dir / ".env"
    original = env.read_text()
    saved = fresh.env_value("SECRET_KEY")
    for n in (1, 2):
        env.write_text(
            original.replace(f"SECRET_KEY={saved}", f"SECRET_KEY=another-key-{n}-0123456789-0123456789")
        )
        time.sleep(1.1)  # the names carry the time to the second
        assert fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n").returncode == 0
    kept = sorted(fresh.dir.glob(".env.before-restore-*"))
    assert len(kept) == 2
    assert "another-key-1-" in kept[0].read_text() and "another-key-2-" in kept[1].read_text()
    assert all(p.stat().st_mode & 0o077 == 0 for p in kept)
    env.write_text(original)


def test_the_restore_removes_the_dump_from_the_database_service_after_a_good_run_too(fresh):
    base = backup(fresh)
    assert fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n").returncode == 0
    assert fresh.dump_left_in_container() == ""


def test_a_dump_that_lists_fine_but_cannot_be_restored_leaves_everything_alone(fresh):
    """A column of a type from an extension the new database does not have: the list is readable and the restore fails."""
    fresh.sql("CREATE DATABASE scratch_x", "postgres")
    fresh.sql(
        "CREATE EXTENSION hstore; CREATE TABLE h (d hstore); INSERT INTO h VALUES ('a=>1')", "scratch_x"
    )
    bad = subprocess.run(
        ["docker", "compose", "--env-file", ".env", "-f", "docker-compose.yml", "exec", "-T", "db", "pg_dump", "-U", fresh.env_value("POSTGRES_USER"), "-Fc", "scratch_x"],
        cwd=fresh.dir, env={**os.environ, "COMPOSE_PROJECT_NAME": PROJECT}, capture_output=True,
    )  # fmt: skip
    assert bad.returncode == 0
    base = backup(fresh)
    Path(f"{base}.dump").write_bytes(bad.stdout)
    fresh.sql("INSERT INTO marker VALUES ('later')")
    before = fresh.state()
    done = fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n")
    assert done.returncode != 0 and "the restore failed" in done.stderr
    assert fresh.state() == before
    assert not any("_restore_" in n or "_replaced_" in n for n in fresh.databases())


def set_version(base: Path, version: str):
    Path(f"{base}.version").write_text(f"version={version}\ncreated=20260101T000000Z\n")


@pytest.mark.parametrize(
    ("saved", "words"),
    [
        ("v1.3.0", "newer than this install"),
        ("v2.0.0", "newer than this install"),
        ("local", "cannot be compared"),
        ("unknown", "cannot be compared"),
    ],
)
def test_a_backup_from_a_newer_or_unknown_version_is_refused_with_a_plain_message(fresh, saved, words):
    base = backup(fresh)
    set_version(base, saved)
    before = fresh.state()
    done = fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n")
    assert done.returncode != 0 and words in done.stderr and "Nothing was changed" in done.stderr
    assert fresh.state() == before


def test_a_backup_from_an_older_version_is_restored_with_a_note(fresh):
    base = backup(fresh)
    set_version(base, "v1.0.9")
    fresh.sql("DELETE FROM marker")
    done = fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n")
    assert done.returncode == 0, done.stderr
    assert "Migrations bring the data forward" in done.stdout and fresh.state() == "original|50"


def test_a_backup_with_no_version_file_is_refused(fresh):
    base = backup(fresh)
    Path(f"{base}.version").unlink()
    done = fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n")
    assert done.returncode != 0 and "does not say which version" in done.stderr


def test_the_secret_key_comes_from_the_saved_env_and_the_old_env_is_kept(fresh):
    base = backup(fresh)
    saved = fresh.env_value("SECRET_KEY")
    env = fresh.dir / ".env"
    env.write_text(
        env.read_text().replace(
            f"SECRET_KEY={saved}", "SECRET_KEY=another-key-from-another-install-0123456789"
        )
    )
    other_password = fresh.env_value("POSTGRES_PASSWORD")
    done = fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n")
    assert done.returncode == 0, done.stderr
    assert fresh.env_value("SECRET_KEY") == saved and fresh.env_value("POSTGRES_PASSWORD") == other_password
    assert "another-key-from-another-install" in next(fresh.dir.glob(".env.before-restore-*")).read_text()
    assert env.stat().st_mode & 0o077 == 0


def test_a_backup_without_a_secret_key_in_its_env_is_refused(fresh):
    base = backup(fresh)
    env_copy = Path(f"{base}.env")
    env_copy.write_text(
        "\n".join(line for line in env_copy.read_text().splitlines() if not line.startswith("SECRET_KEY="))
        + "\n"
    )
    done = fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n")
    assert done.returncode != 0 and "no SECRET_KEY" in done.stderr


def test_the_env_file_is_read_as_text_and_never_run_as_code(fresh):
    env = fresh.dir / ".env"
    original = env.read_text()
    env.write_text(
        original
        + "WEIRD=a b; touch pwned-one\nEVIL=$(touch pwned-two)\nAMP=x&y\nBACKTICK=`touch pwned-three`\n"
    )
    base = backup(fresh)
    done = fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n")
    assert done.returncode == 0, done.stderr
    assert not any(p.name.startswith("pwned") for p in fresh.dir.iterdir())
    env.write_text(original)


# encryption with age


needs_age = pytest.mark.skipif(
    shutil.which("age") is None or shutil.which("age-keygen") is None, reason="age is not installed"
)


@pytest.fixture()
def age_key(tmp_path):
    key = tmp_path / "key.txt"
    done = run("age-keygen", "-o", str(key))
    assert done.returncode == 0, done.stderr
    recipient = re.search(r"(age1\S+)", done.stderr + key.read_text()).group(1)
    other = tmp_path / "other.txt"
    run("age-keygen", "-o", str(other))
    return key, recipient, other


@needs_age
def test_an_encrypted_backup_holds_no_plain_text_and_restores_with_the_key(fresh, age_key):
    key, recipient, _ = age_key
    base = backup(fresh, "--encrypt", recipient)
    assert not Path(f"{base}.dump").exists() and not Path(f"{base}.env").exists()
    for suffix in (".dump.age", ".env.age"):
        data = Path(f"{base}{suffix}").read_bytes()
        # the first line of an age file is its format header, compared whole: it is a file format, not a web address
        assert (
            data.split(b"\n", 1)[0] == AGE_HEADER
            and fresh.env_value("SECRET_KEY").encode() not in data
            and b"PGDMP" not in data
        )
    assert "encrypted=yes" in Path(f"{base}.version").read_text()
    fresh.sql("DELETE FROM marker; INSERT INTO marker VALUES ('changed')")
    refused = fresh.script("restore.sh", str(base.relative_to(fresh.dir)), answer="yes\n")
    assert refused.returncode != 0 and "--identity" in refused.stderr and fresh.state().startswith("changed")
    done = fresh.script(
        "restore.sh", str(base.relative_to(fresh.dir)), "--identity", str(key), answer="yes\n"
    )
    assert done.returncode == 0, done.stderr + done.stdout
    assert fresh.state() == "original|50"


@needs_age
def test_the_wrong_key_stops_the_restore_before_anything_changes(fresh, age_key):
    _, recipient, other = age_key
    base = backup(fresh, "--encrypt", recipient)
    fresh.sql("INSERT INTO marker VALUES ('later')")
    before = fresh.state()
    done = fresh.script(
        "restore.sh", str(base.relative_to(fresh.dir)), "--identity", str(other), answer="yes\n"
    )
    assert done.returncode != 0 and "could not decrypt" in done.stderr and fresh.state() == before


@needs_age
def test_restoring_an_encrypted_backup_encrypts_the_safety_backup_for_the_same_key(fresh, age_key):
    key, recipient, _ = age_key
    base = backup(fresh, "--encrypt", recipient)
    done = fresh.script(
        "restore.sh", str(base.relative_to(fresh.dir)), "--identity", str(key), answer="yes\n"
    )
    assert done.returncode == 0, done.stderr
    safety = list((fresh.dir / "backups").glob("pre-restore-melophos-*"))
    assert safety and all(p.suffix == ".age" or p.name.endswith(".version") for p in safety), safety


@needs_age
def test_the_safety_backup_of_a_restore_can_be_encrypted_too(fresh, age_key):
    key, recipient, _ = age_key
    base = backup(fresh, "--encrypt", recipient)
    done = fresh.script(
        "restore.sh",
        str(base.relative_to(fresh.dir)),
        "--identity",
        str(key),
        "--encrypt",
        recipient,
        answer="yes\n",
    )
    assert done.returncode == 0, done.stderr
    assert list((fresh.dir / "backups").glob("pre-restore-melophos-*.dump.age")) and not list(
        (fresh.dir / "backups").glob("pre-restore-melophos-*.dump")
    )


@needs_age
def test_a_recipients_file_with_a_space_in_its_path_works(fresh, age_key, tmp_path):
    key, recipient, _ = age_key
    folder = tmp_path / "my keys"
    folder.mkdir()
    recipients = folder / "recipients file.txt"
    recipients.write_text(recipient + "\n")
    base = backup(fresh, "--encrypt", str(recipients))
    assert Path(f"{base}.dump.age").stat().st_size > 0 and not Path(f"{base}.dump").exists()
    fresh.sql("DELETE FROM marker")
    done = fresh.script(
        "restore.sh", str(base.relative_to(fresh.dir)), "--identity", str(key), answer="yes\n"
    )
    assert done.returncode == 0, done.stderr
    assert fresh.state() == "original|50"


def test_asking_for_encryption_without_age_installed_says_so_and_writes_nothing(fresh, tmp_path):
    bare = tmp_path / "bare"
    bare.mkdir()
    for tool in (
        "sh",
        "sed",
        "tail",
        "cat",
        "date",
        "mkdir",
        "chmod",
        "mktemp",
        "rm",
        "grep",
        "head",
        "cut",
        "tr",
        "basename",
        "mv",
        "dirname",
        "cp",
    ):
        path = shutil.which(tool)
        if path:
            (bare / tool).symlink_to(path)
    done = run(
        "/bin/sh",
        str(fresh.dir / "backup.sh"),
        "--encrypt",
        "age1xyz",
        cwd=fresh.dir,
        env={"PATH": str(bare), "COMPOSE_PROJECT_NAME": PROJECT},
    )
    assert done.returncode != 0 and "age is not installed" in done.stderr
    assert not list((fresh.dir / "backups").glob("melophos-*")) if (fresh.dir / "backups").exists() else True


# a restore that runs out of room


def test_a_full_disk_during_the_restore_leaves_the_old_data_serving_and_the_stack_up(small_stack):
    """The database lives on a 220 MB volume. A filler leaves too little room for a second copy of the data, which is
    what a restore into a new database needs. The restore must fail cleanly and the old data must go on being served."""
    s = small_stack
    s.sql(
        "DROP TABLE IF EXISTS big; CREATE TABLE big (id int, pad text); INSERT INTO big SELECT g, repeat(md5(g::text), 4) FROM generate_series(1, 200000) g"
    )
    rows = s.sql("SELECT count(*) FROM big")
    assert rows == "200000"
    base = backup(s)
    s.sql("INSERT INTO big VALUES (-1, 'newer than the backup')")
    fill = (
        "avail=$(df -k /var/lib/postgresql/data | tail -1 | awk '{print $4}'); "
        "dd if=/dev/zero of=/var/lib/postgresql/data/filler bs=1k count=$((avail - 6000)) 2>/dev/null; df -k /var/lib/postgresql/data | tail -1"
    )
    filled = run(
        "docker", "compose", "--env-file", ".env", "-f", "docker-compose.yml", "exec", "-T", "db", "sh", "-c", fill,
        cwd=s.dir, env={**os.environ, "COMPOSE_PROJECT_NAME": s.project},
    )  # fmt: skip
    assert filled.returncode == 0, filled.stderr
    done = s.script("restore.sh", str(base.relative_to(s.dir)), answer="yes\n", timeout=600)
    assert done.returncode != 0, "the restore should not have fitted"
    assert "stopped:" in done.stderr, done.stderr[-600:]
    assert "No space left on device" in done.stderr, done.stderr[-800:]  # it really ran out of room
    # a full disk can make the database restart. Wait for it and then look at what it serves
    for _ in range(60):
        try:
            assert s.sql("SELECT count(*) FROM big") == "200001"
            break
        except AssertionError:
            time.sleep(1)
    assert (
        s.sql("SELECT count(*) FROM big") == "200001"
    )  # the old data, including the row newer than the backup
    assert not any("_restore_" in n or "_replaced_" in n for n in s.databases())
    assert s.dump_left_in_container() == ""
    assert "STARTED-SERVER-AND-WORKER" in s.calls()
    assert not list(s.dir.glob(".env.before-restore*"))
