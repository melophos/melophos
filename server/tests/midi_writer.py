"""Builds MIDI files for tests, including labelled ones where every note's hand is known."""

import random
from dataclasses import dataclass


def vlq(value: int) -> bytes:
    out = [value & 0x7F]
    value >>= 7
    while value:
        out.append(0x80 | (value & 0x7F))
        value >>= 7
    return bytes(reversed(out))


def track(events: list[tuple[int, bytes]]) -> bytes:
    """events are (absolute tick, raw event bytes). Adds the end of track marker."""
    body = bytearray()
    last = 0
    for tick, raw in sorted(events, key=lambda e: e[0]):
        body += vlq(tick - last) + raw
        last = tick
    body += vlq(0) + b"\xff\x2f\x00"
    return b"MTrk" + len(body).to_bytes(4, "big") + bytes(body)


def tempo(micros: int) -> bytes:
    return b"\xff\x51\x03" + micros.to_bytes(3, "big")


def name(text: str) -> bytes:
    raw = text.encode("latin-1")
    return b"\xff\x03" + vlq(len(raw)) + raw


def on(channel: int, note: int, velocity: int = 80) -> bytes:
    return bytes([0x90 | channel, note, velocity])


def off(channel: int, note: int) -> bytes:
    return bytes([0x80 | channel, note, 0])


def smf(tracks: list[bytes], fmt: int = 1, division: int = 480, declared: int | None = None) -> bytes:
    count = len(tracks) if declared is None else declared
    header = b"MThd" + (6).to_bytes(4, "big") + fmt.to_bytes(2, "big") + count.to_bytes(2, "big")
    return header + division.to_bytes(2, "big") + b"".join(tracks)


def notes_track(notes: list[tuple[int, int, int]], channel: int = 0, label: str | None = None) -> bytes:
    """notes are (start tick, length in ticks, pitch)."""
    events: list[tuple[int, bytes]] = [(0, name(label))] if label else []
    for start, length, pitch in notes:
        events += [(start, on(channel, pitch)), (start + length, off(channel, pitch))]
    return track(events)


@dataclass
class Labelled:
    data: bytes
    hands: dict[tuple[int, int], str]  # (start tick, pitch) to the hand that plays it
    expected_method: str


def _melody(rng: random.Random, beats: int, low: int, high: int) -> list[tuple[int, int, int]]:
    pitch, out = (low + high) // 2, []
    for beat in range(beats):
        pitch = max(low, min(high, pitch + rng.choice([-4, -2, -1, 0, 1, 2, 4])))
        out.append((beat * 480, 400, pitch))
    return out


def _alberti(beats: int, root: int) -> list[tuple[int, int, int]]:
    pattern = [0, 7, 4, 7]
    return [(b * 480 + 0, 200, root + pattern[b % 4]) for b in range(beats)]


def single_stream(seed: int = 1, beats: int = 64, melody=(62, 84), root: int = 38) -> Labelled:
    """One track and one channel: right hand melody over a left hand Alberti bass, the usual piano file."""
    rng = random.Random(seed)
    right, left = _melody(rng, beats, *melody), _alberti(beats, root)
    labels = {(s, p): "right" for s, _l, p in right} | {(s, p): "left" for s, _l, p in left}
    # the left hand also plays on the offbeat, which keeps starts distinct
    left = [(s + 240, ln, p) for s, ln, p in left]
    labels = {(s, p): "right" for s, _l, p in right} | {(s, p): "left" for s, _l, p in left}
    notes = sorted(right + left)
    return Labelled(smf([track([(0, tempo(500_000))]), notes_track(notes)]), labels, "pitch")


def two_named_tracks(seed: int = 2) -> Labelled:
    """The track named for the right hand holds the LOWER notes, so only the names can get this right."""
    rng = random.Random(seed)
    right_named = _melody(rng, 32, 48, 62)
    left_named = [(s + 240, ln, p) for s, ln, p in _melody(rng, 32, 66, 84)]
    labels = {(s, p): "right" for s, _l, p in right_named} | {(s, p): "left" for s, _l, p in left_named}
    data = smf(
        [
            track([(0, tempo(500_000)), (0, name("Song"))]),
            notes_track(right_named, 0, "Right Hand"),
            notes_track(left_named, 1, "Left Hand"),
        ]
    )
    return Labelled(data, labels, "track_name")


def two_unnamed_tracks(seed: int = 3) -> Labelled:
    rng = random.Random(seed)
    high, low = _melody(rng, 32, 66, 88), _alberti(32, 36)
    labels = {(s, p): "right" for s, _l, p in high} | {(s, p): "left" for s, _l, p in low}
    return Labelled(smf([notes_track(high, 0), notes_track(low, 1)]), labels, "track_pitch")


def channels_in_one_track(seed: int = 4) -> Labelled:
    rng = random.Random(seed)
    high, low = _melody(rng, 32, 64, 86), _alberti(32, 40)
    labels = {(s, p): "right" for s, _l, p in high} | {(s, p): "left" for s, _l, p in low}
    events: list[tuple[int, bytes]] = []
    for start, length, pitch in high:
        events += [(start, on(0, pitch)), (start + length, off(0, pitch))]
    for start, length, pitch in low:
        events += [(start, on(1, pitch)), (start + length, off(1, pitch))]
    return Labelled(smf([track(events)], fmt=0), labels, "channel_pitch")


def three_tracks(seed: int = 5) -> Labelled:
    rng = random.Random(seed)
    melody = _melody(rng, 32, 72, 90)
    chords = [(b * 480, 440, p) for b in range(32) for p in (52 + (b % 3), 56, 59)]
    bass = _alberti(32, 36)
    labels = {(s, p): "right" for s, _l, p in melody}
    labels |= {(s, p): "left" for s, _l, p in chords + bass}
    data = smf([notes_track(melody, 0), notes_track(chords, 1), notes_track(bass, 2)])
    return Labelled(data, labels, "track_pitch")


def overlapping_hands(seed: int = 6) -> Labelled:
    """Both hands share the middle of the keyboard, the hard case for a pitch-only split."""
    return single_stream(seed=seed, melody=(50, 76), root=47)
