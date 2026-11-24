"""The MELOPHOS scoring engine, built from the same Rust crate as the Studio's WebAssembly build."""

from melophos_core._native import (
    MAX_EXPECTED,
    MAX_PLAYED,
    FollowEvent,
    Follower,
    FollowResult,
    FollowScore,
    PushResult,
    Score,
    ScoringError,
    follow,
    score,
)

__all__ = [
    "MAX_EXPECTED",
    "MAX_PLAYED",
    "FollowEvent",
    "FollowResult",
    "FollowScore",
    "Follower",
    "PushResult",
    "Score",
    "ScoringError",
    "follow",
    "score",
]
