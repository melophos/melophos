"""The module's interface: types, defaults, errors, pickling and thread behaviour."""

import pickle
import threading
import time

import melophos_core as mc
import pytest

PIECE = [(0, 60), (500, 62), (1000, 64), (1500, 65)]


def test_the_package_ships_type_information():
    from importlib.resources import files

    assert files("melophos_core").joinpath("py.typed").is_file()


def test_scoring_error_is_a_value_error():
    assert issubclass(mc.ScoringError, ValueError)


def test_the_limits_are_exported():
    assert (mc.MAX_EXPECTED, mc.MAX_PLAYED) == (100_000, 216_000)


def test_an_empty_piece_and_performance_are_perfect():
    assert mc.score([], []).accuracy == 1.0
    result = mc.follow([], [])
    assert result.events == []
    assert result.score.mean_timing_error_ms is None
    assert result.score.mean_speed_ppm is None
    assert result.score.hands == "unknown"


def test_a_slow_steady_performance_scores_as_steady():
    played = [(round(t / 0.6) + 200, n) for t, n in PIECE]
    result = mc.follow(PIECE, played)
    assert result.score.hits == 4
    assert result.score.wrong == 0
    assert abs(result.score.final_speed_ppm - 600_000) < 5_000
    assert [e.kind for e in result.events] == ["hit"] * 4


def test_defaults_equal_explicit_defaults():
    played = [(t + 10, n) for t, n in PIECE]
    assert (
        mc.follow(PIECE, played).events
        == mc.follow(PIECE, played, window_ms=150, band=16, pause_ms=2500, chord_ms=50, relocate_after=3).events
    )


def test_results_are_immutable():
    result = mc.follow(PIECE, PIECE)
    with pytest.raises(AttributeError):
        result.score.hits = 0  # type: ignore[misc]


@pytest.mark.parametrize(
    "notes",
    [
        [[0, 60], [500, 62]],
        ((0, 60), (500, 62)),
        [(0, 60), [500, 62]],
        iter([(0, 60), (500, 62)]),
        (pair for pair in [(0, 60), (500, 62)]),
    ],
)
def test_any_sequence_of_pairs_is_a_list_of_notes(notes):
    assert mc.follow(PIECE[:2], notes).score.hits == 2


@pytest.mark.parametrize(
    "bad",
    [(-1, 60), (0, 128), (0, -1), (2**32, 60), (2**64, 60), (-(2**70), 60)],
)
def test_out_of_range_numbers_raise_a_scoring_error_that_names_the_field(bad):
    with pytest.raises(mc.ScoringError, match=r"played\[0\]"):
        mc.follow([], [bad])


@pytest.mark.parametrize(
    ("bad", "says"),
    [
        ([("0", 60)], r"played\[0\] time must be an int"),
        ([(0.0, 60)], r"played\[0\] time must be an int"),
        ([(True, 60)], r"played\[0\] time must be an int, not a bool"),
        ([(0, False)], r"played\[0\] note must be an int, not a bool"),
        ([(0, 60, 1)], r"played\[0\] must be a \(time_ms, note\) pair, got 3 items"),
        ([(0,)], r"got 1 items"),
        ([60], r"played\[0\] must be a \(time_ms, note\) pair, not int"),
        (["ab"], r"played\[0\] must be a \(time_ms, note\) pair, not str"),
        ("ab", r"played must be a sequence"),
        (None, r"played must be a sequence"),
        (5, r"played must be a sequence"),
    ],
)
def test_input_of_the_wrong_shape_raises_a_type_error_that_says_what_is_wrong(bad, says):
    with pytest.raises(TypeError, match=says):
        mc.follow([], bad)


def test_a_bool_is_not_a_setting():
    with pytest.raises(TypeError, match="window_ms must be an int, not a bool"):
        mc.follow(PIECE, PIECE, window_ms=True)
    with pytest.raises(TypeError, match="window_ms"):
        mc.score(PIECE, PIECE, window_ms=True)
    with pytest.raises(TypeError, match="t_ms"):
        mc.Follower(PIECE).push(True, 60)


def test_a_bad_configuration_names_the_field():
    with pytest.raises(mc.ScoringError, match="band"):
        mc.follow([], [], band=2)
    with pytest.raises(mc.ScoringError, match="relocate_after"):
        mc.follow([], [], relocate_after=9)
    with pytest.raises(mc.ScoringError, match="pause_ms"):
        mc.follow([], [], pause_ms=10)
    with pytest.raises(mc.ScoringError, match="window_ms"):
        mc.follow([], [], window_ms=10_001)


def test_presses_out_of_order_are_refused_and_change_nothing():
    with pytest.raises(mc.ScoringError, match="earlier"):
        mc.follow([], [(5, 60), (4, 60)])
    session = mc.Follower(PIECE)
    session.push(100, 60)
    before = (session.position, session.speed_ppm, session.finish())
    for bad in [(50, 60), (-1, 60), (200, 999), (10**30, 60)]:
        with pytest.raises((mc.ScoringError, TypeError)):
            session.push(*bad)
    assert (session.position, session.speed_ppm, session.finish()) == before
    assert session.push(600, 62).event.kind == "hit"


def test_lists_over_the_limits_are_refused():
    with pytest.raises(mc.ScoringError, match="100000"):
        mc.follow([(i, 60) for i in range(100_001)], [])
    with pytest.raises(mc.ScoringError, match="216000"):
        mc.follow([], [(0, 60)] * 216_001)
    with pytest.raises(mc.ScoringError, match="216000"):
        mc.score([], [(0, 60)] * 216_001)
    with pytest.raises(mc.ScoringError, match="100000"):
        mc.score(((i, 60) for i in range(100_001)), [])


def test_the_live_follower_reports_tempo_and_place():
    session = mc.Follower(PIECE)
    for t, n in PIECE:
        session.push(round(t / 0.6), n)
    assert session.position == 3
    assert abs(session.speed_ppm - 600_000) < 20_000


def test_a_repeat_revises_earlier_events():
    # a repeated passage: the repeat is read again as a repeat once it is recognised
    piece = [(i * 400, 50 + ((i * i * 7 + i * 3 + i // 5 * 11) % 29)) for i in range(30)]
    session = mc.Follower(piece)
    revised_seen = False
    for t, n in piece[:20]:
        session.push(t, n)
    for t, n in piece[12:20]:
        step = session.push(t + 20 * 400 + 4000, n)
        revised_seen = revised_seen or bool(step.revised)
    assert revised_seen
    assert session.finish().repeats == 8


def test_a_hand_played_alone_is_reported_as_that_hand():
    piece = []
    hands = []
    for i in range(20):
        piece += [(i * 500, 72 + i % 5), (i * 500, 48 + i % 4)]
        hands += ["right", "left"]
    right = [p for p, h in zip(piece, hands) if h == "right"]
    score = mc.follow(piece, right, hands=hands).score
    assert (score.hands, score.wrong, score.played_expected, score.played_accuracy) == ("right", 0, 20, 1.0)
    assert mc.follow(piece, right).score.hands == "unknown"
    with pytest.raises(mc.ScoringError, match="hand labels"):
        mc.follow(piece, right, hands=hands[:-1])
    with pytest.raises(mc.ScoringError, match=r"hands\[0\]"):
        mc.follow(piece, right, hands=["middle"] * len(piece))


def test_every_result_pickles_and_comes_back_equal():
    result = mc.follow(PIECE, [(0, 60), (520, 63), (1000, 64)])
    for value in (result, result.score, result.events[1], mc.score(PIECE, PIECE)):
        again = pickle.loads(pickle.dumps(value))
        assert again == value
        assert type(again) is type(value)
    update = mc.Follower(PIECE).push(0, 60)
    assert pickle.loads(pickle.dumps(update)) == update


def test_follow_releases_the_interpreter_lock_while_it_runs():
    # another thread counts while the call runs. With the lock held for the whole
    # call it could not run at all inside it, so its count there would be zero
    piece = [(i * 250, 40 + (i * 7) % 41) for i in range(100_000)]
    played = [(i * 250, 40 + (i * 7) % 41) for i in range(200_000)]
    stamps = []
    stop = threading.Event()

    def tick():
        while not stop.is_set():
            stamps.append(time.perf_counter())

    worker = threading.Thread(target=tick)
    worker.start()
    time.sleep(0.05)
    try:
        start = time.perf_counter()
        mc.follow(piece, played)
        end = time.perf_counter()
    finally:
        stop.set()
        worker.join()
    # the inputs are converted with the lock held, so only the engine's own run counts
    inside = [s for s in stamps if start + 0.02 < s < end - 0.02]
    assert end - start > 0.1, "the call was too short to tell"
    assert len(inside) > 1_000, f"the other thread ran {len(inside)} times during the call"


def _two_hands():
    piece, hands = [], []
    for i in range(24):
        piece.append((i * 500, 72 + ((i * 5 + i // 3) % 11)))
        hands.append("right")
        for k in range(2):
            piece.append((i * 500 + k * 250, 43 + ((i * 3 + k * 4) % 9)))
            hands.append("left")
    return piece, hands


def test_a_start_the_caller_knows_makes_the_first_press_a_hit():
    piece, hands = _two_hands()
    part = sorted((t - 10_000 + 300, n) for t, n in piece if t >= 10_000)
    told = mc.Follower(piece, hands=hands, start_ms=10_000)
    assert [told.push(t, n).event.kind for t, n in part] == ["hit"] * len(part)
    # not told, nothing is ever called wrong and every press ends as a hit
    result = mc.follow(piece, part, hands=hands)
    assert {e.kind for e in result.events} == {"hit"}
    assert piece[result.events[0].expected_index][0] == 10_000


def test_the_hand_named_for_practice_is_the_only_one_matched():
    piece, hands = _two_hands()
    right = [(t + 300, n) for (t, n), h in zip(piece, hands) if h == "right"]
    slip = next(n for (t, n), h in zip(piece, hands) if h == "left" and t == right[9][0] - 300)
    right[9] = (right[9][0], slip)
    told = mc.follow(piece, right, hands=hands, practise="right")
    # the key is the other hand's note at that place: it is not credited and not called wrong
    assert (told.events[9].kind, told.events[9].expected_index) == ("unsure", None)
    assert (told.score.hands, told.score.played_expected, told.score.wrong, told.score.unsure) == ("right", 24, 0, 1)
    assert mc.follow(piece, right, hands=hands).events[9].kind in ("hit", "late")
    # both hands played with one named: the other hand's presses are all left unsure
    both = mc.follow(piece, [(t + 300, n) for t, n in sorted(piece)], hands=hands, practise="right")
    assert (both.score.hits, both.score.wrong, both.score.unsure) == (24, 0, 48)
    with pytest.raises(mc.ScoringError, match="hand label"):
        mc.follow(piece, right, practise="right")
    with pytest.raises(mc.ScoringError, match="practise"):
        mc.follow(piece, right, hands=hands, practise="both hands")


def test_a_stated_jump_is_followed_live_and_in_a_batch():
    piece = [(i * 400, 50 + ((i * 7 + (i // 5) * 3) % 29)) for i in range(24)]
    played = piece[:12] + [(piece[11][0] + 1000 + 400 * k, n) for k, (_, n) in enumerate(piece[4:16])]
    session = mc.Follower(piece)
    kinds = []
    for i, (t, n) in enumerate(played):
        if i == 12:
            session.jump_to(1600)
        kinds.append(session.push(t, n).event.kind)
    assert kinds == ["hit"] * 12 + ["repeat"] * 8 + ["hit"] * 4
    batch = mc.follow(piece, played, jumps=[(12, 1600)])
    assert [e.kind for e in batch.events] == kinds
    assert batch.score == session.finish()
    assert batch.events[12].jumped_from is not None
    with pytest.raises(mc.ScoringError, match="jump"):
        mc.follow(piece, played, jumps=[(99, 0)])
    with pytest.raises(TypeError):
        mc.follow(piece, played, jumps=[(1, 2, 3)])


def test_a_press_that_cannot_be_placed_is_unsure_and_counts_neither_way():
    piece = [(i * 500, 50 + ((i * 7 + (i // 5) * 3) % 29)) for i in range(16)]
    played = list(piece)
    played[6] = (played[6][0], piece[8][1])
    del played[8]
    result = mc.follow(piece, played)
    assert result.events[6].kind == "unsure"
    assert result.events[6].expected_index is None
    assert (result.score.unsure, result.score.wrong) == (1, 0)
    assert result.score.accuracy == pytest.approx(result.score.hits / 16)
    assert pickle.loads(pickle.dumps(result)) == result
