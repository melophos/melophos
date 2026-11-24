"""docs/protocol.md must say what the server accepts: every example in it is checked against the server's models."""

import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.mqtt import MAX_BYTES, MODELS, parse_topic

DOC = Path(__file__).resolve().parents[2] / "docs" / "protocol.md"

pytestmark = pytest.mark.skipif(not DOC.is_file(), reason="docs/ is not part of this checkout")


def examples() -> list[tuple[str, str]]:
    text = DOC.read_text()
    return re.findall(r"<!-- example: (\w+) -->\n```json\n(.*?)\n```", text, re.S)


def test_every_kind_has_an_example_in_the_document():
    assert {kind for kind, _ in examples()} == set(MODELS)


@pytest.mark.parametrize(("kind", "body"), examples() or [("none", "")])
def test_each_example_is_accepted_by_the_servers_models(kind, body):
    assert parse_topic(f"melophos/hub-a1b2c3d4e5f6/{kind}") is not None
    assert len(body.encode()) <= MAX_BYTES[kind]
    # the dates in the document are only illustrative and the server accepts a start within the last year,
    # so the check puts the example start at a recent time and leaves every other field as written
    parsed = json.loads(body)
    if "started_at" in parsed:
        parsed["started_at"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    MODELS[kind].model_validate_json(json.dumps(parsed))
    assert parsed["boot"] >= 0


def test_every_model_field_is_described_in_the_document():
    text = DOC.read_text()
    for kind, model in MODELS.items():
        for name in model.model_fields:
            assert f"`{name}`" in text, f"{kind}.{name} is missing from docs/protocol.md"


def test_the_documented_limits_match_the_code():
    from app import mqtt

    text = DOC.read_text()
    assert f"{mqtt.MAX_NOTES_PER_BATCH:,}".replace(",", " ") in text
    assert f"{mqtt.MAX_SESSION_EVENTS:,}".replace(",", " ") in text
    assert "64 KiB" in text and "128 KiB" in text and "4 KiB" in text
    assert MAX_BYTES == {"notes": 64 * 1024, "status": 4 * 1024, "session": 128 * 1024}
    assert f"(0 to {mqtt.MAX_EVENTS_IN_SESSION_MESSAGE:,})".replace(",", " ") in text


def test_the_document_no_longer_calls_the_notes_body_an_array():
    assert "JSON array" not in DOC.read_text()


def test_an_example_with_a_flaw_would_be_caught():
    flawed = '{"boot": 7, "seq": 1, "session_ref": "s", "started_at": "2026-09-30T18:00:00", "profile_id": "p", "events": []}'
    with pytest.raises(ValueError):
        MODELS["notes"].model_validate_json(flawed)


def test_the_worked_broker_password_example_is_what_the_server_and_the_client_compute():
    import sys

    from app.security import broker_password

    block = re.search(r"<!-- example: broker-password -->\n```json\n(.*?)\n```", DOC.read_text(), re.S)
    assert block, "the document needs the worked example"
    example = json.loads(block.group(1))
    assert broker_password(example["device_secret"]) == example["broker_password"]
    assert (
        len(example["broker_password"]) == 64
        and example["broker_password"] == example["broker_password"].lower()
    )
    client_dir = Path(__file__).resolve().parents[2] / "client"
    sys.path.insert(0, str(client_dir))
    from melophos_client.mqtt import broker_password as hub_side

    assert hub_side(example["device_secret"]) == example["broker_password"]
