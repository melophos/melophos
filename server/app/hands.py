"""Splitting a song into a left and a right hand and rating how hard it is.

The split looks for the strongest evidence first and falls back step by step. It uses no randomness and no clock
and it sorts its input, so the same notes always give the same answer.

1. `track_name`: two tracks whose names say which hand they are (right, left, RH, LH, treble, bass and similar).
   The name wins even when the pitches disagree, because the person who wrote the file said so.
2. `track_pitch`: two or more tracks with notes. A track goes to the left hand when its median pitch is below the
   middle of the lowest and highest track medians. Needs the two ends at least 7 semitones apart.
3. `channel_pitch`: the same rule applied to MIDI channels when the notes are all in one track.
4. `pitch`: one track and one channel, which is what most piano files are. Two hand centres start at the lower and
   upper quartile of the pitches. Each note, taken in time order, goes to the nearer centre (a tie goes right) and
   that centre then moves 10 percent of the way towards the note, so the boundary follows the music up and down the
   keyboard. The centres are kept at least an octave apart. A piece that spans 14 semitones or fewer is one hand,
   the right when its median is middle C or above and the left otherwise.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from statistics import median
from typing import Literal

from .midi import MidiNote, MidiSong

Hand = Literal["left", "right"]

RIGHT_HINT = re.compile(r"\b(right|rh|r\.h\.?|treble|upper)\b", re.I)
LEFT_HINT = re.compile(r"\b(left|lh|l\.h\.?|bass|lower)\b", re.I)
MIN_SEPARATION = 7  # semitones between the two groups before a track or channel split is believed
FOLLOW = 0.1  # how far a hand centre moves towards each new note
MIN_CENTRE_GAP = 12

EXPLANATIONS = {
    "track_name": "Two tracks are named for a hand, so the names decide.",
    "track_pitch": "The file has separate tracks. The track with the lower notes is the left hand.",
    "channel_pitch": "The file uses separate MIDI channels. The channel with the lower notes is the left hand.",
    "pitch": "The file has one stream of notes, so each note goes to the nearer of two hand positions that follow the music.",
}


@dataclass(frozen=True)
class HandSplit:
    method: str
    hands: list[Hand]  # one entry per note, in the order of the notes given

    @property
    def explanation(self) -> str:
        return EXPLANATIONS[self.method]


def split_hands(song: MidiSong) -> HandSplit:
    notes = song.notes
    names = {t.index: t.name for t in song.tracks}
    by_track = _group(notes, lambda n: n.track)
    if len(by_track) >= 2:
        named = _by_name(by_track, names)
        if named is not None:
            return HandSplit("track_name", [named[n.track] for n in notes])
        grouped = _by_median(by_track)
        if grouped is not None:
            return HandSplit("track_pitch", [grouped[n.track] for n in notes])
    by_channel = _group(notes, lambda n: n.channel)
    if len(by_channel) >= 2:
        grouped = _by_median(by_channel)
        if grouped is not None:
            return HandSplit("channel_pitch", [grouped[n.channel] for n in notes])
    return HandSplit("pitch", _follow_pitch(notes))


def _group(notes: list[MidiNote], key: Callable[[MidiNote], int]) -> dict[int, list[int]]:
    groups: dict[int, list[int]] = {}
    for n in notes:
        groups.setdefault(key(n), []).append(n.note)
    return groups


def _by_name(groups: dict[int, list[int]], names: dict[int, str]) -> dict[int, Hand] | None:
    right = [
        t for t in groups if RIGHT_HINT.search(names.get(t, "")) and not LEFT_HINT.search(names.get(t, ""))
    ]
    left = [
        t for t in groups if LEFT_HINT.search(names.get(t, "")) and not RIGHT_HINT.search(names.get(t, ""))
    ]
    if len(right) != 1 or len(left) != 1:
        return None
    # any other track with notes goes to the hand whose median pitch is nearer
    result: dict[int, Hand] = {right[0]: "right", left[0]: "left"}
    for t, pitches in groups.items():
        if t not in result:
            m = median(pitches)
            near_right = abs(m - median(groups[right[0]])) <= abs(m - median(groups[left[0]]))
            result[t] = "right" if near_right else "left"
    return result


def _by_median(groups: dict[int, list[int]]) -> dict[int, Hand] | None:
    medians = {k: median(v) for k, v in groups.items()}
    low, high = min(medians.values()), max(medians.values())
    if high - low < MIN_SEPARATION:
        return None
    middle = (low + high) / 2
    return {k: ("left" if m < middle else "right") for k, m in medians.items()}


def _quartile(sorted_pitches: list[int], q: float) -> float:
    index = q * (len(sorted_pitches) - 1)
    low = int(index)
    high = min(low + 1, len(sorted_pitches) - 1)
    return sorted_pitches[low] + (sorted_pitches[high] - sorted_pitches[low]) * (index - low)


ONE_HAND_SPAN = 14  # a hand reaches about an octave, so a piece this narrow is one hand
MIDDLE_C = 60


def _follow_pitch(notes: list[MidiNote]) -> list[Hand]:
    pitches = sorted(n.note for n in notes)
    if pitches[-1] - pitches[0] <= ONE_HAND_SPAN:
        return ["right" if median(pitches) >= MIDDLE_C else "left"] * len(notes)
    left, right = _quartile(pitches, 0.25), _quartile(pitches, 0.75)
    if right - left < MIN_CENTRE_GAP:
        mid = (left + right) / 2
        left, right = mid - MIN_CENTRE_GAP / 2, mid + MIN_CENTRE_GAP / 2
    order = sorted(range(len(notes)), key=lambda i: (notes[i].t_ms, notes[i].note, i))
    out: list[Hand] = ["right"] * len(notes)
    for i in order:
        pitch = notes[i].note
        if abs(pitch - left) < abs(pitch - right):
            out[i] = "left"
            left += (pitch - left) * FOLLOW
        else:
            out[i] = "right"
            right += (pitch - right) * FOLLOW
        if right - left < MIN_CENTRE_GAP:
            squeeze = (MIN_CENTRE_GAP - (right - left)) / 2
            left, right = left - squeeze, right + squeeze
    return out


def difficulty(song: MidiSong, hands: list[Hand]) -> float:
    """1 (a slow single line) to 10 (fast, wide, dense and leaping). The parts and weights are in the README."""
    notes = song.notes
    if not notes:
        return 1.0
    # density: the busiest 2-second window, in notes a second
    starts = sorted(n.t_ms for n in notes)
    busiest, lo = 0, 0
    for hi, t in enumerate(starts):
        while t - starts[lo] > 2000:
            lo += 1
        busiest = max(busiest, hi - lo + 1)
    density = min(1.0, (busiest / 2) / 12)
    # the widest span of the song in semitones, past one octave
    span = min(1.0, max(0, max(n.note for n in notes) - min(n.note for n in notes) - 12) / 60)
    # the most notes one hand sounds at once
    chord = 1
    for hand in ("left", "right"):
        events = sorted((n.t_ms, 1) for n, h in zip(notes, hands, strict=True) if h == hand)
        events += sorted((n.t_ms + n.dur_ms, -1) for n, h in zip(notes, hands, strict=True) if h == hand)
        held = 0
        for _, step in sorted(events, key=lambda e: (e[0], e[1])):
            held += step
            chord = max(chord, held)
    chords = min(1.0, (chord - 1) / 4)
    # how far a hand jumps between notes, on average
    jumps: list[int] = []
    for hand in ("left", "right"):
        previous = None
        for n, h in zip(notes, hands, strict=True):
            if h == hand:
                if previous is not None and n.t_ms != previous.t_ms:
                    jumps.append(abs(n.note - previous.note))
                previous = n
    leaps = min(1.0, (sum(jumps) / len(jumps) if jumps else 0) / 12)
    score = 0.45 * density + 0.20 * chords + 0.20 * leaps + 0.15 * span
    return round(1 + 9 * score, 1)
