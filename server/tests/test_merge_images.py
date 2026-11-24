"""The merge step (.github/scripts/merge-images.sh) against a real local registry, with tiny images.

It must sign what it made and nothing else: the digest comes from the creation of the index, the index must list
exactly what this run's platform builds contain and a tag that moved in the gap stops it."""

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest

pytestmark = [
    pytest.mark.no_clean,
    pytest.mark.skipif(shutil.which("docker") is None, reason="docker is needed"),
]

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / ".github" / "scripts" / "merge-images.sh"
REGISTRY = "127.0.0.1:26510"
IMAGE = f"{REGISTRY}/melophos/melophos-test"
BUILDER = "melophos-rtest-bx"
REAL_DOCKER = shutil.which("docker") or "docker"


def run(*args, cwd=None, env=None):
    return subprocess.run(list(args), capture_output=True, text=True, cwd=cwd, env=env)


@pytest.fixture(scope="module")
def images(tmp_path_factory):
    base = tmp_path_factory.mktemp("merge")
    run("docker", "rm", "-f", "melophos-rtest-registry")
    up = run(
        "docker", "run", "-d", "--name", "melophos-rtest-registry", "-p", "127.0.0.1:26510:5000", "registry:2"
    )
    assert up.returncode == 0, up.stderr
    run("docker", "buildx", "rm", "-f", BUILDER)
    made = run(
        "docker",
        "buildx",
        "create",
        "--name",
        BUILDER,
        "--driver",
        "docker-container",
        "--driver-opt",
        "network=host",
    )
    assert made.returncode == 0, made.stderr
    try:
        for _ in range(30):
            try:
                import urllib.request

                urllib.request.urlopen(f"http://{REGISTRY}/v2/", timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        digests = {}
        for name, platform in (
            ("amd64", "linux/amd64"),
            ("arm64", "linux/arm64"),
            ("foreign", "linux/amd64"),
        ):
            folder = base / name
            folder.mkdir()
            (folder / "marker").write_text(name)
            (folder / "Dockerfile").write_text("FROM scratch\nCOPY marker /marker\n")
            meta = folder / "meta.json"
            done = run(
                "docker", "buildx", "build", "--builder", BUILDER, "--platform", platform, "--provenance", "mode=max", "--sbom", "true",
                "--output", f"type=image,name={IMAGE},push-by-digest=true,name-canonical=true,push=true", "--metadata-file", str(meta), str(folder),
            )  # fmt: skip
            assert done.returncode == 0, done.stderr[-500:]
            digests[name] = json.loads(meta.read_text())["containerimage.digest"].removeprefix("sha256:")
        yield digests
    finally:
        run("docker", "rm", "-f", "melophos-rtest-registry")
        run("docker", "buildx", "rm", "-f", BUILDER)


def shim(tmp_path: Path, after_create: str = "", extra_source: str = "") -> Path:
    """A docker in front of the real one. It can move a tag right after the index is made or add a source to it."""
    folder = tmp_path / "shim"
    folder.mkdir()
    script = f"""#!/bin/sh
args="$*"
case "$args" in
    *"imagetools create"*)
        if [ -n "{extra_source}" ]; then {REAL_DOCKER} "$@" {extra_source}; rc=$?; else {REAL_DOCKER} "$@"; rc=$?; fi
        {after_create}
        exit $rc ;;
esac
exec {REAL_DOCKER} "$@"
"""
    (folder / "docker").write_text(script)
    (folder / "docker").chmod(0o755)
    return folder


def merge(tmp_path, images, names=("amd64", "arm64"), tag="1.2.3", shim_dir=None, expected="2"):
    digests = tmp_path / "digests"
    digests.mkdir(exist_ok=True)
    for n in names:
        (digests / images[n]).touch()
    env = {
        **os.environ,
        "IMAGE": IMAGE,
        "TAGS": f"{IMAGE}:{tag}",
        "DIGEST_DIR": str(digests),
        "EXPECTED": expected,
    }
    if shim_dir:
        env["PATH"] = f"{shim_dir}:{env['PATH']}"
    return run("sh", str(SCRIPT), env=env)


def tag_digest(tag):
    out = run(
        "docker",
        "buildx",
        "imagetools",
        "inspect",
        "--builder",
        BUILDER,
        f"{IMAGE}:{tag}",
        "--format",
        "{{json .Manifest}}",
    )
    return json.loads(out.stdout)["digest"]


def test_the_digest_it_prints_is_the_index_it_made_and_both_platforms_and_their_attestations_are_in_it(
    tmp_path, images
):
    done = merge(tmp_path, images, tag="ok")
    assert done.returncode == 0, done.stderr
    digest = done.stdout.strip().splitlines()[-1]
    assert digest == tag_digest("ok")
    out = run(
        "docker",
        "buildx",
        "imagetools",
        "inspect",
        "--builder",
        BUILDER,
        f"{IMAGE}@{digest}",
        "--format",
        "{{json .Manifest}}",
    )
    platforms = [m.get("platform", {}) for m in json.loads(out.stdout)["manifests"]]
    assert {"linux/amd64", "linux/arm64"} <= {f"{p.get('os')}/{p.get('architecture')}" for p in platforms}
    assert len(platforms) == 4  # two images and the provenance and bill of materials of each


def test_a_run_that_built_the_wrong_number_of_platforms_is_refused(tmp_path, images):
    done = merge(tmp_path, images, names=("amd64",), tag="one")
    assert done.returncode != 0 and "expected 2" in done.stderr


def test_a_tag_that_moved_in_the_gap_is_not_signed(tmp_path, images):
    foreign = f"{IMAGE}@sha256:{images['foreign']}"
    mover = f"{REAL_DOCKER} buildx imagetools create -t {IMAGE}:moved {foreign} >/dev/null 2>&1"
    done = merge(tmp_path, images, tag="moved", shim_dir=shim(tmp_path, after_create=mover))
    assert done.returncode != 0 and "not signing" in done.stderr
    assert done.stdout.strip() == ""  # nothing was printed for the workflow to sign


def test_an_index_that_lists_an_image_this_run_did_not_build_is_refused(tmp_path, images):
    done = merge(
        tmp_path,
        images,
        tag="extra",
        shim_dir=shim(tmp_path, extra_source=f"{IMAGE}@sha256:{images['foreign']}"),
    )
    assert done.returncode != 0 and "lists other images" in done.stderr
    assert done.stdout.strip() == ""


def test_a_name_that_is_not_a_digest_is_refused(tmp_path, images):
    digests = tmp_path / "digests"
    digests.mkdir()
    (digests / "latest").touch()
    env = {**os.environ, "IMAGE": IMAGE, "TAGS": f"{IMAGE}:x", "DIGEST_DIR": str(digests)}
    done = run("sh", str(SCRIPT), env=env)
    assert done.returncode != 0 and "is not a digest" in done.stderr


def test_the_workflow_signs_the_digest_this_script_printed_and_reads_no_tag_back():
    text = (ROOT / ".github" / "workflows" / "publish-images.yml").read_text()
    assert ".github/scripts/merge-images.sh" in text and "imagetools inspect" not in text
    assert "steps.digest.outputs.digest" in text
