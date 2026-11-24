"""A safety test that does not run must be loud: named at the end of a local run, a failure in CI."""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.no_clean

SERVER = Path(__file__).resolve().parents[1]
ROOT = SERVER.parent


def path_without(tool: str) -> str:
    return os.pathsep.join(d for d in os.environ["PATH"].split(os.pathsep) if not (Path(d) / tool).exists())


def run_pytest(**env):
    merged = {**os.environ, "PATH": path_without("age"), **env}
    merged.pop("MELOPHOS_REQUIRE_SAFETY_TESTS", None) if "MELOPHOS_REQUIRE_SAFETY_TESTS" not in env else None
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/test_backup_restore.py", "-k", "wrong_key_stops"],
        capture_output=True, text=True, cwd=SERVER, env=merged,
    )  # fmt: skip


def test_a_skipped_safety_test_is_named_at_the_end_of_a_local_run():
    done = run_pytest()
    assert done.returncode == 0, done.stdout[-500:]
    assert "SAFETY TESTS THAT DID NOT RUN" in done.stdout and "age is not installed" in done.stdout
    assert "test_the_wrong_key_stops_the_restore_before_anything_changes" in done.stdout


def test_the_same_skip_fails_the_run_when_the_flag_is_set():
    done = run_pytest(MELOPHOS_REQUIRE_SAFETY_TESTS="1")
    assert done.returncode != 0
    assert "a safety test was skipped, which is a failure here: age is not installed" in done.stdout


def test_ci_installs_the_tools_with_checksums_and_sets_the_flag():
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    server = ci[ci.index("  server:") : ci.index("  client:")]
    assert re.search(r"age-v\d+\.\d+\.\d+-linux-amd64\.tar\.gz", server) and re.search(
        r"[0-9a-f]{64}  age\.tar\.gz\" \| sha256sum -c", server
    )
    assert re.search(r"[0-9a-f]{64}  actionlint\.tar\.gz\" \| sha256sum -c", server)
    assert 'MELOPHOS_REQUIRE_SAFETY_TESTS: "1"' in server and "GH_TOKEN: ${{ github.token }}" in server
    assert "apt-get install" not in server.split("Install the tools")[1].split("pytest")[0]


@pytest.mark.skipif(shutil.which("age") is None, reason="age is not installed")
def test_with_age_present_the_encrypted_tests_run_and_are_not_skipped():
    merged = {**os.environ, "MELOPHOS_REQUIRE_SAFETY_TESTS": "1"}
    done = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/test_backup_restore.py", "-k", "wrong_key_stops"],
        capture_output=True, text=True, cwd=SERVER, env=merged,
    )  # fmt: skip
    assert done.returncode == 0 and "1 passed" in done.stdout, done.stdout[-400:]
