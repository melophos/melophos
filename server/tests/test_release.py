"""Issue 35: signed images, a compose file that uses published images and a one-command install.

Nothing here pushes anything. The install script runs for real against a local web server with stand-ins for docker
and cosign, so each safety rule is proved by what the script does and not by reading it. Every test that follows a
failure compares the whole install folder before and after."""

import functools
import hashlib
import http.server
import json
import os
import re
import shutil
import stat
import subprocess
import threading
from pathlib import Path

import pytest
import yaml

pytestmark = pytest.mark.no_clean  # none of these need the test database

SERVER = Path(__file__).resolve().parents[1]
DEPLOY = SERVER / "deploy"
ROOT = SERVER.parent
WORKFLOWS = ROOT / ".github" / "workflows"
PUBLISH = WORKFLOWS / "publish-images.yml"
SERVER_DIGEST = "sha256:" + "a" * 64
MQTT_DIGEST = "sha256:" + "b" * 64
SERVER_DIGEST_2 = "sha256:" + "c" * 64
REGISTRY = "127.0.0.1:26999/melophos"


def run(*args, env=None, cwd=None, input_text=None):
    return subprocess.run(list(args), capture_output=True, text=True, env=env, cwd=cwd, input=input_text)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


needs_docker = pytest.mark.skipif(shutil.which("docker") is None, reason="docker is needed")
needs_shellcheck = pytest.mark.skipif(
    shutil.which("shellcheck") is None, reason="shellcheck is not installed"
)


@pytest.fixture()
def staged(tmp_path):
    """A copy of the deploy folder, like a checkout."""
    target = tmp_path / "deploy"
    shutil.copytree(DEPLOY, target, ignore=shutil.ignore_patterns("certs", ".env", "backups"))
    return target


def pin(source: Path, out: Path, version="v1.2.3", server_digest=SERVER_DIGEST, registry=REGISTRY):
    done = run(
        str(source / "pin-release.sh"),
        "--version",
        version,
        "--server-digest",
        server_digest,
        "--mqtt-digest",
        MQTT_DIGEST,
        "--registry",
        registry,
        "--out",
        str(out),
    )
    assert done.returncode == 0, done.stderr
    return out


def compose_config(compose_dir: Path, env_file: Path, extra_env=None):
    env = {**os.environ, **(extra_env or {})}
    return run(
        "docker",
        "compose",
        "--env-file",
        str(env_file),
        "-f",
        str(compose_dir / "docker-compose.yml"),
        "config",
        "--format",
        "json",
        env=env,
    )


def make_env(staged: Path) -> Path:
    done = run("sh", str(staged / "generate-env.sh"))
    assert done.returncode == 0, done.stderr
    return staged / ".env"


# the compose file


@needs_docker
def test_the_unpinned_compose_file_stops_with_a_plain_message(staged):
    done = compose_config(staged, make_env(staged))
    assert done.returncode != 0
    assert "no image digest yet" in done.stderr and "build-local.sh" in done.stderr


@needs_docker
def test_a_release_fills_every_digest_and_the_file_then_loads(staged, tmp_path):
    out = pin(staged, tmp_path / "release")
    done = compose_config(out, make_env(staged))
    assert done.returncode == 0, done.stderr
    services = json.loads(done.stdout)["services"]
    for name in ("server", "worker", "db-roles", "migrate"):
        assert services[name]["image"] == f"{REGISTRY}/melophos-server@{SERVER_DIGEST}"
    assert services["mqtt"]["image"] == f"{REGISTRY}/melophos-mqtt@{MQTT_DIGEST}"
    assert "DIGEST" not in (out / "docker-compose.yml").read_text()


@needs_docker
def test_every_image_in_the_pinned_compose_file_is_pinned_by_digest_and_none_is_latest(staged, tmp_path):
    out = pin(staged, tmp_path / "release")
    done = compose_config(out, make_env(staged), {"GRAFANA_ADMIN_PASSWORD": "x" * 12})
    services = json.loads(done.stdout)["services"]
    for name, service in services.items():
        image = service["image"]
        assert re.search(r"@sha256:[0-9a-f]{64}$", image), (name, image)
        assert ":latest" not in image, (name, image)


def test_no_image_tag_latest_anywhere_in_the_deploy_files():
    paths = [
        DEPLOY / "docker-compose.yml",
        DEPLOY / "docker-compose.local.yml",
        DEPLOY / "mosquitto" / "Dockerfile",
        SERVER / "Dockerfile",
        SERVER / "tests" / "infra" / "compose.yml",
        PUBLISH,
    ]
    for path in paths:
        text = path.read_text()
        assert not re.search(r"(?<![\w-])(image:|FROM)\s+\S*:latest\b", text), path
        assert "latest-pg" not in text, path


def test_the_base_images_are_pinned_by_digest():
    for path in [SERVER / "Dockerfile", DEPLOY / "mosquitto" / "Dockerfile"]:
        froms = re.findall(r"^FROM (\S+)", path.read_text(), re.M)
        assert froms and all(f in {"scratch", "core"} or "@sha256:" in f for f in froms), (path, froms)


def test_the_pin_script_refuses_bad_input_and_never_writes_into_the_repository_folder(staged, tmp_path):
    base = [str(staged / "pin-release.sh")]
    good = ["--server-digest", SERVER_DIGEST, "--mqtt-digest", MQTT_DIGEST]
    assert "v1.2.3" in run(*base, "--version", "1.2", *good, "--out", str(tmp_path / "o")).stderr
    bad = run(
        *base,
        "--version",
        "v1.2.3",
        "--server-digest",
        "sha256:short",
        "--mqtt-digest",
        MQTT_DIGEST,
        "--out",
        str(tmp_path / "o"),
    )
    assert bad.returncode != 0 and "64 hex" in bad.stderr
    same = run(*base, "--version", "v1.2.3", *good, "--out", str(staged))
    assert same.returncode != 0 and "must not be the deploy folder" in same.stderr
    assert "DIGEST" in (staged / "docker-compose.yml").read_text()  # untouched


def test_the_pin_script_writes_checksums_that_match_the_files_and_lists_every_file(staged, tmp_path):
    out = pin(staged, tmp_path / "release")
    install = (out / "install.sh").read_text()
    assert "__FILLED_BY_RELEASE__" not in install.split("marker=")[0]
    block = re.search(r'^FILES="\n(.*?)\n"$', install, re.M | re.S).group(1)
    names = set()
    for line in block.splitlines():
        checksum, asset, dest, mode = line.split()
        assert checksum == sha(out / asset), asset
        assert mode in {"644", "755"}
        names.add(asset)
    assert names == {
        "docker-compose.yml",
        "env.example",
        "generate-env.sh",
        "backup.sh",
        "restore.sh",
        "prometheus.yml",
    }
    sums = dict(reversed(line.split("  ")) for line in (out / "SHA256SUMS").read_text().splitlines())
    assert set(sums) == names | {"install.sh"}
    for name, checksum in sums.items():
        assert checksum == sha(out / name), name


@needs_docker
def test_the_local_build_file_replaces_every_published_image_name(staged, tmp_path):
    env = {
        "MELOPHOS_CORE_DIR": str(tmp_path),
        "MELOPHOS_SERVER_DIGEST": "sha256:local",
        "MELOPHOS_MQTT_DIGEST": "sha256:local",
    }
    done = run(
        "docker", "compose", "--env-file", str(make_env(staged)), "-f", str(staged / "docker-compose.yml"),
        "-f", str(staged / "docker-compose.local.yml"), "config", "--format", "json", env={**os.environ, **env},
    )  # fmt: skip
    assert done.returncode == 0, done.stderr
    services = json.loads(done.stdout)["services"]
    assert (
        services["server"]["image"] == "melophos-server:local"
        and services["mqtt"]["image"] == "melophos-mqtt:local"
    )
    assert services["server"]["build"]["additional_contexts"]["core"] == str(tmp_path)


# dependencies: nothing is resolved on build day


def lock_names(path: Path) -> set[str]:
    return {
        m.group(1).lower().replace("_", "-")
        for m in re.finditer(r"^([A-Za-z0-9._-]+)==", path.read_text(), re.M)
    }


def test_every_locked_package_has_a_version_and_hashes():
    for name in ("requirements.lock", "requirements-build.lock", "requirements-engine.lock"):
        text = (SERVER / name).read_text()
        packages = re.split(r"\n(?=[A-Za-z0-9._-]+==)", text)[1:] if "==" in text else []
        assert packages, name
        for block in packages:
            assert re.match(r"[A-Za-z0-9._-]+==[^\s]+", block), block[:60]
            assert "--hash=sha256:" in block, block[:60]


def test_every_dependency_in_pyproject_is_in_the_lock():
    deps = re.search(
        r"^dependencies = \[(.*?)\]", (SERVER / "pyproject.toml").read_text(), re.M | re.S
    ).group(1)
    wanted = {
        re.match(r'\s*"([A-Za-z0-9._-]+)', d).group(1).lower().replace("_", "-")
        for d in deps.split("\n")
        if d.strip()
    }
    assert wanted and wanted <= lock_names(SERVER / "requirements.lock")
    assert "setuptools" in lock_names(SERVER / "requirements-build.lock")
    assert "maturin" in lock_names(SERVER / "requirements-engine.lock")


def test_the_image_installs_only_from_hashed_lock_files_and_pins_what_it_takes_from_apt():
    text = (SERVER / "Dockerfile").read_text()
    installs = [line for line in text.splitlines() if "pip install" in line]
    assert installs
    for line in installs:
        # a local wheel (the engine) or a hashed lock file, nothing resolved from a version range
        assert "--require-hashes" in line or "--no-index" in line, line
        assert "--no-deps" in line, line
    assert "pip install --no-cache-dir ." not in text and "maturin>=" not in text
    apt = re.search(r"apt-get install[^\n]*\\\n(.*?)\n\s*&&", text, re.S).group(1)
    for package in apt.replace("\\", " ").split():
        assert re.match(r"[a-z0-9.+-]+=[^=\s]+$", package), package


def test_ci_regenerates_the_locks_and_fails_when_they_differ():
    ci = (WORKFLOWS / "ci.yml").read_text()
    assert (
        "./lock-requirements.sh" in ci
        and "git diff --exit-code -- requirements.lock requirements-build.lock requirements-engine.lock" in ci
    )
    script = (SERVER / "lock-requirements.sh").read_text()
    assert "--generate-hashes" in script and "--exclude-newer" in script and "--universal" in script


# the workflows


def workflow(path: Path) -> dict:
    return yaml.safe_load(path.read_text())


def all_workflows():
    return sorted(WORKFLOWS.glob("*.yml"))


def test_every_action_in_every_workflow_is_pinned_to_a_full_commit_with_its_version_in_a_comment():
    for path in all_workflows():
        for line in path.read_text().splitlines():
            if re.match(r"\s*-?\s*uses:", line):
                assert re.search(r"uses: \S+@[0-9a-f]{40} # v\d+(\.\d+)*", line), (path.name, line)


def test_every_job_in_every_workflow_has_a_timeout():
    for path in all_workflows():
        for name, job in workflow(path)["jobs"].items():
            assert "timeout-minutes" in job, (path.name, name)


def test_ci_never_cancels_a_run_on_main():
    ci = workflow(WORKFLOWS / "ci.yml")
    assert ci["concurrency"]["cancel-in-progress"] == "${{ github.ref != 'refs/heads/main' }}"


def test_the_gitleaks_download_is_checked_against_a_checksum():
    text = (WORKFLOWS / "gitleaks-scan.yml").read_text()
    assert "sha256sum -c" in text and re.search(r"SHA256: [0-9a-f]{64}", text)
    assert not re.search(r"curl[^\n]*\|\s*tar", text)


def test_the_workflows_readme_lists_every_workflow_and_is_true_about_pinning():
    readme = (WORKFLOWS / "README.md").read_text()
    for path in all_workflows():
        assert f"`{path.name}`" in readme, path.name
    for line in (WORKFLOWS / "markdownlint.yml").read_text().splitlines():
        if "uses:" in line:
            assert re.search(r"@[0-9a-f]{40} # v", line), line


def test_publishing_runs_only_for_a_version_tag_in_the_real_repository():
    wf = workflow(PUBLISH)
    triggers = wf[True]  # yaml reads the key `on` as True
    assert set(triggers) == {"push"} and set(triggers["push"]) == {"tags"}
    assert "branches" not in triggers["push"]
    text = PUBLISH.read_text()
    assert "pull_request" not in text and "workflow_dispatch" not in text
    assert wf["permissions"] == {}
    assert wf["jobs"]["verify"]["if"].count("github.repository == 'melophos/melophos'") == 1
    assert "github.ref_type == 'tag'" in wf["jobs"]["verify"]["if"]


def reaches(jobs: dict, start: str, target: str) -> bool:
    needs = jobs[start].get("needs", [])
    needs = [needs] if isinstance(needs, str) else needs
    return target in needs or any(reaches(jobs, n, target) for n in needs)


def test_nothing_runs_before_the_release_gate_and_the_approval():
    jobs = workflow(PUBLISH)["jobs"]
    for name in jobs:
        if name not in {"verify"}:
            assert reaches(jobs, name, "verify"), name
        if name not in {"verify", "approve"}:
            assert reaches(jobs, name, "approve"), name
    assert jobs["approve"]["environment"] == "release"


def test_the_release_is_a_draft_and_nothing_publishes_from_main():
    text = PUBLISH.read_text()
    assert "gh release create" in text and "--draft" in text and "--verify-tag" in text
    assert "refs/heads/main" not in text and "branches:" not in text


def test_the_gate_script_is_the_one_the_workflow_runs():
    assert ".github/scripts/verify-release.sh" in workflow(PUBLISH)["jobs"]["verify"]["steps"][1]["run"]
    assert (ROOT / ".github" / "scripts" / "verify-release.sh").stat().st_mode & stat.S_IXUSR


def test_rights_are_least_privilege_per_job():
    jobs = workflow(PUBLISH)["jobs"]
    writers = {name for name, j in jobs.items() if j.get("permissions", {}).get("packages") == "write"}
    assert writers == {"build", "merge"}
    assert {n for n, j in jobs.items() if j.get("permissions", {}).get("contents") == "write"} == {"release"}
    assert {n for n, j in jobs.items() if "id-token" in j.get("permissions", {})} == {"merge", "files"}
    assert {n for n, j in jobs.items() if "attestations" in j.get("permissions", {})} == {"merge", "files"}


def test_both_platforms_are_built_natively_and_merged():
    build = workflow(PUBLISH)["jobs"]["build"]
    platforms = {(m["platform"], m["runner"]) for m in build["strategy"]["matrix"]["include"]}
    assert platforms == {("linux/amd64", "ubuntu-24.04"), ("linux/arm64", "ubuntu-24.04-arm")}
    text = PUBLISH.read_text()
    assert "setup-qemu" not in text and "merge-images.sh" in text and "push-by-digest=true" in text


def test_images_are_signed_by_digest_attested_and_carry_a_bill_of_materials():
    text = PUBLISH.read_text()
    assert text.count("cosign sign --yes") == 1  # once per image through the merge matrix
    assert 'cosign sign --yes "$REF"' in text and "@${{ steps.digest.outputs.digest }}" in text
    assert text.count("sbom: true") == 1 and text.count("provenance: mode=max") == 1
    assert "flavor: latest=false" in text and "cosign-release: v3.1.4" in text


def test_the_release_files_are_attested_and_the_checksums_are_signed():
    text = PUBLISH.read_text()
    assert "cosign sign-blob --yes --bundle SHA256SUMS.sigstore.json SHA256SUMS" in text
    for name in (
        "install.sh",
        "docker-compose.yml",
        "env.example",
        "generate-env.sh",
        "backup.sh",
        "restore.sh",
        "prometheus.yml",
        "SHA256SUMS",
    ):
        assert f"release-files/{name}" in text, name


def test_actionlint_passes_when_it_is_installed():
    if shutil.which("actionlint") is None:
        pytest.skip("actionlint is not installed")
    done = run("actionlint", *map(str, all_workflows()))
    assert done.returncode == 0, done.stdout


def test_codeowners_gives_the_release_files_a_real_owner_on_their_own_lines():
    text = (ROOT / ".github" / "CODEOWNERS").read_text()
    lines = [line.split() for line in text.splitlines() if line.strip() and not line.startswith("#")]
    rules = {pattern: owners for pattern, *owners in lines}
    assert rules["*"], "the repository owner"
    # the last matching line wins in GitHub, so a narrower line with no real owner would remove the review
    for path in ("/.github/", "/server/deploy/"):
        assert rules[path] == rules["*"], path
    assert "REPLACE" not in text and "melophos/" not in "".join(
        sum(rules.values(), [])
    )  # no team that does not exist


def action_pins():
    for path in sorted(WORKFLOWS.glob("*.yml")):
        for line in path.read_text().splitlines():
            m = re.match(r"\s*-?\s*uses: ([\w.-]+/[\w.-]+)(?:/\S+)?@([0-9a-f]{40}) # (v[\d.]+)", line)
            if m:
                yield path.name, m.group(1), m.group(2), m.group(3)


def test_every_pin_is_a_commit_of_the_actions_own_repository_when_the_api_can_be_reached():
    """A tag object or a commit of another repository would pass a pattern check and fail to run. Asked of GitHub."""
    if shutil.which("gh") is None:
        pytest.skip("gh is not installed, so the pins were only checked by their shape")
    if run("gh", "api", "rate_limit").returncode != 0:
        pytest.skip("the GitHub API cannot be reached, so the pins were only checked by their shape")
    pins = sorted(set(action_pins()))
    assert pins
    for workflow_name, repo, sha, version in pins:
        done = run("gh", "api", f"repos/{repo}/git/commits/{sha}", "--jq", ".sha")
        assert done.returncode == 0 and done.stdout.strip() == sha, (
            workflow_name,
            repo,
            sha,
            version,
            "is not a commit of that repository",
        )


def test_the_pin_check_itself_rejects_a_tag_object_and_a_wrong_repository():
    if shutil.which("gh") is None or run("gh", "api", "rate_limit").returncode != 0:
        pytest.skip("the GitHub API cannot be reached")
    tag_object = (
        "913db5cf77ef624b914090bad9e1615f7f6e099d"  # the annotated tag object of v25.0.0, not a commit
    )
    assert (
        run("gh", "api", f"repos/DavidAnson/markdownlint-cli2-action/git/commits/{tag_object}").returncode
        != 0
    )
    real = "696eb3f2509270d7b882d2aa68347bc676e7af34"
    assert run("gh", "api", f"repos/actions/checkout/git/commits/{real}").returncode != 0
    assert run("gh", "api", f"repos/DavidAnson/markdownlint-cli2-action/git/commits/{real}").returncode == 0


@needs_shellcheck
def test_every_shell_script_is_shellcheck_clean():
    names = (
        "install.sh",
        "backup.sh",
        "restore.sh",
        "generate-env.sh",
        "build-local.sh",
        "pin-release.sh",
        "build-engine-wheel.sh",
    )
    scripts = [DEPLOY / n for n in names] + [
        DEPLOY / "mosquitto" / "healthcheck.sh",
        SERVER / "lock-requirements.sh",
        ROOT / ".github" / "scripts" / "verify-release.sh",
    ]
    done = run("shellcheck", *map(str, scripts))
    assert done.returncode == 0, done.stdout


# secrets never appear on a command line


def test_the_broker_health_check_reads_its_password_from_a_file_and_not_from_an_argument():
    compose = (DEPLOY / "docker-compose.yml").read_text()
    assert "-P " not in compose.split("mqtt:")[1].split("server:")[0]
    script = (DEPLOY / "mosquitto" / "healthcheck.sh").read_text()
    assert (
        "XDG_CONFIG_HOME" in script
        and "mosquitto_ctrl dynsec listRoles" in script
        and " -P " not in script.split("mosquitto_ctrl dynsec")[1]
    )


@needs_docker
def test_the_health_check_tells_a_working_broker_from_a_wrong_password_and_never_shows_the_password():
    name = "melophos-rtest-broker"
    image = "melophos-mqtt-test:local"
    run("docker", "rm", "-f", name)
    built = run("docker", "build", "-q", "-t", image, str(DEPLOY / "mosquitto"))
    assert built.returncode == 0, built.stderr
    try:
        up = run(
            "docker",
            "run",
            "-d",
            "--name",
            name,
            "-e",
            "MQTT_ADMIN_USERNAME=adm",
            "-e",
            "MQTT_ADMIN_PASSWORD=pw-for-the-test-1234",
            image,
        )
        assert up.returncode == 0, up.stderr
        import time

        for _ in range(30):
            if run("docker", "exec", name, "/healthcheck.sh").returncode == 0:
                break
            time.sleep(0.5)
        assert run("docker", "exec", name, "/healthcheck.sh").returncode == 0
        assert (
            run("docker", "exec", "-e", "MQTT_ADMIN_PASSWORD=wrong", name, "/healthcheck.sh").returncode != 0
        )
        # while the check runs, the host's process list holds no password
        watcher = "for i in $(seq 1 60); do ps -o args; done; /healthcheck.sh >/dev/null 2>&1 &"
        seen = run(
            "docker",
            "exec",
            name,
            "sh",
            "-c",
            f"( for i in $(seq 1 40); do /healthcheck.sh; done ) >/dev/null 2>&1 & {watcher} wait; true",
        )
        assert "pw-for-the-test-1234" not in seen.stdout
    finally:
        run("docker", "rm", "-f", name)
        run("docker", "rmi", image)


def test_generate_env_puts_no_secret_on_any_command_line(tmp_path):
    folder = tmp_path / "d"
    folder.mkdir()
    shutil.copy(DEPLOY / "generate-env.sh", folder)
    shutil.copy(DEPLOY / ".env.example", folder)
    log = tmp_path / "argv.log"
    shims = tmp_path / "shims"
    shims.mkdir()
    for tool in ("openssl", "tr", "sed", "awk", "cat", "grep", "tee", "cut"):
        real = shutil.which(tool)
        if real:
            (shims / tool).write_text(f'#!/bin/sh\necho "{tool} $*" >> "{log}"\nexec {real} "$@"\n')
            (shims / tool).chmod(0o755)
    env = {**os.environ, "PATH": f"{shims}:{os.environ['PATH']}"}
    done = run("sh", str(folder / "generate-env.sh"), env=env)
    assert done.returncode == 0, done.stderr
    secrets = [
        v
        for k, v in (line.split("=", 1) for line in (folder / ".env").read_text().splitlines() if "=" in line)
        if len(v) >= 16
    ]
    assert len(secrets) >= 8
    argv = log.read_text()
    assert all(s not in argv for s in secrets)
    assert "sed" not in {line.split()[0] for line in argv.splitlines() if line.strip()}


def test_generate_env_refuses_a_link_and_never_writes_through_it(tmp_path):
    folder = tmp_path / "d"
    folder.mkdir()
    shutil.copy(DEPLOY / "generate-env.sh", folder)
    shutil.copy(DEPLOY / ".env.example", folder)
    target = tmp_path / "elsewhere"
    (folder / ".env").symlink_to(target)  # dangling
    done = run("sh", str(folder / "generate-env.sh"))
    assert done.returncode != 0 and "link" in done.stderr
    assert not target.exists()


def test_generate_env_completes_only_the_missing_keys_and_never_changes_a_value(tmp_path):
    folder = tmp_path / "d"
    folder.mkdir()
    shutil.copy(DEPLOY / "generate-env.sh", folder)
    shutil.copy(DEPLOY / ".env.example", folder)
    run("sh", str(folder / "generate-env.sh"))
    env = folder / ".env"
    kept = [
        line
        for line in env.read_text().splitlines()
        if not line.startswith(("METRICS_TOKEN=", "MQTT_INSTANCE="))
    ]
    env.write_text("\n".join(kept) + "\n")
    env.chmod(0o600)
    done = run("sh", str(folder / "generate-env.sh"), "--complete", str(env))
    assert sorted(done.stdout.split()) == ["METRICS_TOKEN", "MQTT_INSTANCE"]
    after = env.read_text().splitlines()
    assert after[: len(kept)] == kept  # nothing existing changed
    assert any(re.fullmatch(r"METRICS_TOKEN=\S{20,}", line) for line in after)
    assert "MQTT_INSTANCE=main" in after
    assert env.stat().st_mode & 0o077 == 0


# the install script, run for real against a local web server


class Stand:
    """A pinned release served from a local web server, with stand-ins for docker, cosign and friends."""

    def __init__(self, tmp_path, staged):
        self.tmp = tmp_path
        self.staged = staged
        self.servers = []
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        self.log = tmp_path / "calls.log"
        real_openssl = shutil.which("openssl")
        real_id = shutil.which("id")
        stubs = {
            "docker": '#!/bin/sh\necho "docker $*" >> "$FAKE_LOG"\n'
            'case "$*" in *"${FAKE_DOCKER_FAIL_ON:-NEVER-MATCHES}"*) exit 1 ;; esac\nexit 0\n',
            "cosign": '#!/bin/sh\nif [ "$1" = version ]; then echo "GitVersion:    ${FAKE_COSIGN_VERSION:-v3.1.4}"; exit 0; fi\n'
            'echo "cosign $*" >> "$FAKE_LOG"\n'
            'case "$*" in *"${FAKE_COSIGN_FAIL_ON:-NEVER-MATCHES}"*) exit 1 ;; esac\nexit "${FAKE_COSIGN_EXIT:-0}"\n',
            "id": f'#!/bin/sh\nif [ "${{1:-}}" = "-u" ] && [ -n "${{FAKE_UID:-}}" ]; then echo "$FAKE_UID"; else {real_id} "$@"; fi\n',
            "openssl": f'#!/bin/sh\nif [ "${{1:-}}" = rand ] && [ -n "${{FAKE_OPENSSL_FAIL:-}}" ]; then exit 1; fi\nexec {real_openssl} "$@"\n',
        }
        for name, body in stubs.items():
            (self.bin / name).write_text(body)
            (self.bin / name).chmod(0o755)
        self.home = tmp_path / "home"
        self.home.mkdir()
        self.dir = self.home / "m"
        self.release("v1.2.3", SERVER_DIGEST)

    def release(self, version, server_digest):
        out = pin(self.staged, self.tmp / f"served-{version}", version=version, server_digest=server_digest)
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(out))
        handler.log_message = lambda *a: None  # type: ignore[attr-defined]
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.servers.append(server)
        setattr(self, version.replace(".", "_"), (out, server.server_port))
        return out

    def install(self, *args, version="v1.2.3", env=None):
        out, port = getattr(self, version.replace(".", "_"))
        merged = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "FAKE_LOG": str(self.log),
            "HOME": str(self.home),
            **(env or {}),
        }
        return run(
            "sh",
            str(out / "install.sh"),
            "--version",
            version,
            "--base-url",
            f"http://127.0.0.1:{port}",
            "--dir",
            str(self.dir),
            *args,
            env=merged,
        )

    def served(self, version="v1.2.3") -> Path:
        return getattr(self, version.replace(".", "_"))[0]

    def calls(self) -> str:
        return self.log.read_text() if self.log.exists() else ""

    def snapshot(self):
        if not self.dir.exists():
            return None
        shot = {}
        for path in sorted(self.dir.rglob("*")):
            rel = str(path.relative_to(self.dir))
            shot[rel] = (
                ("dir", stat.S_IMODE(path.stat().st_mode))
                if path.is_dir()
                else (path.read_bytes(), stat.S_IMODE(path.stat().st_mode))
            )
        return shot

    def stop(self):
        for s in self.servers:
            s.shutdown()


@pytest.fixture()
def stand(staged, tmp_path):
    s = Stand(tmp_path, staged)
    yield s
    s.stop()


@pytest.fixture()
def installed(stand):
    """An install of v1.2.3 that worked and a v1.2.4 release to update to."""
    assert stand.install("--cosign-key", "key.pub").returncode == 0
    stand.release("v1.2.4", SERVER_DIGEST_2)
    stand.log.unlink()
    return stand


def test_an_install_that_was_not_prepared_by_a_release_refuses_to_run(tmp_path):
    done = run("sh", str(DEPLOY / "install.sh"), "--version", "v1.2.3", "--dir", str(tmp_path / "x"))
    assert done.returncode != 0 and "not prepared by a release" in done.stderr
    assert not (tmp_path / "x").exists()


def test_a_full_install_checks_every_file_verifies_both_images_then_starts(stand):
    done = stand.install("--cosign-key", "key.pub")
    assert done.returncode == 0, done.stderr + done.stdout
    d = stand.dir
    for name in (
        "docker-compose.yml",
        ".env",
        ".env.example",
        "generate-env.sh",
        "backup.sh",
        "restore.sh",
        "monitoring/prometheus.yml",
        "VERSION",
    ):
        assert (d / name).is_file(), name
    assert (d / "VERSION").read_text().strip() == "v1.2.3"
    assert (d / ".env").stat().st_mode & 0o077 == 0 and (d.stat().st_mode & 0o077) == 0
    assert (d / "backup.sh").stat().st_mode & 0o111
    assert (d / "mosquitto" / "certs").is_dir() and (d / "monitoring" / "metrics_token").is_file()
    token = (d / "monitoring" / "metrics_token").read_text().strip()
    assert token and f"METRICS_TOKEN={token}" in (d / ".env").read_text()
    calls = stand.calls()
    verifies = [line for line in calls.splitlines() if line.startswith("cosign verify")]
    assert len(verifies) == 2 and all("--key key.pub" in v for v in verifies)
    assert calls.index("cosign verify") < calls.index("up -d --wait")
    assert "Next:" in done.stdout and "backup.sh" in done.stdout and "ALLOW_SIGNUP=false" in done.stdout
    assert "Only the images above were signature-checked" in done.stdout
    assert not [p for p in d.iterdir() if p.name.startswith(".stage")]  # the work folder is gone


def test_keyless_verification_pins_the_exact_workflow_the_exact_tag_and_the_issuer(stand):
    assert stand.install().returncode == 0
    verify = next(line for line in stand.calls().splitlines() if line.startswith("cosign verify"))
    assert (
        "--certificate-identity https://github.com/melophos/melophos/.github/workflows/publish-images.yml@refs/tags/v1.2.3 "
        in verify
    )
    assert "--certificate-oidc-issuer https://token.actions.githubusercontent.com" in verify
    assert "regexp" not in verify and "heads/main" not in verify


def test_the_files_come_from_the_checked_folder_and_the_start_is_last(stand):
    assert stand.install("--skip-verify").returncode == 0
    calls = stand.calls().splitlines()
    assert calls[-1].endswith("up -d --wait") and any(c.endswith("pull --quiet") for c in calls)


@pytest.mark.parametrize(
    ("label", "env", "extra"),
    [
        ("a signature that does not verify", {"FAKE_COSIGN_EXIT": "1"}, ["--cosign-key", "k"]),
        (
            "a signature that fails on the second image",
            {"FAKE_COSIGN_FAIL_ON": "melophos-mqtt"},
            ["--cosign-key", "k"],
        ),
        ("a cosign that is too old", {"FAKE_COSIGN_VERSION": "v2.4.1"}, []),
    ],
)
def test_a_failure_before_the_move_leaves_a_working_install_exactly_as_it_was(installed, label, env, extra):
    before = installed.snapshot()
    done = installed.install(*extra, version="v1.2.4", env=env)
    assert done.returncode != 0, label
    assert installed.snapshot() == before, label
    assert "up -d" not in installed.calls() and "pull" not in installed.calls()
    assert not (installed.dir / "docker-compose.yml.previous").exists()


def test_a_failing_random_source_stops_a_fresh_install_and_an_update_that_needs_new_keys(stand):
    fresh = stand.install("--skip-verify", env={"FAKE_OPENSSL_FAIL": "1"})
    assert fresh.returncode != 0 and "could not make .env" in fresh.stderr and not stand.dir.exists()
    assert stand.install("--skip-verify").returncode == 0
    stand.release("v1.2.4", SERVER_DIGEST_2)
    env_file = stand.dir / ".env"
    env_file.write_text(
        "\n".join(line for line in env_file.read_text().splitlines() if not line.startswith("METRICS_TOKEN="))
        + "\n"
    )
    before = stand.snapshot()
    update = stand.install("--skip-verify", version="v1.2.4", env={"FAKE_OPENSSL_FAIL": "1"})
    assert update.returncode != 0 and "could not complete .env" in update.stderr
    assert stand.snapshot() == before


def test_a_failed_signature_check_on_a_fresh_install_leaves_no_folder(stand):
    done = stand.install("--cosign-key", "k", env={"FAKE_COSIGN_EXIT": "1"})
    assert done.returncode != 0 and "signature" in done.stderr and "nothing was changed" in done.stderr
    assert not stand.dir.exists()


def test_a_download_that_is_missing_or_changed_changes_nothing(installed):
    before = installed.snapshot()
    served = installed.served("v1.2.4")
    original = (served / "backup.sh").read_text()
    (served / "backup.sh").write_text(original + "\n# tampered\n")
    done = installed.install("--skip-verify", version="v1.2.4")
    assert done.returncode != 0 and "does not match the checksum" in done.stderr
    assert installed.snapshot() == before
    (served / "backup.sh").unlink()
    gone = installed.install("--skip-verify", version="v1.2.4")
    assert gone.returncode != 0 and "could not download" in gone.stderr
    assert installed.snapshot() == before


def test_a_bad_signature_twice_never_overwrites_the_previous_compose_file(installed):
    before = installed.snapshot()
    for _ in range(2):
        assert (
            installed.install("--cosign-key", "k", version="v1.2.4", env={"FAKE_COSIGN_EXIT": "1"}).returncode
            != 0
        )
    assert installed.snapshot() == before and not (installed.dir / "docker-compose.yml.previous").exists()
    old_compose = (installed.dir / "docker-compose.yml").read_bytes()
    assert installed.install("--cosign-key", "k", version="v1.2.4").returncode == 0
    assert (installed.dir / "docker-compose.yml.previous").read_bytes() == old_compose
    assert (
        installed.install("--cosign-key", "k", version="v1.2.4").returncode == 0
    )  # the same again changes nothing
    assert (installed.dir / "docker-compose.yml.previous").read_bytes() == old_compose
    assert (installed.dir / "VERSION").read_text().strip() == "v1.2.4"


def test_an_image_that_is_not_pinned_by_digest_is_refused_before_anything_moves(stand):
    served = stand.served()
    compose = served / "docker-compose.yml"
    compose.write_text(re.sub(r"(melophos-mqtt)@sha256:[0-9a-f]{64}", r"\1:1.2.3", compose.read_text()))
    install = (served / "install.sh").read_text()
    (served / "install.sh").write_text(
        re.sub(r"^[0-9a-f]{64}( docker-compose\.yml )", f"{sha(compose)}\\1", install, flags=re.M)
    )
    done = stand.install("--skip-verify", "--no-start")
    assert done.returncode != 0 and "not pinned by digest" in done.stderr
    assert not stand.dir.exists()


def test_a_start_that_fails_after_the_move_says_how_to_go_back_and_keeps_the_previous_file(installed):
    old = (installed.dir / "docker-compose.yml").read_bytes()
    done = installed.install("--skip-verify", version="v1.2.4", env={"FAKE_DOCKER_FAIL_ON": "pull"})
    assert done.returncode != 0 and "docker-compose.yml.previous" in done.stderr
    assert (installed.dir / "docker-compose.yml.previous").read_bytes() == old


def test_running_twice_never_replaces_the_env_or_touches_data(stand):
    stand.install("--skip-verify")
    env_file = stand.dir / ".env"
    before = env_file.read_text()
    (stand.dir / "data.txt").write_text("my data")
    second = stand.install("--skip-verify")
    assert second.returncode == 0
    assert env_file.read_text() == before and (stand.dir / "data.txt").read_text() == "my data"
    assert not (stand.dir / "docker-compose.yml.previous").exists()


def test_an_update_adds_new_env_keys_with_generated_values_and_never_changes_an_existing_one(installed):
    env_file = installed.dir / ".env"
    kept = [
        line
        for line in env_file.read_text().splitlines()
        if not line.startswith(("METRICS_TOKEN=", "ALLOW_STAND_IN_SCORER="))
    ]
    kept = [line.replace("ALLOW_SIGNUP=true", "ALLOW_SIGNUP=false") for line in kept]
    env_file.write_text("\n".join(kept) + "\n")
    env_file.chmod(0o600)
    done = installed.install("--skip-verify", version="v1.2.4")
    assert done.returncode == 0, done.stderr
    assert "METRICS_TOKEN" in done.stdout and "ALLOW_STAND_IN_SCORER" in done.stdout
    after = env_file.read_text().splitlines()
    assert after[: len(kept)] == kept and "ALLOW_SIGNUP=false" in after
    assert any(re.fullmatch(r"METRICS_TOKEN=\S{20,}", line) for line in after)
    assert env_file.stat().st_mode & 0o077 == 0


def test_a_dangling_link_at_env_is_refused_and_nothing_is_written_through_it(stand):
    stand.dir.mkdir(mode=0o700)
    target = stand.tmp / "elsewhere"
    (stand.dir / ".env").symlink_to(target)
    done = stand.install("--skip-verify")
    assert done.returncode != 0 and "is a link" in done.stderr
    assert not target.exists() and "up -d" not in stand.calls()


def test_an_existing_folder_is_not_changed_but_the_user_is_told(stand):
    stand.dir.mkdir(mode=0o755)
    stand.dir.chmod(0o755)
    done = stand.install("--skip-verify", "--no-start")
    assert done.returncode == 0
    assert stat.S_IMODE(stand.dir.stat().st_mode) == 0o755
    assert "chmod 700" in done.stdout


def test_it_refuses_to_run_as_root_unless_told(stand):
    refused = stand.install("--skip-verify", "--no-start", env={"FAKE_UID": "0"})
    assert refused.returncode != 0 and "do not run this as root" in refused.stderr and not stand.dir.exists()
    assert stand.install("--skip-verify", "--no-start", "--allow-root", env={"FAKE_UID": "0"}).returncode == 0


def test_it_refuses_the_wrong_version_and_plain_http_from_elsewhere(stand):
    wrong = run(
        "sh",
        str(stand.served() / "install.sh"),
        "--version",
        "v9.9.9",
        "--dir",
        str(stand.dir),
        "--skip-verify",
    )
    assert wrong.returncode != 0 and "installs v1.2.3" in wrong.stderr
    elsewhere = stand.install("--base-url", "http://example.com/releases", "--skip-verify", "--no-start")
    assert elsewhere.returncode != 0 and "https" in elsewhere.stderr


def test_without_cosign_the_install_refuses_unless_told_to_skip(stand, tmp_path):
    bare = tmp_path / "nocosign"
    bare.mkdir()
    for name in ("docker", "id", "openssl"):
        shutil.copy(stand.bin / name, bare / name)
    env = {"PATH": f"{bare}:/usr/bin:/bin"}
    done = stand.install(env=env)
    assert done.returncode != 0 and "cosign is needed" in done.stderr
    skipped = stand.install("--skip-verify", "--no-start", env=env)
    assert skipped.returncode == 0 and "WARNING: signatures are not being verified" in skipped.stdout


def test_nothing_from_the_network_is_piped_into_a_shell_and_downloads_go_to_a_file_first():
    for name in ("install.sh", "backup.sh", "restore.sh", "build-local.sh", "pin-release.sh"):
        text = (DEPLOY / name).read_text()
        assert not re.search(r"(curl|wget)[^\n]*\|\s*(ba)?sh", text), name
        assert "eval " not in text, name
    install = (DEPLOY / "install.sh").read_text()
    assert '-o "$stage/files/$dest"' in install and install.index("checksum in this script") < install.index(
        'sh "$stage/files/generate-env.sh"'
    )


def test_the_install_script_does_not_change_the_folder_before_the_images_are_verified():
    text = (DEPLOY / "install.sh").read_text()
    verify = text.index("cosign verify")
    move = text.index("# 5. the move into place")
    assert verify < move
    for marker in ('> "$dir/', 'mv -f "$stage', 'mv "$stage', 'cp "$dir', 'chmod 644 "$compose"'):
        for m in re.finditer(re.escape(marker), text):
            assert m.start() > move, marker  # nothing writes into the folder earlier


def test_the_script_is_short_enough_to_read():
    lines = [
        line
        for line in (DEPLOY / "install.sh").read_text().splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    assert len(lines) < 175


def test_pip_check_runs_after_the_hashed_installs_so_a_missing_dependency_fails_the_build():
    text = (SERVER / "Dockerfile").read_text()
    assert text.count("pip check") == 2  # the engine's build tools and the server image
    engine = text.split("AS engine")[1].split("FROM python")[0]
    assert "/v/bin/pip check" in engine and engine.index("--require-hashes") < engine.index(
        "pip check"
    ) < engine.index("maturin build")
    final = text.split("FROM python")[1]
    assert (
        final.index("--require-hashes")
        < final.index("pip check")
        < final.index("pip uninstall -y setuptools")
    )


def test_each_lock_is_made_for_the_one_python_it_runs_on_and_the_script_says_so():
    script = (SERVER / "lock-requirements.sh").read_text()
    dockerfile = (SERVER / "Dockerfile").read_text()
    assert "compile requirements-engine.in requirements-engine.lock 3.11" in script
    assert (
        "compile pyproject.toml requirements.lock 3.14" in script
        and "compile requirements-build.in requirements-build.lock 3.14" in script
    )
    assert "python3.11" in dockerfile and re.search(r"FROM python:3\.14\.\d+-slim", dockerfile)
    assert (
        "3.11" in script.split("compile()")[0] and "3.14" in script.split("compile()")[0]
    )  # stated in a comment


def test_the_guide_verifies_the_installer_with_the_publishing_workflow_named():
    guide = (ROOT / "docs" / "self-hosting.md").read_text()
    line = next(line for line in guide.splitlines() if line.startswith("gh attestation verify install.sh"))
    assert (
        "--signer-workflow melophos/melophos/.github/workflows/publish-images.yml" in line
        and "--source-ref refs/tags/" in line
    )
