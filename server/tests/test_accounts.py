import hashlib
from unittest.mock import patch

import psycopg
import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.security import PasswordService

from .helpers import PASSWORD, sign_up


def signin(client, email, password, ip=None):
    headers = {"X-Forwarded-For": ip} if ip else {}
    return client.post("/api/v1/auth/signin", json={"email": email, "password": password}, headers=headers)


def test_sign_up_then_sign_in_then_me(client):
    person = sign_up(client, "Ada@Example.test")
    response = signin(client, "ada@example.TEST", PASSWORD)
    assert response.status_code == 200
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {response.json()['token']}"})
    assert me.json()["email"] == "ada@example.test"
    assert person.email == "Ada@Example.test"


def post_signup(client, email, password=PASSWORD, name="x"):
    return client.post(
        "/api/v1/auth/signup", json={"email": email, "password": password, "display_name": name}
    )


def test_sign_up_answers_the_same_whether_or_not_the_address_exists(client):
    sign_up(client, "taken@example.test")
    taken = post_signup(client, "TAKEN@example.test", "another long password")
    fresh = post_signup(client, "fresh@example.test", "another long password")
    assert (taken.status_code, taken.json()) == (fresh.status_code, fresh.json()) == (202, taken.json())
    assert set(taken.headers) - {"date"} == set(fresh.headers) - {"date"}
    assert "token" not in taken.text


def test_sign_up_for_a_taken_address_changes_nothing_for_its_owner(client):
    owner = sign_up(client, "owner2@example.test")
    post_signup(client, "owner2@example.test", "attacker chosen password")
    assert signin(client, owner.email, PASSWORD).status_code == 200
    assert signin(client, owner.email, "attacker chosen password").status_code == 401


def test_a_new_person_signs_in_after_signing_up(client):
    assert post_signup(client, "newcomer@example.test").status_code == 202
    assert signin(client, "newcomer@example.test", PASSWORD).status_code == 200


def test_sign_up_costs_one_hash_whether_or_not_the_address_exists(client):
    sign_up(client, "present@example.test")
    counter = CountVerify()
    hashes = {"n": 0}
    original = PasswordHasher.hash

    def counting_hash(hasher, *args, **kwargs):
        hashes["n"] += 1
        return original(hasher, *args, **kwargs)

    with (
        patch.object(PasswordHasher, "hash", counting_hash),
        patch.object(PasswordHasher, "verify", counter.function),
    ):
        post_signup(client, "present@example.test")
        taken = hashes["n"]
        post_signup(client, "absent@example.test")
        fresh = hashes["n"] - taken
    assert (taken, fresh) == (1, 1)
    assert counter.calls == 0


def test_a_malformed_sign_up_reveals_nothing_about_existing_addresses(client):
    sign_up(client, "exists@example.test")
    a = post_signup(client, "exists@example.test", "short")
    b = post_signup(client, "missing@example.test", "short")
    assert (a.status_code, a.json()) == (b.status_code, b.json())


def test_pairing_and_device_checks_reveal_nothing_about_which_ids_exist(client):
    from .helpers import new_hub

    hub = new_hub(client)
    wrong_secret = client.get(
        "/api/v1/device", headers={"Authorization": f"Device {hub.device_id}:mph_{'a' * 43}"}
    )
    unknown_id = client.get(
        "/api/v1/device", headers={"Authorization": f"Device hub-ffffffffff:mph_{'a' * 43}"}
    )
    assert (wrong_secret.status_code, wrong_secret.json()) == (unknown_id.status_code, unknown_id.json())
    person = sign_up(client)
    real = client.get(f"/api/v1/devices/{hub.device_id}", headers=person.headers)  # exists, owned by nobody
    absent = client.get("/api/v1/devices/hub-ffffffffff", headers=person.headers)
    assert (real.status_code, real.json()) == (absent.status_code, absent.json())


@pytest.mark.parametrize(
    ("email", "password"),
    [
        ("not-an-address", PASSWORD),
        ("a@b", PASSWORD),
        ("ok@example.test", "short"),
        ("ok@example.test", "x" * 200),
    ],
)
def test_bad_sign_up_input_is_refused(client, email, password):
    response = client.post(
        "/api/v1/auth/signup", json={"email": email, "password": password, "display_name": "x"}
    )
    assert response.status_code == 422


def test_passwords_and_tokens_are_never_stored_in_the_clear(client, database_url):
    person = sign_up(client, "store@example.test")
    token = person.headers["Authorization"].removeprefix("Bearer ")
    with psycopg.connect(database_url) as conn:
        stored = conn.execute(
            "SELECT password_hash FROM users WHERE email = 'store@example.test'"
        ).fetchone()[0]
        assert stored.startswith("$argon2id$")
        tables = [r[0] for r in conn.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")]
        for table in tables:
            dump = "\n".join(r[0] for r in conn.execute(f'SELECT row_to_json(t)::text FROM "{table}" t'))  # noqa: S608
            assert PASSWORD not in dump, table
            assert token not in dump, table
        stored_digest = conn.execute("SELECT token_hash FROM auth_sessions").fetchone()[0]
    assert bytes(stored_digest) == hashlib.sha256(token.encode()).digest()


def test_the_default_hash_cost_meets_the_owasp_minimum():
    memory, time_cost = Settings().argon2_memory_kib, Settings().argon2_time_cost
    assert (memory, time_cost) == (19456, 2)
    assert PasswordService(memory, time_cost).hash("x").startswith("$argon2id$v=19$m=19456,t=2,p=1$")


class CountVerify:
    """Stands in for PasswordHasher.verify and counts how many argon2 checks really ran."""

    def __init__(self):
        self.calls = 0
        original = PasswordHasher.verify

        def counting(hasher, *args, **kwargs):
            self.calls += 1
            return original(hasher, *args, **kwargs)

        self.function = counting


def test_one_hash_check_per_attempt_whether_or_not_the_address_exists(client):
    sign_up(client, "real@example.test")
    counter = CountVerify()
    with patch.object(PasswordHasher, "verify", counter.function):
        assert signin(client, "real@example.test", "wrong password").status_code == 401
        known_wrong = counter.calls
        assert signin(client, "nobody@example.test", "wrong password").status_code == 401
        unknown = counter.calls - known_wrong
        assert signin(client, "real@example.test", PASSWORD).status_code == 200
        right = counter.calls - known_wrong - unknown
    assert (known_wrong, unknown, right) == (1, 1, 1)


def test_unknown_address_and_wrong_password_look_the_same(client):
    sign_up(client, "real@example.test")
    a = signin(client, "real@example.test", "wrong password")
    b = signin(client, "nobody@example.test", "wrong password")
    assert (a.status_code, a.json()) == (b.status_code, b.json())


def test_signing_out_revokes_the_token(client):
    person = sign_up(client)
    assert client.get("/api/v1/auth/me", headers=person.headers).status_code == 200
    assert client.post("/api/v1/auth/signout", headers=person.headers).status_code == 204
    assert client.get("/api/v1/auth/me", headers=person.headers).status_code == 401


def test_one_sign_in_can_end_another(client):
    person = sign_up(client)
    other = signin(client, person.email, PASSWORD).json()
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    listing = client.get("/api/v1/auth/sessions", headers=person.headers).json()
    assert len(listing) == 2
    assert sum(item["current"] for item in listing) == 1
    victim = next(item for item in listing if not item["current"])
    assert client.delete(f"/api/v1/auth/sessions/{victim['id']}", headers=person.headers).status_code == 204
    assert client.get("/api/v1/auth/me", headers=other_headers).status_code == 401
    assert client.get("/api/v1/auth/me", headers=person.headers).status_code == 200


def test_expired_sign_ins_stop_working(client, database_url):
    person = sign_up(client)
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute("UPDATE auth_sessions SET expires_at = now() - interval '1 second'")
    assert client.get("/api/v1/auth/me", headers=person.headers).status_code == 401


def test_changing_the_password_ends_the_other_sign_ins(client):
    person = sign_up(client)
    other = signin(client, person.email, PASSWORD).json()
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    response = client.post(
        "/api/v1/auth/password",
        json={"current_password": PASSWORD, "new_password": "a brand new password"},
        headers=person.headers,
    )
    assert response.status_code == 204
    assert client.get("/api/v1/auth/me", headers=other_headers).status_code == 401
    assert client.get("/api/v1/auth/me", headers=person.headers).status_code == 200
    assert signin(client, person.email, PASSWORD).status_code == 401
    assert signin(client, person.email, "a brand new password").status_code == 200


def test_the_wrong_current_password_changes_nothing(client):
    person = sign_up(client)
    response = client.post(
        "/api/v1/auth/password",
        json={"current_password": "nope nope nope", "new_password": "another long one"},
        headers=person.headers,
    )
    assert response.status_code == 401
    assert signin(client, person.email, PASSWORD).status_code == 200


@pytest.mark.parametrize(
    "header", ["", "Bearer", "Bearer x", "Basic abc", "Bearer mph_abc", "bearer mpa_" + "a" * 500]
)
def test_malformed_credentials_are_401(client, header):
    assert client.get("/api/v1/auth/me", headers={"Authorization": header}).status_code == 401


def test_closed_sign_ups(settings):
    closed = Settings(**{**settings.__dict__, "allow_signup": False})
    with TestClient(create_app(closed)) as c:
        response = c.post(
            "/api/v1/auth/signup", json={"email": "a@example.test", "password": PASSWORD, "display_name": "x"}
        )
    assert response.status_code == 403


@pytest.fixture()
def proxied(settings):
    # one proxy in front, so X-Forwarded-For gives each test caller an address of its own
    with TestClient(create_app(Settings(**{**settings.__dict__, "trusted_proxy_hops": 1}))) as c:
        yield c


def test_repeated_failures_from_one_address_are_stopped(proxied):
    sign_up(proxied, "target@example.test")
    codes = [
        signin(proxied, "target@example.test", f"wrong-guess-{i}", ip="203.0.113.9").status_code
        for i in range(7)
    ]
    assert codes[:5] == [401] * 5
    assert codes[5:] == [429, 429]
    blocked = signin(proxied, "target@example.test", PASSWORD, ip="203.0.113.9")
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers


def test_a_stranger_cannot_lock_the_owner_out(proxied):
    sign_up(proxied, "owner@example.test")
    for i in range(30):
        signin(proxied, "owner@example.test", f"attacker-guess-{i}", ip="198.51.100.7")
    assert signin(proxied, "owner@example.test", "x" * 12, ip="198.51.100.7").status_code == 429
    # the owner, from their own address, is unaffected however long the attack runs
    assert signin(proxied, "owner@example.test", PASSWORD, ip="192.0.2.44").status_code == 200


def test_successful_sign_ins_do_not_use_up_the_allowance(proxied):
    sign_up(proxied, "busy@example.test")
    for _ in range(12):
        assert signin(proxied, "busy@example.test", PASSWORD, ip="192.0.2.50").status_code == 200


def test_a_rate_limited_attempt_costs_no_hash(proxied):
    for i in range(6):
        signin(proxied, "ghost@example.test", f"guess-number-{i}", ip="203.0.113.77")
    counter = CountVerify()
    with patch.object(PasswordHasher, "verify", counter.function):
        assert signin(proxied, "ghost@example.test", "one more guess", ip="203.0.113.77").status_code == 429
    assert counter.calls == 0


def test_the_forwarded_header_is_ignored_without_a_trusted_proxy(client):
    # with no proxy configured an attacker cannot pick a fresh address per request
    sign_up(client, "fixed@example.test")
    codes = [
        signin(client, "fixed@example.test", f"wrong-guess-{i}", ip=f"10.9.9.{i}").status_code
        for i in range(7)
    ]
    assert codes[-1] == 429


def test_sign_up_is_rate_limited_per_address(proxied):
    results = [
        proxied.post(
            "/api/v1/auth/signup",
            json={"email": f"bulk{i}@example.test", "password": PASSWORD, "display_name": "x"},
            headers={"X-Forwarded-For": "203.0.113.200"},
        ).status_code
        for i in range(12)
    ]
    assert results[:10] == [202] * 10
    assert results[10:] == [429, 429]
