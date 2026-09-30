from app.mqtt import parse_topic


def test_valid_topics():
    topic = parse_topic("melophos/hub-01/notes")
    assert topic is not None
    assert topic.device_id == "hub-01"
    assert topic.kind == "notes"


def test_rejects_wildcards_and_unknown_kinds():
    assert parse_topic("melophos/+/notes") is None
    assert parse_topic("melophos/hub-01/firmware") is None
    assert parse_topic("other/hub-01/notes") is None
    assert parse_topic("melophos//notes") is None
