"""Writes the final check set in this folder: run once, never tuned on.

This file is written apart from `../generate.py` on purpose. It shares no code
with it: other pieces, another random source, other seeds and other rules for
where mistakes go. It follows the same stated rules for what a label means
(docs/scoring.md), so its labels are the ground truth the follower is judged by:

- a press of a note within the window (150 ms) of its own time on the player's
  timeline is a hit and beyond it late. Near the edge it is either (the margin
  grows with the jitter, since the follower's clock moves with each press);
- the first 3 chord groups after a start, a pause or a jump are not judged. A
  pause is a silence longer than 2.5 s, than two and a half of the piece's mean
  gap over the next 8 groups at the player's speed and than twice the last gap
  between presses;
- a note played again after a restart or a repeat is a repeat;
- a key that belongs to no note is wrong;
- a press played late whose note has the same pitch as another within 600 ms
  may fairly be read as either ("same").

Run `python3 make_final.py` in this folder. Every number in the output is an integer.
"""

import json
import os

FOLDER = os.path.dirname(os.path.abspath(__file__))
WINDOW = 150
GROUP_MS = 50


class XorShift:
    """xorshift32, seeded, so the set never depends on a library version."""

    def __init__(self, seed):
        self.x = (seed * 747796405 + 2891336453) & 0xFFFFFFFF or 1

    def u32(self):
        x = self.x
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= x >> 17
        x ^= (x << 5) & 0xFFFFFFFF
        self.x = x
        return x

    def pick(self, items):
        return items[self.u32() % len(items)]

    def int(self, low, high):
        return low + self.u32() % (high - low + 1)

    def chance(self, percent):
        return self.u32() % 100 < percent


# pieces: (time, pitch, hand)

def waltz(r):
    notes, t = [], 0
    for bar in range(16):
        bass = r.pick([43, 45, 48, 50, 41])
        notes.append((t, bass, "left"))
        for beat in (1, 2):
            chord = bass + r.pick([7, 12])
            notes.append((t + beat * 400, chord, "left"))
            notes.append((t + beat * 400, chord + 4, "left"))
        tune = r.int(67, 79)
        notes.append((t, tune, "right"))
        if r.chance(60):
            notes.append((t + 800, tune + r.pick([-2, 2, 3]), "right"))
        t += 1200
    return notes


def hymn(r):
    notes, t = [], 0
    soprano = 72
    for _ in range(20):
        soprano = max(67, min(79, soprano + r.pick([-2, -1, 1, 2, 0])))
        alto = soprano - r.pick([3, 4, 5])
        tenor = alto - r.pick([5, 7])
        bass = tenor - r.pick([7, 9, 12])
        notes += [(t, soprano, "right"), (t, alto, "right"), (t, tenor, "left"), (t, bass, "left")]
        t += r.pick([600, 600, 1200])
    return notes


def canon(r):
    line, t = [], 0
    pitch = 64
    for _ in range(24):
        pitch = max(57, min(76, pitch + r.pick([-3, -2, -1, 1, 2, 4])))
        line.append((t, pitch))
        t += r.pick([250, 250, 500])
    notes = [(t, p, "right") for t, p in line]
    # the second voice enters two beats later, an octave lower
    notes += [(t + 1000, p - 12, "left") for t, p in line]
    return notes


def pentatonic(r):
    scale = [60, 62, 64, 67, 69, 72, 74, 76]
    notes, t, k = [], 0, 3
    for _ in range(40):
        k = max(0, min(len(scale) - 1, k + r.pick([-2, -1, 1, 2])))
        notes.append((t, scale[k], "right"))
        t += r.pick([375, 125, 250, 500])
    return notes


def broken_octaves(r):
    notes, t = [], 0
    for _ in range(18):
        low = r.int(36, 47)
        notes.append((t, low, "left"))
        notes.append((t + 150, low + 12, "left"))
        notes.append((t, r.int(65, 81), "right"))
        t += 300
    return notes


def slow_chorale(r):
    notes, t = [], 0
    for _ in range(12):
        top = r.int(64, 74)
        notes += [(t, top, "right"), (t, top - 4, "right"), (t, top - 16, "left")]
        t += r.pick([1800, 2400])
    return notes


PIECES = [waltz, hymn, canon, pentatonic, broken_octaves, slow_chorale]


def chord_groups(piece):
    """Chord groups as the follower forms them: within 50 ms of a group's first note."""
    order = sorted(range(len(piece)), key=lambda i: (piece[i][0], piece[i][1], i))
    out = []
    for i in order:
        if out and len(out[-1]) < 16 and piece[i][0] - piece[out[-1][0]][0] <= GROUP_MS:
            out[-1].append(i)
        else:
            out.append([i])
    return out


class Take:
    """One performance: presses with labels, built from what the player did."""

    def __init__(self, piece, r, jitter):
        self.piece, self.r, self.jitter = piece, r, jitter
        self.groups = chord_groups(piece)
        self.out = []
        self.done = set()
        self.last_group = None

    def margin(self):
        return 25 + self.jitter * 3 // 2

    def kind(self, note, deviation, judged):
        if note in self.done:
            return ["repeat", note]
        if not judged or abs(deviation) <= WINDOW - self.margin():
            return ["hit", note]
        if abs(deviation) >= WINDOW + self.margin():
            return ["late", note]
        return ["either", note]

    def pause_after(self, g, speed):
        n = len(self.groups)
        ahead = min(g + 8, n - 1)
        limit = 2500
        if ahead > g:
            span = self.piece[self.groups[ahead][0]][0] - self.piece[self.groups[g][0]][0]
            limit = max(limit, span / (ahead - g) / speed * 2.5)
        if len(self.out) >= 2:
            times = sorted(p[0] for p in self.out)
            limit = max(limit, 2 * (times[-1] - times[-2]))
        return limit

    def play(self, run, start, speed=1.0, who=lambda i: True, offset=lambda i: 0, shift_from=None,
             shift=0, new_clock=True):
        """Plays the groups in `run` from `start` at `speed`. `offset(i)` moves one note,
        `shift` moves every group from `shift_from` on (a hesitation or a rush)."""
        s0 = self.piece[self.groups[run[0]][0]][0]
        unjudged = 3 if new_clock else 0
        latest = max((p[0] for p in self.out), default=None)
        count = 0
        for g in run:
            s = self.piece[self.groups[g][0]][0]
            moved = shift if shift_from is not None and g >= shift_from else 0
            base = start + (s - s0) / speed + moved
            noise = self.r.int(-self.jitter, self.jitter) if self.jitter else 0
            members = [i for i in self.groups[g] if who(i)]
            if not members:
                continue
            here = round(base + noise)
            if latest is not None and self.last_group is not None and here - latest > self.pause_after(self.last_group, speed):
                unjudged = count + 3
            judged = count >= unjudged
            for k, i in enumerate(members):
                spread = 0 if k == 0 else self.r.int(0, 10)
                own = offset(i)
                when = max(0, round(base + noise + spread + own))
                deviation = noise + spread + own + (moved if g == shift_from else 0)
                self.out.append([when, self.piece[i][1], self.kind(i, deviation, judged)])
                latest = when if latest is None else max(latest, when)
            self.done.update(members)
            self.last_group = g
            count += 1
        return latest

    def presses(self):
        self.out.sort(key=lambda p: p[0])
        return self.out


def wrong_key(piece, groups, g, pitch, r):
    near = {piece[i][1] for h in range(max(0, g - 3), min(len(groups), g + 4)) for i in groups[h]}
    options = [pitch + d for d in (-3, -2, -1, 1, 2, 3) if 21 <= pitch + d <= 108 and pitch + d not in near]
    return r.pick(options) if options else None


def ambiguous_late(piece, presses):
    for p in presses:
        if p[2][0] in ("late", "either"):
            i = p[2][1]
            if any(j != i and piece[j][1] == piece[i][1] and abs(piece[j][0] - piece[i][0]) <= 600
                   for j in range(len(piece))):
                p[2] = ["same", i]
    return presses


def takes(piece, seed):
    groups = chord_groups(piece)
    n = len(groups)
    every = list(range(n))
    hands = {h for _, _, h in piece}
    out = []

    def add(family, level, presses, bar, expect=None):
        presses = ambiguous_late(piece, presses)
        out.append({"name": f"{family}_{level}", "family": family, "level": level,
                    "played": [[p[0], p[1]] for p in presses], "labels": [p[2] for p in presses],
                    "bar": bar, "expect": expect or {}})

    def take(k, jitter=8):
        return Take(piece, XorShift(seed * 131 + k), jitter)

    r = XorShift(seed * 977 + 5)
    tk = take(1)
    tk.play(every, 300)
    add("as_written", 0, tk.presses(), 1.0)
    for speed in (0.65, 1.35):
        tk = take(2 + int(speed * 10))
        tk.play(every, 300, speed=speed)
        add("steady", int(speed * 100), tk.presses(), 1.0)
    # a note late at a random place, on its own: the other hand carries on
    for d in (120, 220, 350):
        g = r.int(4, n - 3)
        note = r.pick(groups[g])
        tk = take(10 + d % 13)
        tk.play(every, 300, offset=lambda i, note=note, d=d: d if i == note else 0)
        add("late_note", d, tk.presses(), 0.95)
    # each hand alone, steady and with a stop and a rush
    if {"left", "right"} <= hands:
        for hand in ("left", "right"):
            mine = lambda i, hand=hand: piece[i][2] == hand
            tk = take(20 if hand == "left" else 21)
            tk.play(every, 300, who=mine)
            add("alone", hand, tk.presses(), 1.0, {"hands": hand})
            g = r.int(n // 3, 2 * n // 3)
            tk = take(22 if hand == "left" else 23)
            tk.play(every, 300, who=mine, shift_from=g, shift=r.pick([300, 500, -200]))
            add("alone_shift", hand, tk.presses(), 0.95, {"hands": hand})
    # jitter and wrong keys
    for level in (30, 70, 110):
        tk = take(30 + level, jitter=level)
        tk.play(every, 300)
        add("jitter", level, tk.presses(), 0.95 if level <= 70 else 0.9)
    for level in (8, 15, 25):
        tk = take(40 + level)
        tk.play(every, 300)
        presses = tk.presses()
        group_of = {i: g for g, grp in enumerate(groups) for i in grp}
        for p in presses:
            if p[2][0] == "hit" and r.chance(level):
                w = wrong_key(piece, groups, group_of[p[2][1]], p[1], r)
                if w is not None:
                    p[1], p[2] = w, ["wrong", -1]
        add("wrong_keys", level, presses, 0.95 if level <= 15 else 0.9)
    # notes left out
    for level in (10, 25):
        gone = {i for i in range(len(piece)) if r.chance(level)}
        tk = take(50 + level)
        tk.play(every, 300, who=lambda i: i not in gone)
        add("left_out", level, tk.presses(), 0.95 if level <= 10 else 0.9)
    # a restart from a random earlier bar after a short stop
    stop = r.int(n // 2, n - 4)
    back_to = r.int(0, stop // 2)
    tk = take(60)
    end = tk.play(every[:stop], 300)
    tk.play(every[back_to:], end + r.pick([700, 1500, 3000]))
    add("restart", back_to, tk.presses(), 0.95)
    # a hesitation at a random place, then on from there
    g = r.int(4, n - 3)
    tk = take(61)
    tk.play(every, 300, shift_from=g, shift=r.pick([250, 600, 1200]))
    add("hesitation", g, tk.presses(), 0.95)
    # a burst of random keys at a random place, then on from where the player stopped
    g = r.int(n // 3, 2 * n // 3)
    tk = take(62)
    end = tk.play(every[:g], 300)
    keys = r.int(8, 25)
    for k in range(keys):
        tk.out.append([round(end + 80 + k * r.int(60, 140)), r.int(30, 100), ["wrong", -1]])
    burst_end = max(p[0] for p in tk.out)
    first_back = len(tk.out)
    tk.play(every[g:], burst_end + 600, new_clock=False)
    # the first group after the burst may be judged either way
    for p in tk.out[first_back:]:
        if p[2][1] in groups[g] and p[2][0] in ("hit", "late"):
            p[2] = ["either", p[2][1]]
    add("burst", keys, tk.presses(), 0.9)
    return out


def main():
    for k, make in enumerate(PIECES):
        for variant in (1, 2):
            seed = 50_000 + k * 101 + variant * 7
            piece = sorted(set(make(XorShift(seed))), key=lambda x: (x[0], x[1]))
            # one note per time and pitch
            seen, clean = set(), []
            for t, p, h in piece:
                if (t, p) not in seen:
                    seen.add((t, p))
                    clean.append((t, p, h))
            doc = {
                "name": f"{make.__name__}-{variant}",
                "texture": make.__name__,
                "split": "final",
                "config": {"window_ms": 150, "band": 16, "pause_ms": 2500, "chord_ms": 50, "relocate_after": 3},
                "expected": [[t, p] for t, p, _ in clean],
                "hands": [h for _, _, h in clean],
                "cases": takes(clean, seed),
            }
            with open(os.path.join(FOLDER, f"{doc['name']}.json"), "w") as f:
                json.dump(doc, f, separators=(",", ":"))
                f.write("\n")


if __name__ == "__main__":
    main()
