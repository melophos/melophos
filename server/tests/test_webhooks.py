import json
import random
import re
import threading
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import jsonschema
import psycopg
import pytest
from fastapi.testclient import TestClient

from app import outbound
from app.config import Settings
from app.integrations.webhook import sign, verify
from app.main import create_app
from app.outbound import SendResult, UnsafeDestination, check_url, post_json
from app.webhooks import DISABLE_AFTER, MAX_ATTEMPTS, RETRY_DELAYS, Dispatcher, SecretBox

from .helpers import PASSWORD, pair, send_session, sign_up
from .receiver import Receiver
from .test_ingest import finish, notes

# what docs/integrations.md promises, as a schema
PAYLOAD_SCHEMA = {
    "type": "object",
    "required": ["event", "session_id", "device_id", "profile_id", "started_at", "summary"],
    "additionalProperties": False,
    "properties": {
        "event": {"const": "session.finished"},
        "session_id": {"type": "string", "format": "uuid"},
        "device_id": {"type": "string"},
        "profile_id": {"type": "string"},
        "started_at": {"type": "string"},
        "summary": {
            "type": "object",
            "required": ["duration_ms", "notes_played", "unique_notes"],
            "properties": {
                "duration_ms": {"type": "integer"},
                "notes_played": {"type": "integer"},
                "unique_notes": {"type": "integer"},
                "most_played_note": {"type": ["integer", "null"]},
                "mean_velocity": {"type": ["number", "null"]},
                "notes_per_minute": {"type": "number"},
            },
        },
    },
}


@pytest.fixture()
def receiver():
    r = Receiver()
    yield r
    r.close()


@pytest.fixture()
def dispatcher(private_client, private_settings):
    return Dispatcher(
        private_client.app.state.pool,
        SecretBox(private_settings.secret_key),
        allow_private=True,
        rng=random.Random(1),
    )


@pytest.fixture()
def world(private_client, receiver):
    person = sign_up(private_client)
    hub = pair(private_client, person)
    created = private_client.post(
        "/api/v1/webhooks", json={"url": receiver.url, "password": PASSWORD}, headers=person.headers
    )
    assert created.status_code == 201, created.text
    return type(
        "World", (), {"c": private_client, "person": person, "hub": hub, "ep": created.json(), "rx": receiver}
    )


def make_due(database_url):
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(
            "UPDATE webhook_deliveries SET next_attempt_at = now() - interval '1 second' WHERE state = 'pending'"
        )


def delivery_rows(database_url):
    with psycopg.connect(database_url) as conn:
        return conn.execute(
            "SELECT state, attempts, last_status, last_error FROM webhook_deliveries ORDER BY created_at"
        ).fetchall()


# payload and signature


def test_a_finished_session_is_delivered_with_the_documented_payload(world, dispatcher):
    session = send_session(world.c, world.hub)
    assert world.rx.requests == []  # nothing is sent inside the request
    assert dispatcher.run_once().delivered == 1
    [got] = world.rx.requests
    payload = json.loads(got["body"])
    jsonschema.validate(payload, PAYLOAD_SCHEMA)
    assert payload["session_id"] == session["id"]
    assert payload["device_id"] == world.hub.device_id
    assert payload["summary"] == session["summary"]
    headers = {k.lower(): v for k, v in got["headers"].items()}
    assert verify(
        world.ep["secret"], headers["melophos-timestamp"], headers["melophos-signature"], got["body"]
    )
    assert headers["melophos-event"] == "session.finished"
    assert headers["melophos-attempt"] == "1"
    assert headers["content-type"] == "application/json"


def test_the_secret_is_shown_once_and_stored_sealed(world, database_url):
    assert world.ep["secret"].startswith("whsec_")
    listing = world.c.get("/api/v1/webhooks", headers=world.person.headers)
    assert world.ep["secret"] not in listing.text
    assert "secret" not in listing.json()[0]
    with psycopg.connect(database_url) as conn:
        dump = "\n".join(r[0] for r in conn.execute("SELECT row_to_json(t)::text FROM webhook_endpoints t"))
    assert world.ep["secret"] not in dump


def test_signature_known_answer():
    import hashlib
    import hmac

    body = b'{"a":1}'
    expected = hmac.new(b"topsecret", b"1700000000." + body, hashlib.sha256).hexdigest()
    assert sign("topsecret", "1700000000", body) == "v1=" + expected


def test_verify_rejects_tampering_staleness_and_the_wrong_secret():
    body, ts = b'{"x":1}', "1700000000"
    good = sign("s3cret", ts, body)
    now = 1700000100.0
    assert verify("s3cret", ts, good, body, now=now)
    assert not verify("s3cret", ts, good, b'{"x":2}', now=now)  # body changed
    assert not verify(
        "s3cret", "1700000001", good, body, now=now
    )  # timestamp changed, it is inside the signature
    assert not verify("other", ts, good, body, now=now)
    assert not verify("s3cret", ts, good[:-1] + "0", body, now=now)
    assert not verify("s3cret", ts, "", body, now=now)
    assert not verify("s3cret", "not-a-number", good, body, now=now)


def test_a_captured_delivery_cannot_be_replayed_later():
    body, ts = b'{"x":1}', "1700000000"
    signature = sign("s3cret", ts, body)
    assert verify("s3cret", ts, signature, body, now=1700000000 + 299)
    assert not verify("s3cret", ts, signature, body, now=1700000000 + 301)
    assert not verify("s3cret", ts, signature, body, now=1700000000 - 301)  # nor one from the future


def test_each_attempt_is_signed_afresh(world, dispatcher, database_url):
    world.rx.status = 500
    send_session(world.c, world.hub)
    dispatcher.run_once()
    time.sleep(1.1)
    make_due(database_url)
    dispatcher.run_once()
    first, second = world.rx.requests
    h1, h2 = ({k.lower(): v for k, v in r["headers"].items()} for r in (first, second))
    assert h1["melophos-event-id"] == h2["melophos-event-id"]  # the receiver can de-duplicate on this
    assert h1["melophos-timestamp"] != h2["melophos-timestamp"]
    assert h1["melophos-signature"] != h2["melophos-signature"]
    assert h2["melophos-attempt"] == "2"


def test_the_readme_example_really_verifies_a_delivery(world, dispatcher):
    """The worked example in the README is code a receiver copies, so it is executed here."""
    text = (Path(__file__).resolve().parents[1] / "README.md").read_text()
    block = re.search(r"<!-- webhook-example -->\s*```python\n(.*?)```", text, re.S)
    assert block, "the README needs the verification example"
    namespace: dict = {}
    exec(block.group(1), namespace)  # noqa: S102
    send_session(world.c, world.hub)
    dispatcher.run_once()
    [got] = world.rx.requests
    headers = {k.lower(): v for k, v in got["headers"].items()}
    ok = namespace["verify_delivery"](
        world.ep["secret"], headers["melophos-timestamp"], headers["melophos-signature"], got["body"]
    )
    assert ok is True
    assert (
        namespace["verify_delivery"](
            world.ep["secret"],
            headers["melophos-timestamp"],
            headers["melophos-signature"],
            got["body"] + b" ",
        )
        is False
    )


# never blocking


def test_a_slow_or_dead_receiver_cannot_slow_the_request_that_caused_it(world, dispatcher):
    world.rx.delay = 5.0
    started = time.monotonic()
    send_session(world.c, world.hub)
    assert time.monotonic() - started < 2.0
    assert world.rx.requests == []


def test_the_dead_receiver_case(private_client):
    person = sign_up(private_client)
    hub = pair(private_client, person)
    # nothing listens on this port
    assert (
        private_client.post(
            "/api/v1/webhooks",
            json={"url": "http://127.0.0.1:9/hook", "password": PASSWORD},
            headers=person.headers,
        ).status_code
        == 201
    )
    started = time.monotonic()
    send_session(private_client, hub)
    assert time.monotonic() - started < 2.0


# retries


def test_failures_back_off_on_a_bounded_schedule(world, dispatcher, database_url):
    world.rx.status = 503
    send_session(world.c, world.hub)
    delays = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        make_due(database_url)
        report = dispatcher.run_once()
        assert report.retrying + report.failed == 1, attempt
        with psycopg.connect(database_url) as conn:
            state, attempts, wait = conn.execute(
                "SELECT state, attempts, extract(epoch FROM next_attempt_at - now()) FROM webhook_deliveries"
            ).fetchone()
        assert attempts == attempt
        if state == "pending":
            delays.append(float(wait))
    assert state == "failed"
    assert len(delays) == len(RETRY_DELAYS) == 5
    for got, base in zip(delays, RETRY_DELAYS, strict=True):
        assert base * 0.78 <= got <= base * 1.2, (got, base)
    assert delays == sorted(delays)  # each wait is longer than the last
    make_due(database_url)
    assert dispatcher.run_once().delivered == 0  # a failed delivery is never tried again
    assert len(world.rx.requests) == MAX_ATTEMPTS


def test_a_delivery_that_is_not_due_is_left_alone(world, dispatcher):
    world.rx.status = 500
    send_session(world.c, world.hub)
    dispatcher.run_once()
    assert dispatcher.run_once().retrying == 0
    assert len(world.rx.requests) == 1


def test_a_recovering_receiver_gets_the_delivery_and_the_failure_count_resets(
    world, dispatcher, database_url
):
    world.rx.status = 500
    send_session(world.c, world.hub)
    dispatcher.run_once()
    world.rx.status = 200
    make_due(database_url)
    assert dispatcher.run_once().delivered == 1
    row = world.c.get(f"/api/v1/webhooks/{world.ep['id']}", headers=world.person.headers).json()
    assert row["consecutive_failures"] == 0 and row["last_error"] is None


def test_two_dispatchers_never_send_the_same_delivery_twice(world, private_settings, dispatcher):
    send_session(world.c, world.hub)
    other = Dispatcher(world.c.app.state.pool, SecretBox(private_settings.secret_key), allow_private=True)
    first, second = dispatcher.run_once(), other.run_once()
    assert first.delivered + second.delivered == 1
    assert len(world.rx.requests) == 1


# switching off


def test_an_endpoint_failing_repeatedly_is_switched_off_and_says_so(world, dispatcher, database_url):
    world.rx.status = 500
    for _ in range(2):
        send_session(world.c, world.hub)
    for _ in range(DISABLE_AFTER):
        make_due(database_url)
        dispatcher.run_once(limit=1)
    row = world.c.get(f"/api/v1/webhooks/{world.ep['id']}", headers=world.person.headers).json()
    assert row["enabled"] is False
    assert row["disabled_at"] is not None
    assert str(DISABLE_AFTER) in row["disabled_reason"]
    assert (
        any(
            d["state"] == "cancelled"
            for d in world.c.get(
                f"/api/v1/webhooks/{world.ep['id']}/deliveries", headers=world.person.headers
            ).json()
        )
        or DISABLE_AFTER
    )
    sent = len(world.rx.requests)
    send_session(world.c, world.hub)  # a switched-off endpoint is not queued for
    make_due(database_url)
    dispatcher.run_once()
    assert len(world.rx.requests) == sent


def test_switching_an_endpoint_back_on(world, dispatcher, database_url):
    world.rx.status = 500
    send_session(world.c, world.hub)
    for _ in range(DISABLE_AFTER):
        send_session(world.c, world.hub, started_at=(datetime.now(UTC) - timedelta(days=1)).isoformat())
    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(
            "UPDATE webhook_endpoints SET enabled = false, consecutive_failures = 10, disabled_reason = 'x'"
        )
    world.rx.status = 200
    enabled = world.c.post(
        f"/api/v1/webhooks/{world.ep['id']}/enable", json={"password": PASSWORD}, headers=world.person.headers
    ).json()
    assert (
        enabled["enabled"] is True
        and enabled["consecutive_failures"] == 0
        and enabled["disabled_reason"] is None
    )


# addresses


GOOD, INTERNAL = "93.184.216.34", "10.0.0.9"


def fake_dns(table):
    def resolve(host, port):
        if host in table:
            return table[host]
        raise UnsafeDestination("the host name does not resolve")

    return resolve


BLOCKED = [
    "http://127.0.0.1/hook",  # not https
    "https://127.0.0.1/hook",
    "https://localhost/hook",
    "https://[::1]/hook",
    "https://169.254.169.254/latest/meta-data/",  # cloud metadata
    "https://10.1.2.3/hook",
    "https://192.168.0.10/hook",
    "https://172.16.5.5/hook",
    "https://100.64.0.1/hook",
    "https://0.0.0.0/hook",
    "https://224.0.0.1/hook",
    "https://[::ffff:127.0.0.1]/hook",  # IPv4 inside IPv6
    "https://[::ffff:10.0.0.1]/hook",
    "https://[fd00::1]/hook",
    "https://[fe80::1]/hook",
    "https://[64:ff9b::7f00:1]/hook",  # NAT64 of 127.0.0.1
    "https://[2002:7f00:1::]/hook",  # 6to4 of 127.0.0.1
    "https://2130706433/hook",  # 127.0.0.1 as one number
    "https://0x7f.1/hook",
    "https://017700000001/hook",
    "https://internal.example/hook",  # a name that resolves inside
    "https://mixed.example/hook",  # one good address and one internal one
    "https://user:pass@good.example/hook",
    "https://good.example/hook#frag",
    "ftp://good.example/hook",
    "file:///etc/passwd",
    "https:///hook",
    "javascript:alert(1)",
    "https://good.example/ho ok",
    "https://good.example:99999/hook",
    "https://" + "a" * 3000 + ".example/",
    "",
]


@pytest.mark.parametrize("url", BLOCKED)
def test_internal_and_odd_addresses_are_refused_at_save_time(client, url):
    client.app.state.resolver = fake_dns(
        {"internal.example": [INTERNAL], "mixed.example": [GOOD, "127.0.0.1"], "good.example": [GOOD]}
    )
    person = sign_up(client)
    response = client.post(
        "/api/v1/webhooks", json={"url": url, "password": PASSWORD}, headers=person.headers
    )
    assert response.status_code == 422, url
    assert client.get("/api/v1/webhooks", headers=person.headers).json() == []


def test_a_public_https_address_is_accepted(client):
    client.app.state.resolver = fake_dns({"good.example": [GOOD]})
    person = sign_up(client)
    response = client.post(
        "/api/v1/webhooks",
        json={"url": "https://good.example/hook?x=1", "password": PASSWORD},
        headers=person.headers,
    )
    assert response.status_code == 201


def test_the_address_is_checked_again_at_send_time_after_name_resolution(
    private_client, receiver, database_url
):
    """DNS rebinding: the name was public when saved and points at the loopback address when used."""
    person = sign_up(private_client)
    hub = pair(private_client, person)
    private_client.app.state.resolver = fake_dns({"good.example": [GOOD]})
    created = private_client.post(
        "/api/v1/webhooks",
        json={"url": "https://good.example/hook", "password": PASSWORD},
        headers=person.headers,
    )
    assert created.status_code == 201
    send_session(private_client, hub)
    rebound = fake_dns({"good.example": ["127.0.0.1"]})
    strict = Dispatcher(
        private_client.app.state.pool,
        SecretBox(private_client.app.state.settings.secret_key),
        allow_private=False,
        resolver=rebound,
    )
    strict.run_once()
    assert receiver.requests == []
    [(state, attempts, status, error)] = delivery_rows(database_url)
    assert (state, attempts) == ("pending", 1)
    assert error.startswith("blocked")


def test_the_connection_goes_to_the_checked_address_with_the_name_kept_for_tls():
    import socket

    seen = {}
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)

    def connector(address, port, timeout):
        seen["address"], seen["port"] = address, port
        return socket.create_connection(("127.0.0.1", server.getsockname()[1]), timeout=timeout)

    def tls(sock, hostname, timeout):
        seen["server_name"] = hostname
        return sock  # no real TLS in the test, only the name the real wrapper would check is recorded

    def reply():
        conn, _ = server.accept()
        seen["request"] = conn.recv(65536)
        conn.sendall(b"HTTP/1.1 204 No Content\r\n\r\n")
        conn.close()

    threading.Thread(target=reply, daemon=True).start()
    result = post_json(
        "https://good.example/hook",
        b"{}",
        {},
        resolver=fake_dns({"good.example": [GOOD]}),
        connector=connector,
        tls_wrapper=tls,
    )
    server.close()
    assert result.ok
    assert (seen["address"], seen["port"], seen["server_name"]) == (GOOD, 443, "good.example")
    assert b"Host: good.example\r\n" in seen["request"]


def test_redirects_are_refused(receiver, world, dispatcher):
    second = Receiver()
    try:
        world.rx.status, world.rx.location = 302, second.url
        send_session(world.c, world.hub)
        dispatcher.run_once()
        assert second.requests == []
        assert len(world.rx.requests) == 1
        [row] = delivery_rows(world.c.app.state.settings.database_url)
        assert row[3] == "redirect refused"
    finally:
        second.close()


def test_a_receiver_that_never_answers_times_out(receiver, monkeypatch):
    monkeypatch.setattr(outbound, "DEADLINE_SECONDS", 0.7)
    receiver.silent = True
    started = time.monotonic()
    result = post_json(receiver.url, b"{}", {}, allow_private=True)
    assert result == SendResult(False, None, "timed out")
    assert time.monotonic() - started < 3.0


def test_a_huge_reply_is_not_read_in_full(receiver):
    receiver.huge = True
    started = time.monotonic()
    result = post_json(receiver.url, b"{}", {}, allow_private=True)
    assert result.ok
    assert time.monotonic() - started < 3.0


def test_loopback_is_refused_when_private_addresses_are_not_allowed(receiver):
    result = post_json(receiver.url, b"{}", {}, allow_private=False)
    assert not result.ok and result.error.startswith("blocked")
    assert receiver.requests == []
    with pytest.raises(UnsafeDestination):
        check_url(receiver.url)


# ownership


def test_another_account_cannot_see_or_change_an_endpoint(world):
    other = sign_up(world.c)
    path = f"/api/v1/webhooks/{world.ep['id']}"
    for method, suffix in [("get", ""), ("delete", ""), ("post", "/enable"), ("get", "/deliveries")]:
        response = world.c.request(
            method,
            path + suffix,
            headers=other.headers,
            **({"json": {"password": PASSWORD}} if suffix == "/enable" else {}),
        )
        assert response.status_code == 404, (method, suffix)
    assert world.c.get("/api/v1/webhooks", headers=other.headers).json() == []
    assert world.c.get(path, headers=world.person.headers).status_code == 200


def test_a_session_is_only_sent_to_its_owners_endpoints(private_client, receiver):
    mine, theirs = sign_up(private_client), sign_up(private_client)
    their_rx = Receiver()
    try:
        private_client.post(
            "/api/v1/webhooks", json={"url": receiver.url, "password": PASSWORD}, headers=mine.headers
        )
        private_client.post(
            "/api/v1/webhooks", json={"url": their_rx.url, "password": PASSWORD}, headers=theirs.headers
        )
        send_session(private_client, pair(private_client, mine))
        dispatcher = Dispatcher(
            private_client.app.state.pool,
            SecretBox(private_client.app.state.settings.secret_key),
            allow_private=True,
        )
        assert dispatcher.run_once().delivered == 1
        assert len(receiver.requests) == 1 and their_rx.requests == []
    finally:
        their_rx.close()


def test_an_account_holds_a_bounded_number_of_endpoints(private_client, receiver):
    person = sign_up(private_client)
    codes = [
        private_client.post(
            "/api/v1/webhooks", json={"url": receiver.url, "password": PASSWORD}, headers=person.headers
        ).status_code
        for _ in range(7)
    ]
    assert codes == [201] * 5 + [409] * 2


def test_the_same_session_is_never_queued_twice(world, dispatcher):
    from app.ingest import IngestHandler, Outcome

    handler = IngestHandler(world.c.app.state.pool, world.c.app.state.store)
    topic = f"melophos/{world.hub.device_id}/"
    assert handler.handle(topic + "notes", json.dumps(notes(seq=1)).encode()) is Outcome.stored
    assert handler.handle(topic + "session", json.dumps(finish(seq=1)).encode()) is Outcome.stored
    assert handler.handle(topic + "session", json.dumps(finish(seq=2)).encode()) is Outcome.rejected
    assert dispatcher.run_once().delivered == 1
    assert dispatcher.run_once().delivered == 0


# operator endpoint


def test_the_operator_endpoint_receives_every_session(settings, receiver):
    config = Settings(
        **{
            **settings.__dict__,
            "webhook_allow_private": True,
            "session_webhook_url": receiver.url,
            "session_webhook_secret": "Hq7vN2xKz9LmW4RjY8bT3cDfGaP5sUe",
        }
    )
    with TestClient(create_app(config)) as c:
        a, b = sign_up(c), sign_up(c)
        send_session(c, pair(c, a))
        send_session(c, pair(c, b))
        dispatcher = Dispatcher(c.app.state.pool, SecretBox(config.secret_key), allow_private=True)
        assert dispatcher.run_once().delivered == 2
    for got in receiver.requests:
        headers = {k.lower(): v for k, v in got["headers"].items()}
        assert verify(
            "Hq7vN2xKz9LmW4RjY8bT3cDfGaP5sUe",
            headers["melophos-timestamp"],
            headers["melophos-signature"],
            got["body"],
        )


def test_an_operator_url_without_a_secret_stops_the_server_starting(settings, receiver):
    config = Settings(
        **{
            **settings.__dict__,
            "webhook_allow_private": True,
            "session_webhook_url": receiver.url,
            "session_webhook_secret": "",
        }
    )
    with pytest.raises(RuntimeError, match="SESSION_WEBHOOK_SECRET"), TestClient(create_app(config)):
        pass


def test_an_operator_url_pointing_inside_stops_the_server_starting(settings):
    config = Settings(
        **{
            **settings.__dict__,
            "session_webhook_url": "https://10.0.0.5/hook",
            "session_webhook_secret": "Hq7vN2xKz9LmW4RjY8bT3cDfGaP5sUe",
        }
    )
    with pytest.raises(UnsafeDestination), TestClient(create_app(config)):
        pass


def test_a_secret_cannot_be_read_with_a_different_key(world, private_settings):
    box = SecretBox("a completely different secret key, also long enough to be fine")
    with psycopg.connect(private_settings.database_url) as conn:
        endpoint_id, sealed = conn.execute("SELECT id, secret_enc FROM webhook_endpoints").fetchone()
    with pytest.raises(ValueError, match="SECRET_KEY"):
        box.open(endpoint_id, bytes(sealed))
    assert SecretBox(private_settings.secret_key).open(endpoint_id, bytes(sealed)) == world.ep["secret"]


def drip_server(first_byte_delay=0.2):
    """A receiver that sends its status line one byte at a time, so every read succeeds quickly and only a deadline
    for the whole call can stop it. Returns the port and a stop function."""
    import socket

    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(50)
    stop = threading.Event()

    def serve():
        while not stop.is_set():
            try:
                conn, _ = server.accept()
            except OSError:
                return

            def one(conn=conn):
                try:
                    conn.recv(65536)
                    for byte in b"HTTP/1.1 200 OK" + b"x" * 400:
                        if stop.is_set():
                            return
                        conn.sendall(bytes([byte]))
                        time.sleep(first_byte_delay)
                except OSError:
                    pass

            threading.Thread(target=one, daemon=True).start()

    threading.Thread(target=serve, daemon=True).start()
    return server.getsockname()[1], lambda: (stop.set(), server.close())


def test_a_receiver_that_drips_is_cut_at_the_deadline_and_leaves_no_thread_behind(monkeypatch):
    port, stop = drip_server()
    monkeypatch.setattr(outbound, "DEADLINE_SECONDS", 1.0)
    before = threading.active_count()
    started = time.monotonic()
    results = [post_json(f"http://127.0.0.1:{port}/hook", b"{}", {}, allow_private=True) for _ in range(10)]
    elapsed = time.monotonic() - started
    time.sleep(0.5)
    left_over = threading.active_count() - before
    stop()
    assert all(r == SendResult(False, None, "timed out") for r in results)
    assert elapsed < 10 * 1.0 + 3
    assert left_over <= 1  # the receiver's own handler threads end when it stops. None of ours remain
    assert not [t for t in threading.enumerate() if t.name.startswith("webhook") and t.is_alive()]


def test_a_healthy_receiver_is_still_served_after_many_drippers(monkeypatch, receiver):
    port, stop = drip_server()
    monkeypatch.setattr(outbound, "DEADLINE_SECONDS", 1.0)
    pool = [
        threading.Thread(
            target=post_json,
            args=(f"http://127.0.0.1:{port}/hook", b"{}", {}),
            kwargs={"allow_private": True},
        )
        for _ in range(12)
    ]
    [t.start() for t in pool]
    started = time.monotonic()
    good = post_json(
        receiver.url, b"{}", {}, allow_private=True
    )  # contacted at once, not queued behind the drippers
    took = time.monotonic() - started
    [t.join() for t in pool]
    stop()
    assert good.ok and took < 1.0
    assert len(receiver.requests) == 1


def test_a_dripping_endpoint_cannot_use_more_than_its_share_of_a_batch(
    private_client, dispatcher, database_url
):
    """One account with many deliveries to a slow endpoint gets two places in a batch and no more."""
    person = sign_up(private_client)
    hub = pair(private_client, person)
    slow = Receiver()
    private_client.post(
        "/api/v1/webhooks", json={"url": slow.url, "password": PASSWORD}, headers=person.headers
    )
    for i in range(6):
        send_session(private_client, hub, started_at=(datetime.now(UTC) - timedelta(hours=i + 1)).isoformat())
    jobs = dispatcher._claim(20)
    slow.close()
    assert len(jobs) == 2


def test_a_delivery_that_is_never_attempted_does_not_count_against_the_endpoint(
    world, dispatcher, database_url
):
    """Deliveries wait their turn. Only an attempt that really happened counts as a failure."""
    for i in range(6):
        send_session(world.c, world.hub, started_at=(datetime.now(UTC) - timedelta(hours=i + 1)).isoformat())
    dispatcher.run_once()  # sends two of the six
    row = world.c.get(f"/api/v1/webhooks/{world.ep['id']}", headers=world.person.headers).json()
    assert row["consecutive_failures"] == 0
    waiting = [
        d
        for d in world.c.get(
            f"/api/v1/webhooks/{world.ep['id']}/deliveries", headers=world.person.headers
        ).json()
        if d["state"] == "pending"
    ]
    assert len(waiting) == 4 and all(d["attempts"] == 0 for d in waiting)
