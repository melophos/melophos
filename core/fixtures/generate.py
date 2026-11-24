"""Writes the labelled corpus in `corpus/`: many pieces, each played many ways.

Every piece and every performance comes from a seeded generator, so the files
are the same on every machine. Each press carries a label saying what the
follower should decide. The label comes from how the generator built the
performance (its ground truth), never from running the engine.

Labels:

- ["hit", i]     the first press of expected note i, in time
- ["late", i]    the first press of expected note i, out of time
- ["either", i]  the first press of expected note i, too close to the window's
                 edge (given the jitter) for hit or late to be certain
- ["repeat", i]  expected note i again, after a repeat or a restart
- ["wrong", -1]  a press that belongs to no note (a slip, a neighbour key)
- ["extra", -1]  a press the score does not have that may fairly be read as
                 wrong or as a repeat (an unwritten extra trill note)
- ["any", -1]    an extra trill alternation: wrong, a repeat or any note of
                 the trill is a fair reading
- ["same", i]    a press inside a passage that repeats note for note (an
                 ostinato), after a restart or a repeat there: carrying on and
                 going back give the same presses, so any note of that pitch is
                 a fair reading

What "in time" means is the stated behaviour in docs/scoring.md: a press is
judged against the player's own timeline, the first three chord groups after a start, a pause or a jump are not judged. The two groups after an instant
tempo change may go either way because one interval cannot show a change.

Pieces come in two variants. Variant 1 is the training half used to set the
weights and variant 2 is held out. Run `python3 generate.py` in this folder to
rewrite the files. Every number in them is an integer.
"""

import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "corpus")
WINDOW = 150
PAUSE = 2500
CHORD = 50
WARMUP = 3


class Lcg:
    """A small seeded generator so the corpus never depends on a library version."""

    def __init__(self, seed):
        self.state = (seed * 2654435761 + 12345) & 0xFFFFFFFF

    def next(self):
        self.state = (self.state * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.state >> 8

    def below(self, n):
        return self.next() % n

    def between(self, low, high):
        return low + self.below(high - low + 1)


# pieces: each returns a list of (t_ms, note, hand) with hand "left", "right" or None


def melody(rng, count=64):
    durations = [250, 250, 250, 500, 375, 125, 500, 750]
    t, pitch, out = 0, 67, []
    for _ in range(count):
        out.append((t, pitch, "right"))
        step = rng.between(-3, 3) or 1
        if rng.below(6) == 0:
            step = rng.between(-7, 7) or 5
        pitch = min(84, max(57, pitch + step))
        t += durations[rng.below(len(durations))]
    return out


def two_hands(rng, beats=24):
    """A right-hand tune over a left-hand bass and broken chords: the texture of most beginner pieces."""
    out, t, pitch = [], 0, 72
    beat = 500
    for b in range(beats):
        root = [48, 53, 55, 50, 45, 52][(b // 2) % 6]
        out.append((t, root - 12 if b % 4 == 0 else root, "left"))
        # broken chord in the left hand on the off quavers
        out.append((t + 250, root + 7, "left"))
        if rng.below(2):
            out.append((t + 375, root + 4, "left"))
        # tune: one or two notes a beat
        out.append((t, pitch, "right"))
        if rng.below(3) == 0:
            pitch2 = min(86, max(64, pitch + rng.between(-2, 2) or 2))
            out.append((t + 250, pitch2, "right"))
            pitch = pitch2
        pitch = min(86, max(64, pitch + (rng.between(-4, 4) or 1)))
        t += beat
    return out


def alberti(rng, beats=24):
    """A right-hand tune over an Alberti bass: four left-hand notes to every tune note."""
    out, t, pitch = [], 0, 72
    for b in range(beats):
        root = [48, 53, 55, 48, 50, 55][(b // 2) % 6]
        for k, offset in enumerate((0, 7, 4, 7)):
            out.append((t + k * 125, root + offset, "left"))
        out.append((t, pitch, "right"))
        pitch = min(84, max(64, pitch + (rng.between(-3, 3) or 2)))
        t += 500
    return out


def sparse_bass(rng):
    """A tune in crotchets over one long bass note to each bar."""
    out = []
    for i in range(48):
        out.append((i * 600, 72 + (i * 5 + rng.below(3)) % 9, "right"))
    for b in range(12):
        out.append((b * 2400, 45 + rng.below(8), "left"))
    return out


def very_slow(rng):
    """A slow piece: a note every two seconds, with the bass every other note."""
    out, p = [], 67
    for i in range(16):
        out.append((i * 2000, p, "right"))
        if i % 2 == 0:
            out.append((i * 2000, 43 + rng.below(5), "left"))
        p = min(79, max(60, p + rng.between(-2, 3) or 1))
    return out


def long_rests(rng):
    """Phrases of eight quavers with four seconds of rest between them."""
    out, t = [], 0
    for ph in range(4):
        p = 64 + ph
        for i in range(8):
            out.append((t, p, "right"))
            if i % 4 == 0:
                out.append((t, 41 + ph + rng.below(3), "left"))
            p = min(80, max(58, p + (rng.between(-2, 3) or 1)))
            t += 300
        t += 4000
    return out


def repeated(rng):
    """Each pitch played four times in a row."""
    out, t = [], 0
    for _ in range(12):
        p = 60 + rng.below(10)
        for _ in range(4):
            out.append((t, p, "right"))
            t += 200
    return out


def chords(rng, count=32):
    out, t = [], 0
    for _ in range(count):
        root = 48 + rng.below(12)
        out.append((t, root, "left"))
        out.append((t, root + 7, "left"))
        top = 64 + rng.below(12)
        for k in (0, 4, 7) if rng.below(2) else (0, 3, 8):
            out.append((t, top + k, "right"))
        t += [500, 500, 750, 1000][rng.below(4)]
    return out


def figures(rng, reps=10):
    """A four-note motif repeated in sequence, each time a step higher or lower."""
    motif = [0, 2, 4, 7] if rng.below(2) else [0, 4, 2, 5]
    out, t, base = [], 0, 60 + rng.below(5)
    for r in range(reps):
        for k in motif:
            out.append((t, base + k, "right"))
            t += 200
        base += 2 if r < reps // 2 else -1
        t += 200
    for _ in range(12):
        out.append((t, 55 + rng.below(20), "right"))
        t += 300
    return out


def ostinato(rng, cycles=16):
    """A page of the same four notes, then a new line."""
    cell = [60, 64, 67, 72] if rng.below(2) else [62, 65, 69, 74]
    out, t = [], 0
    for _ in range(cycles):
        for p in cell:
            out.append((t, p, "right"))
            t += 250
    for _ in range(16):
        out.append((t, 48 + rng.below(30), "right"))
        t += 350
    return out


def trill(rng):
    out = []
    t = 0
    for p in melody(rng, 16):
        out.append((t, p[1], "right"))
        t += 400
    a = 70 + rng.below(5)
    for i in range(12):
        out.append((t, a if i % 2 == 0 else a + 2, "right"))
        t += 100
    t += 200
    for p in melody(rng, 16):
        out.append((t, p[1] - 5, "right"))
        t += 400
    return out


def grace(rng):
    """A tune with written grace notes 30 to 40 ms before some of its notes."""
    out = []
    for i, (t, p, h) in enumerate(melody(rng, 48)):
        t = t * 2
        if i % 5 == 3:
            out.append((t, p + 2 if p < 84 else p - 1, h))
            out.append((t + 30 + rng.below(11), p, h))
        else:
            out.append((t, p, h))
    return out


def fast_scale(rng):
    out, t = [], 0
    start = 48 + rng.below(12)
    steps = [0, 2, 4, 5, 7, 9, 11]
    for octave_pass in range(2):
        seq = [start + 12 * (i // 7) + steps[i % 7] for i in range(15)]
        if octave_pass:
            seq = list(reversed(seq))
        for p in seq:
            out.append((t, p, "right"))
            t += 90
    for p in melody(rng, 24):
        out.append((t, p[1], "right"))
        t += 300
    return out


def repeat_section(rng):
    """A section written out twice (A A B), as a score with the repeat spelled out."""
    a = [(t, p, h) for t, p, h in melody(rng, 16)]
    length = a[-1][0] + 400
    b = melody(rng, 24)
    out = list(a) + [(t + length, p, h) for t, p, h in a]
    out += [(t + 2 * length, p - 3, h) for t, p, h in b]
    return out


# families where a note is played late, so may land on a later note of the same pitch
LATE_FAMILIES = {"one_late", "alternate_late", "one_hand_late", "alone_late"}
# families where going back inside an exactly repeating passage is not identifiable
AMBIGUOUS = {"restart", "stumble", "repeat_played", "false_start", "jump_ahead", "repeat_skipped", "restart_earlier"}
OSTINATO_NOTES = 64

TEXTURES = {
    "melody": melody,
    "two_hands": two_hands,
    "alberti": alberti,
    "sparse_bass": sparse_bass,
    "very_slow": very_slow,
    "long_rests": long_rests,
    "repeated": repeated,
    "chords": chords,
    "figures": figures,
    "ostinato": ostinato,
    "trill": trill,
    "grace": grace,
    "fast_scale": fast_scale,
    "repeat_section": repeat_section,
}


def groups_of(piece):
    """Chord groups the way the engine forms them: notes within CHORD ms of a group's first note."""
    order = sorted(range(len(piece)), key=lambda i: (piece[i][0], piece[i][1], i))
    groups = []
    for i in order:
        if groups and len(groups[-1]) < 16 and piece[i][0] - piece[groups[-1][0]][0] <= CHORD:
            groups[-1].append(i)
        else:
            groups.append([i])
    return groups


class Performance:
    """Builds presses and their labels from a plan of segments."""

    def __init__(self, piece, groups, rng, jitter=10):
        self.piece = piece
        self.groups = groups
        self.rng = rng
        self.jitter = jitter
        self.presses = []
        self.played = set()
        self.t = 0.0
        self.last_group = None

    def margin(self):
        # how far from the window's edge a deviation must be for the label to be
        # certain: the engine's clock moves half way to each press, so its error
        # differs from the true deviation by up to about one and a half jitters
        return 25 + self.jitter * 3 // 2

    def label(self, i, deviation, judged):
        if i in self.played:
            return ["repeat", i]
        if not judged:
            return ["hit", i]
        m = self.margin()
        if abs(deviation) <= WINDOW - m:
            return ["hit", i]
        if abs(deviation) >= WINDOW + m:
            return ["late", i]
        return ["either", i]

    def pause_limit(self, g, speed):
        """The stated pause rule: 2.5 s or two and a half of the piece's mean gap over
        the next 8 groups at the player's speed when that is longer."""
        n = len(self.groups)
        ahead = min(g + 8, n - 1)
        if ahead <= g:
            return PAUSE
        span = self.piece[self.groups[ahead][0]][0] - self.piece[self.groups[g][0]][0]
        return max(PAUSE, span / (ahead - g) / speed * 2.5)

    def segment(self, gs, start, speed=lambda s: 1.0, keep=lambda i: True, late=None, either_after=None,
                spread=12, fresh=True, late_member=None):
        """Plays the groups `gs` from play time `start`. `speed` maps score ms to speed and
        `late(g)` gives extra ms for group g's notes: one late note when `late.shifts` is false, a
        hesitation that moves everything after it when it is true. `fresh` says the segment starts
        a new clock (a start, a restart or a jump), so its first groups are not judged. Returns the
        play time of the last press."""
        if not gs:
            return start
        t_play = start
        prev_s = self.piece[self.groups[gs[0]][0]][0]
        shift = 0
        judged_from = WARMUP if fresh else 0
        last = self.presses[-1][0] if self.presses else None
        for k, g in enumerate(gs):
            s = self.piece[self.groups[g][0]][0]
            # integrate the tempo over the score gap, a millisecond at a time
            if s > prev_s:
                t_play += sum(1.0 / speed(x) for x in range(prev_s, s))
            prev_s = s
            extra = late(g) if late else 0
            noise = self.rng.between(-self.jitter, self.jitter) if self.jitter else 0
            base = t_play + shift + extra
            first_when = max(0, round(base + noise))
            # a silence longer than the pause restarts the clock: the stated rule
            limit = PAUSE if self.last_group is None else self.pause_limit(self.last_group, speed(s))
            # and long for the player: twice the last gap between their presses
            if len(self.presses) >= 2:
                limit = max(limit, 2 * (self.presses[-1][0] - self.presses[-2][0]))
            if last is not None and first_when - last > limit:
                judged_from = k + WARMUP
            members = [i for i in self.groups[g] if keep(i)]
            if members:
                self.last_group = g
            judged = k >= judged_from
            uncertain = either_after is not None and either_after(g)
            for n, i in enumerate(members):
                offset = 0 if n == 0 else self.rng.between(0, spread)
                own = late_member(i) if late_member else 0
                when = max(0, round(base + noise + offset + own))
                dev = extra + noise + offset + own
                lab = self.label(i, dev, judged)
                if uncertain and lab[0] in ("hit", "late"):
                    lab = ["either", i]
                self.presses.append([when, self.piece[i][1], lab])
                last = when if last is None else max(last, when)
            if late and getattr(late, "shifts", False):
                shift += extra
            for i in members:
                self.played.add(i)
        return last if last is not None else start

    def finish(self):
        self.presses.sort(key=lambda p: p[0])
        return self.presses


def neighbour(piece, groups, g, pitch, rng):
    """A neighbouring key that is in none of the groups around g, so the label is certain."""
    near = set()
    for h in range(max(0, g - 2), min(len(groups), g + 3)):
        for i in groups[h]:
            near.add(piece[i][1])
    options = [p for p in (pitch + 1, pitch - 1, pitch + 2, pitch - 2) if 21 <= p <= 108 and p not in near]
    return options[rng.below(len(options))] if options else None


def build(name, piece, seed):
    groups = groups_of(piece)
    n = len(groups)
    out = []

    def case(family, level, presses, bar, expect=None):
        if family in LATE_FAMILIES:
            # a late note whose pitch comes again within reach is indistinguishable
            # from that later note played on time: either reading is fair
            for q in presses:
                if q[2][0] in ("hit", "late", "either"):
                    i = q[2][1]
                    if any(j != i and piece[j][1] == piece[i][1] and abs(piece[j][0] - piece[i][0]) <= 600
                           for j in range(len(piece))):
                        q[2] = ["same", i]
        if name.startswith("repeated"):
            # the same pitch four times in a row: once timing moves a note past its
            # neighbour, which of them was meant cannot be told, only what kind of press
            for q in presses:
                if q[2][0] in ("hit", "late", "either", "repeat"):
                    q[2] = [q[2][0] + "~", q[2][1]]
        if family in AMBIGUOUS and name.split("-")[0] in ("ostinato", "repeat_section", "repeated"):
            # in a passage written out note for note more than once, going back
            # and carrying on give the same presses, so either copy is fair
            limit = {"ostinato": OSTINATO_NOTES, "repeat_section": 32}.get(name.split("-")[0], len(piece))
            for q in presses:
                if q[2][0] in ("hit", "repeat", "either", "late") and q[2][1] < limit:
                    q[2] = ["same", q[2][1]]
        out.append({
            "name": f"{family}_{level}" if level is not None else family,
            "family": family,
            "level": level,
            "played": [[p[0], p[1]] for p in presses],
            "labels": [p[2] for p in presses],
            "bar": bar,
            "expect": expect or {},
        })

    def perf(jitter=10, k=0):
        return Performance(piece, groups, Lcg(seed * 1000 + k), jitter)

    allg = list(range(n))
    p = perf(10, 1)
    p.segment(allg, 0)
    case("exact", None, p.finish(), 1.0)

    hands = {h for _, _, h in piece}
    if "left" in hands and "right" in hands:
        for hand in ("right", "left"):
            p = perf(10, 2 if hand == "right" else 3)
            p.segment(allg, 0, keep=lambda i, hand=hand: piece[i][2] == hand)
            case("hand_alone", hand, p.finish(), 1.0, {"hands": hand})
    if name.startswith("chords"):
        # one voice of each chord: the top note only, with no labels needed
        top = {max(grp, key=lambda i: piece[i][1]) for grp in groups}
        p = perf(10, 4)
        p.segment(allg, 0, keep=lambda i: i in top)
        case("one_voice", "top", p.finish(), 1.0)

    p = perf(10, 5)
    p.segment(allg, 0, speed=lambda s: 0.8 + 0.5 * s / max(1, piece[-1][0]))
    case("drift", "up", p.finish(), 0.95)
    p = perf(10, 6)
    p.segment(allg, 0, speed=lambda s: 1.2 - 0.5 * s / max(1, piece[-1][0]))
    case("drift", "down", p.finish(), 0.95)

    mid = groups[n // 2]
    change_s = piece[mid[0]][0]
    for label, after in (("slower", 0.6), ("faster", 1.5)):
        p = perf(10, 7 if after < 1 else 8)
        p.segment(allg, 0, speed=lambda s, a=after: 1.0 if s < change_s else a,
                  either_after=lambda g: n // 2 <= g < n // 2 + 2)
        case("sudden", label, p.finish(), 0.95)

    # rubato: a group whose interval differs by more than half a window from the
    # interval at the tempo of the second before it cannot be called late or in
    # time with certainty, since no listener can hear a change before it happens
    rub = lambda s: 1.0 + 0.2 * math.sin(2 * math.pi * s / 4000)
    def surprise(g):
        if g < 2:
            return False
        s1, s0 = piece[groups[g][0]][0], piece[groups[g - 1][0]][0]
        actual = sum(1.0 / rub(x) for x in range(s0, s1))
        lookback = range(max(0, s0 - 1000), s0)
        mean = sum(1.0 / rub(x) for x in lookback) / max(1, len(lookback))
        return abs(actual - (s1 - s0) * mean) > WINDOW / 2
    p = perf(10, 9)
    p.segment(allg, 0, speed=rub, either_after=surprise)
    case("rubato", None, p.finish(), 0.95)

    for level in (20, 40, 60, 80, 100, 120, 150):
        p = perf(level, 10 + level)
        p.segment(allg, 0)
        case("jitter", level, p.finish(), 0.95 if level <= 80 else 0.9)

    for level in (5, 10, 20, 30):
        rng = Lcg(seed * 77 + level)
        dropped = {i for i in range(len(piece)) if rng.below(100) < level}
        p = perf(10, 20 + level)
        p.segment(allg, 0, keep=lambda i: i not in dropped)
        case("drop", level, p.finish(), 0.95 if level <= 10 else 0.9)

    for level in (5, 10, 20, 30):
        rng = Lcg(seed * 91 + level)
        p = perf(10, 30 + level)
        p.segment(allg, 0)
        presses = p.finish()
        group_of = {i: g for g, grp in enumerate(groups) for i in grp}
        for q in presses:
            if q[2][0] == "hit" and rng.below(100) < level:
                i = q[2][1]
                swap = neighbour(piece, groups, group_of[i], q[1], rng)
                if swap is not None:
                    q[1] = swap
                    q[2] = ["wrong", -1]
        case("neighbour", level, presses, 0.95 if level <= 10 else 0.85)

    # a slip onto the next note: the key of the note that comes next is pressed in
    # place of this one, then the next note is played in its own time. The slip is
    # a wrong note, not the next note early: the commonest slip there is
    for level in (5, 10, 20):
        rng = Lcg(seed * 53 + level)
        group_of = {i: g for g, grp in enumerate(groups) for i in grp}
        p = perf(10, 45 + level)
        p.segment(allg, 0)
        presses = p.finish()
        for q in presses:
            if q[2][0] != "hit" or rng.below(100) >= level:
                continue
            g = group_of[q[2][1]]
            if g < WARMUP + 1 or g + 1 >= n or len(groups[g]) > 1 or len(groups[g + 1]) > 1:
                continue
            nxt = piece[groups[g + 1][0]][1]
            gap = piece[groups[g + 1][0]][0] - piece[groups[g][0]][0]
            here = {piece[i][1] for h in range(max(0, g - 2), g + 1) for i in groups[h]}
            if nxt in here or gap < 2 * WINDOW:
                continue
            q[1] = nxt
            q[2] = ["wrong", -1]
        case("slip_next", level, presses, 0.95 if level <= 10 else 0.9)

    rng = Lcg(seed * 13)
    p = perf(10, 40)
    p.segment(allg, 0)
    presses = p.finish()
    group_of = {i: g for g, grp in enumerate(groups) for i in grp}
    extras = []
    for q in presses:
        if q[2][0] == "hit" and rng.below(10) == 0:
            g = group_of[q[2][1]]
            pitch = neighbour(piece, groups, g, q[1] + 5 if q[1] < 100 else q[1] - 5, rng)
            if pitch is not None:
                extras.append([q[0] + 60 + rng.below(40), pitch, ["wrong", -1]])
    presses = sorted(presses + extras, key=lambda q: q[0])
    case("extra", 10, presses, 0.95)

    # hesitations: the player stops before one group then carries on from there
    at = n * 3 // 5
    for d in (100, 160, 250, 400, 800, 1600, 2400, 3200):
        def hesitate(g, d=d):
            return d if g == at else 0
        hesitate.shifts = True
        p = perf(10, 50 + d % 97)
        p.segment(allg, 0, late=hesitate)
        case("hesitate", d, p.finish(), 0.95)

    # a single note out of time, the rest on the beat. It may land after the notes
    # that follow it, in either hand: it is still the note it was, played late
    def one_late(g):
        return 260 if g == at else 0
    p = perf(10, 60)
    p.segment(allg, 0, late=one_late)
    case("one_late", 260, p.finish(), 0.95)

    def alternate(g):
        return 260 if g % 2 == 1 and g > WARMUP + 2 else 0
    p = perf(10, 61)
    p.segment(allg, 0, late=alternate)
    case("alternate_late", 260, p.finish(), 0.9)

    # one hand late, the other on time: the melody note of one group comes late
    # while the accompaniment carries on, so other notes come between
    if "left" in hands and "right" in hands:
        rh_at = next((g for g in range(at, n) if any(piece[i][2] == "right" for i in groups[g])
                      and any(piece[i][2] == "left" for i in groups[g])), None)
        if rh_at is not None:
            for d in (100, 140, 200, 300, 450):
                p = perf(10, 70 + d % 89)
                p.segment(allg, 0, late_member=lambda i, d=d: d if i in groups[rh_at] and piece[i][2] == "right" else 0)
                case("one_hand_late", d, p.finish(), 0.95)

    # a hand alone with a change of timing: one note late, a hesitation, a rush and
    # a sudden rise in tempo, none of which may turn the hand's notes into mistakes
    if "left" in hands and "right" in hands:
        for hand in ("right", "left"):
            mine = [g for g in allg if any(piece[i][2] == hand for i in groups[g])]
            if len(mine) < 8:
                continue
            gm = mine[len(mine) // 2]
            keep = lambda i, hand=hand: piece[i][2] == hand
            p = perf(10, 80)
            p.segment(allg, 0, keep=keep, late=lambda g, gm=gm: 300 if g == gm else 0)
            case("alone_late", hand, p.finish(), 0.95, {"hands": hand})
            hes = lambda g, gm=gm: 400 if g == gm else 0
            hes.shifts = True
            p = perf(10, 81)
            p.segment(allg, 0, keep=keep, late=hes)
            case("alone_hesitate", hand, p.finish(), 0.95, {"hands": hand})
            rush = lambda g, gm=gm: -250 if g == gm else 0
            rush.shifts = True
            p = perf(10, 82)
            p.segment(allg, 0, keep=keep, late=rush)
            case("alone_rush", hand, p.finish(), 0.95, {"hands": hand})
            change = piece[groups[gm][0]][0]
            p = perf(10, 83)
            p.segment(allg, 0, keep=keep, speed=lambda s, c=change: 1.0 if s < c else 1.25,
                      either_after=lambda g, gm=gm: gm <= g < gm + 3)
            case("alone_faster", hand, p.finish(), 0.95, {"hands": hand})

    # a change of tempo that does not start from the written speed
    for label, (a, b) in (("70_to_100", (0.7, 1.0)), ("130_to_80", (1.3, 0.8))):
        p = perf(10, 84 if a < 1 else 85)
        p.segment(allg, 0, speed=lambda s, a=a, b=b: a if s < change_s else b,
                  either_after=lambda g: n // 2 <= g < n // 2 + 3)
        case("tempo_from", label, p.finish(), 0.95)

    # hammering: two seconds of random keys in the middle, then carrying on from
    # where the player stopped. Every key in the burst is a wrong press
    gmid = n // 2
    p = perf(10, 86)
    last = p.segment(list(range(gmid)), 0)
    rng = Lcg(seed * 31 + 7)
    for k in range(20):
        p.presses.append([round(last + 100 + k * 100), 36 + rng.below(60), ["wrong", -1]])
    p.segment(list(range(gmid, n)), last + 2200, fresh=False,
              either_after=lambda g: g == gmid)
    case("hammer", "keys", p.finish(), 0.9)
    # one key pressed again and again: one press is the note, the rest are extra presses
    p = perf(10, 87)
    last = p.segment(list(range(gmid)), 0)
    key = piece[groups[gmid - 1][0]][1]
    for k in range(10):
        p.presses.append([round(last + 60 + k * 60), key, ["wrong", -1]])
    p.segment(list(range(gmid, n)), last + 1000, fresh=False, either_after=lambda g: g == gmid)
    case("hammer", "one_key", p.finish(), 0.95)

    # several mistakes at once: 40 ms of jitter with one in ten notes dropped, one
    # in ten a neighbouring key and one in ten followed by an extra press
    rng = Lcg(seed * 41 + 3)
    p = perf(40, 88)
    p.segment(allg, 0)
    group_of = {i: g for g, grp in enumerate(groups) for i in grp}
    mixed = []
    for q in p.finish():
        u = rng.below(100)
        if q[2][0] in ("hit", "either", "late") and u < 10:
            continue
        if q[2][0] in ("hit", "either", "late") and u < 20:
            swap = neighbour(piece, groups, group_of[q[2][1]], q[1], rng)
            if swap is not None:
                mixed.append([q[0], swap, ["wrong", -1]])
                continue
        mixed.append(q)
        if q[2][0] in ("hit", "either", "late") and rng.below(10) == 0:
            pitch = neighbour(piece, groups, group_of[q[2][1]], q[1] + 3, rng)
            if pitch is not None:
                mixed.append([q[0] + 20 + rng.below(40), pitch, ["wrong", -1]])
    case("mixed", None, sorted(mixed, key=lambda q: q[0]), 0.9)

    # four notes in a row an octave out
    singles = [g for g in range(WARMUP + 2, n - 6) if len(groups[g]) == 1]
    if singles:
        g0 = singles[len(singles) // 2]
        run4 = []
        k = g0
        while len(run4) < 4 and k < n:
            if len(groups[k]) == 1:
                run4.append(groups[k][0])
            k += 1
        p = perf(10, 89)
        p.segment(allg, 0)
        for q in p.presses:
            if q[2][1] in run4 and q[2][0] in ("hit", "either", "late"):
                q[1] = q[1] + 12 if q[1] + 12 <= 108 else q[1] - 12
                q[2] = ["wrong", -1]
        case("octave_run", 4, p.finish(), 0.95)

    # chords rolled slowly, 90 ms a note: the timing of the later notes is not
    # certain, but they are the chord's notes
    if any(len(grp) >= 3 for grp in groups):
        p = perf(10, 90)
        p.segment(allg, 0, spread=0, late_member=lambda i: 90 * sorted(
            groups[next(g for g, grp in enumerate(groups) if i in grp)],
            key=lambda j: piece[j][1]).index(i))
        rolled = p.finish()
        for q in rolled:
            if q[2][0] in ("hit", "late"):
                q[2] = ["either", q[2][1]]
        case("rolled", 90, rolled, 0.95)

    # one hand stops for two seconds while the other carries on
    if "left" in hands and "right" in hands:
        hold = piece[groups[n // 3][0]][0]
        p = perf(10, 91)
        p.segment(allg, 0, keep=lambda i: not (piece[i][2] == "left" and hold <= piece[i][0] < hold + 2000))
        case("one_hand_holds", None, p.finish(), 0.95)

    # a restart from an earlier bar after getting most of the way
    a3, b3 = int(n * 0.6), int(n * 0.3)
    p = perf(10, 92)
    end = p.segment(list(range(a3)), 0)
    p.segment(list(range(b3, n)), end + 900)
    case("restart_earlier", None, p.finish(), 0.95)

    # a pause half way
    p = perf(10, 62)
    end = p.segment(list(range(n // 2)), 0)
    p.segment(list(range(n // 2, n)), end + 4000)
    case("pause", 4000, p.finish(), 0.95)

    # a false start: a slip onto a note that comes soon, a breath, then the piece
    p = perf(10, 63)
    slip = piece[groups[1][0]][1] if n > 1 else piece[0][1] + 1
    p.presses.append([0, slip, ["wrong", -1]])
    p.segment(allg, 700)
    case("false_start", None, p.finish(), 0.95)

    # restarts from the top, after a pause and straight away
    cut = max(6, n * 2 // 5)
    for label, gap in (("after_pause", 3000), ("at_once", 500)):
        p = perf(10, 64 if gap > 1000 else 65)
        end = p.segment(list(range(cut)), 0)
        p.segment(allg, end + gap + 250)
        case("restart", label, p.finish(), 0.95)

    # a stumble: back two or three groups and on again, twice
    # after the replay the player carries on at the music's own pace: that is not a
    # jump, so the clock carries on too
    def gap(a, b):
        return piece[groups[b][0]][0] - piece[groups[a][0]][0]

    p = perf(10, 66)
    marks = [n // 3, n * 2 // 3]
    t = 0
    start = 0
    for m in marks:
        if start == 0:
            t = p.segment(list(range(start, m)), 0)
        else:
            t = p.segment(list(range(start, m)), t + gap(start - 1, start), fresh=False)
        back = 3
        t = p.segment(list(range(m - back, m)), t + 350)
        start = m
    p.segment(list(range(start, n)), t + gap(start - 1, start), fresh=False)
    case("stumble", None, p.finish(), 0.95)

    # a repeat played: a section of a quarter of the piece played twice
    a, b = n // 4, n // 2
    p = perf(10, 67)
    end = p.segment(list(range(b)), 0)
    end = p.segment(list(range(a, b)), end + 400)
    p.segment(list(range(b, n)), end + gap(b - 1, b), fresh=False)
    case("repeat_played", None, p.finish(), 0.95)

    # jumping ahead: from a quarter of the way to over half way
    p = perf(10, 68)
    end = p.segment(list(range(n // 4)), 0)
    p.segment(list(range(n * 3 // 5, n)), end + 400)
    case("jump_ahead", None, p.finish(), 0.95)

    if name.startswith("repeat_section"):
        # the written-out repeat skipped: A then straight to B
        first_b = next(g for g in range(n) if piece[groups[g][0]][0] >= 2 * (piece[15][0] + 400))
        second_a = next(g for g in range(n) if piece[groups[g][0]][0] >= piece[15][0] + 400)
        p = perf(10, 69)
        end = p.segment(list(range(second_a)), 0)
        p.segment(list(range(first_b, n)), end + 400)
        case("repeat_skipped", None, p.finish(), 0.95)

    if name.startswith("trill"):
        # the trill played with four alternations more than written
        p = perf(10, 70)
        trill_groups = [g for g in range(n) if 16 <= groups[g][0] < 28]
        end = p.segment(list(range(trill_groups[-1] + 1)), 0)
        last_two = [piece[groups[trill_groups[-2]][0]][1], piece[groups[trill_groups[-1]][0]][1]]
        for k in range(4):
            end += 100
            p.presses.append([round(end), last_two[k % 2], ["any", -1]])
        # which alternations are the written ones and which the extra ones cannot be known
        trill_notes = {i for g in trill_groups for i in groups[g]}
        for q in p.presses:
            if q[2][0] in ("hit", "either", "late") and q[2][1] in trill_notes:
                q[2] = ["same", q[2][1]]
        p.segment(list(range(trill_groups[-1] + 1, n)), end + 300)
        case("long_trill", None, p.finish(), 0.9)

    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, make in TEXTURES.items():
        for variant in (1, 2):
            seed = sum(ord(c) for c in name) * 10 + variant
            piece = make(Lcg(seed))
            piece.sort(key=lambda x: (x[0], x[1]))
            # two notes of the same pitch at the same time are one note
            seen, clean = set(), []
            for t, p, h in piece:
                if (t, p) not in seen:
                    seen.add((t, p))
                    clean.append((t, p, h))
            piece = clean
            cases = build(name, piece, seed)
            doc = {
                "name": f"{name}-{variant}",
                "texture": name,
                "split": "train" if variant == 1 else "test",
                "config": {"window_ms": WINDOW, "band": 16, "pause_ms": PAUSE, "chord_ms": CHORD,
                           "relocate_after": 3},
                "expected": [[t, p] for t, p, _ in piece],
                "hands": [h for _, _, h in piece] if any(h == "left" for _, _, h in piece) else None,
                "cases": cases,
            }
            with open(os.path.join(OUT, f"{name}-{variant}.json"), "w") as handle:
                json.dump(doc, handle, separators=(",", ":"))
                handle.write("\n")


if __name__ == "__main__":
    main()
