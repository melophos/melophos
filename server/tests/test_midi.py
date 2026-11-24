import builtins
import contextlib

import pytest

from app import midi
from app.midi import MidiError, parse

from .midi_writer import name, notes_track, off, on, smf, tempo, track, vlq


def simple(notes=((0, 480, 60),), **kw):
    return smf([notes_track(list(notes))], fmt=0 if kw.pop("fmt0", True) else 1, **kw)


# correct reading


def test_notes_and_timing_with_the_default_tempo():
    song = parse(simple([(0, 480, 60), (480, 240, 64)]))
    assert [(n.t_ms, n.dur_ms, n.note) for n in song.notes] == [(0, 500, 60), (500, 250, 64)]
    assert song.length_ms == 750
    assert song.ticks_per_quarter == 480


def test_a_tempo_change_moves_later_notes():
    # 500 000 us a beat for the first beat, then 250 000: the second beat lasts half as long
    data = smf(
        [
            track([(0, tempo(500_000)), (480, tempo(250_000))]),
            notes_track([(0, 480, 60), (480, 480, 62), (960, 480, 64)]),
        ]
    )
    song = parse(data)
    assert [(n.t_ms, n.dur_ms) for n in song.notes] == [(0, 500), (500, 250), (750, 250)]
    assert song.tempo_changes == 2


def test_running_status_and_note_on_with_zero_velocity_as_note_off():
    events = (
        bytes([0x90, 60, 90])
        + vlq(240)
        + bytes([60, 0])
        + vlq(0)
        + bytes([64, 70])
        + vlq(240)
        + bytes([64, 0])
    )
    body = vlq(0) + events + vlq(0) + b"\xff\x2f\x00"
    data = smf([b"MTrk" + len(body).to_bytes(4, "big") + body], fmt=0)
    song = parse(data)
    assert [(n.note, n.t_ms, n.dur_ms) for n in song.notes] == [(60, 0, 250), (64, 250, 250)]


def test_a_note_never_released_ends_with_its_track():
    song = parse(smf([track([(0, on(0, 60)), (960, on(0, 62)), (1440, off(0, 62))])], fmt=0))
    held = next(n for n in song.notes if n.note == 60)
    assert held.dur_ms == 1500


def test_drums_are_skipped_and_counted():
    song = parse(smf([track([(0, on(0, 60)), (100, off(0, 60)), (0, on(9, 36)), (50, off(9, 36))])], fmt=0))
    assert [n.note for n in song.notes] == [60]
    assert song.skipped_percussion == 1


def test_system_exclusive_and_other_meta_events_are_skipped():
    events = [
        (0, b"\xf0" + vlq(3) + b"\x01\x02\xf7"),
        (0, b"\xff\x58\x04\x04\x02\x18\x08"),
        (0, on(0, 60)),
        (100, off(0, 60)),
    ]
    assert len(parse(smf([track(events)], fmt=0)).notes) == 1


def test_a_track_name_is_clean_text_and_never_a_path(monkeypatch):
    monkeypatch.setattr(
        builtins, "open", lambda *a, **k: (_ for _ in ()).throw(AssertionError("opened a file"))
    )
    monkeypatch.setattr(
        "os.listdir", lambda *a, **k: (_ for _ in ()).throw(AssertionError("listed a directory"))
    )
    data = smf([track([(0, name("../../etc/passwd\x00\x01")), (0, on(0, 60)), (10, off(0, 60))])], fmt=0)
    song = parse(data)
    assert song.tracks[0].name == "../../etc/passwd\x00\x01".replace("\x00", "").replace("\x01", "")
    assert song.tracks[0].notes == 1


def test_unknown_chunks_are_skipped():
    data = smf([notes_track([(0, 100, 60)])], fmt=0)
    data = data[:14] + b"XYZZ" + (3).to_bytes(4, "big") + b"abc" + data[14:]
    assert len(parse(data).notes) == 1


# hostile files


def mtrk(body: bytes) -> bytes:
    return b"MTrk" + len(body).to_bytes(4, "big") + body


@pytest.mark.parametrize(
    ("data", "words"),
    [
        (b"", "not a MIDI file"),
        (b"RIFF" + b"\x00" * 40, "not a MIDI file"),
        (b"MThd", "not a MIDI file"),
        (smf([notes_track([(0, 1, 60)])], fmt=2), "format 2"),
        (smf([notes_track([(0, 1, 60)])], division=0x8000 | 25), "SMPTE"),
        (smf([notes_track([(0, 1, 60)])], division=0), "time division"),
        (smf([notes_track([(0, 1, 60)])], declared=0), "tracks"),
        (smf([notes_track([(0, 1, 60)])], declared=65535), "limit is 32"),
        (smf([notes_track([(0, 1, 60)])], fmt=0, declared=2), "exactly one track"),
        (smf([track([(0, tempo(0)), (0, on(0, 60)), (5, off(0, 60))])]), "tempo of zero"),
        (smf([track([(0, b"\xff\x51\x02\x01\x02")])]), "wrong length"),
        (smf([track([(0, tempo(500_000))])]), "no notes"),
        (smf([mtrk(b"")]), "no notes"),
    ],
)
def test_bad_files_are_refused_with_a_reason(data, words):
    with pytest.raises(MidiError, match=words):
        parse(data)


def test_a_track_longer_than_the_file_is_refused():
    data = smf([notes_track([(0, 10, 60)])], fmt=0)
    broken = data[:14] + b"MTrk" + (10**9).to_bytes(4, "big") + data[22:]
    with pytest.raises(MidiError, match="longer than the file"):
        parse(broken)


def test_a_truncated_file_is_refused():
    data = smf([notes_track([(0, 10, 60), (20, 10, 62)])], fmt=0)
    for cut in range(14, len(data) - 1):
        with contextlib.suppress(MidiError):  # the only acceptable failure
            parse(data[:cut])


def test_a_variable_length_number_cannot_run_on():
    body = b"\xff\xff\xff\xff\xff\x7f" + b"\x90\x3c\x40"
    with pytest.raises(MidiError, match="variable-length"):
        parse(smf([mtrk(body)], fmt=0))


def test_an_event_longer_than_its_track_is_refused():
    body = vlq(0) + b"\xff\x01" + vlq(5000) + b"hi"
    with pytest.raises(MidiError, match="longer than the data"):
        parse(smf([mtrk(body)], fmt=0))


def test_a_sysex_length_cannot_reach_past_the_track():
    body = vlq(0) + b"\xf0" + vlq(2**27) + b"x"
    with pytest.raises(MidiError, match="longer than the data"):
        parse(smf([mtrk(body)], fmt=0))


def test_data_bytes_out_of_range_and_missing_status_are_refused():
    with pytest.raises(MidiError, match="no status"):
        parse(smf([mtrk(vlq(0) + b"\x3c\x40")], fmt=0))
    with pytest.raises(MidiError, match="out of range"):
        parse(smf([mtrk(vlq(0) + b"\x90\xff\x40")], fmt=0))


def test_the_size_limit_is_checked_before_parsing():
    with pytest.raises(MidiError, match="larger than"):
        parse(b"MThd" + b"\x00" * midi.MAX_BYTES)


def test_too_many_events_are_refused(monkeypatch):
    monkeypatch.setattr(midi, "MAX_EVENTS", 100)
    body = b"".join(vlq(0) + b"\xff\x01\x00" for _ in range(101)) + vlq(0) + on(0, 60) + vlq(1) + off(0, 60)
    with pytest.raises(MidiError, match="more than 100 events"):
        parse(smf([mtrk(body)], fmt=0))


def test_too_many_notes_are_refused(monkeypatch):
    monkeypatch.setattr(midi, "MAX_NOTES", 50)
    with pytest.raises(MidiError, match="more than 50 notes"):
        parse(simple([(i * 10, 5, 40 + i % 40) for i in range(60)]))


def test_too_many_tempo_changes_are_refused(monkeypatch):
    monkeypatch.setattr(midi, "MAX_TEMPO_CHANGES", 10)
    data = smf(
        [track([(i, tempo(400_000 + i)) for i in range(11)] + [(0, on(0, 60)), (5, off(0, 60))])], fmt=0
    )
    with pytest.raises(MidiError, match="tempo changes"):
        parse(data)


def test_too_many_tracks_and_chunks_are_refused():
    many = smf([notes_track([(0, 1, 60)])] * 33)
    with pytest.raises(MidiError, match="limit is 32"):
        parse(many)
    chunks = smf([notes_track([(0, 1, 60)])], fmt=0, declared=1)
    junk = b"".join(b"JUNK" + (0).to_bytes(4, "big") for _ in range(70))
    with pytest.raises(MidiError, match="too many chunks"):
        parse(chunks[:14] + junk + chunks[14:])


def test_a_song_over_the_duration_limit_is_refused():
    # 600 beats of 16.7 seconds each is about 2.8 hours
    data = smf([track([(0, tempo(16_777_215)), (0, on(0, 60)), (480 * 600, off(0, 60))])], fmt=0)
    with pytest.raises(MidiError, match="longer than"):
        parse(data)


def test_an_absurd_tick_count_is_refused():
    body = vlq(2**28 - 1) + vlq(2**28 - 1) + vlq(2**28 - 1) + vlq(2**28 - 1) + vlq(2**28 - 1)
    data = smf([mtrk(vlq(2**28 - 1) * 1 + on(0, 60) + body + off(0, 60))], fmt=0)
    with pytest.raises(MidiError):
        parse(data)


def test_a_one_megabyte_file_of_tiny_events_is_bounded_in_time():
    import time

    body = (vlq(0) + b"\xff\x01\x00") * 100_000 + vlq(0) + on(0, 60) + vlq(1) + off(0, 60)
    started = time.monotonic()
    assert len(parse(smf([mtrk(body)], fmt=0)).notes) == 1  # under the event cap, so it is valid
    assert time.monotonic() - started < 2.0
