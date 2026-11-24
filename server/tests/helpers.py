"""Small helpers so tests read as what a person does: sign up, pair a hub, send a session."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from itertools import count
from typing import Any

from fastapi.testclient import TestClient

PASSWORD = "correct horse battery"
_emails = count(1)


@dataclass
class Person:
    email: str
    headers: dict[str, str]
    id: str


@dataclass
class Hub:
    device_id: str
    secret: str
    headers: dict[str, str]
    code: str


def sign_up(client: TestClient, email: str | None = None, password: str = PASSWORD) -> Person:
    email = email or f"person{next(_emails)}@example.test"
    response = client.post(
        "/api/v1/auth/signup", json={"email": email, "password": password, "display_name": "Test"}
    )
    assert response.status_code == 202, response.text
    signed_in = client.post("/api/v1/auth/signin", json={"email": email, "password": password})
    assert signed_in.status_code == 200, signed_in.text
    body = signed_in.json()
    return Person(email, {"Authorization": f"Bearer {body['token']}"}, body["user"]["id"])


def new_hub(client: TestClient) -> Hub:
    response = client.post("/api/v1/pairing")
    assert response.status_code == 201, response.text
    body = response.json()
    return Hub(
        body["device_id"],
        body["device_secret"],
        {"Authorization": f"Device {body['device_id']}:{body['device_secret']}"},
        body["code"],
    )


def pair(client: TestClient, person: Person, name: str | None = None) -> Hub:
    hub = new_hub(client)
    response = client.post(
        "/api/v1/devices/pair", json={"code": hub.code, "name": name}, headers=person.headers
    )
    assert response.status_code == 200, response.text
    return hub


SESSION: dict[str, Any] = {
    "profile_id": "piano-88",
    "started_at": (datetime.now(UTC) - timedelta(hours=2)).isoformat(),
    "mode": "free",
    "events": [
        {"t_ms": 0, "note": 60, "velocity": 90},
        {"t_ms": 400, "note": 60, "velocity": 0},
        {"t_ms": 500, "note": 64, "velocity": 70},
        {"t_ms": 900, "note": 64, "velocity": 0},
        {"t_ms": 1000, "note": 60, "velocity": 80},
        {"t_ms": 60000, "note": 60, "velocity": 0},
    ],
}


def send_session(client: TestClient, hub: Hub, **changes: Any) -> dict[str, Any]:
    response = client.post("/api/v1/sessions", json={**SESSION, **changes}, headers=hub.headers)
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body
