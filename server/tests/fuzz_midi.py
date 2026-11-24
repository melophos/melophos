"""Fuzzes the MIDI parser. Run `python -m tests.fuzz_midi 120` from server/ for two minutes.

Every case must either parse or raise MidiError. Any other exception, a parse over a second or a parse that holds
more than 64 MiB at its peak is a failure. The run prints how many cases it tried and the worst time and memory.
"""

import random
import sys
import time
import tracemalloc

from app.midi import MidiError, parse

from . import midi_writer as w

MAX_SECONDS_PER_PARSE = 1.0
MAX_PEAK_BYTES = 64 * 1024 * 1024


def seeds() -> list[bytes]:
    return [
        w.single_stream().data,
        w.two_named_tracks().data,
        w.channels_in_one_track().data,
        w.three_tracks().data,
        w.smf([w.track([(0, w.tempo(500_000)), (0, w.on(0, 60)), (100, w.off(0, 60))])], fmt=0),
        b"MThd\x00\x00\x00\x06\x00\x01\x00\x01\x01\xe0MTrk\x00\x00\x00\x04\x00\xff\x2f\x00",
    ]


def mutate(rng: random.Random, data: bytes) -> bytes:
    out = bytearray(data)
    for _ in range(rng.choice([1, 1, 1, 1, 2, 2, 4])):
        kind = rng.randrange(8)
        if not out:
            out = bytearray(b"MThd")
        # most mutations leave the 14-byte header alone, so the run reaches the track parser and not just the header check
        pos = rng.randrange(len(out)) if rng.random() < 0.2 or len(out) <= 15 else rng.randrange(14, len(out))
        if kind == 0:
            out[pos] = rng.randrange(256)
        elif kind == 1:
            out[pos] ^= 1 << rng.randrange(8)
        elif kind == 2:
            del out[pos : pos + rng.randrange(1, 16)]
        elif kind == 3:
            out[pos:pos] = bytes(rng.randrange(256) for _ in range(rng.randrange(1, 16)))
        elif kind == 4:
            out[pos : pos + 4] = rng.choice(
                [b"\xff\xff\xff\xff", b"\x7f\xff\xff\xff", b"\x80\x80\x80\x00", b"\x00" * 4]
            )
        elif kind == 5:
            out = out[: rng.randrange(len(out) + 1)]
        elif kind == 6:
            out += out[pos : pos + rng.randrange(1, 200)] * rng.randrange(1, 20)
        else:
            out[pos : pos + 1] = rng.choice([b"\xff\x51\x03", b"\xf0\x7f", b"\x90\x3c\x40", b"\xff\x2f\x00"])
    return bytes(out)


def fuzz(seconds: float, seed: int = 0) -> dict[str, float]:
    rng = random.Random(seed)
    corpus = seeds()
    started = time.monotonic()
    cases = refused = parsed = 0
    worst_time = worst_peak = 0.0
    tracemalloc.start()
    try:
        while time.monotonic() - started < seconds:
            data = mutate(rng, rng.choice(corpus))
            if rng.random() < 0.05:
                corpus.append(data[:4096])  # keeps interesting shapes in play without growing without bound
                corpus = corpus[-64:]
            tracemalloc.reset_peak()
            before = time.perf_counter()
            try:
                parse(data)
                parsed += 1
            except MidiError:
                refused += 1
            elapsed = time.perf_counter() - before
            peak = tracemalloc.get_traced_memory()[1]
            worst_time, worst_peak = max(worst_time, elapsed), max(worst_peak, peak)
            cases += 1
            assert elapsed < MAX_SECONDS_PER_PARSE, f"a parse took {elapsed:.2f}s"
            assert peak < MAX_PEAK_BYTES, f"a parse held {peak} bytes"
    finally:
        tracemalloc.stop()
    return {
        "cases": cases,
        "parsed": parsed,
        "refused": refused,
        "worst_ms": round(worst_time * 1000, 2),
        "worst_peak_kib": round(worst_peak / 1024),
    }


if __name__ == "__main__":
    duration = float(sys.argv[1]) if len(sys.argv) > 1 else 10.0
    print(fuzz(duration))
