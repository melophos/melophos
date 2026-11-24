import pytest

from app.mqtt import parse_topic


def test_valid_topics():
    topic = parse_topic("melophos/hub-01/notes")
    assert topic is not None
    assert topic.device_id == "hub-01"
    assert topic.kind == "notes"


@pytest.mark.parametrize(
    "topic",
    [
        "melophos/+/notes",
        "melophos/#",
        "melophos/hub-01/#",
        "melophos/hub-01/+",
        "melophos/hub#01/notes",
        "melophos/hub-01/firmware",
        "melophos/hub-01/notes/extra",
        "melophos/hub-01",
        "other/hub-01/notes",
        "melophos//notes",
        "$SYS/broker/version",
        "$CONTROL/dynamic-security/v1",
        "melophos/HUB-01/notes",
        "melophos/hub 01/notes",
        "melophos/hub-01\x00/notes",
        "melophos/../notes",
        "melophos/hub-01/Notes",
        "melophos/" + "a" * 200 + "/notes",
        "melophos/é-hub/notes",
        "",
    ],
)
def test_rejects_wildcards_unknown_kinds_and_odd_ids(topic):
    assert parse_topic(topic) is None
