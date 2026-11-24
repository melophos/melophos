"""A Standard MIDI File reader for files uploaded by strangers.

It is written to be unable to loop or allocate without bound whatever the bytes say:

- the file is capped before parsing (MAX_BYTES) and every length field is checked against the bytes that are left
  before it is used, so a field cannot ask for more than the file holds
- every loop step consumes at least one byte, so a track of n bytes takes at most n steps
- counts that grow (tracks, chunks, events, notes, tempo changes) have hard caps and the parse stops with an error
  the moment one is passed, so memory is bounded by the caps and not by anything the file claims
- the tempo and tick arithmetic is integer and the length of the song is capped, so no number can run away
- text inside the file (track names) is read for hints only, truncated and never used as a path or a query

Anything wrong raises MidiError with a message that says what to fix. No other exception can leave `parse`.
"""

from bisect import bisect_right
from dataclasses import dataclass, field

MAX_BYTES = 1024 * 1024
MAX_TRACKS = 32
MAX_CHUNKS = 64
MAX_EVENTS = 300_000
MAX_NOTES = 50_000
MAX_TEMPO_CHANGES = 2_000
MAX_DURATION_MS = 2 * 60 * 60 * 1000
MAX_TICK = 2**32
MAX_VLQ_BYTES = 4
PERCUSSION_CHANNEL = 9
DEFAULT_TEMPO_US = 500_000  # 120 beats a minute, the standard's default


class MidiError(ValueError):
    """The file is not usable. The message is safe to show to the person who uploaded it."""


@dataclass(frozen=True)
class MidiNote:
    t_ms: int
    dur_ms: int
    note: int
    velocity: int
    channel: int
    track: int


@dataclass
class TrackInfo:
    index: int
    name: str = ""
    notes: int = 0


@dataclass
class MidiSong:
    format: int
    ticks_per_quarter: int
    tracks: list[TrackInfo]
    notes: list[MidiNote]
    length_ms: int
    skipped_percussion: int = 0
    tempo_changes: int = 0
    warnings: list[str] = field(default_factory=list)


@dataclass
class _RawNote:
    start: int
    end: int
    note: int
    velocity: int
    channel: int
    track: int


class _Reader:
    __slots__ = ("data", "pos", "end")

    def __init__(self, data: bytes, pos: int, end: int) -> None:
        self.data, self.pos, self.end = data, pos, end

    def left(self) -> int:
        return self.end - self.pos

    def byte(self) -> int:
        if self.pos >= self.end:
            raise MidiError("the file ends in the middle of an event")
        value = self.data[self.pos]
        self.pos += 1
        return value

    def take(self, count: int) -> bytes:
        if count < 0 or count > self.left():
            raise MidiError("an event is longer than the data that is left in its track")
        chunk = self.data[self.pos : self.pos + count]
        self.pos += count
        return chunk

    def vlq(self) -> int:
        value = 0
        for _ in range(MAX_VLQ_BYTES):
            b = self.byte()
            value = (value << 7) | (b & 0x7F)
            if not b & 0x80:
                return value
        raise MidiError("a variable-length number is longer than the standard allows")


def _clean_name(raw: bytes) -> str:
    return "".join(c for c in raw[:64].decode("latin-1") if c.isprintable())


def parse(data: bytes) -> MidiSong:
    """Read a MIDI file. Raises MidiError for anything that is not a usable, in-limits file."""
    if len(data) > MAX_BYTES:
        raise MidiError(f"the file is larger than the {MAX_BYTES // 1024} KiB limit")
    if len(data) < 14 or data[:4] != b"MThd":
        raise MidiError("this is not a MIDI file (it does not start with MThd)")
    header_len = int.from_bytes(data[4:8], "big")
    if header_len < 6 or header_len > 64 or 8 + header_len > len(data):
        raise MidiError("the MIDI header is the wrong size")
    fmt = int.from_bytes(data[8:10], "big")
    declared_tracks = int.from_bytes(data[10:12], "big")
    division = int.from_bytes(data[12:14], "big")
    if fmt not in (0, 1):
        raise MidiError("only MIDI format 0 and 1 files are supported (format 2 holds unrelated songs)")
    if declared_tracks < 1 or declared_tracks > MAX_TRACKS:
        raise MidiError(f"the file declares {declared_tracks} tracks, the limit is {MAX_TRACKS}")
    if fmt == 0 and declared_tracks != 1:
        raise MidiError("a format 0 file must have exactly one track")
    if division & 0x8000:
        raise MidiError("SMPTE time division is not supported, save the file with beats and ticks")
    if division == 0:
        raise MidiError("the file has no time division")

    pos = 8 + header_len
    raw_notes: list[_RawNote] = []
    tempos: list[tuple[int, int]] = []
    tracks: list[TrackInfo] = []
    events = 0
    chunks = 0
    skipped = 0
    while pos + 8 <= len(data) and len(tracks) < declared_tracks:
        chunks += 1
        if chunks > MAX_CHUNKS:
            raise MidiError("the file has too many chunks")
        kind = data[pos : pos + 4]
        length = int.from_bytes(data[pos + 4 : pos + 8], "big")
        body = pos + 8
        if length > len(data) - body:
            raise MidiError("a track claims to be longer than the file")
        if kind == b"MTrk":
            info = TrackInfo(index=len(tracks))
            tracks.append(info)
            used, skipped_here = _read_track(
                _Reader(data, body, body + length), info, raw_notes, tempos, events
            )
            events = used
            skipped += skipped_here
        pos = body + length  # unknown chunk types are skipped, as the standard asks
    if not tracks:
        raise MidiError("the file has no tracks")
    if not raw_notes:
        raise MidiError("the file has no notes")

    tempo_map = _tempo_map(tempos)
    notes = [
        MidiNote(
            t_ms=_to_ms(n.start, tempo_map, division),
            dur_ms=max(1, _to_ms(n.end, tempo_map, division) - _to_ms(n.start, tempo_map, division)),
            note=n.note,
            velocity=n.velocity,
            channel=n.channel,
            track=n.track,
        )
        for n in raw_notes
    ]
    length_ms = max(n.t_ms + n.dur_ms for n in notes)
    if length_ms > MAX_DURATION_MS:
        raise MidiError(f"the song is longer than {MAX_DURATION_MS // 60000} minutes")
    notes.sort(key=lambda n: (n.t_ms, n.note, n.track, n.channel))
    for n in notes:
        tracks[n.track].notes += 1
    return MidiSong(
        format=fmt,
        ticks_per_quarter=division,
        tracks=tracks,
        notes=notes,
        length_ms=length_ms,
        skipped_percussion=skipped,
        tempo_changes=len(tempos),
    )


def _read_track(
    reader: _Reader,
    info: TrackInfo,
    out: list[_RawNote],
    tempos: list[tuple[int, int]],
    events: int,
) -> tuple[int, int]:
    tick = 0
    status = 0
    open_notes: dict[tuple[int, int], list[tuple[int, int]]] = {}
    held = 0  # how many notes are sounding, kept as a count so the cap check costs nothing
    skipped = 0
    while reader.left() > 0:
        events += 1
        if events > MAX_EVENTS:
            raise MidiError(f"the file has more than {MAX_EVENTS} events")
        tick += reader.vlq()
        if tick > MAX_TICK:
            raise MidiError("the file runs for an impossible number of ticks")
        first = reader.byte()
        if first == 0xFF:  # meta event
            meta = reader.byte()
            payload = reader.take(reader.vlq())
            if meta == 0x2F:
                break
            if meta == 0x03 and not info.name:
                info.name = _clean_name(payload)
            elif meta == 0x51:
                if len(payload) != 3:
                    raise MidiError("a tempo event has the wrong length")
                micros = int.from_bytes(payload, "big")
                if micros == 0:
                    raise MidiError("a tempo of zero is not possible")
                if len(tempos) >= MAX_TEMPO_CHANGES:
                    raise MidiError(f"the file has more than {MAX_TEMPO_CHANGES} tempo changes")
                tempos.append((tick, micros))
            continue
        if first in (0xF0, 0xF7):  # system exclusive, skipped by length
            reader.take(reader.vlq())
            continue
        if first >= 0x80:
            status = first
            data1 = reader.byte()
        else:
            if status == 0:
                raise MidiError("an event has no status byte")
            data1 = first  # running status: the status of the previous event applies
        if status >= 0xF0:
            raise MidiError("an unsupported system message is in a track")
        kind, channel = status & 0xF0, status & 0x0F
        if data1 > 0x7F:
            raise MidiError("an event has a data byte that is out of range")
        two = kind in (0x80, 0x90, 0xA0, 0xB0, 0xE0)
        data2 = reader.byte() if two else 0
        if two and data2 > 0x7F:
            raise MidiError("an event has a data byte that is out of range")
        if kind not in (0x80, 0x90):
            continue
        if channel == PERCUSSION_CHANNEL:
            if kind == 0x90 and data2 > 0:
                skipped += 1
            continue
        key = (channel, data1)
        if kind == 0x90 and data2 > 0:
            if len(out) + held >= MAX_NOTES:
                raise MidiError(f"the file has more than {MAX_NOTES} notes")
            open_notes.setdefault(key, []).append((tick, data2))
            held += 1
        else:
            stack = open_notes.get(key)
            if stack:
                start, velocity = stack.pop(0)
                held -= 1
                out.append(_RawNote(start, max(tick, start), data1, velocity, channel, info.index))
    # a note still held when the track ends stops there
    for (channel, note), stack in open_notes.items():
        for start, velocity in stack:
            out.append(_RawNote(start, max(tick, start), note, velocity, channel, info.index))
    return events, skipped


@dataclass
class _TempoMap:
    ticks: list[int]
    micros: list[int]
    at_us: list[int]  # elapsed microseconds at the start of each segment


def _tempo_map(tempos: list[tuple[int, int]]) -> _TempoMap:
    ordered = sorted(tempos)
    ticks, micros = [0], [DEFAULT_TEMPO_US]
    for tick, tempo in ordered:
        if tick == ticks[-1]:
            micros[-1] = tempo
        else:
            ticks.append(tick)
            micros.append(tempo)
    return _TempoMap(ticks, micros, [])


def _to_ms(tick: int, tempo_map: _TempoMap, division: int) -> int:
    if not tempo_map.at_us:
        total = 0
        for i, t in enumerate(tempo_map.ticks):
            tempo_map.at_us.append(total)
            if i + 1 < len(tempo_map.ticks):
                total += (tempo_map.ticks[i + 1] - t) * tempo_map.micros[i] // division
    i = bisect_right(tempo_map.ticks, tick) - 1
    micros = tempo_map.at_us[i] + (tick - tempo_map.ticks[i]) * tempo_map.micros[i] // division
    return micros // 1000
