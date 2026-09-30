"""MQTT topic handling for hub traffic, see docs/protocol.md."""

from dataclasses import dataclass

TOPIC_ROOT = "melophos"
KINDS = {"notes", "session", "status"}


@dataclass(frozen=True)
class Topic:
    device_id: str
    kind: str


def parse_topic(topic: str) -> Topic | None:
    """Split `melophos/<device_id>/<kind>`. Device ids are untrusted, so wildcards are refused."""
    parts = topic.split("/")
    if len(parts) != 3 or parts[0] != TOPIC_ROOT:
        return None
    device_id, kind = parts[1], parts[2]
    if not device_id or any(c in device_id for c in "+#") or kind not in KINDS:
        return None
    return Topic(device_id=device_id, kind=kind)
