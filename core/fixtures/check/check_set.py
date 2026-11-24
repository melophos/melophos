"""Our own check set for the follower: nine small pieces and twenty-one ways of playing them, with the truth worked
out from how each performance is built. It is synthetic. Nobody played it.

It is not part of the golden corpus. The engine's constants were set by hand while working through the labelled
sets and this set is where a change to one of them is tried before those sets are run again. Run it against the
Python module:

    core/python/.venv/bin/python core/fixtures/check/check_set.py

It prints, for each way of playing, the right notes called wrong, the wrong presses called right and the presses
left unsure. A press is `right` when it is a note the player meant, whatever its timing. For the ways of playing
that a teacher would call well played (every note once, no wrong key) it also prints the lowest accuracy any
performance was given: that is the number a family sees.
"""
import collections
import random

import melophos_core as mc

R, L = "right", "left"


def pieces():
    out = {}
    # a scale in thirds over a held bass
    n = []
    for i in range(32):
        d = [0, 2, 4, 5, 7, 9, 11, 12][i % 8 if (i // 8) % 2 == 0 else 7 - i % 8]
        n += [(i * 300, 60 + d, R), (i * 300, 64 + d, R)]
        if i % 8 == 0:
            n.append((i * 300, 36 + (i // 8) * 2, L))
    out["thirds"] = n
    # a vamp of two chords under a tune that keeps coming back to one note
    n = []
    for i in range(24):
        n.append((i * 450, [67, 69, 67, 72, 67, 65, 67, 64][i % 8], R))
        ch = [48, 52, 55] if (i // 2) % 2 == 0 else [47, 50, 55]
        n += [(i * 450, p, L) for p in ch]
    out["vamp"] = n
    # a dotted march
    n, t = [], 0
    for i in range(40):
        n.append((t, 55 + [0, 0, 4, 7, 7, 4, 2, 0, 5, 5][i % 10] + (i // 10) * 2, R))
        if i % 2 == 0:
            n.append((t, 36 + [0, 7][(i // 2) % 2], L))
        t += 450 if i % 2 == 0 else 150
    out["march"] = n
    # a lullaby: slow tune, rocking left hand
    n = []
    for i in range(20):
        n.append((i * 900, [64, 67, 72, 71, 69, 67, 65, 64, 62, 60][i % 10], R))
        n += [(i * 900, 48, L), (i * 900 + 300, 55, L), (i * 900 + 600, 52, L)]
    out["lullaby"] = n
    # call and response: the hands take turns
    n = []
    for i in range(32):
        hand = R if (i // 4) % 2 == 0 else L
        base = 72 if hand == R else 48
        n.append((i * 250, base + [0, 2, 4, 7][i % 4] + (i // 8), hand))
    out["call"] = n
    # repeated top notes over a moving bass
    n = []
    for i in range(36):
        n.append((i * 200, 76 if i % 3 else 79, R))
        if i % 3 == 0:
            n.append((i * 200, 40 + (i // 3) % 7, L))
    out["bells"] = n
    # the same two-note chord over and over, a bass note under every other one
    n = []
    for i in range(32):
        n += [(i * 250, 64, R), (i * 250, 67, R)]
        if i % 2 == 0:
            n.append((i * 250, 48 + (i // 2) % 5, L))
    out["chords"] = n
    # six-note chords in two hands that change one finger at a time
    n = []
    for i in range(24):
        d = [0, 0, 2, 2, 0, -1, 0, 0][i % 8]
        n += [(i * 600, p, R) for p in (60 + d, 64, 67 + (i % 2))]
        n += [(i * 600, p, L) for p in (36 + d, 43, 48 + (i % 3))]
    out["big"] = n
    # one key over and over with a bass note every fourth
    n = []
    for i in range(32):
        n.append((i * 300, 72, R))
        if i % 4 == 0:
            n.append((i * 300, 41 + (i // 4) % 3, L))
    out["one_key"] = n
    return {k: sorted(set(v)) for k, v in out.items()}


def perform(notes, kind, rng, seed=0):
    """Returns (presses, truth, kwargs). truth[i] is the note index meant or None for a press that is no note."""
    kw = {}
    onsets = sorted({t for t, _, _ in notes})
    speed = rng.choice([0.6, 0.8, 1.0, 1.2])
    keep = lambda h: True
    plan = list(range(len(onsets)))
    exact = kind in ("speed", "half_bar", "tempo_step", "hesitate_at")
    if kind == "speed":
        # steady and exact at every speed from 40 to 200 per cent in steps of five
        speed = (40 + 5 * seed) / 100
    if exact and kind != "speed":
        speed = [0.6, 1.0, 1.4][seed % 3]
    # a hesitation before one onset, the second and third included, of four lengths
    wait_at, wait = 1 + seed % 12, [400, 800, 1200, 2000][(seed // 12) % 4]
    # a bar at half speed or a tempo that halves or doubles and stays
    bar = (len(onsets) // 3, len(onsets) // 3 + 8)
    factor = [0.5, 2.0][seed % 2]
    if kind == "one_hand_told":
        hand = rng.choice([R, L]); keep = lambda h: h == hand; kw["practise"] = hand
    if kind == "one_hand_untold":
        hand = rng.choice([R, L]); keep = lambda h: h == hand
    if kind in ("start_told", "start_untold"):
        k = len(onsets) // 2; plan = plan[k:]
        if kind == "start_told":
            kw["start_ms"] = onsets[k]
    if kind == "go_back":
        k = rng.randrange(8, len(onsets) - 6); plan = plan[:k] + plan[k - 5:]
    if kind == "skip":
        k = rng.randrange(6, len(onsets) - 10); plan = plan[:k] + plan[k + 6:]
    presses, t, prev = [], 300.0, None
    played = set()
    for step, o in enumerate(plan):
        s = onsets[o]
        gap = 0 if prev is None else (abs(s - prev) if plan[step - 1] + 1 == o else 500)
        if kind == "rubato":
            gap *= 1 + 0.12 * [0, 1, 1, 0, -1, -1][step % 6]
        if kind == "half_bar" and bar[0] < step <= bar[1]:
            gap *= 2
        if kind == "tempo_step" and step > bar[0]:
            gap /= factor
        if kind == "hesitate_at" and step == wait_at:
            t += wait
        t += gap / speed
        prev = s
        if kind == "hesitate" and step and rng.random() < 0.08:
            t += rng.uniform(300, 900)
        here = [i for i, (nt, p, h) in enumerate(notes) if nt == s and keep(h)]
        for i in here:
            lag = 110 if kind == "hands_apart" and notes[i][2] == L else 0
            at = t + lag + (3 * here.index(i) if exact else rng.gauss(0, 12))
            pitch = notes[i][1]
            near = {p for nt, p, h in notes if abs(nt - s) <= 1500}
            if kind == "neighbour" and step > 3 and rng.random() < 0.1:
                bad = next((pitch + d for d in (1, -1, 2, -2, 3) if pitch + d not in near), pitch + 13)
                presses.append((at, bad, None))
                continue
            if kind == "stutter" and step > 3 and rng.random() < 0.08:
                presses.append((at - 60, pitch, ("pair", i)))
                presses.append((at, pitch, ("pair", i)))
                continue
            if kind == "chord_slip" and step > 3 and len(here) > 1 and i == here[step % len(here)] and rng.random() < 0.3:
                # one finger of a chord lands on the key next to it and half the time the right key follows
                bad = next((pitch + d for d in (1, -1, 2, -2) if pitch + d not in {notes[j][1] for j in here}), pitch + 13)
                presses.append((at, bad, None))
                if rng.random() < 0.5:
                    presses.append((at + 140, pitch, i))
                continue
            presses.append((at, pitch, i))
            if kind == "restrike" and step > 3 and rng.random() < 0.12:
                # the key sounds a second time: a sticky key or a finger that bounced
                presses.append((at + rng.uniform(70, 130), pitch, None))
        if kind == "burst" and step == len(plan) // 2:
            for j in range(6):
                presses.append((t + 60 + j * 70, rng.choice([p for p in range(30, 100) if p not in near]), None))
            t += 700
    presses.sort(key=lambda x: x[0])
    out, last = [], 0
    for at, p, truth in presses:
        last = max(last, round(at)); out.append((last, p, truth))
    return out, kw


KINDS = ["steady", "hesitate", "rubato", "hands_apart", "one_hand_told", "one_hand_untold", "start_told", "start_untold",
         "go_back", "skip", "neighbour", "stutter", "burst", "slow_start", "speed", "hesitate_at", "half_bar",
         "tempo_step", "restrike", "chord_slip", "both_one_named"]
# how many performances of each piece: every speed, every place and length of hesitation, four of the rest
SEEDS = {"speed": 33, "hesitate_at": 48, "half_bar": 6, "tempo_step": 6}
# the ways of playing a teacher would call well played: every note of the hands played once and no wrong key
WELL = ["steady", "hesitate", "rubato", "hands_apart", "one_hand_told", "one_hand_untold", "slow_start", "speed",
        "hesitate_at", "half_bar", "tempo_step"]


def main():
    tot = collections.defaultdict(collections.Counter)
    for name, notes in pieces().items():
        exp = [(t, p) for t, p, _ in notes]; hands = [h for _, _, h in notes]
        for kind in KINDS:
            for seed in range(SEEDS.get(kind, 4)):
                rng = random.Random(f"{name}/{kind}/{seed}")
                base = {"slow_start": "steady", "both_one_named": "steady"}.get(kind, kind)
                presses, kw = perform(notes, base, rng, seed)
                if kind == "slow_start":
                    presses = [(t * 2, p, tr) for t, p, tr in presses]
                if kind == "both_one_named":
                    # both hands are played although one was named: the other hand's presses are not judged
                    kw["practise"] = R
                    presses = [(t, p, tr if notes[tr][2] == R else ("other", tr)) for t, p, tr in presses]
                r = mc.follow(exp, [(t, p) for t, p, _ in presses], hands=hands, **kw)
                c = tot[kind]
                if kind in WELL or kind == "both_one_named":
                    c["worst"] = min(c.get("worst", 1000), round(r.score.played_accuracy * 1000))
                pairs = collections.defaultdict(list)
                for e, (t, p, truth) in zip(r.events, presses):
                    c["presses"] += 1
                    if isinstance(truth, tuple) and truth[0] == "other":
                        c["other hand"] += 1
                        c["other hand unsure"] += e.kind == "unsure"
                        c["wrong called right"] += e.kind in ("hit", "late", "repeat")
                        continue
                    if isinstance(truth, tuple):
                        pairs[(truth[1], round(t / 200))].append(e.kind)
                    elif truth is None:
                        c["wrong presses"] += 1
                        c["wrong called right"] += e.kind in ("hit", "late", "repeat")
                    else:
                        c["right notes"] += 1
                        c["right called wrong"] += e.kind == "wrong"
                    c["unsure"] += e.kind == "unsure"
                # of two quick strikes of one key one is the note and one is extra: nobody can say which
                for ks in pairs.values():
                    c["right notes"] += 1; c["wrong presses"] += 1
                    credited = sum(k in ("hit", "late", "repeat") for k in ks)
                    c["right called wrong"] += credited == 0 and ks.count("wrong") == 2
                    c["wrong called right"] += credited == 2
    keys = ["presses", "right notes", "right called wrong", "wrong presses", "wrong called right", "unsure"]
    print(f"{'kind':<18}" + "".join(f"{k:>20}" for k in keys) + f"{'worst accuracy':>20}")
    total = collections.Counter()
    worst = 1000
    for kind in KINDS:
        low = tot[kind].pop("worst", None)
        shown = "" if low is None else f"{low / 1000:.3f}"
        print(f"{kind:<18}" + "".join(f"{tot[kind][k]:>20}" for k in keys) + f"{shown:>20}")
        total.update(tot[kind])
        worst = min(worst, 1000 if low is None else low)
    print(f"{'all':<18}" + "".join(f"{total[k]:>20}" for k in keys) + f"{worst / 1000:>20.3f}")
    print(f"other hand played with one hand named: {total['other hand unsure']} of {total['other hand']} presses left unsure")


if __name__ == "__main__":
    main()
