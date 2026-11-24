"""The whole corpus through Python must give exactly the bits the native build wrote.

A digest of every event and every summary number is compared with fixtures/golden.json,
floats as their 32-bit patterns and not as rounded decimals.
"""

import json
import struct
from pathlib import Path

import melophos_core as mc
import pytest

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
GOLDEN = json.loads((FIXTURES / "golden.json").read_text())
KINDS = ["hit", "wrong", "late", "repeat", "unsure"]
HANDS = ["unknown", "neither", "left", "right", "both"]


def corpus():
    out = []
    for path in sorted([*(FIXTURES / "corpus").glob("*.json"), *(FIXTURES / "final").glob("*.json")]):
        doc = json.loads(path.read_text())
        expected = [(t, n) for t, n in doc["expected"]]
        for case in doc["cases"]:
            out.append((f"{doc['name']}/{case['name']}", doc, expected, [(t, n) for t, n in case["played"]]))
    return out


CASES = corpus()


def bits(value):
    return None if value is None else struct.unpack("<I", struct.pack("<f", value))[0]


def digest(events):
    """FNV-1a over every number of every event, each as 8 little-endian bytes, as the Rust test computes it."""
    h = 0xCBF29CE484222325
    for e in events:
        for v in (
            e.played_index,
            KINDS.index(e.kind),
            -1 if e.expected_index is None else e.expected_index,
            e.position,
            e.error_ms,
            e.speed_ppm,
            -1 if e.jumped_from is None else e.jumped_from,
        ):
            for b in (v & 0xFFFFFFFFFFFFFFFF).to_bytes(8, "little"):
                h ^= b
                h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return f"{h:016x}"


def summary(s):
    return {
        "expected": s.expected,
        "hits": s.hits,
        "late": s.late,
        "misses": s.misses,
        "wrong": s.wrong,
        "repeats": s.repeats,
        "unsure": s.unsure,
        "accuracy_bits": s.accuracy_bits,
        "mean_timing_error_bits": s.mean_timing_error_bits,
        "final_speed_ppm": s.final_speed_ppm,
        "mean_speed_ppm": s.mean_speed_ppm,
        "hands": HANDS.index(s.hands),
        "played_expected": s.played_expected,
        "played_accuracy_bits": s.played_accuracy_bits,
    }


def test_there_is_a_golden_entry_for_every_case():
    assert sorted(key for key, *_ in CASES) == sorted(GOLDEN)
    assert len(CASES) >= 1500


def test_every_case_follows_bit_for_bit():
    for key, doc, expected, played in CASES:
        result = mc.follow(expected, played, hands=doc["hands"], **doc["config"])
        want = GOLDEN[key]
        assert len(result.events) == want["events"], key
        assert digest(result.events) == want["digest"], key
        assert summary(result.score) == want["follow"], key
        # the float the server stores is exactly the float the native build made
        assert bits(result.score.accuracy) == result.score.accuracy_bits
        assert bits(result.score.mean_timing_error_ms) == result.score.mean_timing_error_bits


def test_every_case_scores_bit_for_bit():
    for key, _, expected, played in CASES:
        s = mc.score(expected, played)
        assert {
            "expected": s.expected,
            "hits": s.hits,
            "misses": s.misses,
            "wrong": s.wrong,
            "accuracy_bits": s.accuracy_bits,
            "mean_timing_error_bits": s.mean_timing_error_bits,
        } == GOLDEN[key]["score"], key


@pytest.mark.parametrize("step", range(0, len(CASES), 7))
def test_a_live_session_ends_with_the_same_alignment(step):
    key, doc, expected, played = CASES[step]
    session = mc.Follower(expected, hands=doc["hands"], **doc["config"])
    final = []
    for t_ms, note in played:
        update = session.push(t_ms, note)
        for revised in update.revised:
            final[revised.played_index] = revised
        final.append(update.event)
    assert digest(final) == GOLDEN[key]["digest"], key
    assert summary(session.finish()) == GOLDEN[key]["follow"], key
