"""Publishes a session the way a hub does: status, notes batches every 250 ms of playing, then the session."""

import hashlib
import hmac
import json
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

BATCH_MS = 250
ACK_TIMEOUT = 5.0


@dataclass
class PublishReport:
    sent: int = 0
    refused: list[str] = field(default_factory=list)  # topics the broker refused, by reason
    session_ref: str = ""


def batches(events: list[dict[str, int]], window_ms: int = BATCH_MS) -> list[list[dict[str, int]]]:
    """Group time-ordered events into windows of `window_ms`, one message each."""
    grouped: dict[int, list[dict[str, int]]] = {}
    for event in sorted(events, key=lambda e: e["t_ms"]):
        grouped.setdefault(event["t_ms"] // window_ms, []).append(event)
    return [grouped[k] for k in sorted(grouped)]


def broker_password(device_secret: str) -> str:
    """The broker password: HMAC-SHA256 keyed with the device secret over the ASCII text `mqtt`, as 64 lower
    case hex characters. The HTTP API wants the device secret itself, so this value is useless there."""
    return hmac.new(device_secret.encode(), b"mqtt", hashlib.sha256).hexdigest()


class HubLink:
    """One MQTT connection signed in as the hub. The broker's rules decide what it may publish."""

    def __init__(
        self, host: str, port: int, device_id: str, secret: str, tls: bool = False, ca_file: str | None = None
    ) -> None:
        self.device_id = device_id
        self._connected = False
        self._client = mqtt.Client(CallbackAPIVersion.VERSION2, client_id=device_id, protocol=mqtt.MQTTv5)
        self._client.username_pw_set(device_id, broker_password(secret))
        if tls:
            # the certificate is checked against the host name. ca_file names the authority to trust when the
            # system does not know it (your own authority or the self-signed certificate itself)
            self._client.tls_set(ca_certs=ca_file)
        self._acks: dict[int, bool] = {}  # message id to "the broker accepted it"
        self._client.on_publish = self._on_publish
        self._host, self._port = host, port

    def _on_publish(self, _c: mqtt.Client, _u: object, mid: int, reason: object, _p: object) -> None:
        self._acks[mid] = not getattr(reason, "is_failure", False)

    def __enter__(self) -> "HubLink":
        self._client.connect(self._host, self._port, keepalive=30)
        self._client.loop_start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._client.disconnect()
        self._client.loop_stop()

    def publish(self, topic: str, payload: dict[str, Any] | bytes) -> bool:
        """Publish at QoS 1 and wait for the broker. False means the broker refused it."""
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        info = self._client.publish(topic, body, qos=1)
        deadline = time.monotonic() + ACK_TIMEOUT
        while info.mid not in self._acks and time.monotonic() < deadline:
            time.sleep(0.005)
        return self._acks.get(info.mid, False)


def run_session(
    host: str,
    port: int,
    device_id: str,
    secret: str,
    boot: int,
    profile_id: str,
    events: list[dict[str, int]],
    firmware: str = "sim-0.1.0",
    mode: str = "free",
    tls: bool = False,
    ca_file: str | None = None,
) -> PublishReport:
    started = datetime.now(UTC)
    ref = f"sim-{boot}-{int(started.timestamp())}"
    report = PublishReport(session_ref=ref)
    seq = {"status": 0, "notes": 0, "session": 0}

    def stamp(kind: str) -> dict[str, int]:
        seq[kind] += 1
        return {"boot": boot, "seq": seq[kind]}

    with HubLink(host, port, device_id, secret, tls=tls, ca_file=ca_file) as link:
        messages: list[tuple[str, dict[str, Any]]] = [
            (
                "status",
                {
                    **stamp("status"),
                    "firmware": firmware,
                    "profile_id": profile_id,
                    "inputs": ["network"],
                    "dropped_events": 0,
                },
            )
        ]
        for batch in batches(events):
            messages.append(
                (
                    "notes",
                    {
                        **stamp("notes"),
                        "session_ref": ref,
                        "started_at": started.isoformat(),
                        "profile_id": profile_id,
                        "events": batch,
                    },
                )
            )
        messages.append(
            (
                "session",
                {
                    **stamp("session"),
                    "session_ref": ref,
                    "started_at": started.isoformat(),
                    "profile_id": profile_id,
                    "mode": mode,
                },
            )
        )
        for kind, payload in messages:
            topic = f"melophos/{device_id}/{kind}"
            if link.publish(topic, payload):
                report.sent += 1
            else:
                report.refused.append(topic)
    return report
