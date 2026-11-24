import pytest

from app.hands import difficulty, split_hands
from app.midi import parse

from . import midi_writer as w
from .midi_writer import notes_track, smf


def accuracy(labelled) -> tuple[str, float]:
    song = parse(labelled.data)
    split = split_hands(song)
    # a note is identified by its start tick and pitch, so convert the song's milliseconds back to ticks
    right = 0
    total = 0
    for note, hand in zip(song.notes, split.hands, strict=True):
        tick = round(note.t_ms * 480 / 500)
        total += 1
        right += labelled.hands[(tick, note.note)] == hand
    return split.method, right / total


@pytest.mark.parametrize(
    ("build", "minimum"),
    [
        (w.two_named_tracks, 1.0),
        (w.two_unnamed_tracks, 1.0),
        (w.channels_in_one_track, 1.0),
        (w.three_tracks, 1.0),
        (w.single_stream, 0.95),
    ],
)
def test_each_labelled_file_is_split_by_the_expected_rule_and_accurately(build, minimum):
    labelled = build()
    method, got = accuracy(labelled)
    assert method == labelled.expected_method
    assert got >= minimum, got


@pytest.mark.parametrize("seed", range(1, 9))
def test_single_stream_accuracy_holds_across_seeds(seed):
    _, got = accuracy(w.single_stream(seed=seed))
    assert got >= 0.95


def test_names_beat_pitch():
    # the track named Right Hand has the lower notes and the answer follows the names
    song = parse(w.two_named_tracks().data)
    split = split_hands(song)
    for note, hand in zip(song.notes, split.hands, strict=True):
        track_name = song.tracks[note.track].name
        assert hand == ("right" if track_name == "Right Hand" else "left")


def test_the_split_is_deterministic_and_ignores_input_order():
    song = parse(w.single_stream().data)
    first = split_hands(song)
    again = split_hands(song)
    assert first == again
    import dataclasses

    shuffled = dataclasses.replace(song, notes=list(reversed(song.notes)))
    flipped = split_hands(shuffled)
    assert {(n.t_ms, n.note): h for n, h in zip(song.notes, first.hands, strict=True)} == {
        (n.t_ms, n.note): h for n, h in zip(shuffled.notes, flipped.hands, strict=True)
    }


def test_a_single_hand_piece_stays_in_one_hand():
    data = smf([notes_track([(i * 480, 400, 60 + i % 5) for i in range(20)])], fmt=0)
    split = split_hands(parse(data))
    assert split.method == "pitch"
    assert set(split.hands) == {"right"}
    low = split_hands(parse(smf([notes_track([(i * 480, 400, 40 + i % 5) for i in range(20)])], fmt=0)))
    assert set(low.hands) == {"left"}


def test_every_method_has_an_explanation():
    for build in (w.two_named_tracks, w.two_unnamed_tracks, w.channels_in_one_track, w.single_stream):
        assert len(split_hands(parse(build().data)).explanation) > 20


def rate(notes, fmt0=True):
    song = parse(smf([notes_track(notes)], fmt=0))
    return difficulty(song, split_hands(song).hands)


def test_difficulty_rises_with_speed_chords_and_leaps():
    slow = rate([(i * 960, 900, 60 + (i % 3)) for i in range(16)])
    fast = rate([(i * 120, 100, 60 + (i % 3)) for i in range(64)])
    chords = rate([(i * 240, 200, p) for i in range(32) for p in (48, 52, 55, 60, 64)])
    leaping = rate([(i * 240, 200, 40 if i % 2 else 90) for i in range(32)])
    assert 1.0 <= slow < fast
    assert slow < chords
    assert slow < leaping
    assert all(1.0 <= v <= 10.0 for v in (slow, fast, chords, leaping))


def test_difficulty_of_a_trivial_line_is_near_the_bottom():
    assert rate([(i * 960, 900, 60) for i in range(8)]) < 2.5


def test_overlapping_hands_are_the_known_weak_case_and_the_figure_is_stated():
    # a pitch-only split cannot see which hand played a note in the shared middle, so this is a floor, not a promise.
    # The README gives the measured mean. The Studio lets the player correct the split.
    scores = [accuracy(w.overlapping_hands(seed=s))[1] for s in range(1, 9)]
    assert sum(scores) / len(scores) >= 0.7
