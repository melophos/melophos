//! MELOPHOS core: the scoring engine shared by the Studio and the server.
//!
//! The same code compiles to WebAssembly for live scoring in the browser and to
//! a Python module for the server, so both always agree on a score.

pub mod follow;
pub mod score;

pub use follow::{
    follow, follow_session, follow_with_hands, Event, EventKind, FollowConfig, FollowError,
    FollowScore, Follower, Hand, PlayedHands, Practise, Session, Update, MAX_EXPECTED, MAX_PLAYED,
    MAX_REREAD,
};
pub use score::{score, Note, Score, ScoreConfig};

// runs the Rust examples in the README as tests so they cannot drift from the code
#[cfg(doctest)]
#[doc = include_str!("../README.md")]
struct ReadmeExamples;
