import json
import stat

import httpx
import pytest

from melophos_client import simulator
from melophos_client.api import Client
from melophos_client.credentials import Credentials
from melophos_client.mqtt import batches


def client_with(handler, **kwargs):
    return Client("http://server.test", transport=httpx.MockTransport(handler), **kwargs)


def test_account_calls_send_the_bearer_token_and_device_calls_send_the_device_credential():
    seen = []

    def handler(request):
        seen.append((request.url.path, request.headers.get("authorization")))
        return httpx.Response(200, json={"items": [], "next_cursor": None, "paired": True})

    c = client_with(handler, token="mpa_token", device_id="hub-1", device_secret="mph_secret")
    c.sessions()
    c.device_status()
    c.post_session({"events": []})
    assert seen == [
        ("/api/v1/sessions", "Bearer mpa_token"),
        ("/api/v1/device", "Device hub-1:mph_secret"),
        ("/api/v1/sessions", "Device hub-1:mph_secret"),
    ]


def test_a_call_without_the_right_credential_fails_before_it_is_sent():
    c = client_with(lambda r: httpx.Response(500))
    with pytest.raises(RuntimeError, match="sign in first"):
        c.sessions()
    with pytest.raises(RuntimeError, match="pair the hub first"):
        c.post_session({})


def test_pairing_keeps_the_device_secret_and_sign_in_keeps_the_token():
    def handler(request):
        if request.url.path == "/api/v1/pairing":
            return httpx.Response(
                201,
                json={"device_id": "hub-9", "device_secret": "mph_x", "code": "ABCD-EFGH", "expires_in": 600},
            )
        return httpx.Response(200, json={"token": "mpa_t", "user": {}})

    c = client_with(handler)
    c.start_pairing()
    c.sign_in("a@example.test", "pw")
    assert (c.device_id, c.device_secret, c.token) == ("hub-9", "mph_x", "mpa_t")


def test_iter_sessions_follows_the_cursor_to_the_end():
    pages = {None: {"items": [1, 2], "next_cursor": "c1"}, "c1": {"items": [3], "next_cursor": None}}

    def handler(request):
        return httpx.Response(200, json=pages[request.url.params.get("cursor")])

    assert list(client_with(handler, token="mpa_t").iter_sessions()) == [1, 2, 3]


def test_redirects_are_not_followed():
    c = client_with(lambda r: httpx.Response(302, headers={"Location": "http://elsewhere.test/"}))
    with pytest.raises(httpx.HTTPStatusError):
        c.health()


def test_credentials_are_saved_owner_only_and_round_trip(tmp_path):
    path = tmp_path / "creds.json"
    Credentials("http://s", "hub-1", "mph_secret", boot=3).save(path)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert Credentials.load(path) == Credentials("http://s", "hub-1", "mph_secret", 3)
    Credentials("http://s", "hub-1", "mph_new").save(path)  # saving again keeps the mode
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_batches_group_events_into_quarter_second_windows_in_order():
    events = [{"t_ms": t, "note": 60, "velocity": 50} for t in (0, 100, 249, 250, 900, 1000)]
    grouped = batches(events)
    assert [[e["t_ms"] for e in g] for g in grouped] == [[0, 100, 249], [250], [900], [1000]]
    assert batches([]) == []


def test_pair_prints_the_code_saves_the_secret_and_waits_for_the_owner(tmp_path, monkeypatch, capsys):
    polls = iter([False, False, True])

    def handler(request):
        if request.url.path == "/api/v1/pairing":
            return httpx.Response(
                201,
                json={"device_id": "hub-7", "device_secret": "mph_s", "code": "WXYZ-2345", "expires_in": 600},
            )
        return httpx.Response(200, json={"device_id": "hub-7", "paired": next(polls)})

    real = simulator.Client
    monkeypatch.setattr(
        simulator, "Client", lambda server: real(server, transport=httpx.MockTransport(handler))
    )
    path = tmp_path / "c.json"
    creds = simulator.pair("http://server.test", path, wait_s=5, poll_s=0)
    assert creds.device_id == "hub-7"
    out = capsys.readouterr().out
    assert "WXYZ-2345" in out and "paired as hub-7" in out
    assert json.loads(path.read_text())["device_secret"] == "mph_s"


def test_pair_gives_up_when_the_code_is_never_typed(tmp_path, monkeypatch):
    def handler(request):
        if request.url.path == "/api/v1/pairing":
            return httpx.Response(
                201, json={"device_id": "hub-7", "device_secret": "mph_s", "code": "A", "expires_in": 600}
            )
        return httpx.Response(200, json={"paired": False})

    real = simulator.Client
    monkeypatch.setattr(
        simulator, "Client", lambda server: real(server, transport=httpx.MockTransport(handler))
    )
    with pytest.raises(SystemExit, match="expired"):
        simulator.pair("http://server.test", tmp_path / "c.json", wait_s=0.05, poll_s=0.01)


def test_sending_without_pairing_says_what_to_do(tmp_path):
    profile = tmp_path / "p.json"
    profile.write_text(
        json.dumps({"id": "piano-61", "type": "keyboard", "notes": {"lowest": 36, "highest": 96}})
    )
    with pytest.raises(SystemExit, match="--pair"):
        simulator.main(["--profile", str(profile), "--credentials", str(tmp_path / "missing.json")])
