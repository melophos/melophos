"""Checks the hub's golden MQTT messages against the server's own models.

    python -m venv .venv && .venv/bin/pip install pydantic
    .venv/bin/python test/contract_check.py

test_publish compares the firmware's output with test/data/mqtt_golden.txt
byte for byte. This script feeds the same lines to server/app/mqtt.py, so a
change to either side that breaks the contract fails one of the two.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))

from app.mqtt import MAX_BYTES, MODELS, parse_topic  # noqa: E402

DEVICE = "hub-a1b2c3d4e5f6"


def check_time_fields() -> int:
    """server_time must be in protocol.md and parsed by the hub. server_time_synced is tolerated as absent from the
    document until the server's builder adds it. Once the document carries it, its meaning must match the hub's:
    true means the server's clock is synchronised and is the authority, false means it is not yet and the hub must not
    correct its clock from it, absent or null counts as true."""
    failures = 0
    protocol = (ROOT / "docs" / "protocol.md").read_text()
    pairing = (Path(__file__).parents[1] / "lib" / "pairing" / "pairing.cpp").read_text()
    if "server_time" not in protocol:
        print("protocol.md does not name server_time")
        failures += 1
    if '"server_time"' not in pairing:
        print("the hub does not read server_time")
        failures += 1
    if "server_time_synced" in protocol:
        line = " ".join(l for l in protocol.splitlines() if "server_time_synced" in l).lower()
        if '"server_time_synced"' not in pairing:
            print("protocol.md names server_time_synced but the hub does not read it")
            failures += 1
        if "false" not in line or not any(w in line for w in ("synchronised", "synchronized", "not yet", "not set", "trust")):
            print("protocol.md's server_time_synced does not say what false means")
            failures += 1
        if "null" in line and "true" not in line:
            print("protocol.md's null reading must be treated as true by the hub")
            failures += 1
    else:
        print("server_time_synced: not in protocol.md yet (tolerated)")
    return failures


def main() -> int:
    failures = check_time_fields()
    for line in (Path(__file__).parent / "data" / "mqtt_golden.txt").read_text().splitlines():
        kind, payload = line.split("\t", 1)
        topic = parse_topic(f"melophos/{DEVICE}/{kind}")
        if topic is None or topic.kind != kind:
            print(f"{kind}: the server refuses the topic")
            failures += 1
            continue
        if len(payload.encode()) > MAX_BYTES[kind]:
            print(f"{kind}: over the server's size limit")
            failures += 1
            continue
        try:
            MODELS[kind].model_validate_json(payload)
            print(f"{kind}: accepted")
        except Exception as error:  # a validation error names the field
            print(f"{kind}: refused: {error}")
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
