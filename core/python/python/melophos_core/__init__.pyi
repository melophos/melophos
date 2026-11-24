from collections.abc import Iterable, Sequence
from typing import Literal

Note = tuple[int, int] | list[int]
"""A pair of (time in milliseconds, MIDI note number). Time is 0 to 4 294 967 295 and the note 0 to 127."""

Hand = Literal["left", "right"]
EventKind = Literal["hit", "wrong", "late", "repeat", "unsure"]
"""`unsure` is a press the engine cannot place with confidence. It counts neither for nor against the player."""
Practise = Literal["left", "right", "both"]
Jump = tuple[int, int] | list[int]
"""A pair of (index of the press the jump comes before, written time in milliseconds the learner goes on from)."""
PlayedHands = Literal["unknown", "neither", "left", "right", "both"]

MAX_EXPECTED: int
"""The most notes in a piece: 100 000."""
MAX_PLAYED: int
"""The most presses in one session or one call: 216 000, six hours at ten a second."""

class ScoringError(ValueError):
    """The engine refused its input. The message says what to change."""

class Score:
    expected: int
    hits: int
    misses: int
    wrong: int
    accuracy: float
    accuracy_bits: int
    mean_timing_error_ms: float | None
    mean_timing_error_bits: int | None

class FollowEvent:
    played_index: int
    kind: EventKind
    expected_index: int | None
    position: int
    error_ms: int
    speed_ppm: int
    jumped_from: int | None

class FollowScore:
    expected: int
    hits: int
    late: int
    misses: int
    wrong: int
    repeats: int
    unsure: int
    accuracy: float
    accuracy_bits: int
    mean_timing_error_ms: float | None
    mean_timing_error_bits: int | None
    final_speed_ppm: int
    mean_speed_ppm: int | None
    hands: PlayedHands
    played_expected: int
    played_accuracy: float
    played_accuracy_bits: int

class FollowResult:
    events: list[FollowEvent]
    score: FollowScore

class PushResult:
    """Keep one event per press: put `event` at its index and replace each of `revised`.
    The place steps back only with a revision or a jump. Presses before `settled` are final."""

    event: FollowEvent
    revised: list[FollowEvent]
    settled: int

class Follower:
    def __init__(
        self,
        expected: Iterable[Note],
        *,
        hands: Sequence[Hand | None] | None = None,
        start_ms: int | None = None,
        practise: Practise | None = None,
        window_ms: int = 150,
        band: int = 16,
        pause_ms: int = 2500,
        chord_ms: int = 50,
        relocate_after: int = 3,
    ) -> None: ...
    def push(self, t_ms: int, note: int) -> PushResult: ...
    def jump_to(self, to_ms: int) -> None:
        """The learner goes on from this written time (Repeat, Next phrase, another bar)."""

    def finish(self) -> FollowScore: ...
    @property
    def speed_ppm(self) -> int: ...
    @property
    def position(self) -> int: ...

def score(expected: Iterable[Note], played: Iterable[Note], window_ms: int = 150) -> Score: ...
def follow(
    expected: Iterable[Note],
    played: Iterable[Note],
    *,
    hands: Sequence[Hand | None] | None = None,
    start_ms: int | None = None,
    practise: Practise | None = None,
    jumps: Iterable[Jump] | None = None,
    window_ms: int = 150,
    band: int = 16,
    pause_ms: int = 2500,
    chord_ms: int = 50,
    relocate_after: int = 3,
) -> FollowResult: ...
