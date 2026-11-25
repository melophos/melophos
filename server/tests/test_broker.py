"""The broker, not the server, decides who may publish where. These tests use a real Mosquitto."""

import json
import secrets
import threading
import time

import paho.mqtt.client as mqtt
import pytest
from paho.mqtt.enums import CallbackAPIVersion

from .conftest import BROKER_HOST, BROKER_PORT


def connect(user: str | None, password: str | None, timeout: float = 3.0, cid: str | None = None):
    """Returns (client, connected_ok). Never raises on a refused login, so tests can assert the refusal."""
    client = mqtt.Client(
        CallbackAPIVersion.VERSION2,
        client_id=cid or user or "t-" + secrets.token_hex(4),
        protocol=mqtt.MQTTv5,
    )
    if user is not None:
        client.username_pw_set(user, password)
    state = {"ok": False}
    done = threading.Event()

    def on_connect(_c, _u, _f, reason, _p):
        state["ok"] = not reason.is_failure
        done.set()

    client.on_connect = on_connect
    client.acks = {}
    client.disconnects = []
    client.on_disconnect = lambda c, u, f, r, p: client.disconnects.append(r)
    client.on_publish = lambda c, u, mid, reason, p: client.acks.__setitem__(mid, not reason.is_failure)
    client.suback = {}
    client.on_subscribe = lambda c, u, mid, reasons, p: client.suback.__setitem__(
        mid, [r.value for r in reasons]
    )
    client.connect(BROKER_HOST, BROKER_PORT, keepalive=10)
    client.loop_start()
    done.wait(timeout)
    return client, state["ok"]


def publish(client, topic, payload=b"{}"):
    info = client.publish(topic, payload, qos=1)
    deadline = time.monotonic() + 3
    while info.mid not in client.acks and time.monotonic() < deadline:
        time.sleep(0.01)
    return client.acks.get(info.mid)


def stop(client):
    client.disconnect()
    client.loop_stop()


@pytest.fixture()
def two_hubs(broker_admin):
    a, b = "hub-" + secrets.token_hex(5), "hub-" + secrets.token_hex(5)
    sa, sb = "mph_" + secrets.token_urlsafe(24), "mph_" + secrets.token_urlsafe(24)
    broker_admin.create_device(a, sa)
    broker_admin.create_device(b, sb)
    yield a, sa, b, sb
    broker_admin.delete_device(a)
    broker_admin.delete_device(b)


def test_a_hub_may_publish_under_its_own_id(two_hubs):
    a, sa, _b, _sb = two_hubs
    client, ok = connect(a, sa)
    assert ok
    for kind in ("notes", "session", "status"):
        assert publish(client, f"melophos/{a}/{kind}") is True, kind
    stop(client)


def test_a_hub_cannot_publish_under_another_hubs_id(two_hubs):
    a, sa, b, _sb = two_hubs
    client, ok = connect(a, sa)
    assert ok
    assert publish(client, f"melophos/{b}/notes") is False
    assert publish(client, f"melophos/{b}/status") is False
    assert publish(client, f"melophos/{a}/notes") is True  # the connection is still fine
    stop(client)


def test_a_hub_cannot_publish_anywhere_else(two_hubs):
    a, sa, _b, _sb = two_hubs
    client, _ = connect(a, sa)
    for topic in [
        f"melophos/{a}/other/deep",
        f"melophos/{a}",
        "$CONTROL/dynamic-security/v1",
        "$SYS/broker/clients/total",
        "elsewhere/topic",
    ]:
        answer = publish(client, topic)
        assert answer is False or client.disconnects, (topic, answer)  # an answer or a dropped connection
    stop(client)


def test_a_hub_cannot_read_what_others_send(two_hubs):
    a, sa, _b, _sb = two_hubs
    client, _ = connect(a, sa)
    for filter_ in ["melophos/#", "melophos/+/notes", f"melophos/{a}/notes", "$SYS/#", "$CONTROL/#"]:
        result, mid = client.subscribe(filter_, qos=1)
        time.sleep(0.3)
        assert mid in client.suback, (
            f"no answer to the subscribe for {filter_}"
        )  # a time-out is not a refusal
        assert all(code >= 128 for code in client.suback[mid]), filter_
    stop(client)


def test_a_hub_cannot_reach_the_brokers_control_topic_to_grant_itself_rights(two_hubs):
    a, sa, _b, _sb = two_hubs
    client, _ = connect(a, sa)
    command = json.dumps({"commands": [{"command": "addClientRole", "username": a, "rolename": "admin"}]})
    answer = publish(client, "$CONTROL/dynamic-security/v1", command.encode())
    assert answer is False or client.disconnects, answer
    stop(client)


@pytest.mark.parametrize("user_pass", [(None, None), ("nobody", "x"), ("admin", "wrong")])
def test_anonymous_and_wrong_logins_are_refused(user_pass, broker_admin):
    client, ok = connect(*user_pass)
    assert not ok
    stop(client)


def test_a_hub_with_the_wrong_secret_is_refused(two_hubs):
    a, _sa, _b, sb = two_hubs
    client, ok = connect(a, sb)  # the other hub's secret
    assert not ok
    stop(client)


def test_a_rotated_secret_ends_the_old_one(two_hubs, broker_admin):
    a, sa, _b, _sb = two_hubs
    new = "mph_" + secrets.token_urlsafe(24)
    broker_admin.set_secret(a, new)
    old_client, old_ok = connect(a, sa)
    new_client, new_ok = connect(a, new)
    assert (old_ok, new_ok) == (False, True)
    stop(old_client)
    stop(new_client)


def test_a_removed_hub_is_refused(two_hubs, broker_admin):
    a, sa, _b, _sb = two_hubs
    broker_admin.delete_device(a)
    client, ok = connect(a, sa)
    assert not ok
    stop(client)


def test_setting_up_the_roles_twice_changes_nothing(broker_admin):
    broker_admin.ensure_roles()
    broker_admin.ensure_roles()


# what the broker will hold and who may use a login


def wait_ack(client, mid, seconds=3.0):
    deadline = time.monotonic() + seconds
    while mid not in client.acks and time.monotonic() < deadline:
        time.sleep(0.01)
    return client.acks.get(mid, "no answer")


def test_a_hub_cannot_leave_a_retained_message_on_the_broker(two_hubs):
    """A client filled the broker with 1 MiB retained messages. Nothing may be retained and a refusal must be real
    (an answer or a dropped connection), not a time-out read as a no."""
    a, sa, _b, _sb = two_hubs
    client, ok = connect(a, sa)
    assert ok
    info = client.publish(f"melophos/{a}/status", b"x" * 2000, qos=1, retain=True)
    answer = wait_ack(client, info.mid)
    time.sleep(0.5)
    assert answer is False or client.disconnects, answer
    stop(client)


def test_a_message_larger_than_the_broker_allows_is_refused(two_hubs):
    a, sa, _b, _sb = two_hubs
    client, ok = connect(a, sa)
    assert ok
    try:
        info = client.publish(f"melophos/{a}/notes", b"x" * 140_000, qos=1)
        answer = wait_ack(client, info.mid)
        time.sleep(0.5)
        assert answer is False or client.disconnects, answer
    finally:
        stop(client)


def test_the_hub_may_publish_the_three_exact_topics_and_nothing_else(two_hubs):
    a, sa, _b, _sb = two_hubs
    client, ok = connect(a, sa)
    assert ok
    for kind in ("notes", "session", "status"):
        info = client.publish(f"melophos/{a}/{kind}", b"{}", qos=1)
        assert wait_ack(client, info.mid) is True, kind
    for other in ("anything", "s1", "notes2", "Notes", "x/y"):
        info = client.publish(f"melophos/{a}/{other}", b"{}", qos=1)
        assert wait_ack(client, info.mid) is False, other
    stop(client)


def test_a_login_only_works_with_its_own_client_id(two_hubs):
    """A hub that uses another hub's id as its client id used to kick it off the broker."""
    a, sa, b, sb = two_hubs
    cb, ok_b = connect(b, sb)
    assert ok_b
    ca, ok_a = connect(a, sa, cid=b)  # A with B's client id
    time.sleep(0.5)
    assert ok_a is False
    assert cb.disconnects == []  # B was not taken over
    stop(ca)
    stop(cb)


def test_the_tidy_up_removes_logins_the_database_does_not_want(broker_admin):
    from app.broker import reconcile

    keep, drop = "hub-" + secrets.token_hex(5), "hub-" + secrets.token_hex(5)
    broker_admin.create_device(keep, "mph_keep-" + secrets.token_urlsafe(24))
    broker_admin.create_device(drop, "mph_drop-" + secrets.token_urlsafe(24))
    # the broker can list a new login a moment after it accepts it, so the wanted set is read once both are there
    deadline = time.monotonic() + 5
    while not {keep, drop} <= broker_admin.list_devices() and time.monotonic() < deadline:
        time.sleep(0.05)
    removed = reconcile(broker_admin, due=broker_admin.list_devices() - {drop})
    assert drop in removed and keep not in removed
    assert drop not in broker_admin.list_devices()
    broker_admin.delete_device(keep)
