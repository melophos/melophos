//! WebAssembly bindings for the MELOPHOS scoring engine.
//!
//! Everything crosses the boundary as flat typed arrays so no value is converted
//! on the way. The TypeScript wrapper in `package/` turns them into objects.
//!
//! An event is 7 numbers: press index, kind (0 hit, 1 wrong, 2 late, 3 repeat,
//! 4 unsure), expected index or -1, place, error in ms, speed in ppm and the
//! place left by a jump or -1. A summary is 16 numbers, see [`summary`]. Hand
//! labels are one byte a note: 0 for none, 1 for the left hand and 2 for the
//! right. What the caller knows about a session is empty or three numbers: 1
//! when the start is known, the written time of the start and the hands
//! practised (0 both, 1 left, 2 right).

use melophos_core::{
    follow_session, score, Event, FollowConfig, FollowError, FollowScore, Follower as Engine, Hand,
    Note, Practise, ScoreConfig, Session, MAX_EXPECTED, MAX_PLAYED,
};
use wasm_bindgen::prelude::*;

fn notes(times: &[u32], pitches: &[u8], limit: usize) -> Result<Vec<Note>, JsError> {
    if times.len() != pitches.len() {
        return Err(JsError::new("times and notes must have the same length"));
    }
    if times.len() > limit {
        return Err(JsError::new(&format!(
            "{} notes given, the limit is {limit}",
            times.len()
        )));
    }
    Ok(times
        .iter()
        .zip(pitches)
        .map(|(&t_ms, &note)| Note { t_ms, note })
        .collect())
}

fn hands(labels: &[u8], count: usize) -> Result<Vec<Hand>, JsError> {
    if !labels.is_empty() && labels.len() != count {
        return Err(JsError::new(
            "give one hand label for each expected note or none",
        ));
    }
    labels
        .iter()
        .map(|&h| match h {
            0 => Ok(Hand::Unknown),
            1 => Ok(Hand::Left),
            2 => Ok(Hand::Right),
            _ => Err(JsError::new("a hand label must be 0, 1 or 2")),
        })
        .collect()
}

fn config(values: &[u32]) -> Result<FollowConfig, JsError> {
    match values {
        [] => Ok(FollowConfig::default()),
        &[window_ms, band, pause_ms, chord_ms, relocate_after] => Ok(FollowConfig {
            window_ms,
            band: u16::try_from(band).map_err(|_| JsError::new("band is too large"))?,
            pause_ms,
            chord_ms,
            relocate_after: u8::try_from(relocate_after)
                .map_err(|_| JsError::new("relocate_after is too large"))?,
        }),
        _ => Err(JsError::new(
            "config must be empty or hold window_ms, band, pause_ms, chord_ms and relocate_after",
        )),
    }
}

fn session(values: &[u32]) -> Result<Session, JsError> {
    match values {
        [] => Ok(Session::default()),
        &[known, start_ms, practise] => Ok(Session {
            start_ms: (known != 0).then_some(start_ms),
            practise: match practise {
                0 => Practise::Both,
                1 => Practise::Left,
                2 => Practise::Right,
                _ => return Err(JsError::new("practise must be 0, 1 or 2")),
            },
        }),
        _ => Err(JsError::new(
            "session must be empty or hold whether the start is known, the start and the hands practised",
        )),
    }
}

fn fail(error: FollowError) -> JsError {
    JsError::new(&error.to_string())
}

fn flat(event: &Event, out: &mut Vec<i32>) {
    let signed = |n: u32| i32::try_from(n).unwrap_or(i32::MAX);
    out.extend([
        signed(event.played_index),
        i32::from(event.kind.code()),
        event.expected_index.map_or(-1, signed),
        signed(event.position),
        event.error_ms,
        signed(event.speed_ppm),
        event.jumped_from.map_or(-1, signed),
    ]);
}

/// Sixteen numbers: expected, hits, late, misses, wrong, repeats, the bits of the
/// accuracy, 1 when a mean timing error exists, its bits, the final speed, 1 when
/// a mean speed exists, the mean speed, the hands played (0 unknown, 1 neither,
/// 2 left, 3 right, 4 both), the expected notes in those hands, the bits of
/// the accuracy over them and the presses left unsure.
fn summary(s: &FollowScore) -> Vec<u32> {
    let size = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    vec![
        size(s.expected),
        size(s.hits),
        size(s.late),
        size(s.misses),
        size(s.wrong),
        size(s.repeats),
        s.accuracy.to_bits(),
        u32::from(s.mean_timing_error_ms.is_some()),
        s.mean_timing_error_ms.map_or(0, f32::to_bits),
        s.final_speed_ppm,
        u32::from(s.mean_speed_ppm.is_some()),
        s.mean_speed_ppm.unwrap_or(0),
        u32::from(s.hands.code()),
        size(s.played_expected),
        s.played_accuracy.to_bits(),
        size(s.unsure),
    ]
}

/// Scores a whole passage against the clock as written. Returns six numbers:
/// expected, hits, misses, wrong, the bits of the accuracy and 1 plus the bits of
/// the mean timing error (two zeros when there was no hit).
///
/// # Errors
/// Fails when the time and note arrays differ in length or a list is over its limit.
#[wasm_bindgen]
pub fn score_passage(
    expected_t: &[u32],
    expected_note: &[u8],
    played_t: &[u32],
    played_note: &[u8],
    window_ms: u32,
) -> Result<Vec<u32>, JsError> {
    let result = score(
        &notes(expected_t, expected_note, MAX_EXPECTED)?,
        &notes(played_t, played_note, MAX_PLAYED)?,
        ScoreConfig { window_ms },
    )
    .map_err(fail)?;
    let size = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    Ok(vec![
        size(result.expected),
        size(result.hits),
        size(result.misses),
        size(result.wrong),
        result.accuracy.to_bits(),
        u32::from(result.mean_timing_error_ms.is_some()),
        result.mean_timing_error_ms.map_or(0, f32::to_bits),
    ])
}

/// The result of following a whole performance.
#[wasm_bindgen]
pub struct FollowResult {
    events: Vec<i32>,
    summary: Vec<u32>,
}

#[wasm_bindgen]
impl FollowResult {
    /// One event per press, 7 numbers each.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn events(&self) -> Vec<i32> {
        self.events.clone()
    }

    /// The 15 summary numbers.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn summary(&self) -> Vec<u32> {
        self.summary.clone()
    }
}

/// Follows a whole recorded performance.
///
/// # Errors
/// Fails on mismatched array lengths, a list over its limit, a bad configuration,
/// a jump that names no press or presses out of order.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn follow_performance(
    expected_t: &[u32],
    expected_note: &[u8],
    expected_hand: &[u8],
    played_t: &[u32],
    played_note: &[u8],
    settings: &[u32],
    known: &[u32],
    jumps: &[u32],
) -> Result<FollowResult, JsError> {
    let expected = notes(expected_t, expected_note, MAX_EXPECTED)?;
    if jumps.len() % 2 != 0 {
        return Err(JsError::new(
            "jumps must hold a press index and a time for each jump",
        ));
    }
    let jumps: Vec<(u32, u32)> = jumps.chunks_exact(2).map(|j| (j[0], j[1])).collect();
    let (events, score) = follow_session(
        &expected,
        &hands(expected_hand, expected.len())?,
        &notes(played_t, played_note, MAX_PLAYED)?,
        session(known)?,
        &jumps,
        config(settings)?,
    )
    .map_err(fail)?;
    let mut flat_events = Vec::with_capacity(events.len() * 7);
    for event in &events {
        flat(event, &mut flat_events);
    }
    Ok(FollowResult {
        events: flat_events,
        summary: summary(&score),
    })
}

/// Follows a live performance one press at a time.
#[wasm_bindgen]
pub struct Follower {
    inner: Engine,
}

#[wasm_bindgen]
impl Follower {
    /// Starts following `expected`. `expected_hand` is empty or holds one hand
    /// label for each note. `settings` is empty for the defaults or holds
    /// `window_ms`, `band`, `pause_ms`, `chord_ms` and `relocate_after`. `known`
    /// is empty or says where the learner starts and which hands they practise.
    ///
    /// # Errors
    /// Fails on mismatched array lengths, a piece that is too long or a bad configuration.
    #[wasm_bindgen(constructor)]
    pub fn new(
        expected_t: &[u32],
        expected_note: &[u8],
        expected_hand: &[u8],
        settings: &[u32],
        known: &[u32],
    ) -> Result<Follower, JsError> {
        let expected = notes(expected_t, expected_note, MAX_EXPECTED)?;
        let labels = hands(expected_hand, expected.len())?;
        Ok(Follower {
            inner: Engine::with_session(&expected, &labels, session(known)?, config(settings)?)
                .map_err(fail)?,
        })
    }

    /// Tells the follower the learner goes on from the written time `to_ms`.
    #[wasm_bindgen(js_name = jumpTo)]
    pub fn jump_to(&mut self, to_ms: u32) {
        self.inner.jump_to(to_ms);
    }

    /// Takes the next press. Returns the events it settles, oldest first: any it
    /// changed its mind about, then the one for this press, then one number: the
    /// presses whose events are final (every press with a smaller index).
    ///
    /// # Errors
    /// Fails when the press is earlier than the one before it.
    pub fn push(&mut self, t_ms: u32, note: u8) -> Result<Vec<i32>, JsError> {
        let update = self.inner.push(Note { t_ms, note }).map_err(fail)?;
        let mut out = Vec::with_capacity((update.revised.len() + 1) * 7);
        for event in &update.revised {
            flat(event, &mut out);
        }
        flat(&update.event, &mut out);
        out.push(i32::try_from(update.settled).unwrap_or(i32::MAX));
        Ok(out)
    }

    /// The summary of everything pushed so far: 16 numbers.
    #[must_use]
    pub fn finish(&self) -> Vec<u32> {
        summary(&self.inner.finish())
    }

    /// The tempo reached: 1 000 000 is the written speed.
    #[wasm_bindgen(getter, js_name = speedPpm)]
    #[must_use]
    pub fn speed_ppm(&self) -> u32 {
        self.inner.speed_ppm()
    }

    /// The chord group the player has reached.
    #[wasm_bindgen(getter)]
    #[must_use]
    pub fn position(&self) -> u32 {
        u32::try_from(self.inner.position()).unwrap_or(u32::MAX)
    }
}

/// The engine's limits: the most notes in a piece and the most presses in a session.
#[wasm_bindgen]
#[must_use]
pub fn limits() -> Vec<u32> {
    let size = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    vec![size(MAX_EXPECTED), size(MAX_PLAYED)]
}
