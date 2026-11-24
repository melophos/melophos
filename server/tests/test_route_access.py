"""Every registered route is classified public, device or account and the classification is real."""

import re

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from starlette.routing import Mount, Route

from app.auth import ACCESS_KEY, require_account, require_device, require_device_any
from app.main import create_app

# framework routes and the metrics app, each a deliberate and reviewed entry
FRAMEWORK_PATHS = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}
MOUNTS = {"/metrics"}
AUTH_CALLS = {require_account, require_device, require_device_any}


def walk(dependant):
    yield dependant.call
    for sub in dependant.dependencies:
        yield from walk(sub)


def flat_routes(routes):
    """FastAPI keeps included routers as lazy nodes, so open each one to reach the routes inside."""
    for route in routes:
        inner = getattr(route, "original_router", None)
        if inner is not None:
            yield from flat_routes(inner.routes)
        else:
            yield route


def api_routes(app: FastAPI) -> list[APIRoute]:
    return [r for r in flat_routes(app.routes) if isinstance(r, APIRoute)]


def problems(app: FastAPI) -> list[str]:
    found = []
    for route in flat_routes(app.routes):
        if isinstance(route, APIRoute):
            if not route.include_in_schema:
                found.append(
                    f"{route.path} is hidden from the OpenAPI document, so the access list cannot cover it"
                )
            label = (route.openapi_extra or {}).get(ACCESS_KEY)
            calls = set(walk(route.dependant)) & AUTH_CALLS
            where = f"{sorted(route.methods)} {route.path}"
            if label not in {"public", "device", "account"}:
                found.append(f"{where} has no access label")
            elif label == "public" and calls:
                found.append(f"{where} is labelled public but checks credentials")
            elif label == "account" and require_account not in calls:
                found.append(f"{where} is labelled account but does not require an account")
            elif label == "device" and not ({require_device, require_device_any} & calls):
                found.append(f"{where} is labelled device but does not require a device")
        elif isinstance(route, Mount):
            if route.path not in MOUNTS:
                found.append(f"unreviewed mount {route.path}")
        elif isinstance(route, Route) and route.path not in FRAMEWORK_PATHS:
            found.append(f"unreviewed route {route.path}")
        elif not isinstance(route, Route):
            # any other kind of route (a WebSocket for one) has no access label to check, so it is refused outright
            found.append(f"unreviewed {type(route).__name__} {getattr(route, 'path', '?')}")
    return found


def fill(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "00000000-0000-0000-0000-000000000000", path)


def test_the_walk_really_finds_the_routes(client):
    # a walker that finds nothing would pass every other test here, so it must find what the OpenAPI document lists
    found = {(m, r.path) for r in api_routes(client.app) for m in r.methods}
    documented = {(m.upper(), path) for path, ops in client.app.openapi()["paths"].items() for m in ops}
    assert found == documented
    assert len(found) >= 15


def test_every_route_is_classified_and_the_label_is_true(client):
    assert problems(client.app) == []


def test_the_openapi_document_carries_every_label(client):
    for path, operations in client.app.openapi()["paths"].items():
        for method, operation in operations.items():
            assert operation[ACCESS_KEY] in {"public", "device", "account"}, (method, path)


def test_an_unlabelled_route_is_caught(settings):
    app = create_app(settings)

    @app.get("/api/v1/forgotten")
    def forgotten() -> dict[str, str]:
        return {"oops": "open"}

    assert problems(app) == ["['GET'] /api/v1/forgotten has no access label"]


def test_a_route_lying_about_its_label_is_caught(settings):
    app = create_app(settings)

    @app.get("/api/v1/liar", openapi_extra={ACCESS_KEY: "account"})
    def liar() -> dict[str, str]:
        return {"oops": "open"}

    assert "liar" in problems(app)[0]


def test_every_non_public_route_refuses_a_caller_with_no_credentials(client):
    checked = 0
    for route in api_routes(client.app):
        label = route.openapi_extra[ACCESS_KEY]
        for method in route.methods:
            response = client.request(method, fill(route.path))
            if label == "public":
                assert response.status_code != 401, (method, route.path)
            else:
                assert response.status_code == 401, (method, route.path, label)
                checked += 1
    assert checked >= 10


def test_account_routes_refuse_a_device_credential_and_the_reverse(client):
    from .helpers import new_hub, sign_up

    hub, person = new_hub(client), sign_up(client)
    for route in api_routes(client.app):
        label = route.openapi_extra[ACCESS_KEY]
        for method in route.methods:
            if label == "account":
                assert client.request(method, fill(route.path), headers=hub.headers).status_code == 401, (
                    route.path
                )
            elif label == "device":
                assert client.request(method, fill(route.path), headers=person.headers).status_code == 401, (
                    route.path
                )


def test_an_unlabelled_websocket_route_is_caught(settings):
    app = create_app(settings)

    @app.websocket("/ws/everything")
    async def everything(socket) -> None:  # pragma: no cover - never connected
        await socket.accept()

    assert any("WebSocketRoute" in p and "/ws/everything" in p for p in problems(app)), problems(app)


# every account route, asked for account A's things by account B, with no hand-written list of routes


BODIES = {
    ("PUT", "/hands"): {"changes": [{"idx": 0, "hand": "left"}]},
    ("POST", "/enable"): {"password": "correct horse battery"},
}


def a_world(client):
    from . import midi_writer as w
    from .helpers import new_hub, pair, send_session, sign_up
    from .test_songs import MIDI, run_worker

    a, b = sign_up(client), sign_up(client)
    hub = pair(client, a)
    session = send_session(client, hub)
    song = client.post(
        "/api/v1/songs",
        params={"title": "A"},
        content=w.two_unnamed_tracks().data,
        headers={**a.headers, **MIDI},
    ).json()
    run_worker(client)
    client.app.state.resolver = lambda host, port: ["93.184.216.34"]
    endpoint = client.post(
        "/api/v1/webhooks",
        json={"url": "https://good.example/h", "password": "correct horse battery"},
        headers=a.headers,
    ).json()
    client.post("/api/v1/auth/signin", json={"email": a.email, "password": "correct horse battery"}).json()
    sign_ins = client.get("/api/v1/auth/sessions", headers=a.headers).json()
    other = next(s for s in sign_ins if not s["current"])
    ids = {
        "session_id": session["id"],
        "device_id": hub.device_id,
        "song_id": song["id"],
        "endpoint_id": endpoint["id"],
    }
    return a, b, ids, other["id"], new_hub


def leaks(client, a, b, ids, auth_session_id) -> list[str]:
    """Calls every account route as B with A's ids and reports anything but a 404 and any A id in a list answer."""
    found = []
    for route in api_routes(client.app):
        if route.openapi_extra[ACCESS_KEY] != "account":
            continue
        names = re.findall(r"\{(\w+)\}", route.path)
        for method in sorted(route.methods):
            if method == "HEAD" or (not names and method != "GET"):
                continue  # a route with no id acts on the caller's own things, which is no leak
            path = route.path
            for name in names:
                value = (
                    auth_session_id if "/auth/sessions/" in path and name == "session_id" else ids.get(name)
                )
                if value is None:
                    # a route with an id this check does not know would be skipped silently, so it fails instead
                    raise AssertionError(
                        f"{method} {route.path} has the id {name!r}, which the cross-account check cannot fill"
                    )
                path = path.replace("{" + name + "}", str(value))
            else:
                suffix = "/" + route.path.rsplit("/", 1)[-1]
                body = BODIES.get((method, suffix))
                kwargs = {"json": body} if body is not None else {}
                response = client.request(method, path, headers=b.headers, **kwargs)
                if names and response.status_code != 404:
                    found.append(
                        f"{method} {route.path} answered {response.status_code} to the other account"
                    )
                if not names and method == "GET":
                    text = response.text
                    found += [
                        f"{method} {route.path} listed {k}"
                        for k, v in {**ids, "auth": auth_session_id}.items()
                        if str(v) in text
                    ]
    return found


def test_the_other_account_gets_a_404_from_every_account_route_and_sees_nothing_in_lists(client):
    a, b, ids, auth_id, _ = a_world(client)
    assert leaks(client, a, b, ids, auth_id) == []
    # and A's things are all still there afterwards, so none of those calls changed anything
    assert client.get(f"/api/v1/sessions/{ids['session_id']}", headers=a.headers).status_code == 200
    assert client.get(f"/api/v1/songs/{ids['song_id']}", headers=a.headers).status_code == 200
    assert client.get(f"/api/v1/devices/{ids['device_id']}", headers=a.headers).status_code == 200
    assert client.get(f"/api/v1/webhooks/{ids['endpoint_id']}", headers=a.headers).status_code == 200


def test_a_route_that_hands_out_everyones_data_fails_the_cross_account_check(client):

    from app.auth import access, require_account  # noqa: F401

    a, b, ids, auth_id, _ = a_world(client)

    @client.app.get("/api/v1/leaky/{session_id}", **access("account"))
    def leaky(session_id: str):
        return client.app.state.store.get(session_id)  # no owner check: the bug the check exists to catch

    found = leaks(client, a, b, ids, auth_id)
    assert any("/api/v1/leaky/{session_id}" in f for f in found), found


def test_the_cross_account_check_fails_on_a_route_with_an_id_it_does_not_know(client):
    from app.auth import access

    a, b, ids, auth_id, _ = a_world(client)

    @client.app.get("/api/v1/novel/{mystery_id}", **access("account"))
    def novel(mystery_id: str):
        return {}

    with pytest.raises(AssertionError, match="mystery_id"):
        leaks(client, a, b, ids, auth_id)
