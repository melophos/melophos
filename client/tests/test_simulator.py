import json

from melophos_client.simulator import build_session, main, scale_session

PIANO_61 = {"id": "piano-61", "type": "keyboard", "notes": {"lowest": 36, "highest": 96}}
GUITAR = {"id": "guitar-6-standard", "type": "fretboard", "strings": [40, 45, 50, 55, 59, 64], "frets": 22}


def test_scale_is_balanced_on_and_off():
    events = scale_session(PIANO_61, seed=1)
    presses = [e for e in events if e["velocity"] > 0]
    releases = [e for e in events if e["velocity"] == 0]
    assert len(presses) == len(releases) == 30


def test_events_are_time_ordered_and_in_range():
    events = scale_session(PIANO_61, seed=2)
    assert events == sorted(events, key=lambda e: e["t_ms"])
    assert all(36 <= e["note"] <= 96 for e in events)


def test_notes_outside_the_instrument_are_skipped():
    events = scale_session(PIANO_61, tonic=90, seed=3)
    assert all(e["note"] <= 96 for e in events)


def test_guitar_profile_is_supported():
    assert scale_session(GUITAR, seed=4)


def test_session_shape_matches_the_api():
    session = build_session(PIANO_61, "sim-hub", seed=5)
    assert set(session) == {"device_id", "profile_id", "started_at", "mode", "events"}


def test_dry_run_prints_json(tmp_path, capsys):
    profile = tmp_path / "piano-61.json"
    profile.write_text(json.dumps(PIANO_61))
    main(["--profile", str(profile), "--dry-run", "--seed", "6"])
    assert json.loads(capsys.readouterr().out)["profile_id"] == "piano-61"
