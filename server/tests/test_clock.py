"""The server is the hub's trusted time source, so its clock is told to hubs and a plainly wrong clock stops it."""

import sys
import time
from dataclasses import replace
from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from app import clock
from app.clock import BUILD_EPOCH_ENV, build_time, check_clock, kernel_synchronised, sync_status

from .helpers import new_hub, pair, send_session, sign_up


def test_an_unpaired_hub_is_told_the_servers_time_in_whole_utc_seconds(client):
    hub = new_hub(client)
    before = time.time()
    answer = client.get("/api/v1/device", headers=hub.headers).json()
    after = time.time()
    assert type(answer["server_time"]) is int
    assert before - 1 <= answer["server_time"] <= after + 1


def test_a_paired_hub_is_told_it_too(client):
    hub = pair(client, sign_up(client))
    before = time.time()
    answer = client.get("/api/v1/device", headers=hub.headers).json()
    assert answer["paired"] is True
    assert abs(answer["server_time"] - before) <= 2
    assert abs(answer["server_time"] - datetime.now(UTC).timestamp()) <= 2


def test_the_time_is_read_on_every_call_and_does_not_stick(client):
    hub = new_hub(client)
    with patch("app.clock.time.time", return_value=1_900_000_000.9):
        assert client.get("/api/v1/device", headers=hub.headers).json()["server_time"] == 1_900_000_000
    with patch("app.clock.time.time", return_value=1_900_000_100.2):
        assert client.get("/api/v1/device", headers=hub.headers).json()["server_time"] == 1_900_000_100


def test_the_build_time_comes_from_the_build_and_falls_back_to_the_code(monkeypatch):
    monkeypatch.setenv(BUILD_EPOCH_ENV, "1795000000")
    assert build_time() == 1_795_000_000.0
    for bad in ("", "abc", "12", "-5"):
        monkeypatch.setenv(BUILD_EPOCH_ENV, bad)
        assert (
            build_time() <= time.time()
        )  # ignored: the newest file of the code is used, which is in the past
    monkeypatch.delenv(BUILD_EPOCH_ENV)
    assert 1_700_000_000 < build_time() <= time.time()


def test_the_image_takes_the_build_time_from_the_build_and_the_workflow_passes_it():
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    dockerfile = (root / "server" / "Dockerfile").read_text()
    assert "ARG BUILD_EPOCH" in dockerfile and "MELOPHOS_BUILD_EPOCH=$BUILD_EPOCH" in dockerfile
    assert "BUILD_EPOCH" in (root / "server" / "deploy" / "docker-compose.local.yml").read_text()
    assert "BUILD_EPOCH=$(date +%s)" in (root / "server" / "deploy" / "build-local.sh").read_text().replace(
        '"', ""
    )
    workflow = (root / ".github" / "workflows" / "publish-images.yml").read_text()
    assert "git log -1 --format=%ct" in workflow and "BUILD_EPOCH={0}" in workflow


@pytest.mark.parametrize("wrong", [0, 86_400 * 365, 1_795_000_000 - 1])
def test_a_clock_before_the_build_time_stops_the_server_with_a_plain_message(wrong, settings, monkeypatch):
    monkeypatch.setenv(BUILD_EPOCH_ENV, "1795000000")
    with pytest.raises(RuntimeError, match="before this version was built") as stopped:
        check_clock(wrong)
    assert "Set the system time" in str(stopped.value)
    from app.main import create_app

    with patch("app.clock.time.time", return_value=wrong), pytest.raises(RuntimeError, match="clock says"):
        create_app(settings)


def test_a_clock_at_the_build_time_is_accepted(monkeypatch):
    monkeypatch.setenv(BUILD_EPOCH_ENV, "1795000000")
    check_clock(1_795_000_000.0)
    check_clock()  # now


# synchronised or not


def test_the_kernel_is_asked_through_adjtimex_and_the_answer_is_one_of_three():
    assert kernel_synchronised() in (True, False, None)
    if sys.platform.startswith("linux"):
        assert isinstance(kernel_synchronised(), bool)


def fake_libc(state, status=0, fail=False):
    class Libc:
        def adjtimex(self, ref):
            if fail:
                return -1
            ref._obj.status = status
            return state

    return Libc()


@pytest.mark.parametrize(
    ("state", "status", "expected"),
    [(0, 0, True), (1, 0, True), (5, 0x40, False), (5, 0, False), (0, 0x40, False)],
)
def test_the_kernels_answer_is_read_the_way_the_kernel_gives_it(monkeypatch, state, status, expected):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr("app.clock.ctypes.CDLL", lambda *a, **k: fake_libc(state, status))
    assert kernel_synchronised() is expected


def test_a_refused_call_or_another_platform_is_unknown_and_never_an_error(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr("app.clock.ctypes.CDLL", lambda *a, **k: fake_libc(0, fail=True))
    assert kernel_synchronised() is None
    monkeypatch.setattr("app.clock.ctypes.CDLL", lambda *a, **k: (_ for _ in ()).throw(OSError("no libc")))
    assert kernel_synchronised() is None
    monkeypatch.setattr(sys, "platform", "darwin")
    assert kernel_synchronised() is None


def device_answer(client):
    return client.get("/api/v1/device", headers=new_hub(client).headers).json()


def test_the_answer_carries_the_kernels_verdict_for_each_of_the_three_cases(client, monkeypatch):
    for verdict in (True, False, None):
        monkeypatch.setattr("app.clock.kernel_synchronised", lambda verdict=verdict: verdict)
        assert device_answer(client)["server_time_synced"] is verdict


@pytest.mark.parametrize(
    ("mode", "kernel", "expected"),
    [
        ("true", False, True),
        ("false", True, False),
        ("true", None, True),
        ("false", None, False),
        ("auto", False, False),
        ("auto", None, None),
    ],
)
def test_the_setting_overrides_the_kernel_in_either_direction(client, monkeypatch, mode, kernel, expected):
    monkeypatch.setattr("app.clock.kernel_synchronised", lambda: kernel)
    client.app.state.settings = replace(client.app.state.settings, clock_sync=mode)
    assert device_answer(client)["server_time_synced"] is expected


def test_the_server_still_serves_when_the_clock_is_not_synchronised_and_says_so_plainly(
    settings, monkeypatch, caplog
):
    from fastapi.testclient import TestClient

    from app.main import create_app

    monkeypatch.setattr("app.clock.kernel_synchronised", lambda: False)
    clock._last[0] = "unset"
    with caplog.at_level("INFO", logger="melophos.clock"), TestClient(create_app(settings)) as c:
        assert c.get("/health").status_code == 200
        assert device_answer(c)["server_time_synced"] is False
    assert any("NOT synchronised" in r.message and "timedatectl" in r.message for r in caplog.records)


def test_an_unreadable_status_gives_one_warning_at_start_and_is_treated_as_trusted(
    settings, monkeypatch, caplog
):
    from fastapi.testclient import TestClient

    from app.main import create_app

    monkeypatch.setattr("app.clock.kernel_synchronised", lambda: None)
    clock._last[0] = "unset"
    with caplog.at_level("INFO", logger="melophos.clock"), TestClient(create_app(settings)) as c:
        answers = [device_answer(c) for _ in range(3)]
    assert all(a["server_time_synced"] is None for a in answers)
    assert sum("could not read whether its clock is synchronised" in r.message for r in caplog.records) == 1


def test_a_change_of_state_is_logged(monkeypatch, caplog):
    state = {"now": True}
    monkeypatch.setattr("app.clock.kernel_synchronised", lambda: state["now"])
    clock._last[0] = "unset"
    with caplog.at_level("INFO", logger="melophos.clock"):
        sync_status("auto")
        state["now"] = False
        sync_status("auto")
    assert any("changed to NOT synchronised" in r.message for r in caplog.records)


def test_a_setting_that_is_not_auto_true_or_false_stops_the_server(settings):
    from app.main import create_app

    with pytest.raises(RuntimeError, match="CLOCK_SYNC must be one of"):
        create_app(replace(settings, clock_sync="sometimes"))


def test_sessions_received_while_the_clock_is_not_synchronised_are_marked_and_others_are_not(
    client, monkeypatch
):
    owner = sign_up(client)
    hub = pair(client, owner)
    monkeypatch.setattr("app.clock.kernel_synchronised", lambda: True)
    good = send_session(client, hub)
    monkeypatch.setattr("app.clock.kernel_synchronised", lambda: False)
    unsure = send_session(client, hub)
    monkeypatch.setattr("app.clock.kernel_synchronised", lambda: None)
    unknown = send_session(client, hub)
    assert (good["clock_unsynced"], unsure["clock_unsynced"], unknown["clock_unsynced"]) == (
        False,
        True,
        False,
    )
    listed = {
        s["id"]: s["clock_unsynced"]
        for s in client.get("/api/v1/sessions", headers=owner.headers).json()["items"]
    }
    assert listed[unsure["id"]] is True and listed[good["id"]] is False
