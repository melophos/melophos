//! Python bindings for the MELOPHOS scoring engine. See `core/README.md` for the interface.

// pyo3 hands arguments over by value and Python keyword arguments make long signatures
#![allow(clippy::needless_pass_by_value, clippy::too_many_arguments)]

use melophos_core::{
    follow_session as engine_follow, score as engine_score, Event, EventKind, FollowConfig,
    FollowError, FollowScore as EngineFollowScore, Follower as Engine, Hand, Note, PlayedHands,
    Practise, ScoreConfig, Session, MAX_EXPECTED, MAX_PLAYED,
};
use pyo3::create_exception;
use pyo3::exceptions::{PyOverflowError, PyTypeError, PyValueError};
use pyo3::prelude::*;
use pyo3::types::{PyBool, PyBytes, PyString, PyTuple};
use pyo3::IntoPyObjectExt;

create_exception!(
    melophos_core,
    ScoringError,
    PyValueError,
    "The engine refused its input. The message says what to change."
);

fn refuse(message: impl Into<String>) -> PyErr {
    ScoringError::new_err(message.into())
}

fn engine_error(error: FollowError) -> PyErr {
    refuse(error.to_string())
}

fn whole(value: i64, name: &str, high: i64) -> PyResult<u32> {
    if (0..=high).contains(&value) {
        Ok(u32::try_from(value).unwrap_or(u32::MAX))
    } else {
        Err(refuse(format!(
            "{name} must be a whole number from 0 to {high}, got {value}"
        )))
    }
}

/// An int argument. A bool is refused although Python counts it as an int. An
/// int too large for 64 bits is out of range, not an overflow.
fn int_of(value: &Bound<'_, PyAny>, name: &str, high: i64) -> PyResult<u32> {
    if value.is_instance_of::<PyBool>() {
        return Err(PyTypeError::new_err(format!(
            "{name} must be an int, not a bool"
        )));
    }
    match value.extract::<i64>() {
        Ok(v) => whole(v, name, high),
        Err(e) if e.is_instance_of::<PyOverflowError>(value.py()) => Err(refuse(format!(
            "{name} must be a whole number from 0 to {high}, got {value}"
        ))),
        Err(_) => Err(PyTypeError::new_err(format!(
            "{name} must be an int, not {}",
            value.get_type().name()?
        ))),
    }
}

/// A list of notes: any sequence (or other iterable) of `(time_ms, note)` pairs,
/// each pair a tuple, a list or another two-item sequence.
fn notes(list: &Bound<'_, PyAny>, name: &str, limit: usize) -> PyResult<Vec<Note>> {
    if list.is_instance_of::<PyString>() || list.is_instance_of::<PyBytes>() {
        return Err(PyTypeError::new_err(format!(
            "{name} must be a sequence of (time_ms, note) pairs, not {}",
            list.get_type().name()?
        )));
    }
    if let Ok(len) = list.len() {
        if len > limit {
            return Err(refuse(format!(
                "{name} has {len} notes, the limit is {limit}"
            )));
        }
    }
    let items = list.try_iter().map_err(|_| {
        PyTypeError::new_err(format!(
            "{name} must be a sequence of (time_ms, note) pairs"
        ))
    })?;
    let mut out = Vec::new();
    for (i, item) in items.enumerate() {
        if i >= limit {
            return Err(refuse(format!(
                "{name} has more than {limit} notes, the limit"
            )));
        }
        let item = item?;
        let at = format!("{name}[{i}]");
        let pair: Vec<Bound<'_, PyAny>> = if let Ok(t) = item.cast::<PyTuple>() {
            t.iter().collect()
        } else if item.is_instance_of::<PyString>() || item.is_instance_of::<PyBytes>() {
            return Err(PyTypeError::new_err(format!(
                "{at} must be a (time_ms, note) pair, not {}",
                item.get_type().name()?
            )));
        } else {
            match item.try_iter() {
                Ok(it) => it.collect::<PyResult<_>>()?,
                Err(_) => {
                    return Err(PyTypeError::new_err(format!(
                        "{at} must be a (time_ms, note) pair, not {}",
                        item.get_type().name()?
                    )))
                }
            }
        };
        if pair.len() != 2 {
            return Err(PyTypeError::new_err(format!(
                "{at} must be a (time_ms, note) pair, got {} items",
                pair.len()
            )));
        }
        out.push(Note {
            t_ms: int_of(&pair[0], &format!("{at} time"), i64::from(u32::MAX))?,
            note: u8::try_from(int_of(&pair[1], &format!("{at} note"), 127)?).unwrap_or(u8::MAX),
        });
    }
    Ok(out)
}

/// Hand labels: `None` for none. Otherwise one of "left", "right" or `None` per expected note.
fn hands(labels: Option<&Bound<'_, PyAny>>, count: usize) -> PyResult<Vec<Hand>> {
    let Some(labels) = labels.filter(|l| !l.is_none()) else {
        return Ok(Vec::new());
    };
    if labels.is_instance_of::<PyString>() {
        return Err(PyTypeError::new_err(
            "hands must be a sequence of \"left\", \"right\" or None, not str",
        ));
    }
    let mut out = Vec::with_capacity(count);
    for (i, item) in labels.try_iter()?.enumerate() {
        let item = item?;
        out.push(if item.is_none() {
            Hand::Unknown
        } else {
            match item.extract::<String>().as_deref() {
                Ok("left") => Hand::Left,
                Ok("right") => Hand::Right,
                _ => {
                    return Err(refuse(format!(
                        "hands[{i}] must be \"left\", \"right\" or None, got {item}"
                    )))
                }
            }
        });
        if out.len() > count {
            break;
        }
    }
    if out.len() != count {
        return Err(refuse(format!(
            "{} hand labels for {count} notes: give one per note or none",
            out.len()
        )));
    }
    Ok(out)
}

struct Settings {
    config: FollowConfig,
}

/// What the caller knows about the session: where the learner starts and the
/// hand or hands being practised. `None` for either means the caller does not know.
fn session(
    start_ms: Option<&Bound<'_, PyAny>>,
    practise: Option<&Bound<'_, PyAny>>,
) -> PyResult<Session> {
    let start_ms = match start_ms.filter(|s| !s.is_none()) {
        Some(s) => Some(int_of(s, "start_ms", i64::from(u32::MAX))?),
        None => None,
    };
    let practise = match practise.filter(|p| !p.is_none()) {
        None => Practise::Both,
        Some(p) => match p.extract::<String>().as_deref() {
            Ok("both") => Practise::Both,
            Ok("left") => Practise::Left,
            Ok("right") => Practise::Right,
            _ => {
                return Err(refuse(format!(
                    "practise must be \"left\", \"right\", \"both\" or None, got {p}"
                )))
            }
        },
    };
    Ok(Session { start_ms, practise })
}

/// Stated jumps: a sequence of `(press_index, to_ms)` pairs or `None`.
fn jumps_of(jumps: Option<&Bound<'_, PyAny>>) -> PyResult<Vec<(u32, u32)>> {
    let Some(jumps) = jumps.filter(|j| !j.is_none()) else {
        return Ok(Vec::new());
    };
    if jumps.is_instance_of::<PyString>() {
        return Err(PyTypeError::new_err(
            "jumps must be a sequence of (press_index, to_ms) pairs, not str",
        ));
    }
    let mut out = Vec::new();
    for (i, item) in jumps.try_iter()?.enumerate() {
        let item = item?;
        let pair: Vec<Bound<'_, PyAny>> = match item.try_iter() {
            Ok(it) if !item.is_instance_of::<PyString>() => it.collect::<PyResult<_>>()?,
            _ => {
                return Err(PyTypeError::new_err(format!(
                    "jumps[{i}] must be a (press_index, to_ms) pair"
                )))
            }
        };
        if pair.len() != 2 {
            return Err(PyTypeError::new_err(format!(
                "jumps[{i}] must be a (press_index, to_ms) pair, got {} items",
                pair.len()
            )));
        }
        let max = i64::from(u32::MAX);
        out.push((
            int_of(&pair[0], &format!("jumps[{i}] press index"), max)?,
            int_of(&pair[1], &format!("jumps[{i}] time"), max)?,
        ));
    }
    Ok(out)
}

fn config(
    window_ms: &Bound<'_, PyAny>,
    band: &Bound<'_, PyAny>,
    pause_ms: &Bound<'_, PyAny>,
    chord_ms: &Bound<'_, PyAny>,
    relocate_after: &Bound<'_, PyAny>,
) -> PyResult<Settings> {
    let max = i64::from(u32::MAX);
    Ok(Settings {
        config: FollowConfig {
            window_ms: int_of(window_ms, "window_ms", max)?,
            band: u16::try_from(int_of(band, "band", 256)?).unwrap_or(u16::MAX),
            pause_ms: int_of(pause_ms, "pause_ms", max)?,
            chord_ms: int_of(chord_ms, "chord_ms", 1000)?,
            relocate_after: u8::try_from(int_of(relocate_after, "relocate_after", 8)?)
                .unwrap_or(u8::MAX),
        },
    })
}

fn hands_name(h: PlayedHands) -> &'static str {
    match h {
        PlayedHands::Unknown => "unknown",
        PlayedHands::Neither => "neither",
        PlayedHands::Left => "left",
        PlayedHands::Right => "right",
        PlayedHands::Both => "both",
    }
}

fn kind_name(kind: EventKind) -> &'static str {
    match kind {
        EventKind::Hit => "hit",
        EventKind::Wrong => "wrong",
        EventKind::Late => "late",
        EventKind::Repeat => "repeat",
        EventKind::Unsure => "unsure",
    }
}

/// Builds the argument tuple `__reduce__` hands to pickle.
fn args<'py>(py: Python<'py>, items: Vec<Bound<'py, PyAny>>) -> PyResult<Bound<'py, PyTuple>> {
    PyTuple::new(py, items)
}

macro_rules! any {
    ($py:expr, $($v:expr),* $(,)?) => {
        vec![$($v.into_bound_py_any($py)?),*]
    };
}

/// The first pass: a passage compared with the clock as written.
#[pyclass(frozen, eq, get_all, module = "melophos_core")]
#[derive(Debug, Clone, PartialEq)]
pub struct Score {
    expected: usize,
    hits: usize,
    misses: usize,
    wrong: usize,
    accuracy: f32,
    accuracy_bits: u32,
    mean_timing_error_ms: Option<f32>,
    mean_timing_error_bits: Option<u32>,
}

#[pymethods]
impl Score {
    #[new]
    fn new(
        expected: usize,
        hits: usize,
        misses: usize,
        wrong: usize,
        accuracy_bits: u32,
        mean_timing_error_bits: Option<u32>,
    ) -> Self {
        Self {
            expected,
            hits,
            misses,
            wrong,
            accuracy: f32::from_bits(accuracy_bits),
            accuracy_bits,
            mean_timing_error_ms: mean_timing_error_bits.map(f32::from_bits),
            mean_timing_error_bits,
        }
    }

    fn __reduce__<'py>(
        slf: &Bound<'py, Self>,
    ) -> PyResult<(Bound<'py, PyAny>, Bound<'py, PyTuple>)> {
        let py = slf.py();
        let s = slf.get();
        let items = any!(
            py,
            s.expected,
            s.hits,
            s.misses,
            s.wrong,
            s.accuracy_bits,
            s.mean_timing_error_bits
        );
        Ok((slf.get_type().into_any(), args(py, items)?))
    }

    fn __repr__(&self) -> String {
        format!(
            "Score(hits={}, misses={}, wrong={}, accuracy={:?})",
            self.hits, self.misses, self.wrong, self.accuracy
        )
    }
}

/// One decision of the follower.
#[pyclass(frozen, eq, get_all, module = "melophos_core")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FollowEvent {
    played_index: u32,
    kind: &'static str,
    expected_index: Option<u32>,
    position: u32,
    error_ms: i32,
    speed_ppm: u32,
    jumped_from: Option<u32>,
}

#[pymethods]
impl FollowEvent {
    #[new]
    fn new(
        played_index: u32,
        kind: &str,
        expected_index: Option<u32>,
        position: u32,
        error_ms: i32,
        speed_ppm: u32,
        jumped_from: Option<u32>,
    ) -> PyResult<Self> {
        let kind = ["hit", "wrong", "late", "repeat", "unsure"]
            .into_iter()
            .find(|k| *k == kind)
            .ok_or_else(|| {
                refuse(format!(
                    "kind must be hit, wrong, late, repeat or unsure, got {kind}"
                ))
            })?;
        Ok(Self {
            played_index,
            kind,
            expected_index,
            position,
            error_ms,
            speed_ppm,
            jumped_from,
        })
    }

    fn __reduce__<'py>(
        slf: &Bound<'py, Self>,
    ) -> PyResult<(Bound<'py, PyAny>, Bound<'py, PyTuple>)> {
        let py = slf.py();
        let e = slf.get();
        let items = any!(
            py,
            e.played_index,
            e.kind,
            e.expected_index,
            e.position,
            e.error_ms,
            e.speed_ppm,
            e.jumped_from
        );
        Ok((slf.get_type().into_any(), args(py, items)?))
    }

    fn __repr__(&self) -> String {
        format!(
            "FollowEvent(played_index={}, kind={:?}, expected_index={}, error_ms={})",
            self.played_index,
            self.kind,
            self.expected_index
                .map_or_else(|| "None".to_string(), |i| i.to_string()),
            self.error_ms
        )
    }
}

impl From<&Event> for FollowEvent {
    fn from(e: &Event) -> Self {
        Self {
            played_index: e.played_index,
            kind: kind_name(e.kind),
            expected_index: e.expected_index,
            position: e.position,
            error_ms: e.error_ms,
            speed_ppm: e.speed_ppm,
            jumped_from: e.jumped_from,
        }
    }
}

/// The summary of a performance. Every figure is defined in docs/scoring.md.
#[pyclass(frozen, eq, get_all, module = "melophos_core")]
#[derive(Debug, Clone, PartialEq)]
pub struct FollowScore {
    expected: usize,
    hits: usize,
    late: usize,
    misses: usize,
    wrong: usize,
    repeats: usize,
    unsure: usize,
    accuracy: f32,
    accuracy_bits: u32,
    mean_timing_error_ms: Option<f32>,
    mean_timing_error_bits: Option<u32>,
    final_speed_ppm: u32,
    mean_speed_ppm: Option<u32>,
    hands: &'static str,
    played_expected: usize,
    played_accuracy: f32,
    played_accuracy_bits: u32,
}

#[pymethods]
impl FollowScore {
    #[new]
    #[allow(clippy::too_many_arguments)]
    fn new(
        expected: usize,
        hits: usize,
        late: usize,
        misses: usize,
        wrong: usize,
        repeats: usize,
        unsure: usize,
        accuracy_bits: u32,
        mean_timing_error_bits: Option<u32>,
        final_speed_ppm: u32,
        mean_speed_ppm: Option<u32>,
        hands: &str,
        played_expected: usize,
        played_accuracy_bits: u32,
    ) -> PyResult<Self> {
        let hands = ["unknown", "neither", "left", "right", "both"]
            .into_iter()
            .find(|h| *h == hands)
            .ok_or_else(|| {
                refuse(format!(
                    "hands must be unknown, neither, left, right or both, got {hands}"
                ))
            })?;
        Ok(Self {
            expected,
            hits,
            late,
            misses,
            wrong,
            repeats,
            unsure,
            accuracy: f32::from_bits(accuracy_bits),
            accuracy_bits,
            mean_timing_error_ms: mean_timing_error_bits.map(f32::from_bits),
            mean_timing_error_bits,
            final_speed_ppm,
            mean_speed_ppm,
            hands,
            played_expected,
            played_accuracy: f32::from_bits(played_accuracy_bits),
            played_accuracy_bits,
        })
    }

    fn __reduce__<'py>(
        slf: &Bound<'py, Self>,
    ) -> PyResult<(Bound<'py, PyAny>, Bound<'py, PyTuple>)> {
        let py = slf.py();
        let s = slf.get();
        let items = any!(
            py,
            s.expected,
            s.hits,
            s.late,
            s.misses,
            s.wrong,
            s.repeats,
            s.unsure,
            s.accuracy_bits,
            s.mean_timing_error_bits,
            s.final_speed_ppm,
            s.mean_speed_ppm,
            s.hands,
            s.played_expected,
            s.played_accuracy_bits
        );
        Ok((slf.get_type().into_any(), args(py, items)?))
    }

    fn __repr__(&self) -> String {
        format!(
            "FollowScore(hits={}, late={}, misses={}, wrong={}, repeats={}, unsure={}, accuracy={:?}, final_speed_ppm={}, hands={:?})",
            self.hits, self.late, self.misses, self.wrong, self.repeats, self.unsure, self.accuracy, self.final_speed_ppm, self.hands
        )
    }
}

impl From<&EngineFollowScore> for FollowScore {
    fn from(s: &EngineFollowScore) -> Self {
        Self {
            expected: s.expected,
            hits: s.hits,
            late: s.late,
            misses: s.misses,
            wrong: s.wrong,
            repeats: s.repeats,
            unsure: s.unsure,
            accuracy: s.accuracy,
            accuracy_bits: s.accuracy.to_bits(),
            mean_timing_error_ms: s.mean_timing_error_ms,
            mean_timing_error_bits: s.mean_timing_error_ms.map(f32::to_bits),
            final_speed_ppm: s.final_speed_ppm,
            mean_speed_ppm: s.mean_speed_ppm,
            hands: hands_name(s.hands),
            played_expected: s.played_expected,
            played_accuracy: s.played_accuracy,
            played_accuracy_bits: s.played_accuracy.to_bits(),
        }
    }
}

/// The result of following a whole performance.
#[pyclass(frozen, eq, get_all, module = "melophos_core")]
#[derive(Debug, Clone, PartialEq)]
pub struct FollowResult {
    events: Vec<FollowEvent>,
    score: FollowScore,
}

#[pymethods]
impl FollowResult {
    #[new]
    fn new(events: Vec<PyRef<'_, FollowEvent>>, score: PyRef<'_, FollowScore>) -> Self {
        Self {
            events: events.iter().map(|e| (**e).clone()).collect(),
            score: (*score).clone(),
        }
    }

    fn __reduce__<'py>(
        slf: &Bound<'py, Self>,
    ) -> PyResult<(Bound<'py, PyAny>, Bound<'py, PyTuple>)> {
        let py = slf.py();
        let r = slf.get();
        let items = any!(py, r.events.clone(), r.score.clone());
        Ok((slf.get_type().into_any(), args(py, items)?))
    }

    fn __repr__(&self) -> String {
        format!(
            "FollowResult(events={}, score={})",
            self.events.len(),
            self.score.__repr__()
        )
    }
}

/// The answer to one `Follower.push`.
#[pyclass(frozen, eq, get_all, module = "melophos_core")]
#[derive(Debug, Clone, PartialEq)]
pub struct PushResult {
    event: FollowEvent,
    revised: Vec<FollowEvent>,
    settled: u32,
}

#[pymethods]
impl PushResult {
    #[new]
    fn new(
        event: PyRef<'_, FollowEvent>,
        revised: Vec<PyRef<'_, FollowEvent>>,
        settled: u32,
    ) -> Self {
        Self {
            event: (*event).clone(),
            revised: revised.iter().map(|e| (**e).clone()).collect(),
            settled,
        }
    }

    fn __reduce__<'py>(
        slf: &Bound<'py, Self>,
    ) -> PyResult<(Bound<'py, PyAny>, Bound<'py, PyTuple>)> {
        let py = slf.py();
        let r = slf.get();
        let items = any!(py, r.event.clone(), r.revised.clone(), r.settled);
        Ok((slf.get_type().into_any(), args(py, items)?))
    }

    fn __repr__(&self) -> String {
        format!(
            "PushResult(event={}, revised={})",
            self.event.__repr__(),
            self.revised.len()
        )
    }
}

/// Scores a passage against the clock as written. Both lists hold (time in ms, MIDI note) pairs.
#[pyfunction]
#[pyo3(signature = (expected, played, window_ms = None))]
fn score(
    py: Python<'_>,
    expected: &Bound<'_, PyAny>,
    played: &Bound<'_, PyAny>,
    window_ms: Option<&Bound<'_, PyAny>>,
) -> PyResult<Score> {
    let expected = notes(expected, "expected", MAX_EXPECTED)?;
    let played = notes(played, "played", MAX_PLAYED)?;
    let window_ms = match window_ms {
        Some(w) => int_of(w, "window_ms", i64::from(u32::MAX))?,
        None => 150,
    };
    let s = py
        .detach(|| engine_score(&expected, &played, ScoreConfig { window_ms }))
        .map_err(engine_error)?;
    Ok(Score {
        expected: s.expected,
        hits: s.hits,
        misses: s.misses,
        wrong: s.wrong,
        accuracy: s.accuracy,
        accuracy_bits: s.accuracy.to_bits(),
        mean_timing_error_ms: s.mean_timing_error_ms,
        mean_timing_error_bits: s.mean_timing_error_ms.map(f32::to_bits),
    })
}

/// The keyword arguments `follow` and `Follower` share, as Python objects so a
/// bool can be refused.
struct Keywords<'py> {
    window_ms: Bound<'py, PyAny>,
    band: Bound<'py, PyAny>,
    pause_ms: Bound<'py, PyAny>,
    chord_ms: Bound<'py, PyAny>,
    relocate_after: Bound<'py, PyAny>,
}

fn defaults<'py>(
    py: Python<'py>,
    given: [Option<Bound<'py, PyAny>>; 5],
) -> PyResult<Keywords<'py>> {
    let standard = FollowConfig::default();
    let pick = |value: Option<Bound<'py, PyAny>>, default: u32| -> PyResult<Bound<'py, PyAny>> {
        match value {
            Some(value) => Ok(value),
            None => default.into_bound_py_any(py),
        }
    };
    let [window, band, pause, chord, relocate] = given;
    Ok(Keywords {
        window_ms: pick(window, standard.window_ms)?,
        band: pick(band, u32::from(standard.band))?,
        pause_ms: pick(pause, standard.pause_ms)?,
        chord_ms: pick(chord, standard.chord_ms)?,
        relocate_after: pick(relocate, u32::from(standard.relocate_after))?,
    })
}

fn settings_of(k: &Keywords<'_>) -> PyResult<FollowConfig> {
    Ok(config(
        &k.window_ms,
        &k.band,
        &k.pause_ms,
        &k.chord_ms,
        &k.relocate_after,
    )?
    .config)
}

/// Follows a whole recorded performance and returns the alignment of every press and a summary.
#[pyfunction]
#[pyo3(signature = (expected, played, *, hands = None, start_ms = None, practise = None, jumps = None, window_ms = None, band = None, pause_ms = None, chord_ms = None, relocate_after = None))]
#[allow(clippy::too_many_arguments)]
fn follow<'py>(
    py: Python<'py>,
    expected: &Bound<'py, PyAny>,
    played: &Bound<'py, PyAny>,
    hands: Option<&Bound<'py, PyAny>>,
    start_ms: Option<&Bound<'py, PyAny>>,
    practise: Option<&Bound<'py, PyAny>>,
    jumps: Option<&Bound<'py, PyAny>>,
    window_ms: Option<Bound<'py, PyAny>>,
    band: Option<Bound<'py, PyAny>>,
    pause_ms: Option<Bound<'py, PyAny>>,
    chord_ms: Option<Bound<'py, PyAny>>,
    relocate_after: Option<Bound<'py, PyAny>>,
) -> PyResult<FollowResult> {
    let expected = notes(expected, "expected", MAX_EXPECTED)?;
    let played = notes(played, "played", MAX_PLAYED)?;
    let labels = self::hands(hands, expected.len())?;
    let config = settings_of(&defaults(
        py,
        [window_ms, band, pause_ms, chord_ms, relocate_after],
    )?)?;
    let session = session(start_ms, practise)?;
    let jumps = jumps_of(jumps)?;
    let (events, summary) = py
        .detach(|| engine_follow(&expected, &labels, &played, session, &jumps, config))
        .map_err(engine_error)?;
    Ok(FollowResult {
        events: events.iter().map(FollowEvent::from).collect(),
        score: FollowScore::from(&summary),
    })
}

/// Follows a live performance one press at a time.
#[pyclass(module = "melophos_core")]
pub struct Follower {
    inner: Engine,
}

#[pymethods]
impl Follower {
    #[new]
    #[pyo3(signature = (expected, *, hands = None, start_ms = None, practise = None, window_ms = None, band = None, pause_ms = None, chord_ms = None, relocate_after = None))]
    #[allow(clippy::too_many_arguments)]
    fn new<'py>(
        py: Python<'py>,
        expected: &Bound<'py, PyAny>,
        hands: Option<&Bound<'py, PyAny>>,
        start_ms: Option<&Bound<'py, PyAny>>,
        practise: Option<&Bound<'py, PyAny>>,
        window_ms: Option<Bound<'py, PyAny>>,
        band: Option<Bound<'py, PyAny>>,
        pause_ms: Option<Bound<'py, PyAny>>,
        chord_ms: Option<Bound<'py, PyAny>>,
        relocate_after: Option<Bound<'py, PyAny>>,
    ) -> PyResult<Self> {
        let expected = notes(expected, "expected", MAX_EXPECTED)?;
        let labels = self::hands(hands, expected.len())?;
        let config = settings_of(&defaults(
            py,
            [window_ms, band, pause_ms, chord_ms, relocate_after],
        )?)?;
        let session = session(start_ms, practise)?;
        Ok(Self {
            inner: Engine::with_session(&expected, &labels, session, config)
                .map_err(engine_error)?,
        })
    }

    /// Takes the next press. Presses must arrive in time order.
    fn push(&mut self, t_ms: &Bound<'_, PyAny>, note: &Bound<'_, PyAny>) -> PyResult<PushResult> {
        let press = Note {
            t_ms: int_of(t_ms, "t_ms", i64::from(u32::MAX))?,
            note: u8::try_from(int_of(note, "note", 127)?).unwrap_or(u8::MAX),
        };
        let update = self.inner.push(press).map_err(engine_error)?;
        Ok(PushResult {
            event: FollowEvent::from(&update.event),
            revised: update.revised.iter().map(FollowEvent::from).collect(),
            settled: update.settled,
        })
    }

    /// Tells the follower the learner goes on from the written time `to_ms`
    /// (Repeat, Next phrase or another bar). The next press is read from there.
    fn jump_to(&mut self, to_ms: &Bound<'_, PyAny>) -> PyResult<()> {
        self.inner
            .jump_to(int_of(to_ms, "to_ms", i64::from(u32::MAX))?);
        Ok(())
    }

    /// The summary of everything pushed so far.
    fn finish(&self) -> FollowScore {
        FollowScore::from(&self.inner.finish())
    }

    /// The tempo reached: 1 000 000 is the written speed.
    #[getter]
    fn speed_ppm(&self) -> u32 {
        self.inner.speed_ppm()
    }

    /// The chord group the player has reached.
    #[getter]
    fn position(&self) -> usize {
        self.inner.position()
    }
}

#[pymodule]
fn _native(py: Python<'_>, m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("ScoringError", py.get_type::<ScoringError>())?;
    m.add("MAX_EXPECTED", MAX_EXPECTED)?;
    m.add("MAX_PLAYED", MAX_PLAYED)?;
    m.add_class::<Score>()?;
    m.add_class::<FollowEvent>()?;
    m.add_class::<FollowScore>()?;
    m.add_class::<FollowResult>()?;
    m.add_class::<PushResult>()?;
    m.add_class::<Follower>()?;
    m.add_function(wrap_pyfunction!(score, m)?)?;
    m.add_function(wrap_pyfunction!(follow, m)?)?;
    Ok(())
}
