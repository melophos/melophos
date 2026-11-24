"""Limits are sliding windows: no stretch of time as long as the window holds more than the limit."""

from unittest.mock import patch

import psycopg
import pytest

from app import accounts as accounts_module
from app.security import RateLimiter

from . import midi_writer as w
from .helpers import PASSWORD, pair, sign_up
from .test_songs import MIDI


def age(database_url, bucket_like, seconds):
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(
            "UPDATE rate_events SET at = at - make_interval(secs => %s) WHERE bucket LIKE %s",
            (seconds, bucket_like),
        )


@pytest.fixture()
def limiter(client):
    return RateLimiter(client.app.state.pool)


def test_hit_allows_exactly_the_limit_in_any_window(limiter, database_url):
    # 5 per 100 seconds. Four attempts happened 95 seconds ago, so a fixed window would have reset by now
    # and let 5 more through right away. A sliding window sees 4 in the last 100 seconds and allows only 1
    for _ in range(4):
        assert limiter.hit("x", 5, 100)
    age(database_url, "x", 95)
    results = [limiter.hit("x", 5, 100) for _ in range(5)]
    assert results == [True, False, False, False, False]
    # 6 seconds on, the four old ones have left the window and four places open
    age(database_url, "x", 6)
    assert [limiter.hit("x", 5, 100) for _ in range(5)] == [True, True, True, True, False]


def test_a_refused_attempt_is_not_recorded(limiter):
    for _ in range(3):
        assert limiter.hit("y", 3, 100)
    for _ in range(50):
        assert not limiter.hit("y", 3, 100)
    assert limiter.count("y", 100) == 3  # so rows stay bounded and the window frees on time


def test_failures_only_buckets_do_not_count_successes(limiter):
    for _ in range(4):
        limiter.add("f")
    assert not limiter.over("f", 5, 100)
    limiter.add("f")
    assert limiter.over("f", 5, 100)


def test_concurrent_attempts_cannot_both_take_the_last_place(limiter):
    import threading

    results = []
    gate = threading.Barrier(8)

    def go():
        gate.wait()
        results.append(limiter.hit("race", 3, 100))

    threads = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count(True) == 3


def signin_status(client, email, password, ip):
    r = client.post(
        "/api/v1/auth/signin", json={"email": email, "password": password}, headers={"X-Forwarded-For": ip}
    )
    return r.status_code


@pytest.fixture()
def proxied(settings):
    from dataclasses import replace

    from fastapi.testclient import TestClient

    from app.main import create_app

    with TestClient(create_app(replace(settings, trusted_proxy_hops=1))) as c:
        yield c


def test_sign_in_has_no_double_burst_at_a_boundary(proxied, database_url):
    sign_up(proxied, "slide@example.test")
    ip = "203.0.113.50"
    assert [signin_status(proxied, "slide@example.test", f"wrong-{i}", ip) for i in range(5)] == [401] * 5
    age(
        database_url, "signin:%", 14 * 60 + 30
    )  # 30 seconds before the 15 minute window would have rolled over
    # a fixed window would now allow five more wrong guesses. The sliding window still holds all five
    assert signin_status(proxied, "slide@example.test", "wrong-again", ip) == 429
    age(database_url, "signin:%", 31)
    assert signin_status(proxied, "slide@example.test", PASSWORD, ip) == 200


def test_pairing_guesses_have_no_double_burst(proxied, database_url):
    person = sign_up(proxied)

    def claim(code):
        return proxied.post("/api/v1/devices/pair", json={"code": code}, headers=person.headers).status_code

    assert [claim("AAAAAAAA") for _ in range(5)] == [404] * 5
    age(database_url, "claim:%", 9 * 60 + 50)
    assert claim("AAAAAAAA") == 429
    age(database_url, "claim:%", 15)
    assert claim("AAAAAAAA") == 404


def test_uploads_have_no_double_burst(client, database_url):
    person = sign_up(client)
    data = w.two_unnamed_tracks().data

    def upload():
        return client.post(
            "/api/v1/songs", params={"title": "t"}, content=data, headers={**person.headers, **MIDI}
        ).status_code

    assert [upload() for _ in range(20)] == [202] * 20
    age(database_url, "song-upload:%", 3600 - 30)
    assert upload() == 429
    age(database_url, "song-upload:%", 60)
    assert upload() == 202


def test_pairing_requests_and_sign_ups_are_sliding_too(proxied, database_url):
    with patch.object(accounts_module, "PER_ADDRESS_PENDING", 1000):  # so the hourly limit is what answers
        codes = [
            proxied.post("/api/v1/pairing", headers={"X-Forwarded-For": "198.51.100.9"}).status_code
            for _ in range(20)
        ]
    assert codes == [201] * 20
    age(database_url, "pairstart:%", 3600 - 30)
    assert proxied.post("/api/v1/pairing", headers={"X-Forwarded-For": "198.51.100.9"}).status_code == 429
    assert pair  # imported for the other tests in this file
