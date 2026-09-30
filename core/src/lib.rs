//! MELOPHOS core: the scoring engine shared by the Studio and the server.
//!
//! The same code compiles to WebAssembly for live scoring in the browser and to
//! a Python module for the server, so both always agree on a score.

pub mod score;

pub use score::{score, Note, Score, ScoreConfig};
