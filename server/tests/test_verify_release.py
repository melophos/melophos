"""The release gate (.github/scripts/verify-release.sh): nothing publishes unless the tag, the commit, CI and the version
all agree. `gh` is a stand-in that answers from files, so each refusal is proved by running the real script."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

pytestmark = pytest.mark.no_clean

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / ".github" / "scripts" / "verify-release.sh"
REPO = "melophos/melophos"
TAG = "v0.1.0"
SHA = "a" * 40
TAG_SHA = "b" * 40

GH = """#!/bin/sh
shift
endpoint=""
jqf=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        -X | -f) shift 2 ;;
        --jq) jqf="$2"; shift 2 ;;
        *) endpoint="$1"; shift ;;
    esac
done
f="$FAKE_GH_DIR/$(echo "$endpoint" | tr '/' '_')"
[ -f "$f" ] || { echo "gh: HTTP 404 $endpoint" >&2; exit 1; }
if [ -n "$jqf" ]; then jq -r "$jqf" "$f"; else cat "$f"; fi
"""


class Gate:
    def __init__(self, tmp_path: Path):
        self.tmp = tmp_path
        # a copy of the script inside a small tree, so its package file is the one under test
        self.tree = tmp_path / "tree"
        (self.tree / ".github" / "scripts").mkdir(parents=True)
        (self.tree / "server").mkdir()
        shutil.copy(SCRIPT, self.tree / ".github" / "scripts" / "verify-release.sh")
        self.set_version("0.1.0")
        self.api = tmp_path / "api"
        self.api.mkdir()
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        (bin_dir / "gh").write_text(GH)
        (bin_dir / "gh").chmod(0o755)
        self.bin = bin_dir
        self.put(f"repos/{REPO}/git/ref/tags/{TAG}", {"object": {"type": "tag", "sha": TAG_SHA}})
        self.put(
            f"repos/{REPO}/git/tags/{TAG_SHA}",
            {"object": {"type": "commit", "sha": SHA}, "verification": {"verified": True, "reason": "valid"}},
        )
        self.put(f"repos/{REPO}/compare/main...{SHA}", {"status": "behind"})
        self.put(f"repos/{REPO}/actions/workflows/ci.yml/runs", {"total_count": 1})

    def set_version(self, version: str):
        (self.tree / "server" / "pyproject.toml").write_text(
            f'[project]\nname = "x"\nversion = "{version}"\n'
        )

    def put(self, endpoint: str, body: dict):
        (self.api / endpoint.replace("/", "_")).write_text(json.dumps(body))

    def run(self, tag=TAG, sha=SHA):
        env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "FAKE_GH_DIR": str(self.api),
            "GH_TOKEN": "x",
            "REPO": REPO,
            "TAG": tag,
            "SHA": sha,
        }
        return subprocess.run(
            ["sh", str(self.tree / ".github" / "scripts" / "verify-release.sh")],
            capture_output=True,
            text=True,
            env=env,
        )


@pytest.fixture()
def gate(tmp_path):
    return Gate(tmp_path)


def refused(done, words):
    assert done.returncode != 0
    assert "release gate:" in done.stderr and words in done.stderr, done.stderr


def test_a_signed_annotated_tag_on_main_with_passing_ci_and_a_matching_version_passes(gate):
    done = gate.run()
    assert done.returncode == 0, done.stderr
    assert f"release gate passed for {TAG}" in done.stdout


def test_a_lightweight_tag_is_refused(gate):
    gate.put(f"repos/{REPO}/git/ref/tags/{TAG}", {"object": {"type": "commit", "sha": SHA}})
    refused(gate.run(), "not annotated")


def test_an_unsigned_or_unverified_tag_is_refused(gate):
    gate.put(
        f"repos/{REPO}/git/tags/{TAG_SHA}",
        {"object": {"type": "commit", "sha": SHA}, "verification": {"verified": False, "reason": "unsigned"}},
    )
    refused(gate.run(), "not signed")


def test_a_tag_that_points_at_another_commit_than_the_run_is_refused(gate):
    refused(gate.run(sha="c" * 40), "not at the commit of this run")


@pytest.mark.parametrize("status", ["ahead", "diverged"])
def test_a_commit_that_is_not_on_main_is_refused(gate, status):
    gate.put(f"repos/{REPO}/compare/main...{SHA}", {"status": status})
    refused(gate.run(), "not on main")


def test_a_commit_that_main_never_saw_is_refused_when_the_comparison_fails(gate):
    (gate.api / f"repos_{REPO.replace('/', '_')}_compare_main...{SHA}").unlink()
    refused(gate.run(), "cannot compare")


def test_a_commit_without_a_successful_ci_run_is_refused(gate):
    gate.put(f"repos/{REPO}/actions/workflows/ci.yml/runs", {"total_count": 0})
    refused(gate.run(), "no successful run")


def test_a_tag_that_disagrees_with_the_package_version_is_refused(gate):
    gate.set_version("0.2.0")
    refused(gate.run(), "says version 0.2.0")


@pytest.mark.parametrize("tag", ["1.2.3", "v1.2", "v1.2.3-rc1", "main", "v1.2.3; rm -rf x"])
def test_a_tag_name_of_any_other_shape_is_refused(gate, tag):
    refused(gate.run(tag=tag), "not of the form")


def test_a_short_commit_id_is_refused(gate):
    refused(gate.run(sha="abc123"), "not a full commit id")
