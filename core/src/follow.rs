//! Follows a live performance through a piece: where the player is, what each
//! press was and how fast they are playing.
//!
//! `docs/scoring.md` states the model in full and `docs/scoring-design.md` says
//! why it was chosen. In short. Each hand is a line of its own and the lines
//! share one tempo. A press is read as the next unplayed note of its pitch
//! unless the clock says otherwise, a note goes to the press that fits it best
//! and the tempo is the median of recent intervals, so one bad interval cannot
//! move it. A press that fits nowhere is called wrong only when the reading is
//! sure of the place and no note of that key could have been meant. Otherwise
//! it is left unsure. A jump is found by a search and adopted only when a run
//! of presses fits the new place.
//!
//! Every decision uses integer arithmetic. The only floating point values are
//! final divisions in [`Follower::finish`], each a single correctly rounded IEEE
//! 754 operation, so native, WebAssembly and Python builds agree bit for bit.

// the readings carry many small flags and the step that reads a press takes
// the whole context it works in: splitting either would hide how they relate
#![allow(
    clippy::struct_excessive_bools,
    clippy::too_many_arguments,
    clippy::too_many_lines,
    clippy::similar_names,
    clippy::large_types_passed_by_value
)]

use crate::score::Note;
use std::fmt;

/// Longest piece the engine accepts, so memory per session has a ceiling.
pub const MAX_EXPECTED: usize = 100_000;
/// Most presses one session (or one call to [`follow`]) accepts: six hours at
/// ten presses a second, the server's longest session.
pub const MAX_PLAYED: usize = 216_000;
/// Presses kept open to re-reading. Older decisions are final.
pub const MAX_REREAD: usize = 48;

/// Most notes treated as one chord group.
const MAX_GROUP: usize = 16;
/// Played milliseconds per score millisecond, in parts per million.
const UNIT: i64 = 1_000_000;
/// Slowest and fastest tempo the tracker will report (period in ppm).
const PERIOD_MIN: i64 = 250_000;
const PERIOD_MAX: i64 = 4_000_000;
/// Hand lines: no label, left and right.
const LINES: usize = 3;
/// Interval measurements kept for the tempo.
const RATIOS: usize = 8;
const RATIOS_U8: u8 = 8;
/// Shortest stretch of score an interval is measured over: shorter ones are mostly jitter.
const MIN_SPAN_MS: i64 = 300;
/// The shortest written interval whose pace is carried on to judge the next note.
const MIN_PACE_MS: i64 = 100;
/// Presses in a row refused only for coming too soon before the tempo is taken to be wrong and learnt again.
const RELEARN_AFTER: u8 = 3;
/// Measurements the tempo is the median of.
const TEMPO_MIN: usize = 3;
/// Onsets after a start, a pause or a jump before timing is judged.
const WARMUP: u16 = 3;
/// Notes of one pitch looked at on each side of the place for one press.
const SCAN: usize = 16;
/// Onsets ahead of the place a press may match after a pause, before the clock is set again.
const REACH_COLD: u32 = 4;
/// The same at a start: the player begins at the first notes of the place.
const REACH_START: u32 = 0;
/// How much nearer to a note's time a later press must be to take it from the press that has it.
const STEAL_MARGIN_MS: i64 = 20;
/// Longest stretch of score a press may come early by, as a share of the step.
const EARLY_STEP_CAP_MS: i64 = 2_000;
/// Score on each side of the place searched for a note a stray press could have meant.
const NEAR_MS: i64 = 1_500;
/// The same, in local beats, when they are longer.
const NEAR_BEATS: i64 = 3;
/// Other places kept under test at once.
const MAX_ALTS: usize = 6;
/// Presses another place may stay under test without being adopted.
const MAX_ALT_AGE: u32 = 24;
/// How many presses back a key struck again is looked for.
const ECHO_BACK: usize = 6;
/// Latest presses a search for another place reads again.
const SEARCH_SPAN: u32 = 8;
/// Most candidate places one search looks at.
const MAX_SEARCH: usize = 1_024;
/// Candidate places one search replays in full.
const MAX_REPLAYS: usize = 3;
/// What a clean match is worth when two readings are compared.
const WORTH: u32 = 4;
/// How much more a new place must explain than the present one: a press and a half.
const ADOPT_MARGIN: u32 = 6;
/// Matched presses in a row that confirm the place.
const CONFIRM: u8 = 3;
/// Groups ahead that count as going on, not as a jump.
const JUMP_AHEAD: u32 = 3;
/// Groups ahead whose mean gap sets the pause for a slow piece.
const PAUSE_GROUPS: usize = 8;
/// Most the hands may be taken to sit apart.
const MAX_SKEW_MS: i64 = 240;
/// Largest `relocate_after` value.
const MAX_RELOCATE_U8: u8 = 8;
/// Largest `window_ms` value.
const MAX_WINDOW_MS: u32 = 10_000;
const NONE: u32 = u32::MAX;

/// How the follower is tuned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FollowConfig {
    /// The floor of the timing window: a matched press is in time (a hit) when it
    /// lands within this many milliseconds of where the reading's clock expected
    /// it or within a quarter of the gap between the notes around it at the tempo
    /// being played when that is more. From 1 to 10 000.
    pub window_ms: u32,
    /// Chord groups ahead of the player's place a press may be matched to without
    /// a search, from 4 to 256.
    pub band: u16,
    /// A silence longer than this re-anchors the clock at the next note.
    pub pause_ms: u32,
    /// Expected notes closer than this to the first of a chord form one group.
    pub chord_ms: u32,
    /// Presses a new place must explain before the reading moves there, from 2
    /// to 8. A search starts one press earlier.
    pub relocate_after: u8,
}

impl Default for FollowConfig {
    fn default() -> Self {
        Self {
            window_ms: 150,
            band: 16,
            pause_ms: 2_500,
            chord_ms: 50,
            relocate_after: 3,
        }
    }
}

/// Which hand an expected note belongs to, when the song library knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Hand {
    /// No label.
    #[default]
    Unknown,
    /// The left hand.
    Left,
    /// The right hand.
    Right,
}

/// Which hands the learner chose to practise, when the caller knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Practise {
    /// Both hands or the caller does not know.
    #[default]
    Both,
    /// The left hand alone: the right hand's notes are never matched.
    Left,
    /// The right hand alone: the left hand's notes are never matched.
    Right,
}

/// What the caller knows about a session that the engine would otherwise have to guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Session {
    /// The written time the learner starts from. `None` when the caller does not
    /// know: the engine then expects the top and stays unsure until the presses
    /// show where the player is.
    pub start_ms: Option<u32>,
    /// The hand or hands being practised.
    pub practise: Practise,
}

/// Which hands the player was found to play, from the hand labels of the notes they matched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayedHands {
    /// The piece carries no hand labels.
    Unknown,
    /// No labelled note was matched.
    Neither,
    /// Only the left hand's notes were played.
    Left,
    /// Only the right hand's notes were played.
    Right,
    /// Both hands were played.
    Both,
}

impl PlayedHands {
    /// A stable small number for the bindings.
    #[must_use]
    pub fn code(self) -> u8 {
        match self {
            Self::Unknown => 0,
            Self::Neither => 1,
            Self::Left => 2,
            Self::Right => 3,
            Self::Both => 4,
        }
    }
}

/// What the follower decided about one press.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    /// The right note at the right place, in time.
    Hit,
    /// A press the engine is sure was not a note of the piece at the place the
    /// player had reached.
    Wrong,
    /// The right note at the right place, outside the timing window, early or
    /// late. The note counts as played, not as a hit and not as a wrong press.
    Late,
    /// The right note, matched to an expected note an earlier press already
    /// matched, after the player went back.
    Repeat,
    /// A press the engine cannot place with confidence. It counts neither for
    /// nor against the player.
    Unsure,
}

impl EventKind {
    /// A stable small number for the bindings.
    #[must_use]
    pub fn code(self) -> u8 {
        match self {
            Self::Hit => 0,
            Self::Wrong => 1,
            Self::Late => 2,
            Self::Repeat => 3,
            Self::Unsure => 4,
        }
    }
}

/// The alignment of one press.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Event {
    /// Position of the press in the stream, from 0.
    pub played_index: u32,
    /// What the follower decided.
    pub kind: EventKind,
    /// Index in the `expected` slice given to [`Follower::new`], when a note was matched.
    pub expected_index: Option<u32>,
    /// Chord group the reading has reached after this press.
    pub position: u32,
    /// Press time minus the time the reading's clock expected, in milliseconds.
    /// Zero for a press that matched no note or when the clock was not yet set.
    pub error_ms: i32,
    /// Tempo after this press: 1 000 000 means the speed written in the piece.
    pub speed_ppm: u32,
    /// Set when the reading moved to this press from a place that is not the one
    /// before it in time (a repeat, a restart or a jump): the group it left.
    pub jumped_from: Option<u32>,
}

/// The answer to one [`Follower::push`].
///
/// To follow a session live, keep one event for each press: put `event` at its
/// `played_index` and replace each event in `revised` at its own. The place a
/// view shows may step back only when `revised` is not empty or `event` has
/// `jumped_from` set. Presses before `settled` are final: no later update ever
/// revises them, so a view can stop redrawing them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Update {
    /// The decision for the press just pushed.
    pub event: Event,
    /// Earlier events the follower now reads differently, oldest first.
    pub revised: Vec<Event>,
    /// Presses whose events are final: every press with a smaller index.
    pub settled: u32,
}

/// The summary of a whole performance. Every figure is defined in `docs/scoring.md`.
#[derive(Debug, Clone, PartialEq)]
pub struct FollowScore {
    /// Notes the piece expected.
    pub expected: usize,
    /// Expected notes matched in time.
    pub hits: usize,
    /// Expected notes matched outside the window.
    pub late: usize,
    /// Expected notes never matched: `expected - hits - late`.
    pub misses: usize,
    /// Presses the engine is sure matched no note.
    pub wrong: usize,
    /// Presses that matched an expected note already matched.
    pub repeats: usize,
    /// Presses left unsure. They count neither for nor against the player.
    pub unsure: usize,
    /// Hits divided by expected notes plus wrong presses, from 0 to 1.
    pub accuracy: f32,
    /// Mean absolute timing error of the matched notes whose timing was judged.
    pub mean_timing_error_ms: Option<f32>,
    /// Tempo at the end: 1 000 000 is the written speed.
    pub final_speed_ppm: u32,
    /// Mean tempo over the judged notes that started a chord.
    pub mean_speed_ppm: Option<u32>,
    /// Which hands were played, from the hand labels.
    pub hands: PlayedHands,
    /// Expected notes in the hands that were played (all of them unless one hand only was played).
    pub played_expected: usize,
    /// Hits in the hands played divided by `played_expected` plus wrong presses.
    pub played_accuracy: f32,
}

/// Why the engine refused its input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FollowError {
    /// The piece has more notes than [`MAX_EXPECTED`].
    TooManyExpected {
        /// Notes given.
        given: usize,
    },
    /// A press is earlier than the one before it.
    PlayedOutOfOrder {
        /// Index of the press.
        index: u32,
    },
    /// More presses than [`MAX_PLAYED`].
    TooManyPlayed,
    /// A note number above 127.
    NoteOutOfRange {
        /// True for a press, false for an expected note.
        played: bool,
        /// Index of the note.
        index: u32,
        /// The number given.
        note: u8,
    },
    /// The hand labels do not have one entry per expected note.
    HandsLength {
        /// Labels given.
        given: usize,
        /// Expected notes.
        expected: usize,
    },
    /// One hand was named for practice but the piece has no hand labels.
    PractiseNeedsHands,
    /// A jump was given for a press that is not ahead or out of order.
    BadJump {
        /// Index of the jump in the list given.
        index: u32,
    },
    /// A configuration value is out of range.
    BadConfig(&'static str),
}

impl fmt::Display for FollowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooManyExpected { given } => {
                write!(
                    f,
                    "the piece has {given} notes, the limit is {MAX_EXPECTED}"
                )
            }
            Self::PlayedOutOfOrder { index } => {
                write!(f, "press {index} is earlier than the press before it")
            }
            Self::TooManyPlayed => write!(
                f,
                "too many presses in one session, the limit is {MAX_PLAYED}"
            ),
            Self::NoteOutOfRange {
                played,
                index,
                note,
            } => {
                let list = if *played { "played" } else { "expected" };
                write!(
                    f,
                    "{list} note {index} is {note}, MIDI notes run from 0 to 127"
                )
            }
            Self::HandsLength { given, expected } => write!(
                f,
                "{given} hand labels for {expected} notes: give one per note or none"
            ),
            Self::PractiseNeedsHands => write!(
                f,
                "practising one hand needs a hand label on the piece's notes: give hands or practise both"
            ),
            Self::BadJump { index } => write!(
                f,
                "jump {index} must name a press from 0 to the number of presses, in rising order"
            ),
            Self::BadConfig(why) => write!(f, "bad configuration: {why}"),
        }
    }
}

impl std::error::Error for FollowError {}

/// One note of the piece as the follower holds it.
#[derive(Debug, Clone, Copy)]
struct PNote {
    t: u32,
    pitch: u8,
    line: u8,
    /// Whether the note belongs to a hand being practised.
    play: bool,
    orig: u32,
    group: u32,
    /// The smaller of the gaps to the onsets before and after it, among the notes in play.
    beat: u32,
    /// The gap to the onset before it in its own line.
    step: u32,
    /// The note of the same pitch before it, among the notes in play.
    prev_same: u32,
}

#[derive(Debug, Clone, Copy)]
struct Group {
    start: u32,
    len: u8,
    t: u32,
    /// Onsets in play before this group.
    rank: u32,
    beat: u32,
    play: bool,
}

/// One reading's clock: where the beat is, how fast it goes and how far each
/// hand sits from it.
#[derive(Debug, Clone, Copy)]
struct Clock {
    period: i64,
    anchored: bool,
    at: i64,
    as_: i64,
    /// The anchor from before the last onset far out of time, kept for one
    /// onset: the next one says whether that press was one note out of time
    /// (this anchor still fits) or the player moved (the new one fits).
    bt: i64,
    bs: i64,
    has_b: bool,
    outlier: i8,
    /// Which way the last onset leant: late, early or neither.
    lean: i8,
    off: [i64; LINES],
    /// The last press that started a chord in each line.
    lead: [(i64, i64, bool); LINES],
    /// The anchors as they stood before the last onset moved them.
    pre: (i64, i64, i64, i64, bool),
    has_pre: bool,
    /// The anchor from before a pause: it says how far the piece has run on if
    /// the player was counting a rest and not stopping.
    held: (i64, i64),
    has_held: bool,
    ratio: [(i64, i64); RATIOS],
    /// The stretch of playing the latest measurement covers.
    ratio_span: (i64, i64),
    /// The pace of the last interval played, on its own.
    last: i64,
    paced: bool,
    /// The pace as it stood before the last onset.
    pace_pre: (i64, bool),
    ratios: u8,
    head: u8,
    base: [(i64, i64, bool); LINES],
    /// The last onset of each line within the stretch being measured.
    span_last: [(i64, i64); LINES],
    /// The slowest single interval of that stretch, as played and as written.
    span_worst: [(i64, i64); LINES],
    /// Onsets at distinct score times since the anchor.
    onsets: u16,
    last_s: i64,
    /// Intervals measured since the session began.
    measured: u16,
    /// The range the tempo may take: a place under test may not explain presses
    /// by a tempo far from the one the player had.
    slowest: i64,
    fastest: i64,
}

impl Clock {
    const fn new() -> Self {
        Self {
            period: UNIT,
            anchored: false,
            at: 0,
            as_: 0,
            bt: 0,
            bs: 0,
            has_b: false,
            outlier: 0,
            lean: 0,
            off: [0; LINES],
            lead: [(0, 0, false); LINES],
            pre: (0, 0, 0, 0, false),
            has_pre: false,
            held: (0, 0),
            has_held: false,
            ratio: [(0, 0); RATIOS],
            ratio_span: (0, 0),
            last: UNIT,
            paced: false,
            pace_pre: (UNIT, false),
            ratios: 0,
            head: 0,
            base: [(0, 0, false); LINES],
            span_last: [(0, 0); LINES],
            span_worst: [(0, 0); LINES],
            onsets: 0,
            last_s: 0,
            measured: 0,
            slowest: PERIOD_MAX,
            fastest: PERIOD_MIN,
        }
    }

    /// Forgets where the beat is but keeps how fast the player was going.
    fn pause(&mut self) {
        if self.anchored {
            self.held = (self.at, self.as_);
            self.has_held = true;
        }
        self.anchored = false;
        self.paced = false;
        self.has_b = false;
        self.has_pre = false;
        self.outlier = 0;
        self.lean = 0;
        self.onsets = 0;
        for b in &mut self.base {
            b.2 = false;
        }
        for l in &mut self.lead {
            l.2 = false;
        }
    }

    fn line_on(&self, s: i64, line: usize, t0: i64, s0: i64) -> i64 {
        t0 + (s - s0) * self.period / UNIT + self.off[line]
    }

    /// When a note written at `s` in `line` is expected.
    fn pred(&self, s: i64, line: usize) -> i64 {
        self.line_on(s, line, self.at, self.as_)
    }

    /// The anchors a note written at `s` is measured against. A note written at
    /// the same moment as the last onset is measured as that onset was, before
    /// the clock moved to it, so two hands playing together get one judgement.
    fn anchors(&self, s: i64) -> (i64, i64, i64, i64, bool) {
        if self.has_pre && s == self.last_s {
            self.pre
        } else {
            (self.at, self.as_, self.bt, self.bs, self.has_b)
        }
    }

    /// Press time less expected time, against the anchor that fits better.
    fn error(&self, s: i64, line: usize, t: i64) -> i64 {
        let (at, as_, bt, bs, has_b) = self.anchors(s);
        let err = t - self.line_on(s, line, at, as_);
        if has_b {
            let other = t - self.line_on(s, line, bt, bs);
            if other.abs() < err.abs() {
                return other;
            }
        }
        err
    }

    /// The error a note is judged by: against the pulse or against the beat
    /// carried on at the pace of the interval just played when that fits
    /// better. A note is in time when it fits either, as a listener hears it.
    fn heard(&self, s: i64, line: usize, t: i64) -> i64 {
        let mut err = self.error(s, line, t);
        // the other hand at the written moment of the last onset is judged as that onset was
        let (pace, paced) = if self.has_pre && s == self.last_s {
            self.pace_pre
        } else {
            (self.last, self.paced)
        };
        if paced {
            let (at, as_, ..) = self.anchors(s);
            let other = t - (at + (s - as_) * pace / UNIT + self.off[line]);
            if other.abs() < err.abs() {
                err = other;
            }
        }
        err
    }

    /// Where in the score the clock puts a press at `t`.
    fn score_at(&self, t: i64) -> i64 {
        self.as_ + (t - self.at) * UNIT / self.period
    }

    fn judged(&self) -> bool {
        // not before the tempo has been measured
        self.anchored && self.onsets >= WARMUP && self.learnt()
    }

    fn speed_ppm(&self) -> u32 {
        speed_of(self.period)
    }

    /// Moves the clock to a press that starts a chord in its line. `window` is
    /// the timing window at that note.
    fn onset(&mut self, t: i64, s: i64, line: usize, window: i64) {
        if !self.anchored {
            self.lead[line] = (t, s, true);
            self.at = t - self.off[line];
            self.as_ = s;
            self.anchored = true;
            self.has_b = false;
            self.outlier = 0;
            self.onsets = 1;
            self.last_s = s;
            self.base[line] = (t, s, true);
            self.span_last[line] = (t, s);
            self.span_worst[line] = (0, 0);
            return;
        }
        // the other hand at the same written moment is the same onset: the beat
        // has already moved to it
        let together = s == self.last_s;
        if !together {
            self.pre = (self.at, self.as_, self.bt, self.bs, self.has_b);
            self.pace_pre = (self.last, self.paced);
            self.has_pre = true;
            let mut err = t - self.pred(s, line);
            if self.has_b {
                let other = t - self.line_on(s, line, self.bt, self.bs);
                if other.abs() < err.abs() {
                    // the press before was one note out of time: its anchor is dropped
                    self.at = self.bt;
                    self.as_ = self.bs;
                    err = other;
                    self.outlier = 0;
                }
                self.has_b = false;
            }
            let here = t - self.off[line];
            let sign: i8 = match err {
                e if e * 4 > window => 1,
                e if e * 4 < -window => -1,
                _ => 0,
            };
            // an onset far out of time after onsets that were not leaning the same
            // way is a hesitation or a slip, not a measurement of the tempo: the
            // interval that led to it is left out and measuring starts again here.
            // when the onsets before it leant the same way the tempo is changing
            // and every interval counts. while the tempo is still being learnt
            // nothing is left out
            if err.abs() > window && self.lean != sign && self.learnt() {
                for b in &mut self.base {
                    b.2 = false;
                }
            }
            self.lean = sign;
            if err.abs() > window {
                if self.outlier != sign {
                    // one onset out of time: keep the old anchor for one more onset
                    self.bt = self.at;
                    self.bs = self.as_;
                    self.has_b = true;
                    self.outlier = sign;
                }
                // a second onset out of time the same way: the beat has moved
                self.at = here;
                self.as_ = s;
            } else {
                self.outlier = 0;
                // inside the window the beat moves half way to the press, so a steady
                // offset is forgiven while jitter is still judged. before the tempo is
                // known it moves all the way: half steps would add up to a false lead
                self.at = if self.learnt() {
                    here - err + err / 2
                } else {
                    here
                };
                self.as_ = s;
            }
        }
        // how far apart the hands are is learnt only from notes written together:
        // the gap between the two presses, less what is already allowed for
        for other in 0..LINES {
            let (ot, os, on) = self.lead[other];
            if other == line || !on || os != s {
                continue;
            }
            let gap = (t - ot) - (self.off[line] - self.off[other]);
            let limit = MAX_SKEW_MS / 2;
            self.off[line] = (self.off[line] + gap / 8).clamp(-limit, limit);
            self.off[other] = (self.off[other] - gap / 8).clamp(-limit, limit);
        }
        // the pace of the interval this hand just played, for the judgement of the next note
        let (lt, ls, on) = self.lead[line];
        if on && s - ls >= MIN_PACE_MS && t > lt {
            self.last = ((t - lt) * UNIT / (s - ls)).clamp(PERIOD_MIN, PERIOD_MAX);
            self.paced = true;
        }
        self.lead[line] = (t, s, true);
        if s != self.last_s {
            self.onsets = self.onsets.saturating_add(1);
            self.last_s = s;
        }
        // the tempo: the interval since this line's last onset, measured within
        // the line so that hands a little apart do not read as a change of tempo
        let (bt, bs, on) = self.base[line];
        if !on {
            self.base[line] = (t, s, true);
            self.span_last[line] = (t, s);
            self.span_worst[line] = (0, 0);
            return;
        }
        let (pt, ps) = self.span_last[line];
        if s > ps && t > pt {
            let (wd, ws) = self.span_worst[line];
            if ws == 0 || (t - pt) * ws > wd * (s - ps) {
                self.span_worst[line] = (t - pt, s - ps);
            }
        }
        self.span_last[line] = (t, s);
        if s - bs >= MIN_SPAN_MS {
            if t > bt {
                let (mut dt, mut ds) = (t - bt, s - bs);
                // a stretch of several intervals with one far slower than the rest
                // holds a hesitation: that interval is left out of the measurement
                let (wd, ws) = self.span_worst[line];
                if ws > 0 && ds > ws && dt > wd {
                    let (rt, rs) = (dt - wd, ds - ws);
                    if wd * rs * 10 > 17 * rt * ws {
                        dt = rt;
                        ds = rs;
                    }
                }
                let r = (dt * UNIT / ds).clamp(PERIOD_MIN, PERIOD_MAX);
                let w = ds;
                // two measurements over much the same stretch of playing are one: a
                // hesitation falls in both hands' intervals and must not count twice
                // or two hands would outvote the tempo together
                let (from, to) = self.ratio_span;
                let shared = to.min(t) - from.max(bt);
                if self.ratios > 0 && shared * 2 > (to - from).min(t - bt) {
                    // the same stretch seen by the other hand is averaged in. a longer
                    // interval that swallows it adds nothing but whatever went before,
                    // a hesitation perhaps and is left out
                    if t - bt <= to - from {
                        let last = (usize::from(self.head) + RATIOS - 1) % RATIOS;
                        let (r0, w0) = self.ratio[last];
                        self.ratio[last] = ((r0 + r) / 2, w0.max(w));
                        self.ratio_span = (from.min(bt), to.max(t));
                    }
                } else {
                    self.ratio[usize::from(self.head)] = (r, w);
                    self.head = (self.head + 1) % RATIOS_U8;
                    self.ratios = (self.ratios + 1).min(RATIOS_U8);
                    self.measured = self.measured.saturating_add(1);
                    self.ratio_span = (bt, t);
                }
                self.period = self.tempo();
            }
            self.base[line] = (t, s, true);
            self.span_worst[line] = (0, 0);
        }
    }

    /// The median of the last three intervals. Until three have been measured
    /// the tempo stays where it was: no single interval, which may hold a
    /// hesitation, ever sets it and one bad interval among three cannot move it.
    fn tempo(&self) -> i64 {
        if usize::from(self.ratios) < TEMPO_MIN {
            return self.period;
        }
        let mut picked = [0i64; TEMPO_MIN];
        for (k, slot) in picked.iter_mut().enumerate() {
            *slot = self.ratio[(usize::from(self.head) + RATIOS - 1 - k) % RATIOS].0;
        }
        picked.sort_unstable();
        picked[1].clamp(self.fastest, self.slowest)
    }

    /// Whether the tempo has been measured: until then the order of the notes
    /// is trusted over the clock.
    fn learnt(&self) -> bool {
        usize::from(self.ratios) >= TEMPO_MIN
    }

    /// Drops what was measured: presses that keep failing to fit say the tempo
    /// is not what the clock holds. The tempo is then learnt again from the next
    /// three intervals.
    fn relearn(&mut self) {
        self.ratios = 0;
        self.lean = 0;
        self.outlier = 0;
        self.has_b = false;
        for b in &mut self.base {
            b.2 = false;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum State {
    /// The press is a note of the piece.
    Matched,
    /// The press is no note of the piece and the reading is sure of it.
    Wrong,
    /// The press fits nowhere yet and the reading is not sure why.
    Pending,
}

/// One open press as a reading has it.
#[derive(Debug, Clone, Copy)]
struct Slot {
    index: u32,
    t: u32,
    pitch: u8,
    state: State,
    note: u32,
    /// The press that held the note before this one took it: an earlier pass
    /// through the passage or none.
    prev_owner: u32,
    repeat: bool,
    err: i32,
    judged: bool,
    lead: bool,
    late: bool,
    /// When the note was expected at the moment it was matched.
    pred0: i64,
    /// Matched straight after two presses that fitted nothing: a later press of
    /// the same key in a steadier place has the better claim.
    shaky: bool,
    speed: u32,
    position: u32,
    jumped_from: u32,
    /// The stretch of score the press could belong to: from the place the
    /// reading had reached to where its clock put the press.
    s_lo: i64,
    s_hi: i64,
    /// A pending press whose verdict will not change: a note it could have meant was never claimed.
    firm: bool,
    /// The silence before this press was a pause.
    paused: bool,
    /// Unplayed notes of its own line the match stepped over.
    holes: u8,
    /// Matched to a note behind the place.
    passed: bool,
    /// Outside the timing window, judged or not.
    off: bool,
    /// The first press of a written moment in this reading.
    first: bool,
    /// A key of the hand that is not being practised: left unjudged and out of the reading.
    aside: bool,
    /// Matched after at least one interval had been measured.
    timed: bool,
    /// Refused only for coming too soon for the clock: the place is not in doubt.
    soon: bool,
    /// The first note the press held, if it ever held one: a press that was shown
    /// as a note is called wrong only when another press holds that note in its place.
    was: u32,
}

impl Slot {
    /// A match that needs no excuse: in step, in time and over no unplayed note.
    fn clean(&self) -> bool {
        self.state == State::Matched && !self.shaky && self.holes == 0 && !self.late
    }

    /// A match that is evidence of the place: in order and in time.
    fn solid(&self) -> bool {
        self.state == State::Matched && !self.passed && !self.off
    }

    /// A press that speaks against the reading it is in.
    fn strain(&self) -> bool {
        !self.clean() && !self.aside && !self.soon
    }

    /// What the press is worth to a reading when two are compared.
    fn worth(&self) -> u32 {
        if self.state == State::Matched {
            // a match is worth four, one less for each unplayed note stepped over
            // (two at most, so a hand played alone still counts). timing is left
            // out: a change of tempo must never look like a move to another place
            4u32.saturating_sub(u32::from(self.holes.min(2)))
        } else {
            0
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Lead {
    group: u32,
    t: i64,
    err: i64,
    /// When the pulse alone expected the chord.
    due: i64,
    judged: bool,
}

const NO_LEAD: Lead = Lead {
    group: NONE,
    t: 0,
    err: 0,
    due: 0,
    judged: false,
};

/// One reading of the performance: a place, a clock and what each open press was.
#[derive(Debug, Clone)]
struct Track {
    clock: Clock,
    /// Written time of the furthest note matched. Notes at or after it are still to come.
    front: i64,
    front_group: u32,
    /// When the last note of the chord at the place was pressed.
    front_t: i64,
    /// The first press this reading explains from its present place. Notes held
    /// by earlier presses and written at or after `replay_from` may be played again.
    epoch: u32,
    replay_from: i64,
    /// Index of the press in `slots[0]`.
    first: u32,
    slots: Vec<Slot>,
    /// Matched presses in a row.
    run: u8,
    /// Presses in a row that matched nothing.
    missed: u8,
    /// Presses in a row that were the next note of their key and came too soon for the clock.
    too_soon: u8,
    /// The caller said where this reading starts or a search placed it.
    told: bool,
    /// Nothing has matched since the start or the last stated jump.
    fresh: bool,
    /// A pause has passed since the last match, so the place is not sure.
    paused: bool,
    /// Matches since the place was last in doubt.
    since: u8,
    /// How badly the last few presses have fitted: up two for a press that
    /// fitted nothing, down one for a clean match.
    trouble: u8,
    leads: [Lead; LINES],
    /// Presses matched since `epoch`.
    hits: u32,
    /// The group the reported reading had reached when this one left it.
    from_group: u32,
    /// The first note this reading matched.
    entry_note: u32,
    /// Set on the next matched press: the group a stated jump left.
    jump_pending: u32,
}

impl Track {
    fn new(clock: Clock, front: i64, front_group: u32, epoch: u32, told: bool) -> Self {
        Self {
            clock,
            front,
            front_group,
            front_t: i64::MIN / 2,
            epoch,
            replay_from: front,
            first: epoch,
            slots: Vec::new(),
            run: 0,
            missed: 0,
            too_soon: 0,
            told,
            fresh: true,
            paused: false,
            since: if told { CONFIRM } else { 0 },
            trouble: 0,
            leads: [NO_LEAD; LINES],
            hits: 0,
            from_group: front_group,
            entry_note: NONE,
            jump_pending: NONE,
        }
    }

    /// Whether the reading knows where the player is well enough to call a press wrong.
    fn sure(&self) -> bool {
        !self.paused && self.missed <= 1 && self.since >= CONFIRM && self.trouble <= 2
    }
}

/// What became of the notes of a pending press's key near where it fell.
#[derive(Debug, Clone, Copy, Default)]
struct Claims {
    /// There is such a note.
    any: bool,
    /// One of them was never played: the press may have been meant for it.
    unclaimed: bool,
    /// One of them is still ahead of the place, so it is too soon to say.
    waiting: bool,
    /// One of them was played by a later press: the key came again in its place.
    later: bool,
    /// One of them was played just before by the same key: the key was struck again.
    again: bool,
}

/// Who holds a note in a reading.
#[derive(Debug, Clone, Copy)]
enum Holder {
    /// Nobody: it has not been played.
    Free,
    /// A press from an earlier pass through the passage: it may be played again.
    Old(u32),
    /// An open press of this reading, by its slot.
    Open(usize),
    /// A press that is final or out of reach.
    Taken,
}

#[derive(Debug, Clone, Copy)]
enum How {
    Fresh,
    Again(u32),
    Steal(usize),
}

#[derive(Debug, Clone, Copy)]
struct Cand {
    note: u32,
    /// Press time less expected time, when the clock is set.
    err: Option<i64>,
    how: How,
    /// The note is behind the place: matched where it belongs, the place and the clock stay.
    passed: bool,
    /// For a note of the chord just sounded: how long after that chord's last
    /// press this one came. Candidates are compared by it, since a chord struck
    /// late is no nearer to the same chord written next.
    spread: Option<i64>,
}

impl Cand {
    fn off(&self) -> i64 {
        self.spread.unwrap_or_else(|| self.err.map_or(0, i64::abs))
    }
}

/// A candidate place from a search: the presses it fits, its distance and the
/// two presses a replay may start from, each with the note it would be.
type Placed = (usize, i64, [(usize, u32); 2]);

/// The reported reading's slots, for a reading under test to look through.
#[derive(Clone, Copy)]
struct Base<'a> {
    slots: &'a [Slot],
    first: u32,
}

/// The piece and the settings: everything a reading needs that never changes.
#[derive(Debug, Clone)]
struct Piece {
    config: FollowConfig,
    notes: Vec<PNote>,
    groups: Vec<Group>,
    by_pitch: Vec<Vec<u32>>,
    /// The notes of the hand that is not being practised, by pitch.
    aside: Vec<Vec<u32>>,
}

impl Piece {
    fn window(&self, clock: &Clock, note: &PNote) -> i64 {
        (i64::from(note.beat) * clock.period / UNIT / 4).max(i64::from(self.config.window_ms))
    }

    /// How early a press may be for a note still to come: a share of the step
    /// from the note before it in its line, at the tempo being played.
    fn early_max(&self, clock: &Clock, note: &PNote, lost: bool) -> i64 {
        if lost && clock.learnt() {
            // straight after a press that fitted nothing, a note is taken only in time
            return i64::from(self.config.window_ms);
        }
        let step = i64::from(note.step).min(EARLY_STEP_CAP_MS) * clock.period / UNIT;
        // until the tempo has been measured the order of the notes is trusted more than the clock
        let share = if clock.learnt() {
            step * 3 / 5
        } else {
            step * 17 / 20
        };
        share.max(i64::from(self.config.window_ms))
    }

    /// How late a press may be for a note the reading has passed.
    fn late_max(&self, clock: &Clock, note: &PNote) -> i64 {
        (i64::from(note.step) * clock.period / UNIT)
            .max(4 * i64::from(self.config.window_ms))
            .min(i64::from(self.config.pause_ms))
    }

    fn holder(&self, tr: &Track, owner: &[u32], base: Option<Base<'_>>, n: u32) -> Holder {
        let old = |o: u32| {
            if i64::from(self.notes[n as usize].t) >= tr.replay_from {
                Holder::Old(o)
            } else {
                Holder::Taken
            }
        };
        match base {
            None => {
                let o = owner[n as usize];
                if o == NONE {
                    Holder::Free
                } else if o < tr.epoch {
                    old(o)
                } else if o >= tr.first {
                    Holder::Open((o - tr.first) as usize)
                } else {
                    Holder::Taken
                }
            }
            Some(base) => {
                if let Some(i) = tr
                    .slots
                    .iter()
                    .position(|s| s.note == n && s.state == State::Matched)
                {
                    return Holder::Open(i);
                }
                // the reported reading's claims on presses this reading reads again do not count
                let mut o = owner[n as usize];
                while o != NONE && o >= tr.epoch {
                    let before = base
                        .slots
                        .get((o.saturating_sub(base.first)) as usize)
                        .map_or(NONE, |s| s.prev_owner);
                    // a holder is always an earlier press than the one that took the
                    // note from it, so the walk back ends
                    o = if before < o { before } else { NONE };
                }
                if o == NONE {
                    Holder::Free
                } else {
                    old(o)
                }
            }
        }
    }

    /// The note a press at `t` of `pitch` is, in this reading, if any.
    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    fn find(
        &self,
        tr: &Track,
        owner: &[u32],
        base: Option<Base<'_>>,
        t: i64,
        pitch: u8,
        steal: bool,
        skip: u32,
        too_soon: &mut bool,
        work: &mut u64,
    ) -> Option<Cand> {
        let list = &self.by_pitch[usize::from(pitch)];
        if list.is_empty() {
            return None;
        }
        let clock = &tr.clock;
        let cold = !clock.anchored;
        let start = list.partition_point(|&n| i64::from(self.notes[n as usize].t) < tr.front);
        // at a start the player is at the first notes or the reading is lost. after
        // a pause they may have counted a rest: the clock from before it says how far
        let reach = if tr.fresh { REACH_START } else { REACH_COLD };
        let mut rank = self
            .groups
            .get(tr.front_group as usize)
            .map_or(0, |g| g.rank);
        if cold && clock.has_held {
            let due = clock.held.1 + (t - clock.held.0) * UNIT / clock.period;
            let g = self.group_at(due + i64::from(self.config.window_ms));
            rank = rank.max(self.groups.get(g as usize).map_or(0, |g| g.rank));
        }
        let early_cap = (EARLY_STEP_CAP_MS * clock.period / UNIT)
            .max(i64::from(self.config.window_ms))
            + i64::from(self.config.window_ms);
        // a press nearer a note's time than the press that holds it may take it
        let mut better: Option<(i64, usize, u32, bool)> = None;
        let mut loose: Option<(usize, u32)> = None;
        let mut offer = |i: usize, n: u32| {
            let slot = &tr.slots[i];
            // a note changes hands on timing only when both presses were timed by an
            // interval that had been measured: before that the expected time means nothing
            if !steal || slot.index < tr.epoch || slot.repeat || !slot.timed || clock.ratios == 0 {
                return;
            }
            let mine = (t - slot.pred0).abs();
            let theirs = (i64::from(slot.t) - slot.pred0).abs();
            // only presses within a step of each other compete for one note: that
            // is as far ahead of its time as a press may be taken for it
            let note = &self.notes[n as usize];
            let room = (i64::from(note.step) * clock.period / UNIT)
                .max(2 * i64::from(self.config.window_ms));
            let close = (t - i64::from(slot.t)).abs() <= room;
            if close && mine + STEAL_MARGIN_MS < theirs {
                if better.is_none_or(|(b, ..)| mine < b) {
                    // how many of the other notes of the holder's chord, in its hand,
                    // were struck with it
                    let group = &self.groups[note.group as usize];
                    let together = i64::from(self.config.window_ms);
                    let mut others = 0;
                    let mut with = 0;
                    for m in group.start..group.start + u32::from(group.len) {
                        let other = &self.notes[m as usize];
                        if m == n || other.line != note.line {
                            continue;
                        }
                        others += 1;
                        if let Holder::Open(j) = self.holder(tr, owner, base, m) {
                            if (i64::from(tr.slots[j].t) - i64::from(slot.t)).abs() <= together {
                                with += 1;
                            }
                        }
                    }
                    // one finger of a chord struck without the rest is a key struck
                    // again. so are two strikes closer than two fifths of the step
                    // between notes. anything else may be the next note played quicker
                    let lone = others > 0 && with < others;
                    let step = i64::from(note.step) * clock.period / UNIT;
                    let again = (t - i64::from(slot.t)) * 5 < 2 * step;
                    better = Some((mine, i, n, !lone && !again));
                }
            } else if slot.shaky && loose.is_none() && mine <= self.late_max(clock, note) {
                // a press that stood among presses fitting nothing gives its note up
                // to a later one, but only to one that could itself be that note played late
                loose = Some((i, n));
            }
        };
        // the next unplayed note of this pitch: the order of the notes comes before the clock
        let mut up: Option<Cand> = None;
        let mut partner: Option<Cand> = None;
        for &n in list[start..].iter().take(SCAN) {
            *work += 1;
            let note = &self.notes[n as usize];
            if n == skip {
                continue;
            }
            let group = &self.groups[note.group as usize];
            if cold {
                if group.rank > rank + reach {
                    break;
                }
            } else if clock.pred(i64::from(note.t), usize::from(note.line)) - t > early_cap
                || note.group > tr.front_group.saturating_add(u32::from(self.config.band)) + 64
            {
                break;
            }
            let how = match self.holder(tr, owner, base, n) {
                Holder::Free => How::Fresh,
                Holder::Old(o) => How::Again(o),
                Holder::Open(i) => {
                    offer(i, n);
                    continue;
                }
                Holder::Taken => continue,
            };
            let cand = Cand {
                note: n,
                err: None,
                how,
                passed: false,
                spread: None,
            };
            // an unplayed note of the chord already sounded (another voice of it or
            // the other hand's part of it) is a candidate, but it does not stand in
            // the way of the next note of this pitch
            if !cold && !tr.fresh && note.group <= tr.front_group {
                if partner.is_none() {
                    partner = Some(cand);
                }
                continue;
            }
            up = Some(cand);
            break;
        }
        if let Some(c) = partner.as_mut() {
            let note = &self.notes[c.note as usize];
            let err = clock.error(i64::from(note.t), usize::from(note.line), t);
            c.err = Some(err);
            let late = self.late_max(clock, note);
            if note.group == tr.front_group {
                // struck with the chord's last press, however late the chord itself was
                c.spread = Some((t - tr.front_t).abs().min(err.abs()));
            }
            let fits = match c.spread {
                Some(spread) => spread <= late,
                None => err <= late && -err <= i64::from(self.config.window_ms),
            };
            if !fits {
                partner = None;
            }
        }
        if let (Some(c), false) = (up.as_mut(), cold) {
            let note = &self.notes[c.note as usize];
            let err = clock.error(i64::from(note.t), usize::from(note.line), t);
            c.err = Some(err);
            let early = self.early_max(clock, note, tr.missed > 0);
            let mut ok = -err <= early;
            if !ok {
                // the beat only moves half way to an early onset, so the onset after
                // a quicker one looks earlier still. measured from where the hand's
                // last onset really fell, it may be near enough to its time
                let (lt, ls, on) = clock.lead[usize::from(note.line)];
                let due = lt + (i64::from(note.t) - ls) * clock.period / UNIT;
                ok = on && i64::from(note.t) > ls && due - t <= early;
            }
            // a key struck again too soon after the note of the same pitch before it
            // is that key pressed again, not the next note
            if ok && note.prev_same != NONE {
                if let Holder::Open(j) = self.holder(tr, owner, base, note.prev_same) {
                    // measured from where that note really fell, against the time
                    // written between the two at the tempo being played
                    let before = i64::from(tr.slots[j].t);
                    let written =
                        i64::from(note.t) - i64::from(self.notes[note.prev_same as usize].t);
                    let gap = written * clock.period / UNIT;
                    let (num, den) = if clock.learnt() { (2, 5) } else { (1, 5) };
                    if (t - before) * den < gap * num {
                        ok = false;
                    }
                }
            }
            if !ok {
                // the next note of its hand was there and only the clock refused it:
                // next, that is, after the notes of the presses refused the same way
                // just before. a note further on may be a skip instead
                *too_soon = self.holes(tr, owner, base, note) <= tr.too_soon;
                up = None;
            }
        }
        // or a note the reading has passed, played late
        let mut passed: Option<Cand> = None;
        if !cold {
            for &n in list[..start].iter().rev().take(SCAN) {
                *work += 1;
                let note = &self.notes[n as usize];
                if n == skip {
                    continue;
                }
                let (s, line) = (i64::from(note.t), usize::from(note.line));
                if t - clock.pred(s, line) > i64::from(self.config.pause_ms) {
                    break;
                }
                let how = match self.holder(tr, owner, base, n) {
                    Holder::Free => How::Fresh,
                    Holder::Old(o) => How::Again(o),
                    Holder::Open(i) => {
                        offer(i, n);
                        continue;
                    }
                    Holder::Taken => continue,
                };
                let err = clock.error(s, line, t);
                if err > self.late_max(clock, note)
                    || -err > i64::from(self.config.window_ms)
                    || passed.is_some_and(|p| p.off() <= err.abs())
                {
                    continue;
                }
                passed = Some(Cand {
                    note: n,
                    err: Some(err),
                    how,
                    passed: true,
                    spread: None,
                });
            }
        }
        // a key of the chord just sounded, struck with it, is that chord's note:
        // no later note of the pitch is weighed against it
        if let Some(c) = partner {
            if c.spread
                .is_some_and(|d| d <= 2 * i64::from(self.config.chord_ms))
            {
                return Some(c);
            }
        }
        let nearer = |a: Option<Cand>, b: Option<Cand>| match (a, b) {
            (Some(a), Some(b)) => Some(if a.off() <= b.off() { a } else { b }),
            (a, b) => a.or(b),
        };
        // whether the key has a note of its own next in order, in time or too soon for the clock
        let in_order = up.is_some() || *too_soon;
        let free = nearer(nearer(partner, up), passed);
        let taken = |i: usize, n: u32| {
            let note = &self.notes[n as usize];
            Cand {
                note: n,
                err: (!cold).then(|| clock.error(i64::from(note.t), usize::from(note.line), t)),
                how: How::Steal(i),
                passed: i64::from(note.t) < tr.front,
                spread: None,
            }
        };
        if let Some((mine, i, n, apart)) = better {
            // two strikes far enough apart to be two notes, the second with a note
            // of its own next in order, are the music played quicker and not one
            // note struck twice: nothing changes hands
            if free.is_none_or(|f| mine < f.off()) && !(apart && in_order) {
                return Some(taken(i, n));
            }
        }
        if free.is_none() {
            if let Some((i, n)) = loose {
                return Some(taken(i, n));
            }
        }
        free
    }

    /// Records a match in the reading and moves its clock and place.
    fn place(
        &self,
        tr: &mut Track,
        owner: Option<&mut [u32]>,
        look: &[u32],
        base: Option<Base<'_>>,
        k: usize,
        cand: Cand,
    ) {
        let note = self.notes[cand.note as usize];
        let holes = if cand.passed {
            0
        } else {
            self.holes(tr, owner.as_deref().unwrap_or(look), base, &note)
        };
        let (s, line) = (i64::from(note.t), usize::from(note.line));
        let t = i64::from(tr.slots[k].t);
        let window = self.window(&tr.clock, &note);
        // while the tempo is still being learnt a note cannot be out of time
        let timed = tr.clock.learnt();
        let measured = tr.clock.ratios > 0;
        let first = !cand.passed && (!tr.clock.anchored || s != tr.clock.last_s);
        let lead = tr.leads[line];
        // `due` is when the pulse alone expected the note: two presses that
        // compete for one note are compared against it, not against the kinder
        // judgement a listener makes
        let (err, due, judged, is_lead) = if cand.passed {
            let err = cand.err.unwrap_or(0);
            (err, t - err, tr.clock.judged(), false)
        } else if lead.group == note.group {
            // a chord is as early or late as its first note: the rest add their spread
            (lead.err + (t - lead.t), lead.due, lead.judged, false)
        } else {
            let (err, due) = if cand.err.is_some() {
                (tr.clock.heard(s, line, t), t - tr.clock.error(s, line, t))
            } else {
                (0, t)
            };
            let judged = tr.clock.judged();
            tr.clock.onset(t, s, line, window);
            tr.leads[line] = Lead {
                group: note.group,
                t,
                err,
                due,
                judged,
            };
            (err, due, judged, true)
        };
        let prev_owner = match cand.how {
            How::Fresh => NONE,
            How::Again(o) => o,
            How::Steal(i) => tr.slots[i].prev_owner,
        };
        let shaky = tr.missed >= 2;
        if !cand.passed && s >= tr.front {
            tr.front = s;
            tr.front_group = tr.front_group.max(note.group);
            if note.group == tr.front_group {
                tr.front_t = t;
            }
        }
        tr.run = tr.run.saturating_add(1);
        tr.missed = 0;
        tr.too_soon = 0;
        tr.paused = false;
        tr.fresh = false;
        tr.since = tr.since.saturating_add(1);
        tr.hits += 1;
        if tr.entry_note == NONE {
            tr.entry_note = cand.note;
        }
        let jumped_from = std::mem::replace(&mut tr.jump_pending, NONE);
        let speed = tr.clock.speed_ppm();
        let position = tr.front_group;
        let slot = &mut tr.slots[k];
        slot.state = State::Matched;
        slot.note = cand.note;
        if slot.was == NONE {
            slot.was = cand.note;
        }
        slot.prev_owner = prev_owner;
        slot.repeat = prev_owner != NONE;
        slot.err = clamp32(err);
        slot.judged = judged;
        slot.lead = is_lead;
        slot.off = timed && err.abs() > window;
        slot.late = judged && slot.off;
        slot.passed = cand.passed;
        slot.first = first;
        slot.timed = measured;
        slot.pred0 = due;
        slot.shaky = shaky;
        slot.speed = speed;
        slot.position = position;
        slot.jumped_from = jumped_from;
        slot.firm = false;
        slot.holes = holes;
        if let Some(owner) = owner {
            owner[cand.note as usize] = slot.index;
        }
    }

    /// Unplayed notes of the note's own line between the place and the note: a
    /// reading that keeps stepping over notes the player is playing is suspect.
    fn holes(&self, tr: &Track, owner: &[u32], base: Option<Base<'_>>, note: &PNote) -> u8 {
        let from = tr.front_group as usize + usize::from(!tr.fresh);
        let to = note.group as usize;
        if to <= from {
            return 0;
        }
        let lo = self.groups[from].start as usize;
        let hi = self.groups[to].start as usize;
        let mut n = 0u8;
        for i in lo..hi.min(lo + 48) {
            let x = &self.notes[i];
            if x.play
                && x.line == note.line
                && matches!(self.holder(tr, owner, base, small(i)), Holder::Free)
            {
                n = n.saturating_add(1);
            }
        }
        n
    }

    /// The notes of a press's key written near where it fell: the stretch from
    /// the place the reading had reached to where its clock put the press,
    /// widened by the reach a stray press could have meant.
    fn near(&self, tr: &Track, pitch: u8, lo: i64, hi: i64) -> &[u32] {
        self.near_in(&self.by_pitch[usize::from(pitch)], tr, lo, hi)
    }

    fn near_in<'a>(&self, list: &'a [u32], tr: &Track, lo: i64, hi: i64) -> &'a [u32] {
        let beat = self
            .groups
            .get(tr.front_group as usize)
            .map_or(0, |g| i64::from(g.beat));
        let reach = NEAR_MS.max(NEAR_BEATS * beat).min(4 * NEAR_MS);
        let from = list.partition_point(|&n| i64::from(self.notes[n as usize].t) < lo - reach);
        let to = list.partition_point(|&n| i64::from(self.notes[n as usize].t) <= hi + reach);
        &list[from..to.max(from)]
    }

    /// What became of the notes a pending press could have meant.
    fn claims(&self, tr: &Track, owner: &[u32], k: usize) -> Claims {
        let slot = &tr.slots[k];
        let mut out = Claims::default();
        for &n in self
            .near(tr, slot.pitch, slot.s_lo, slot.s_hi)
            .iter()
            .take(2 * SCAN)
        {
            out.any = true;
            match self.holder(tr, owner, None, n) {
                // a note still ahead of the place may yet be played: only one the
                // reading has passed was left out
                Holder::Free | Holder::Old(_) => {
                    if i64::from(self.notes[n as usize].t) > tr.front {
                        out.waiting = true;
                    } else {
                        out.unclaimed = true;
                    }
                }
                Holder::Taken => {}
                Holder::Open(j) => {
                    let other = &tr.slots[j];
                    let note = &self.notes[n as usize];
                    let room = (i64::from(note.step) * tr.clock.period / UNIT)
                        .max(2 * i64::from(self.config.window_ms));
                    if j > k {
                        out.later = true;
                    } else if (i64::from(slot.t) - i64::from(other.t)) * 5 < 2 * room {
                        out.again = true;
                    }
                }
            }
        }
        out
    }

    /// Reads one press in a reading. `base` is set for a reading under test.
    fn step(
        &self,
        tr: &mut Track,
        mut owner: Option<&mut [u32]>,
        look: &[u32],
        base: Option<Base<'_>>,
        press: Note,
        index: u32,
        paused: bool,
        work: &mut u64,
    ) {
        if paused {
            tr.clock.pause();
            tr.paused = true;
            tr.since = tr.since.min(1);
            tr.leads = [NO_LEAD; LINES];
        }
        let t = i64::from(press.t_ms);
        let here = if tr.clock.anchored {
            tr.clock.score_at(t)
        } else {
            tr.front
        };
        tr.slots.push(Slot {
            index,
            t: press.t_ms,
            pitch: press.note,
            state: State::Pending,
            note: NONE,
            prev_owner: NONE,
            repeat: false,
            err: 0,
            judged: false,
            lead: false,
            late: false,
            pred0: t,
            shaky: false,
            speed: tr.clock.speed_ppm(),
            position: tr.front_group,
            jumped_from: NONE,
            s_lo: tr.front.min(here),
            s_hi: tr.front.max(here),
            firm: false,
            paused,
            holes: 0,
            passed: false,
            off: false,
            first: false,
            aside: false,
            timed: false,
            soon: false,
            was: NONE,
        });
        let k = tr.slots.len() - 1;
        let view: &[u32] = owner.as_deref().unwrap_or(look);
        let mut too_soon = false;
        let found = self.find(
            tr,
            view,
            base,
            t,
            press.note,
            true,
            NONE,
            &mut too_soon,
            work,
        );
        let Some(cand) = found else {
            let slot = tr.slots[k];
            // a key of the hand that is not being practised, where that hand has it
            // written: the learner may be playing that hand too. the engine was told
            // not to follow it, so it does not judge the press and the press does
            // not disturb the reading of the hand that is practised
            let other = &self.aside[usize::from(press.note)];
            if !self.near_in(other, tr, slot.s_lo, slot.s_hi).is_empty() {
                tr.slots[k].firm = true;
                tr.slots[k].aside = true;
                return;
            }
            // wrong at once only when the player was in step just before and the
            // key belongs to no note anywhere near: nothing else could be meant
            if tr.sure() && self.near(tr, press.note, slot.s_lo, slot.s_hi).is_empty() {
                tr.slots[k].state = State::Wrong;
            }
            tr.missed = tr.missed.saturating_add(1);
            // three presses running that were each the next note of their key, come
            // too soon for the clock: it is the clock that is wrong, not the player
            tr.too_soon = if too_soon { tr.too_soon + 1 } else { 0 };
            tr.slots[k].soon = too_soon;
            tr.trouble = (tr.trouble + 2).min(8);
            tr.run = 0;
            if tr.too_soon == RELEARN_AFTER {
                // the tempo is dropped and those presses are read again in the order
                // of the notes, the first of them setting the beat afresh. the place
                // has not moved, so no other place is looked for on their account
                tr.too_soon = 0;
                if tr.clock.learnt() {
                    tr.clock.relearn();
                }
                tr.clock.pause();
                tr.clock.has_held = false;
                for i in k + 1 - usize::from(RELEARN_AFTER)..=k {
                    let again = tr.slots[i];
                    tr.slots[i].soon = false;
                    let view: &[u32] = owner.as_deref().unwrap_or(look);
                    let t = i64::from(again.t);
                    let found = self.find(
                        tr,
                        view,
                        base,
                        t,
                        again.pitch,
                        false,
                        NONE,
                        &mut false,
                        work,
                    );
                    if let Some(cand) = found {
                        self.place(tr, owner.as_deref_mut(), look, base, i, cand);
                    }
                }
            }
            return;
        };
        let lost = if let How::Steal(i) = cand.how {
            let old = &mut tr.slots[i];
            old.state = State::Pending;
            old.note = NONE;
            old.repeat = false;
            old.err = 0;
            Some((i, cand.note))
        } else {
            None
        };
        self.place(tr, owner.as_deref_mut(), look, base, k, cand);
        if tr.slots[k].clean() {
            tr.trouble = tr.trouble.saturating_sub(1);
        }
        if let Some((i, note)) = lost {
            // the press that lost its note is read again: it may be a note played late
            let old = tr.slots[i];
            let view: &[u32] = owner.as_deref().unwrap_or(look);
            if let Some(again) = self.find(
                tr,
                view,
                base,
                i64::from(old.t),
                old.pitch,
                false,
                note,
                &mut false,
                work,
            ) {
                let (run, missed, hits) = (tr.run, tr.missed, tr.hits);
                let again = Cand {
                    passed: true,
                    ..again
                };
                self.place(tr, owner, look, base, i, again);
                // an older press read again says nothing new about the run in hand
                tr.run = run;
                tr.missed = missed;
                tr.hits = hits;
            } else {
                tr.hits = tr.hits.saturating_sub(1);
            }
        }
    }

    /// How long a silence must be to count as a pause: `pause_ms` or two and a
    /// half of the piece's own gaps around the place when they are longer, so a
    /// slow piece is still judged for timing.
    fn pause_after(&self, tr: &Track) -> i64 {
        let n = self.groups.len();
        let floor = i64::from(self.config.pause_ms);
        let col = tr.front_group as usize;
        let ahead = (col + PAUSE_GROUPS).min(n.saturating_sub(1));
        if ahead <= col {
            return floor;
        }
        let span = i64::from(self.groups[ahead].t - self.groups[col].t);
        let mean = span * tr.clock.period / UNIT / i64::try_from(ahead - col).unwrap_or(1);
        floor.max(mean * 5 / 2)
    }

    /// The note of `pitch` in play nearest `want` among those written from `lo` to `hi`.
    fn nearest(
        &self,
        pitch: u8,
        lo: i64,
        hi: i64,
        want: i64,
        used: &[u32],
        work: &mut u64,
    ) -> Option<u32> {
        let list = &self.by_pitch[usize::from(pitch)];
        let from = list.partition_point(|&n| i64::from(self.notes[n as usize].t) < lo);
        let mut best: Option<(i64, u32)> = None;
        for &n in list[from..].iter().take(SCAN) {
            *work += 1;
            let s = i64::from(self.notes[n as usize].t);
            if s > hi {
                break;
            }
            if used.contains(&n) {
                continue;
            }
            let d = (s - want).abs();
            if best.is_none_or(|(b, _)| d < b) {
                best = Some((d, n));
            }
        }
        best.map(|(_, n)| n)
    }

    /// The first group written at or after `s`.
    fn group_at(&self, s: i64) -> u32 {
        small(self.groups.partition_point(|g| i64::from(g.t) < s))
            .min(small(self.groups.len().saturating_sub(1)))
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct Totals {
    hits: u64,
    late: u64,
    wrong: u64,
    repeats: u64,
    unsure: u64,
    error_sum: u64,
    error_count: u64,
    speed_sum: u64,
    speed_count: u64,
}

impl Totals {
    fn add(&mut self, slot: &Slot) {
        match kind_of(slot) {
            EventKind::Hit => self.hits += 1,
            EventKind::Late => self.late += 1,
            EventKind::Wrong => self.wrong += 1,
            EventKind::Repeat => self.repeats += 1,
            EventKind::Unsure => self.unsure += 1,
        }
        if slot.state == State::Matched && slot.judged && !slot.repeat {
            self.error_sum += u64::from(slot.err.unsigned_abs());
            self.error_count += 1;
            if slot.lead {
                self.speed_sum += u64::from(slot.speed);
                self.speed_count += 1;
            }
        }
    }
}

fn kind_of(slot: &Slot) -> EventKind {
    match slot.state {
        State::Wrong => EventKind::Wrong,
        State::Pending => EventKind::Unsure,
        State::Matched if slot.repeat => EventKind::Repeat,
        State::Matched if slot.late => EventKind::Late,
        State::Matched => EventKind::Hit,
    }
}

/// Follows one performance, press by press.
#[derive(Debug, Clone)]
pub struct Follower {
    piece: Piece,
    labelled: bool,
    practise: Practise,
    in_play: usize,
    /// For each note, the press that holds it in the reported reading.
    owner: Vec<u32>,
    main: Track,
    alts: Vec<Track>,
    reported: Vec<Event>,
    committed: Totals,
    matched: Vec<bool>,
    hit: Vec<bool>,
    last_t: Option<u32>,
    gap: u32,
    count: u32,
    /// The last press at which a search was started by a match that strained the reading.
    last_strain_search: u32,
    work: u64,
}

impl Follower {
    /// Starts following a performance of `expected`, which need not be sorted.
    ///
    /// # Errors
    /// Returns [`FollowError`] when the piece is too long, a note is above 127 or
    /// the configuration is out of range.
    pub fn new(expected: &[Note], config: FollowConfig) -> Result<Self, FollowError> {
        Self::with_session(expected, &[], Session::default(), config)
    }

    /// As [`Follower::new`], with one hand label for each expected note (or none).
    /// Each labelled hand is followed as a line of its own.
    ///
    /// # Errors
    /// As [`Follower::new`]. Also when `hands` is neither empty nor as long as `expected`.
    pub fn with_hands(
        expected: &[Note],
        hands: &[Hand],
        config: FollowConfig,
    ) -> Result<Self, FollowError> {
        Self::with_session(expected, hands, Session::default(), config)
    }

    /// As [`Follower::with_hands`], with what the caller knows about the session:
    /// where the learner starts and which hands they chose to practise.
    ///
    /// # Errors
    /// As [`Follower::with_hands`]. Also when one hand is named for practice and
    /// the piece has no hand labels.
    #[allow(clippy::too_many_lines)]
    pub fn with_session(
        expected: &[Note],
        hands: &[Hand],
        session: Session,
        config: FollowConfig,
    ) -> Result<Self, FollowError> {
        if expected.len() > MAX_EXPECTED {
            return Err(FollowError::TooManyExpected {
                given: expected.len(),
            });
        }
        if !hands.is_empty() && hands.len() != expected.len() {
            return Err(FollowError::HandsLength {
                given: hands.len(),
                expected: expected.len(),
            });
        }
        validate(config)?;
        if let Some(i) = expected.iter().position(|n| n.note > 127) {
            return Err(FollowError::NoteOutOfRange {
                played: false,
                index: small(i),
                note: expected[i].note,
            });
        }
        let labelled = hands.iter().any(|&h| h != Hand::Unknown);
        if session.practise != Practise::Both && !labelled {
            return Err(FollowError::PractiseNeedsHands);
        }
        let mut order: Vec<u32> = (0..small(expected.len())).collect();
        order.sort_by_key(|&i| (expected[i as usize].t_ms, expected[i as usize].note, i));
        let in_play = |hand: Hand| match (session.practise, hand) {
            (Practise::Both, _) | (_, Hand::Unknown) => true,
            (Practise::Left, h) => h == Hand::Left,
            (Practise::Right, h) => h == Hand::Right,
        };
        let mut notes: Vec<PNote> = Vec::with_capacity(order.len());
        let mut play: Vec<bool> = Vec::with_capacity(order.len());
        let mut groups: Vec<Group> = Vec::new();
        for &orig in &order {
            let note = expected[orig as usize];
            let hand = hands.get(orig as usize).copied().unwrap_or_default();
            let open = groups.last().is_some_and(|g| {
                usize::from(g.len) < MAX_GROUP && note.t_ms - g.t <= config.chord_ms
            });
            if open {
                if let Some(g) = groups.last_mut() {
                    g.len += 1;
                }
            } else {
                groups.push(Group {
                    start: small(notes.len()),
                    len: 1,
                    t: note.t_ms,
                    rank: 0,
                    beat: 0,
                    play: false,
                });
            }
            let g = groups.len() - 1;
            groups[g].play |= in_play(hand);
            play.push(in_play(hand));
            notes.push(PNote {
                t: note.t_ms,
                pitch: note.note,
                line: hand as u8,
                play: in_play(hand),
                orig,
                group: small(g),
                beat: 0,
                step: 0,
                prev_same: NONE,
            });
        }
        // the local beat of each onset in play: the smaller gap to its neighbours
        let live: Vec<usize> = (0..groups.len()).filter(|&g| groups[g].play).collect();
        for (k, &g) in live.iter().enumerate() {
            let before = k.checked_sub(1).map(|j| groups[g].t - groups[live[j]].t);
            let after = live.get(k + 1).map(|&h| groups[h].t - groups[g].t);
            groups[g].beat = match (before, after) {
                (Some(b), Some(a)) => b.min(a),
                (b, a) => b.or(a).unwrap_or(1_000),
            };
            groups[g].rank = small(k);
        }
        let mut rank = 0;
        for g in &mut groups {
            if g.play {
                rank = g.rank;
            } else {
                g.rank = rank;
            }
        }
        // each note's step from the onset before it in its own line and the note of its pitch before it
        let mut last_onset: [Option<u32>; LINES] = [None; LINES];
        let mut line_group: [u32; LINES] = [NONE; LINES];
        let mut line_step: [u32; LINES] = [0; LINES];
        let mut first_of_line: [Vec<usize>; LINES] = [Vec::new(), Vec::new(), Vec::new()];
        let mut last_pitch = [NONE; 128];
        let mut by_pitch: Vec<Vec<u32>> = vec![Vec::new(); 128];
        let mut aside: Vec<Vec<u32>> = vec![Vec::new(); 128];
        for i in 0..notes.len() {
            if !play[i] {
                aside[usize::from(notes[i].pitch)].push(small(i));
                continue;
            }
            let line = usize::from(notes[i].line);
            let g = notes[i].group;
            let at = groups[g as usize].t;
            if line_group[line] != g {
                line_step[line] = last_onset[line].map_or(0, |b| at - b);
                last_onset[line] = Some(at);
                line_group[line] = g;
            }
            notes[i].beat = groups[g as usize].beat;
            notes[i].step = line_step[line];
            if notes[i].step == 0 {
                first_of_line[line].push(i);
            }
            let p = usize::from(notes[i].pitch);
            notes[i].prev_same = last_pitch[p];
            last_pitch[p] = small(i);
            by_pitch[p].push(small(i));
        }
        // a line's first onset has no step behind it: it takes the one ahead
        for (line, firsts) in first_of_line.iter().enumerate() {
            let ahead = notes
                .iter()
                .zip(&play)
                .find(|(n, &on)| on && usize::from(n.line) == line && n.step > 0)
                .map_or(500, |(n, _)| n.step);
            for &i in firsts {
                notes[i].step = ahead;
            }
        }
        let piece = Piece {
            config,
            notes,
            groups,
            by_pitch,
            aside,
        };
        let front = session.start_ms.map_or(0, i64::from);
        let main = Track::new(
            Clock::new(),
            front,
            piece.group_at(front),
            0,
            session.start_ms.is_some(),
        );
        Ok(Self {
            labelled,
            practise: session.practise,
            in_play: play.iter().filter(|&&p| p).count(),
            owner: vec![NONE; expected.len()],
            matched: vec![false; expected.len()],
            hit: vec![false; expected.len()],
            piece,
            main,
            alts: Vec::new(),
            reported: Vec::with_capacity(MAX_REREAD + 1),
            committed: Totals::default(),
            last_t: None,
            gap: 0,
            count: 0,
            last_strain_search: 0,
            work: 0,
        })
    }

    /// The tempo reached so far: 1 000 000 is the speed written in the piece.
    #[must_use]
    pub fn speed_ppm(&self) -> u32 {
        self.main.clock.speed_ppm()
    }

    /// The chord group the player has reached.
    #[must_use]
    pub fn position(&self) -> usize {
        self.main.front_group as usize
    }

    /// Units of work done so far: one for each note looked at and each press read
    /// again. For the tests that check the work per press has a ceiling.
    #[doc(hidden)]
    #[must_use]
    pub fn work(&self) -> u64 {
        self.work
    }

    /// Readings held, the reported one and those under test. For the test that
    /// checks the memory of a session has a ceiling.
    #[doc(hidden)]
    #[must_use]
    pub fn buffers(&self) -> usize {
        1 + self.alts.len()
    }

    /// Tells the follower that the learner goes on from the written time
    /// `to_ms`: they pressed Repeat or Next phrase or chose another bar. The
    /// next press is read from there. Notes already played may be played again
    /// and are then reported as repeats.
    pub fn jump_to(&mut self, to_ms: u32) {
        self.firm_before(self.count);
        self.alts.clear();
        let to = i64::from(to_ms);
        let left = self.main.front_group;
        let main = &mut self.main;
        main.clock.pause();
        main.front = to;
        main.front_group = self.piece.group_at(to);
        main.epoch = self.count;
        main.replay_from = to;
        main.told = true;
        main.fresh = true;
        main.paused = false;
        main.trouble = 0;
        main.since = CONFIRM;
        main.run = 0;
        main.missed = 0;
        main.leads = [NO_LEAD; LINES];
        main.jump_pending = left;
    }

    /// Takes the next press. Presses must arrive in time order.
    ///
    /// # Errors
    /// Returns [`FollowError::PlayedOutOfOrder`] when `note` is earlier than the
    /// previous press, [`FollowError::NoteOutOfRange`] for a note above 127 and
    /// [`FollowError::TooManyPlayed`] past [`MAX_PLAYED`]. A refused press changes nothing.
    pub fn push(&mut self, note: Note) -> Result<Update, FollowError> {
        if self.count as usize >= MAX_PLAYED {
            return Err(FollowError::TooManyPlayed);
        }
        if note.note > 127 {
            return Err(FollowError::NoteOutOfRange {
                played: true,
                index: self.count,
                note: note.note,
            });
        }
        if self.last_t.is_some_and(|last| note.t_ms < last) {
            return Err(FollowError::PlayedOutOfOrder { index: self.count });
        }
        let index = self.count;
        self.count += 1;
        if self.in_play == 0 {
            // no note is being practised, so no press can be one
            let event = Event {
                played_index: index,
                kind: EventKind::Wrong,
                expected_index: None,
                position: 0,
                error_ms: 0,
                speed_ppm: self.speed_ppm(),
                jumped_from: None,
            };
            self.committed.wrong += 1;
            self.main.first = self.count;
            self.last_t = Some(note.t_ms);
            return Ok(Update {
                event,
                revised: Vec::new(),
                settled: self.count,
            });
        }
        // a silence is a pause when it is long for the piece and long for the
        // player: twice the last gap between presses, so a hand playing long notes
        // alone keeps its clock
        let limit = self
            .piece
            .pause_after(&self.main)
            .max(2 * i64::from(self.gap));
        let paused = self
            .last_t
            .is_some_and(|last| i64::from(note.t_ms - last) > limit);
        self.gap = self.last_t.map_or(0, |last| note.t_ms - last);
        self.last_t = Some(note.t_ms);
        let mut work = 0;
        {
            let Self {
                piece,
                owner,
                main,
                alts,
                ..
            } = self;
            piece.step(main, Some(owner), &[], None, note, index, paused, &mut work);
            let base = Base {
                slots: &main.slots,
                first: main.first,
            };
            for alt in alts.iter_mut() {
                piece.step(alt, None, owner, Some(base), note, index, paused, &mut work);
            }
        }
        self.work += work + 1;
        let first = self.main.first;
        self.alts
            .retain(|a| a.missed < 2 && index - a.epoch < MAX_ALT_AGE && a.epoch >= first);
        if let Some(last) = self.main.slots.last().copied() {
            // a press that fits nothing starts a search at once. a match that strains
            // the reading starts one now and then, since a hand played alone or a
            // dropped note strains it all the time and means nothing
            let unmatched = last.state != State::Matched && !last.aside && !last.soon;
            if unmatched || (last.strain() && index - self.last_strain_search >= SEARCH_SPAN / 2) {
                if !unmatched {
                    self.last_strain_search = index;
                }
                self.search(index);
            }
        }
        self.adopt();
        if self.main.sure() && !self.rival() {
            self.harden();
        }
        let mut revised = Vec::new();
        let mut event = None;
        for (k, slot) in self.main.slots.iter().enumerate() {
            let e = self.event_of(slot);
            if k < self.reported.len() {
                if self.reported[k] != e {
                    self.reported[k] = e;
                    revised.push(e);
                }
            } else {
                self.reported.push(e);
                event = Some(e);
            }
        }
        // the oldest open press becomes final only after its last reading has
        // been sent, so what a view holds is what the summary counts
        if self.main.slots.len() > MAX_REREAD {
            self.settle();
        }
        Ok(Update {
            event: event.unwrap_or(Event {
                played_index: index,
                kind: EventKind::Unsure,
                expected_index: None,
                position: self.main.front_group,
                error_ms: 0,
                speed_ppm: self.speed_ppm(),
                jumped_from: None,
            }),
            revised,
            settled: self.main.first,
        })
    }

    fn event_of(&self, slot: &Slot) -> Event {
        let matched = slot.state == State::Matched;
        Event {
            played_index: slot.index,
            kind: kind_of(slot),
            expected_index: matched.then(|| self.piece.notes[slot.note as usize].orig),
            position: slot.position,
            error_ms: if matched { slot.err } else { 0 },
            speed_ppm: slot.speed,
            jumped_from: (slot.jumped_from != NONE).then_some(slot.jumped_from),
        }
    }

    /// Gives each pending press its verdict once the place is known on both
    /// sides of it: clean matches after it on two different keys and in every
    /// hand that is playing.
    fn harden(&mut self) {
        if !self
            .main
            .slots
            .iter()
            .any(|s| s.state == State::Pending && !s.firm)
        {
            return;
        }
        let mut playing = 0u8;
        for s in &self.main.slots {
            if s.state == State::Matched {
                playing |= 1 << self.piece.notes[s.note as usize].line;
            }
        }
        // walking back from the newest press: the hands heard from cleanly and the keys they played
        let mut heard = 0u8;
        let mut keys: [u8; 2] = [u8::MAX; 2];
        let mut ready: Vec<usize> = Vec::new();
        for k in (0..self.main.slots.len()).rev() {
            let slot = self.main.slots[k];
            self.work += 1;
            if slot.clean() {
                heard |= 1 << self.piece.notes[slot.note as usize].line;
                if keys[0] == u8::MAX {
                    keys[0] = slot.pitch;
                } else if keys[1] == u8::MAX && slot.pitch != keys[0] {
                    keys[1] = slot.pitch;
                }
            } else if slot.state == State::Pending
                && !slot.firm
                && keys[1] != u8::MAX
                && heard & playing == playing
            {
                ready.push(k);
            }
        }
        // oldest first, so that a key hammered on is followed from strike to strike
        for &k in ready.iter().rev() {
            if self.reclaim(k) {
                continue;
            }
            let slot = self.main.slots[k];
            let claims = self.piece.claims(&self.main, &self.owner, k);
            if claims.waiting {
                continue;
            }
            // the press before it was the same key, close before it and was itself
            // that key struck again (or its note): this one carries the hammering on
            let chained = k > 0 && {
                let before = &self.main.slots[k - 1];
                before.pitch == slot.pitch
                    && before.state != State::Pending
                    && i64::from(slot.t - before.t) * 5 < 4 * i64::from(self.piece.config.window_ms)
            };
            // wrong when the key belongs to no note near, when its note was played
            // in its place by a later press or when the key was struck again
            // straight after its note. unsure for good when a note it could have
            // meant was never played or was played a while before: the player may
            // have been going back over it
            // a press that was shown as a note is called wrong only when another
            // press now holds that note as its first playing: never on the word of
            // a press that is itself wrong or a note played again
            let displaced = slot.was == NONE
                || self.main.slots.iter().enumerate().any(|(j, other)| {
                    j != k
                        && other.state == State::Matched
                        && other.note == slot.was
                        && !other.repeat
                });
            if displaced
                && !claims.unclaimed
                && (!claims.any || claims.later || claims.again || chained)
            {
                self.main.slots[k].state = State::Wrong;
            } else {
                self.main.slots[k].firm = true;
            }
        }
    }

    /// A note belongs to the press that sits better among right notes. When the
    /// note a pending press could be is held by a press that stood among presses
    /// fitting nothing and this one stands among clean matches, they change places.
    fn reclaim(&mut self, k: usize) -> bool {
        let slot = self.main.slots[k];
        let company = |slots: &[Slot], i: usize| {
            let lo = i.saturating_sub(2);
            let hi = (i + 3).min(slots.len());
            (lo..hi).filter(|&j| j != i && slots[j].clean()).count()
        };
        let mine = company(&self.main.slots, k);
        let mut best: Option<(usize, usize)> = None;
        for (j, other) in self.main.slots.iter().enumerate() {
            if j == k
                || other.state != State::Matched
                || other.pitch != slot.pitch
                || other.repeat
                || other.index < self.main.epoch
            {
                continue;
            }
            // the note must lie where this press fell: between the place then and
            // where the clock put the press, give or take a beat
            let note = &self.piece.notes[other.note as usize];
            let s = i64::from(note.t);
            let beat = i64::from(note.beat);
            if j > k || s < slot.s_lo - beat || s > slot.s_hi + beat {
                continue;
            }
            // only from a press that stood alone among presses fitting nothing
            let theirs = company(&self.main.slots, j);
            if theirs == 0 && mine >= 2 && best.is_none() {
                best = Some((theirs, j));
            }
        }
        let Some((_, j)) = best else {
            return false;
        };
        let taken = self.main.slots[j];
        let mine = &mut self.main.slots[k];
        mine.state = State::Matched;
        mine.note = taken.note;
        if mine.was == NONE {
            mine.was = taken.note;
        }
        mine.prev_owner = taken.prev_owner;
        mine.repeat = false;
        mine.err = 0;
        mine.judged = false;
        mine.lead = false;
        mine.late = false;
        mine.off = false;
        mine.passed = true;
        mine.shaky = false;
        mine.holes = 0;
        self.owner[taken.note as usize] = mine.index;
        let theirs = &mut self.main.slots[j];
        theirs.state = State::Pending;
        theirs.note = NONE;
        theirs.err = 0;
        theirs.firm = false;
        true
    }

    /// Leaves every pending press before `upto` unsure for good: the reading
    /// that would have judged it has just been found to be in the wrong place.
    fn firm_before(&mut self, upto: u32) {
        for slot in &mut self.main.slots {
            if slot.state == State::Pending && slot.index < upto {
                slot.firm = true;
            }
        }
    }

    /// Makes the oldest open press final.
    fn settle(&mut self) {
        let slot = self.main.slots.remove(0);
        self.main.first += 1;
        if !self.reported.is_empty() {
            self.reported.remove(0);
        }
        self.committed.add(&slot);
        if slot.state == State::Matched && !slot.repeat {
            let orig = self.piece.notes[slot.note as usize].orig as usize;
            self.matched[orig] = true;
            self.hit[orig] = !slot.late;
        }
    }

    /// Looks for another place when presses have stopped fitting the one the
    /// reading has. Each candidate becomes a reading under test, replayed from
    /// the first press that fits it.
    #[allow(clippy::too_many_lines)]
    fn search(&mut self, index: u32) {
        // one press that does not fit is enough to look: where the music of two
        // places is the same in one hand, a single note of the other hand is all
        // that tells them apart and the place found is only adopted on more evidence
        let need = 1;
        let lo = self.main.first.max((index + 1).saturating_sub(SEARCH_SPAN));
        let from = (lo - self.main.first) as usize;
        let seq: Vec<Slot> = self.main.slots[from..].to_vec();
        let loose = seq.iter().filter(|s| s.strain()).count();
        if small(loose) < need {
            return;
        }
        // a reading already under test that explains every press since it began needs no rival
        if self
            .alts
            .iter()
            .any(|a| a.epoch <= lo && a.hits as usize >= a.slots.len())
        {
            return;
        }
        let piece = &self.piece;
        // the pivot is the rarest pitch among the presses that fitted nothing, so the list of places is short
        let Some(pivot) = (0..seq.len())
            .rev()
            .filter(|&i| seq[i].strain() && !piece.by_pitch[usize::from(seq[i].pitch)].is_empty())
            .min_by_key(|&i| piece.by_pitch[usize::from(seq[i].pitch)].len())
        else {
            return;
        };
        let places = &piece.by_pitch[usize::from(seq[pivot].pitch)];
        // a restart from where the session began first, then the places nearest the present one
        let mut order: Vec<u32> = Vec::new();
        let top = self.main.replay_from.min(self.main.front);
        let top_from = places.partition_point(|&n| i64::from(piece.notes[n as usize].t) < top);
        let split =
            places.partition_point(|&n| i64::from(piece.notes[n as usize].t) < self.main.front);
        for &n in places[top_from..].iter().take(4) {
            order.push(n);
        }
        let top_count = order.len();
        let (mut below, mut above) = (split, split);
        while order.len() < MAX_SEARCH && (below > 0 || above < places.len()) {
            let lower = below.checked_sub(1).map(|i| places[i]);
            let upper = places.get(above).copied();
            let dist = |n: u32| (i64::from(piece.notes[n as usize].t) - self.main.front).abs();
            let n = match (lower, upper) {
                (Some(l), Some(u)) if dist(l) <= dist(u) => {
                    below -= 1;
                    l
                }
                (_, Some(u)) => {
                    above += 1;
                    u
                }
                (Some(l), None) => {
                    below -= 1;
                    l
                }
                (None, None) => break,
            };
            if !order[..order.len().min(4)].contains(&n) {
                order.push(n);
            }
        }
        // a cheap check of each place: how many of the presses are found around it,
        // in order and about as far apart in the score as they were in time
        let period = self.main.clock.period;
        let mut work = 0;
        // a place is replayed from the first press that fits it and, when that
        // reaches back over presses the reading was happy with, also from the
        // first press that strained the reading
        let mut first_strain = seq.iter().position(Slot::strain).unwrap_or(0);
        // presses struck together with it belong to the same moment
        let together = seq[first_strain]
            .t
            .saturating_sub(2 * self.piece.config.chord_ms);
        while first_strain > 0 && seq[first_strain - 1].t >= together {
            first_strain -= 1;
        }
        let mut scored: Vec<Placed> = Vec::new();
        let mut used: Vec<u32> = Vec::with_capacity(seq.len());
        for &c in &order {
            let rank = (i64::from(piece.notes[c as usize].t) - self.main.front).abs();
            let mut found = 1;
            used.clear();
            used.push(c);
            let mut s = i64::from(piece.notes[c as usize].t);
            let mut t = i64::from(seq[pivot].t);
            for p in &seq[pivot + 1..] {
                let ds = (i64::from(p.t) - t) * UNIT / period;
                if let Some(n) =
                    piece.nearest(p.pitch, s, s + 2 * ds + 500, s + ds, &used, &mut work)
                {
                    found += 1;
                    used.push(n);
                    s = i64::from(piece.notes[n as usize].t);
                    t = i64::from(p.t);
                }
            }
            let mut s = i64::from(piece.notes[c as usize].t);
            let mut t = i64::from(seq[pivot].t);
            let mut entry = (pivot, c);
            let mut near = (pivot, c);
            let mut found_near = found;
            for (i, p) in seq[..pivot].iter().enumerate().rev() {
                let ds = (t - i64::from(p.t)) * UNIT / period;
                if let Some(n) =
                    piece.nearest(p.pitch, s - 2 * ds - 500, s, s - ds, &used, &mut work)
                {
                    found += 1;
                    used.push(n);
                    s = i64::from(piece.notes[n as usize].t);
                    t = i64::from(p.t);
                    entry = (i, n);
                    if i >= first_strain {
                        near = (i, n);
                        found_near = found;
                    }
                }
            }
            let fits =
                |found: usize, from: usize| found >= 2 && found * 3 >= (seq.len() - from) * 2;
            if fits(found, entry.0) {
                scored.push((found, rank, [entry, near]));
            } else if fits(found_near, near.0) {
                scored.push((found_near, rank, [near, near]));
            }
        }
        self.work += work + order.len() as u64;
        // the places that fit most presses, the nearest first: and the place the
        // session began at when it fits as well as any, since a restart is common
        let restart = scored
            .iter()
            .take(4.min(top_count))
            .max_by_key(|&&(found, rank, _)| (found, std::cmp::Reverse(rank)))
            .copied();
        scored.sort_by_key(|&(found, rank, _)| (std::cmp::Reverse(found), rank));
        let best = scored.first().map_or(0, |&(found, ..)| found);
        scored.truncate(MAX_REPLAYS);
        if let Some(r) = restart {
            if r.0 == best && !scored.iter().any(|x| x.2 == r.2) {
                scored.push(r);
            }
        }
        let mut entries: Vec<(usize, u32)> = Vec::new();
        for (_, _, [far, near]) in scored {
            entries.push(far);
            if near != far {
                entries.push(near);
            }
        }
        for (entry, note) in entries {
            let epoch = seq[entry].index;
            if self
                .alts
                .iter()
                .any(|a| a.epoch == epoch && a.entry_note == note)
            {
                continue;
            }
            let at = i64::from(self.piece.notes[note as usize].t);
            // a new place starts with the tempo the player had: it may not explain
            // presses by a tempo far from it
            let mut clock = self.main.clock;
            clock.pause();
            clock.has_held = false;
            clock.fastest = (clock.period * 3 / 4).max(PERIOD_MIN);
            clock.slowest = (clock.period * 2).min(PERIOD_MAX);
            let mut alt = Track::new(
                clock,
                at,
                self.piece.notes[note as usize].group,
                epoch,
                true,
            );
            alt.from_group = self.main.front_group;
            let mut work = 0;
            let base = Base {
                slots: &self.main.slots,
                first: self.main.first,
            };
            for (i, p) in seq[entry..].iter().enumerate() {
                let press = Note {
                    t_ms: p.t,
                    note: p.pitch,
                };
                self.piece.step(
                    &mut alt,
                    None,
                    &self.owner,
                    Some(base),
                    press,
                    p.index,
                    i > 0 && p.paused,
                    &mut work,
                );
            }
            self.work += work;
            if alt.slots.iter().filter(|s| s.solid()).count() < 2 || alt.entry_note != note {
                continue;
            }
            if self.alts.len() >= MAX_ALTS {
                // the place that leaves most presses unexplained goes first, then the one that explains fewest
                let rank = |a: &Track| (std::cmp::Reverse(a.slots.len() - a.hits as usize), a.hits);
                let Some(weak) = (0..self.alts.len()).min_by_key(|&i| rank(&self.alts[i])) else {
                    continue;
                };
                if rank(&self.alts[weak]) >= rank(&alt) {
                    continue;
                }
                self.alts.swap_remove(weak);
            }
            self.alts.push(alt);
        }
    }

    /// Drops places under test that have come to read the latest press exactly
    /// as the reported reading does without explaining more: they are the same
    /// reading. Returns whether a place that explains more is still under test.
    fn rival(&mut self) -> bool {
        let main = &self.main;
        let last = main.slots.last().map(|s| (s.state, s.note));
        let first = main.first;
        let echo_ms = self.piece.config.window_ms * 4 / 3;
        let mut any = false;
        self.alts.retain(|alt| {
            let from = (alt.epoch.max(first) - first) as usize;
            let mine: u32 = main.slots[from..].iter().map(Slot::worth).sum();
            let theirs = told_apart(&main.slots, from, &alt.slots, echo_ms);
            let same =
                alt.slots.last().map(|s| (s.state, s.note)) == last && alt.front == main.front;
            // from the same place on the two read alike, so one that is not ahead by
            // enough to be moved to never will be
            if same && theirs < mine + ADOPT_MARGIN {
                return false;
            }
            any |= theirs > mine;
            true
        });
        any
    }

    /// Moves the reported reading to a place under test once that place explains
    /// enough presses and enough more than the present one does.
    fn adopt(&mut self) {
        let need = u32::from(self.piece.config.relocate_after);
        let mut pick: Option<(u32, u32, usize)> = None;
        for (i, alt) in self.alts.iter().enumerate() {
            let from = (alt.epoch - self.main.first) as usize;
            let mine: u32 = self.main.slots[from..].iter().map(Slot::worth).sum();
            let echo_ms = self.piece.config.window_ms * 4 / 3;
            let theirs = told_apart(&self.main.slots, from, &alt.slots, echo_ms);
            // a press the present reading is happy with and the new one cannot place speaks against the move
            let demoted = small(
                self.main.slots[from..]
                    .iter()
                    .zip(&alt.slots)
                    .filter(|(m, a)| m.clean() && a.state != State::Matched)
                    .count(),
            );
            let gain = theirs.saturating_sub(mine + 2 * WORTH * demoted);
            // the evidence for a move: a run of presses in order and in time, with
            // nothing between them that the new place cannot explain
            let mut solid = 0u32;
            let mut run = 0u32;
            for slot in &alt.slots {
                run = if slot.solid() { run + 1 } else { 0 };
                solid = solid.max(run);
            }
            // one key played over and over fits many places: a move needs two keys
            let first_key = alt.slots.iter().find(|s| s.solid()).map(|s| s.pitch);
            let two_keys = alt
                .slots
                .iter()
                .any(|s| s.solid() && Some(s.pitch) != first_key);
            if solid >= need
                && two_keys
                && gain >= ADOPT_MARGIN
                && pick.is_none_or(|(best, epoch, _)| (gain, alt.epoch) > (best, epoch))
            {
                pick = Some((gain, alt.epoch, i));
            }
        }
        let pick = pick.map(|(_, _, i)| i);
        let Some(i) = pick else {
            return;
        };
        // the other places stay under test: where the music is the same for a
        // while, the one passed over may yet prove to be where the player is
        let mut alt = self.alts.swap_remove(i);
        let k = alt.epoch;
        let from = (k - self.main.first) as usize;
        let was_note: Vec<u32> = self.main.slots[from..].iter().map(|s| s.was).collect();
        // newest first: a note played twice since then goes back through both presses
        for slot in self.main.slots[from..].iter().rev() {
            if slot.state == State::Matched && self.owner[slot.note as usize] == slot.index {
                self.owner[slot.note as usize] = slot.prev_owner;
            }
        }
        self.main.slots.truncate(from);
        let entry = self.piece.notes[alt.entry_note as usize];
        let back = i64::from(entry.t) < self.main.front;
        let moved =
            entry.group < self.main.front_group || entry.group > self.main.front_group + JUMP_AHEAD;
        if moved {
            if let Some(slot) = alt.slots.iter_mut().find(|s| s.state == State::Matched) {
                slot.jumped_from = alt.from_group;
            }
        }
        if entry.group + 2 < self.main.front_group
            || entry.group > self.main.front_group + JUMP_AHEAD
        {
            // the presses left pending before a real move were read from the wrong place
            self.firm_before(k);
        }
        for slot in &mut alt.slots {
            // what a press was first shown as stays with it across the move
            slot.was = was_note
                .get((slot.index - k) as usize)
                .copied()
                .unwrap_or(NONE);
            if slot.state == State::Matched {
                slot.prev_owner = self.owner[slot.note as usize];
                slot.repeat = slot.prev_owner != NONE;
                self.owner[slot.note as usize] = slot.index;
                if slot.was == NONE {
                    slot.was = slot.note;
                }
            } else if slot.was != NONE {
                // a press that was a note where the player was before the move is
                // never turned wrong by the move: at worst the engine is no longer sure
                slot.state = State::Pending;
                slot.firm = true;
            }
        }
        let main = &mut self.main;
        main.slots.append(&mut alt.slots);
        main.clock = alt.clock;
        main.clock.fastest = PERIOD_MIN;
        main.clock.slowest = PERIOD_MAX;
        main.front = alt.front;
        main.front_group = alt.front_group;
        main.front_t = alt.front_t;
        main.run = alt.run;
        main.missed = alt.missed;
        main.paused = alt.paused;
        main.trouble = 0;
        main.since = CONFIRM;
        main.fresh = false;
        main.leads = alt.leads;
        if back {
            // the player went back: what they played before may be played again
            main.epoch = k;
            main.replay_from = alt.replay_from;
        }
    }

    /// Summarises everything pushed so far, reading the open presses as the
    /// follower reads them now.
    #[must_use]
    pub fn finish(&self) -> FollowScore {
        let mut totals = self.committed;
        let mut matched = self.matched.clone();
        let mut hit = self.hit.clone();
        for slot in &self.main.slots {
            totals.add(slot);
            if slot.state == State::Matched && !slot.repeat {
                let orig = self.piece.notes[slot.note as usize].orig as usize;
                matched[orig] = true;
                hit[orig] = !slot.late;
            }
        }
        let expected = self.piece.notes.len();
        let hits = count(totals.hits);
        let late = count(totals.late);
        let wrong = count(totals.wrong);
        let (hands, played_expected, played_hits) = self.hands_played(&matched, &hit, hits);
        FollowScore {
            expected,
            hits,
            late,
            misses: expected.saturating_sub(hits + late),
            wrong,
            repeats: count(totals.repeats),
            unsure: count(totals.unsure),
            accuracy: share(hits as u64, (expected + wrong) as u64),
            mean_timing_error_ms: (totals.error_count > 0)
                .then(|| ratio(totals.error_sum, totals.error_count)),
            final_speed_ppm: self.speed_ppm(),
            mean_speed_ppm: (totals.speed_count > 0)
                .then(|| u32::try_from(totals.speed_sum / totals.speed_count).unwrap_or(u32::MAX)),
            hands,
            played_expected,
            played_accuracy: share(played_hits as u64, (played_expected + wrong) as u64),
        }
    }

    /// Which hands were played. When the caller named the hand practised, that
    /// is the answer. Otherwise a labelled hand counts when at least a quarter of
    /// its notes within the stretch the player covered were matched. Returns the
    /// hands, the expected notes in them and the hits on those notes.
    fn hands_played(
        &self,
        matched: &[bool],
        hit: &[bool],
        hits: usize,
    ) -> (PlayedHands, usize, usize) {
        let notes = &self.piece.notes;
        let expected = notes.len();
        if !self.labelled {
            return (PlayedHands::Unknown, expected, hits);
        }
        let told = match self.practise {
            Practise::Left => Some(Hand::Left),
            Practise::Right => Some(Hand::Right),
            Practise::Both => None,
        };
        let one = if let Some(hand) = told {
            hand
        } else {
            let first = notes.iter().position(|n| matched[n.orig as usize]);
            let last = notes.iter().rposition(|n| matched[n.orig as usize]);
            let (Some(first), Some(last)) = (first, last) else {
                return (PlayedHands::Neither, expected, hits);
            };
            let (from, to) = (notes[first].group, notes[last].group);
            let mut span = [0usize; LINES];
            let mut got = [0usize; LINES];
            for n in notes.iter().filter(|n| n.group >= from && n.group <= to) {
                span[usize::from(n.line)] += 1;
                got[usize::from(n.line)] += usize::from(matched[n.orig as usize]);
            }
            let plays = |h: Hand| span[h as usize] > 0 && got[h as usize] * 4 >= span[h as usize];
            match (plays(Hand::Left), plays(Hand::Right)) {
                (true, true) => return (PlayedHands::Both, expected, hits),
                (true, false) => Hand::Left,
                (false, true) => Hand::Right,
                (false, false) => return (PlayedHands::Neither, expected, hits),
            }
        };
        let mine = |n: &&PNote| usize::from(n.line) == one as usize || n.line == 0;
        let played_expected = if told.is_some() {
            self.in_play
        } else {
            notes.iter().filter(mine).count()
        };
        let played_hits = notes
            .iter()
            .filter(mine)
            .filter(|n| hit[n.orig as usize] && matched[n.orig as usize])
            .count();
        let hands = if one == Hand::Left {
            PlayedHands::Left
        } else {
            PlayedHands::Right
        };
        (hands, played_expected, played_hits)
    }
}

/// What a reading under test is worth against the reported one from press
/// `from` on. A key struck again straight after its note (or after another
/// such strike) is a slip made in place: where the music of two places is the
/// same it fits the other place as well and it says nothing about which of
/// them the player is at. Such presses count for nothing.
fn told_apart(main: &[Slot], from: usize, alt: &[Slot], echo_ms: u32) -> u32 {
    let mut echo = [false; ECHO_BACK];
    let mut total = 0;
    for (k, slot) in main.iter().enumerate().skip(from.saturating_sub(ECHO_BACK)) {
        let mut again = false;
        if slot.state != State::Matched {
            for back in 1..=ECHO_BACK.min(k) {
                let before = &main[k - back];
                if before.pitch == slot.pitch
                    && slot.t - before.t <= echo_ms
                    && (before.state == State::Matched || echo[(k - back) % ECHO_BACK])
                {
                    again = true;
                    break;
                }
            }
        }
        echo[k % ECHO_BACK] = again;
        if k >= from && !again {
            total += alt.get(k - from).map_or(0, Slot::worth);
        }
    }
    total
}

fn speed_of(period: i64) -> u32 {
    u32::try_from(UNIT * UNIT / period.max(1)).unwrap_or(u32::MAX)
}

fn validate(config: FollowConfig) -> Result<(), FollowError> {
    if !(1..=MAX_WINDOW_MS).contains(&config.window_ms) {
        return Err(FollowError::BadConfig("window_ms must be from 1 to 10000"));
    }
    if !(4..=256).contains(&config.band) {
        return Err(FollowError::BadConfig("band must be from 4 to 256"));
    }
    if config.pause_ms < 500 {
        return Err(FollowError::BadConfig("pause_ms must be at least 500"));
    }
    if config.chord_ms > 1_000 {
        return Err(FollowError::BadConfig("chord_ms must be at most 1000"));
    }
    if !(2..=MAX_RELOCATE_U8).contains(&config.relocate_after) {
        return Err(FollowError::BadConfig("relocate_after must be from 2 to 8"));
    }
    Ok(())
}

/// Converts a count that the engine's limits keep far below `u32::MAX`.
fn small(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

fn clamp32(v: i64) -> i32 {
    i32::try_from(v.clamp(i64::from(i32::MIN), i64::from(i32::MAX))).unwrap_or(0)
}

/// Converts a count that the limits keep below `MAX_PLAYED`.
fn count(n: u64) -> usize {
    usize::try_from(n).unwrap_or(usize::MAX)
}

/// A ratio of two counts, 1 when there is nothing to count.
fn share(numerator: u64, denominator: u64) -> f32 {
    if denominator == 0 {
        1.0
    } else {
        ratio(numerator, denominator)
    }
}

#[allow(clippy::cast_precision_loss)]
fn ratio(numerator: u64, denominator: u64) -> f32 {
    // both values are below 2^24 under the engine's limits, so each converts
    // exactly and the one division is correctly rounded on every target
    numerator as f32 / denominator as f32
}

/// Follows a whole recorded performance and returns the final alignment of every press.
///
/// Events changed by a later press are replaced in the list, so the result
/// holds exactly one event for each press.
///
/// # Errors
/// Returns [`FollowError`] for a bad configuration, a piece that is too long,
/// a note above 127, too many presses or presses out of time order.
pub fn follow(
    expected: &[Note],
    played: &[Note],
    config: FollowConfig,
) -> Result<(Vec<Event>, FollowScore), FollowError> {
    follow_session(expected, &[], played, Session::default(), &[], config)
}

/// As [`follow`], with one hand label for each expected note (or none).
///
/// # Errors
/// As [`follow`]. Also when `hands` is neither empty nor as long as `expected`.
pub fn follow_with_hands(
    expected: &[Note],
    hands: &[Hand],
    played: &[Note],
    config: FollowConfig,
) -> Result<(Vec<Event>, FollowScore), FollowError> {
    follow_session(expected, hands, played, Session::default(), &[], config)
}

/// As [`follow_with_hands`], with what the caller knows: the session's start
/// and hands and each stated jump as a pair of the index of the press it comes
/// before and the written time the learner goes on from.
///
/// # Errors
/// As [`follow_with_hands`]. Also [`FollowError::PractiseNeedsHands`] and
/// [`FollowError::BadJump`] for a jump past the last press or out of order.
pub fn follow_session(
    expected: &[Note],
    hands: &[Hand],
    played: &[Note],
    session: Session,
    jumps: &[(u32, u32)],
    config: FollowConfig,
) -> Result<(Vec<Event>, FollowScore), FollowError> {
    if played.len() > MAX_PLAYED {
        return Err(FollowError::TooManyPlayed);
    }
    for (i, &(at, _)) in jumps.iter().enumerate() {
        if at as usize > played.len() || (i > 0 && jumps[i - 1].0 > at) {
            return Err(FollowError::BadJump { index: small(i) });
        }
    }
    let mut follower = Follower::with_session(expected, hands, session, config)?;
    let mut events: Vec<Event> = Vec::with_capacity(played.len());
    let mut next = 0;
    for (i, &note) in played.iter().enumerate() {
        while jumps.get(next).is_some_and(|j| j.0 as usize == i) {
            follower.jump_to(jumps[next].1);
            next += 1;
        }
        let update = follower.push(note)?;
        for revised in update.revised {
            events[revised.played_index as usize] = revised;
        }
        events.push(update.event);
    }
    Ok((events, follower.finish()))
}

#[cfg(test)]
// test data is small, so the numeric casts cannot lose anything
#[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
mod tests {
    use super::*;

    fn notes(pairs: &[(u32, u8)]) -> Vec<Note> {
        pairs
            .iter()
            .map(|&(t_ms, note)| Note { t_ms, note })
            .collect()
    }

    fn run(expected: &[(u32, u8)], played: &[(u32, u8)]) -> (Vec<Event>, FollowScore) {
        follow(&notes(expected), &notes(played), FollowConfig::default()).unwrap()
    }

    /// A varied line: no two neighbours equal and no pitch again within four notes.
    fn line(count: u32, gap: u32) -> Vec<(u32, u8)> {
        (0..count)
            .map(|i| (i * gap, 50 + ((i * 7 + (i / 5) * 3) % 29) as u8))
            .collect()
    }

    fn kinds(events: &[Event]) -> String {
        events
            .iter()
            .map(|e| match e.kind {
                EventKind::Hit => 'H',
                EventKind::Wrong => 'W',
                EventKind::Late => 'L',
                EventKind::Repeat => 'R',
                EventKind::Unsure => 'U',
            })
            .collect()
    }

    /// A tune in the right hand over a bass in the left, with hand labels.
    fn two_hands(bars: u32) -> (Vec<Note>, Vec<Hand>) {
        let mut piece = Vec::new();
        let mut hands = Vec::new();
        for i in 0..bars * 4 {
            piece.push(Note {
                t_ms: i * 500,
                note: 72 + ((i * 5 + i / 3) % 11) as u8,
            });
            hands.push(Hand::Right);
            for k in 0..2 {
                piece.push(Note {
                    t_ms: i * 500 + k * 250,
                    note: 43 + ((i * 3 + k * 4) % 9) as u8,
                });
                hands.push(Hand::Left);
            }
        }
        (piece, hands)
    }

    fn shifted(piece: &[Note], by: u32) -> Vec<Note> {
        let mut out: Vec<Note> = piece
            .iter()
            .map(|n| Note {
                t_ms: n.t_ms + by,
                note: n.note,
            })
            .collect();
        out.sort_by_key(|n| (n.t_ms, n.note));
        out
    }

    #[test]
    fn exact_performance_is_all_hits_at_written_speed() {
        let piece = line(20, 500);
        let (events, score) = run(&piece, &piece);
        assert_eq!(kinds(&events), "H".repeat(20));
        assert_eq!((score.hits, score.wrong, score.unsure), (20, 0, 0));
        assert_eq!(score.final_speed_ppm, 1_000_000);
        assert_eq!(score.mean_timing_error_ms, Some(0.0));
    }

    #[test]
    fn steady_slow_playing_is_not_late() {
        let piece = line(24, 400);
        let slow: Vec<(u32, u8)> = piece.iter().map(|&(t, n)| (t * 5 / 3 + 300, n)).collect();
        let (_, score) = run(&piece, &slow);
        assert_eq!(
            (score.hits, score.late, score.wrong, score.unsure),
            (24, 0, 0, 0)
        );
        assert!(score.final_speed_ppm.abs_diff(600_000) < 20_000);
    }

    #[test]
    fn a_wrong_key_in_step_is_wrong_at_once_and_a_skipped_note_is_a_miss() {
        let piece = notes(&line(12, 500));
        let mut played = piece.clone();
        played[4].note = 95;
        played.remove(8);
        let mut follower = Follower::new(&piece, FollowConfig::default()).unwrap();
        for (i, &p) in played.iter().enumerate() {
            let update = follower.push(p).unwrap();
            let want = if i == 4 {
                EventKind::Wrong
            } else {
                EventKind::Hit
            };
            assert_eq!(update.event.kind, want, "press {i} as first reported");
        }
        let score = follower.finish();
        assert_eq!((score.hits, score.wrong, score.misses), (10, 1, 2));
    }

    #[test]
    fn a_stray_key_that_could_be_a_note_never_played_is_left_unsure_not_wrong() {
        // the key of the note two ahead, struck in the slot of the note before it
        // and that note then left out: nobody can say the press was not meant for it
        let piece = notes(&line(16, 500));
        let mut played = piece.clone();
        played[6].note = piece[8].note;
        played.remove(8);
        let (events, score) = follow(&piece, &played, FollowConfig::default()).unwrap();
        assert_eq!(events[6].kind, EventKind::Unsure, "{}", kinds(&events));
        assert_eq!(score.wrong, 0);
        assert_eq!(score.unsure, 1);
        // unsure counts neither for nor against: accuracy is hits over notes plus wrong presses
        assert!((score.accuracy - score.hits as f32 / 16.0).abs() < f32::EPSILON);
    }

    #[test]
    fn a_key_struck_again_is_wrong_once_its_note_is_played_in_place() {
        // the same slip, but the note is then played where it belongs: the stray
        // press was an extra key and the engine says so
        let piece = notes(&line(16, 500));
        let mut played = piece.clone();
        played[6].note = piece[8].note;
        let (events, score) = follow(&piece, &played, FollowConfig::default()).unwrap();
        assert_eq!(events[6].kind, EventKind::Wrong, "{}", kinds(&events));
        assert_eq!(events[8].kind, EventKind::Hit);
        assert_eq!((score.wrong, score.unsure), (1, 0));
    }

    #[test]
    fn hands_a_little_apart_over_a_repeated_bass_are_all_right() {
        // regression: the left hand 110 ms behind over a repeated G gave
        // 8 wrong presses and 15 misses, because the late bass note read as the next one
        let mut piece = Vec::new();
        let mut hands = Vec::new();
        for i in 0..32u32 {
            piece.push(Note {
                t_ms: i * 250,
                note: 43,
            });
            hands.push(Hand::Left);
        }
        let tune = [
            71u8, 72, 74, 72, 71, 71, 69, 69, 67, 69, 71, 72, 74, 74, 74, 74,
        ];
        for (i, &p) in tune.iter().enumerate() {
            piece.push(Note {
                t_ms: i as u32 * 500,
                note: p,
            });
            hands.push(Hand::Right);
        }
        for lag in [60u32, 110, 150, 200] {
            let mut played: Vec<Note> = piece
                .iter()
                .zip(&hands)
                .map(|(n, &h)| Note {
                    t_ms: n.t_ms + 300 + if h == Hand::Left { lag } else { 0 },
                    note: n.note,
                })
                .collect();
            played.sort_by_key(|n| (n.t_ms, n.note));
            let (_, score) =
                follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
            assert_eq!(score.wrong, 0, "lag {lag}");
            assert!(score.hits + score.late >= 47, "lag {lag}: {score:?}");
        }
    }

    #[test]
    fn a_start_from_a_later_bar_is_found_and_never_called_wrong() {
        // regression: the first press of a start from a later bar was wrong for good
        let (piece, hands) = two_hands(8);
        let from = 5 * 2_000;
        let part: Vec<Note> = piece.iter().filter(|n| n.t_ms >= from).copied().collect();
        let played: Vec<Note> = shifted(&part, 300)
            .iter()
            .map(|n| Note {
                t_ms: n.t_ms - from,
                note: n.note,
            })
            .collect();
        let config = FollowConfig::default();
        // not told: nothing is wrong at any moment and every press ends as a hit
        let mut follower = Follower::with_hands(&piece, &hands, config).unwrap();
        let mut view: Vec<Event> = Vec::new();
        for &p in &played {
            let update = follower.push(p).unwrap();
            assert_ne!(update.event.kind, EventKind::Wrong);
            for r in update.revised {
                assert_ne!(r.kind, EventKind::Wrong);
                view[r.played_index as usize] = r;
            }
            view.push(update.event);
        }
        assert!(
            view.iter().all(|e| e.kind == EventKind::Hit),
            "{}",
            kinds(&view)
        );
        // told: the first press is a hit as it is reported
        let session = Session {
            start_ms: Some(from),
            ..Session::default()
        };
        let mut follower = Follower::with_session(&piece, &hands, session, config).unwrap();
        for &p in &played {
            assert_eq!(follower.push(p).unwrap().event.kind, EventKind::Hit);
        }
    }

    #[test]
    fn a_held_back_note_whose_pitch_comes_again_does_not_turn_the_next_one_wrong() {
        // regression: 69 72 76 over 45 52 in a 600 ms beat. the 69 of one
        // beat is held back 500 ms and lands just before the 69 of the next beat
        let mut piece = Vec::new();
        let mut hands = Vec::new();
        for b in 0..8u32 {
            for (k, p) in [69u8, 72, 76].into_iter().enumerate() {
                piece.push(Note {
                    t_ms: b * 600 + k as u32 * 200,
                    note: p,
                });
                hands.push(Hand::Right);
            }
            for (k, p) in [45u8, 52].into_iter().enumerate() {
                piece.push(Note {
                    t_ms: b * 600 + k as u32 * 300,
                    note: p,
                });
                hands.push(Hand::Left);
            }
        }
        for late in [300u32, 500, 550] {
            let mut played: Vec<Note> = piece
                .iter()
                .map(|n| Note {
                    t_ms: n.t_ms
                        + 300
                        + if (n.t_ms, n.note) == (2_400, 69) {
                            late
                        } else {
                            0
                        },
                    note: n.note,
                })
                .collect();
            played.sort_by_key(|n| (n.t_ms, n.note));
            let (events, score) =
                follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
            let kind_at = |t: u32| {
                played
                    .iter()
                    .zip(&events)
                    .find(|(p, _)| p.t_ms == t && p.note == 69)
                    .map(|(_, e)| e.kind)
            };
            assert_eq!(kind_at(2_700 + late), Some(EventKind::Late), "{late} late");
            assert_eq!(kind_at(3_300), Some(EventKind::Hit), "{late} late");
            assert_eq!((score.wrong, score.unsure), (0, 0), "{late} late");
        }
    }

    #[test]
    fn extra_strikes_of_a_key_the_score_repeats_are_wrong_and_steal_no_note() {
        // regression: extra strikes of a pedal note were credited as its next notes
        let mut piece = Vec::new();
        let mut hands = Vec::new();
        for i in 0..40u32 {
            piece.push(Note {
                t_ms: i * 250,
                note: 43,
            });
            hands.push(Hand::Left);
            if i % 2 == 0 {
                piece.push(Note {
                    t_ms: i * 250,
                    note: 67 + ((i * 3) % 10) as u8,
                });
                hands.push(Hand::Right);
            }
        }
        for extra in [4u32, 6] {
            let mut played = shifted(&piece, 300);
            for j in 1..=extra {
                played.push(Note {
                    t_ms: 300 + 20 * 250 + 70 * j,
                    note: 43,
                });
            }
            played.sort_by_key(|n| (n.t_ms, n.note));
            let (_, score) =
                follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
            assert_eq!(
                score.hits + score.late,
                piece.len(),
                "{extra} extra: {score:?}"
            );
            assert_eq!(score.wrong as u32, extra, "{extra} extra: {score:?}");
        }
    }

    #[test]
    fn the_hand_named_for_practice_is_the_only_one_matched() {
        // regression: in one-hand practice a slip on to a key of the other
        // hand's part was excused. told which hand is practised, it is wrong
        let (piece, hands) = two_hands(6);
        let right: Vec<Note> = piece
            .iter()
            .zip(&hands)
            .filter(|(_, &h)| h == Hand::Right)
            .map(|(n, _)| *n)
            .collect();
        let mut played = shifted(&right, 300);
        // the left hand's key of the same moment in place of the tune note
        let slip = piece
            .iter()
            .zip(&hands)
            .find(|(n, &h)| h == Hand::Left && n.t_ms == right[9].t_ms)
            .map(|(n, _)| n.note)
            .unwrap();
        played[9].note = slip;
        let session = Session {
            practise: Practise::Right,
            ..Session::default()
        };
        let config = FollowConfig::default();
        let (events, score) =
            follow_session(&piece, &hands, &played, session, &[], config).unwrap();
        // the key is the other hand's note at that place: it is not credited and not
        // called wrong, since the learner may be playing that hand too
        assert_eq!(events[9].kind, EventKind::Unsure);
        assert_eq!(events[9].expected_index, None);
        assert_eq!(
            (score.wrong, score.unsure, score.hands),
            (0, 1, PlayedHands::Right)
        );
        assert_eq!(score.played_expected, right.len());
        assert_eq!(score.hits, right.len() - 1);
        // a key that belongs to neither hand there is wrong
        let mut stray = played.clone();
        stray[9].note = 99;
        let (events, _) = follow_session(&piece, &hands, &stray, session, &[], config).unwrap();
        assert_eq!(events[9].kind, EventKind::Wrong);
        // both hands played with the right hand named: every left-hand press is left
        // unjudged in the same way and the right hand is still followed in full
        let both = shifted(&piece, 300);
        let (events, score) = follow_session(&piece, &hands, &both, session, &[], config).unwrap();
        let unsure = events
            .iter()
            .filter(|e| e.kind == EventKind::Unsure)
            .count();
        assert_eq!(
            (score.hits, score.wrong, unsure),
            (right.len(), 0, piece.len() - right.len())
        );
        // not told, the slip is read as the left hand's note
        let (events, _) = follow_with_hands(&piece, &hands, &played, config).unwrap();
        assert!(matches!(events[9].kind, EventKind::Hit | EventKind::Late));
        // and naming a hand needs labels to tell the hands apart
        assert_eq!(
            Follower::with_session(&piece, &[], session, config).unwrap_err(),
            FollowError::PractiseNeedsHands
        );
    }

    #[test]
    fn the_window_is_a_quarter_of_the_gap_between_notes_with_a_floor() {
        // notes 1 400 ms apart: a quarter of the gap is 350 ms. notes 400 ms apart:
        // a quarter is 100 ms, so the floor of 150 ms applies
        for (gap, late, want) in [
            (1_400u32, 300u32, EventKind::Hit),
            (1_400, 420, EventKind::Late),
            (400, 120, EventKind::Hit),
            (400, 190, EventKind::Late),
        ] {
            let piece = line(16, gap);
            let mut played = piece.clone();
            played[9].0 += late;
            let (events, score) = run(&piece, &played);
            assert_eq!(events[9].kind, want, "gap {gap}, {late} late");
            assert_eq!(i64::from(events[9].error_ms), i64::from(late));
            assert_eq!(score.wrong, 0);
        }
        // and the window follows the tempo played: at half speed the same piece has twice the room
        let piece = line(16, 700);
        let mut played: Vec<(u32, u8)> = piece.iter().map(|&(t, n)| (2 * t, n)).collect();
        played[9].0 += 300;
        assert_eq!(run(&piece, &played).0[9].kind, EventKind::Hit);
        let mut played = piece.clone();
        played[9].0 += 300;
        assert_eq!(run(&piece, &played).0[9].kind, EventKind::Late);
    }

    #[test]
    fn rubato_in_slow_practice_is_not_late() {
        // regression: at half speed with the tempo moving 13 percent from
        // beat to beat, up to 62 percent of in-time notes were told late
        let piece = line(48, 450);
        let steps = [1_000u32, 885, 885, 1_000, 1_150, 1_150];
        let mut t = 300;
        let played: Vec<(u32, u8)> = piece
            .iter()
            .enumerate()
            .map(|(i, &(_, n))| {
                let at = t;
                t += 450 * 2 * steps[i % 6] / 1_000;
                (at, n)
            })
            .collect();
        let (events, score) = run(&piece, &played);
        assert_eq!(
            (score.late, score.wrong, score.unsure),
            (0, 0, 0),
            "{}",
            kinds(&events)
        );
    }

    #[test]
    fn one_hesitation_is_one_late_note_and_does_not_move_the_tempo() {
        let (piece, hands) = two_hands(8);
        let mut played: Vec<Note> = piece
            .iter()
            .map(|n| Note {
                t_ms: n.t_ms + 300 + if n.t_ms >= 8_000 { 600 } else { 0 },
                note: n.note,
            })
            .collect();
        played.sort_by_key(|n| (n.t_ms, n.note));
        let (events, score) =
            follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
        assert_eq!(score.wrong + score.unsure, 0);
        // both hands play the note after the hesitation together: one moment, one judgement
        assert_eq!(score.late, 2, "{}", kinds(&events));
        for e in &events {
            assert!(e.speed_ppm.abs_diff(1_000_000) < 30_000, "{e:?}");
        }
    }

    #[test]
    fn a_stated_jump_is_followed_and_replayed_notes_are_repeats() {
        let piece = notes(&line(24, 400));
        let mut follower = Follower::new(&piece, FollowConfig::default()).unwrap();
        for n in &piece[..12] {
            assert_eq!(follower.push(*n).unwrap().event.kind, EventKind::Hit);
        }
        // the learner presses Repeat: back to the note at 1 600 ms
        follower.jump_to(1_600);
        let mut t = piece[11].t_ms + 1_000;
        for (k, n) in piece[4..16].iter().enumerate() {
            let update = follower
                .push(Note {
                    t_ms: t,
                    note: n.note,
                })
                .unwrap();
            let want = if k < 8 {
                EventKind::Repeat
            } else {
                EventKind::Hit
            };
            assert_eq!(update.event.kind, want, "press {k} after the jump");
            assert_eq!(update.event.jumped_from.is_some(), k == 0);
            t += 400;
        }
        let score = follower.finish();
        assert_eq!((score.hits, score.repeats, score.wrong), (16, 8, 0));
        // the batch call takes the same jump as a pair of press index and written time
        let mut played = piece[..12].to_vec();
        played.extend(piece[4..16].iter().enumerate().map(|(k, n)| Note {
            t_ms: piece[11].t_ms + 1_000 + 400 * k as u32,
            note: n.note,
        }));
        let (_, batch) = follow_session(
            &piece,
            &[],
            &played,
            Session::default(),
            &[(12, 1_600)],
            FollowConfig::default(),
        )
        .unwrap();
        assert_eq!(batch, score);
        assert_eq!(
            follow_session(
                &piece,
                &[],
                &played,
                Session::default(),
                &[(99, 0)],
                FollowConfig::default()
            )
            .unwrap_err(),
            FollowError::BadJump { index: 0 }
        );
    }

    #[test]
    fn a_skipped_bar_is_found_without_being_told() {
        let (piece, hands) = two_hands(10);
        // bars 0 to 3, then straight on to bar 6 in rhythm
        let mut played: Vec<Note> = piece.iter().filter(|n| n.t_ms < 8_000).copied().collect();
        played.extend(piece.iter().filter(|n| n.t_ms >= 12_000).map(|n| Note {
            t_ms: n.t_ms - 4_000,
            note: n.note,
        }));
        let played = shifted(&played, 300);
        let (events, score) =
            follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
        assert_eq!(score.wrong, 0, "{}", kinds(&events));
        assert_eq!(score.hits + score.late, played.len(), "{}", kinds(&events));
        assert!(events.iter().any(|e| e.jumped_from.is_some()));
    }

    #[test]
    fn a_restart_from_the_top_reads_the_replayed_notes_as_repeats() {
        let piece = line(30, 400);
        for gap in [600u32, 6_000] {
            let mut played = piece[..15].to_vec();
            played.extend(piece.iter().map(|&(t, n)| (t + 14 * 400 + gap, n)));
            let (events, score) = run(&piece, &played);
            assert_eq!(
                kinds(&events),
                "H".repeat(15) + &"R".repeat(15) + &"H".repeat(15),
                "gap {gap}"
            );
            assert_eq!((score.hits, score.wrong, score.repeats), (30, 0, 15));
            assert_eq!(events[15].expected_index, Some(0));
        }
    }

    #[test]
    fn a_note_played_late_after_others_came_between_is_late_not_unsure() {
        // removing the reach back to the notes the reading has passed fails this test
        let (piece, hands) = two_hands(6);
        let target = piece
            .iter()
            .position(|n| n.t_ms == 5_000 && n.note >= 72)
            .unwrap();
        let mut played: Vec<Note> = piece
            .iter()
            .enumerate()
            .map(|(i, n)| Note {
                t_ms: n.t_ms + 300 + if i == target { 600 } else { 0 },
                note: n.note,
            })
            .collect();
        played.sort_by_key(|n| (n.t_ms, n.note));
        let (events, score) =
            follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
        let e = events
            .iter()
            .find(|e| e.expected_index == Some(target as u32))
            .unwrap();
        // two left-hand notes and the next tune note came before it
        assert_eq!((e.kind, e.error_ms), (EventKind::Late, 600));
        assert_eq!((score.wrong, score.unsure, score.misses), (0, 0, 0));
    }

    #[test]
    fn after_a_press_that_fitted_nothing_a_note_is_taken_only_in_time() {
        // letting a reading that has just lost the player take a note early fails this test
        let piece = notes(&line(16, 600));
        let early = |with_stray: bool| {
            let mut played: Vec<Note> = piece[..8].to_vec();
            if with_stray {
                played.push(Note {
                    t_ms: piece[7].t_ms + 150,
                    note: 99,
                });
            }
            // the next note 300 ms early: inside its usual allowance of three fifths of the step
            played.push(Note {
                t_ms: piece[8].t_ms - 300,
                note: piece[8].note,
            });
            let mut follower = Follower::new(&piece, FollowConfig::default()).unwrap();
            played
                .iter()
                .map(|&p| follower.push(p).unwrap().event.kind)
                .last()
                .unwrap()
        };
        assert_eq!(early(false), EventKind::Late);
        assert_eq!(early(true), EventKind::Unsure);
    }

    #[test]
    fn a_slow_piece_is_judged_for_timing_because_its_gaps_are_not_pauses() {
        // long notes and short ones in turn: a gap of 3 s after one of 600 ms. taking
        // every silence over 2.5 s for a pause fails this test, because each
        // long gap would start a new stretch and the notes after it would never be judged
        let mut t = 0;
        let piece: Vec<(u32, u8)> = (0..24u32)
            .map(|i| {
                let at = t;
                t += if i % 2 == 0 { 600 } else { 3_000 };
                (at, 50 + ((i * 7 + (i / 5) * 3) % 29) as u8)
            })
            .collect();
        let mut played = piece.clone();
        played[13].0 += 900;
        let (events, score) = run(&piece, &played);
        assert_eq!(
            (events[13].kind, events[13].error_ms),
            (EventKind::Late, 900)
        );
        assert_eq!((score.late, score.wrong, score.unsure), (1, 0, 0));
        // while a real stop of several such gaps is a pause: the note after it is not judged
        let mut played = piece.clone();
        for p in &mut played[13..] {
            p.0 += 9_500;
        }
        let (events, score) = run(&piece, &played);
        assert_eq!(events[13].kind, EventKind::Hit);
        assert_eq!((score.late, score.wrong), (0, 0));
    }

    #[test]
    fn hammering_one_key_counts_against_the_player() {
        let piece = notes(&line(30, 400));
        let mut played = piece[..10].to_vec();
        played.extend((1..=40u32).map(|k| Note {
            t_ms: piece[9].t_ms + 50 * k,
            note: piece[9].note,
        }));
        played.extend(piece[10..].iter().map(|n| Note {
            t_ms: n.t_ms + 2_100,
            note: n.note,
        }));
        let (_, score) = follow(&piece, &played, FollowConfig::default()).unwrap();
        assert_eq!(score.hits + score.late, 30);
        assert!(score.wrong >= 39, "{score:?}");
        assert!(score.accuracy < 0.45);
    }

    #[test]
    fn the_hands_played_are_reported() {
        let (piece, hands) = two_hands(6);
        let config = FollowConfig::default();
        let only = |hand: Hand| -> Vec<Note> {
            let part: Vec<Note> = piece
                .iter()
                .zip(&hands)
                .filter(|(_, &h)| h == hand)
                .map(|(n, _)| *n)
                .collect();
            shifted(&part, 300)
        };
        let (_, r) = follow_with_hands(&piece, &hands, &only(Hand::Right), config).unwrap();
        assert_eq!(
            (r.hands, r.played_expected, r.wrong),
            (PlayedHands::Right, 24, 0)
        );
        assert!((r.played_accuracy - 1.0).abs() < f32::EPSILON);
        assert!(r.accuracy < 0.5, "the whole piece was not played");
        let (_, l) = follow_with_hands(&piece, &hands, &only(Hand::Left), config).unwrap();
        assert_eq!(
            (l.hands, l.played_expected, l.hits),
            (PlayedHands::Left, 48, 48)
        );
        let (_, both) = follow_with_hands(&piece, &hands, &shifted(&piece, 300), config).unwrap();
        assert_eq!(both.hands, PlayedHands::Both);
        let (_, unknown) = follow(&piece, &only(Hand::Right), config).unwrap();
        assert_eq!(
            (unknown.hands, unknown.played_expected),
            (PlayedHands::Unknown, 72)
        );
    }

    /// Repeated two-note chords in the right hand every 250 ms over a left-hand
    /// note every 500 ms: every chord has the same keys as the next.
    fn repeated_chords(beats: u32) -> (Vec<Note>, Vec<Hand>) {
        let mut piece = Vec::new();
        let mut hands = Vec::new();
        for i in 0..beats * 2 {
            for note in [64u8, 67] {
                piece.push(Note {
                    t_ms: i * 250,
                    note,
                });
                hands.push(Hand::Right);
            }
            if i % 2 == 0 {
                piece.push(Note {
                    t_ms: i * 250,
                    note: 48 + ((i / 2) % 5) as u8,
                });
                hands.push(Hand::Left);
            }
        }
        (piece, hands)
    }

    /// Plays every note at `percent` of the written speed from 300 ms, the notes of a chord 3 ms apart.
    fn at_speed(piece: &[Note], percent: u32) -> Vec<Note> {
        let mut order: Vec<Note> = piece.to_vec();
        order.sort_by_key(|n| (n.t_ms, n.note));
        let mut last = 0;
        order
            .iter()
            .map(|n| {
                let t = (300 + n.t_ms * 100 / percent).max(last);
                last = t + 3;
                Note {
                    t_ms: t,
                    note: n.note,
                }
            })
            .collect()
    }

    #[test]
    fn the_place_is_not_sure_until_three_presses_have_matched() {
        // being sure after a single matched press fails this test: with the start
        // not stated, one press at the top is not yet proof of the place
        let piece = notes(&line(16, 500));
        let first_report = |before: usize| {
            let mut follower = Follower::new(&piece, FollowConfig::default()).unwrap();
            for n in &piece[..before] {
                follower.push(*n).unwrap();
            }
            let stray = Note {
                t_ms: piece[before].t_ms,
                note: 99,
            };
            follower.push(stray).unwrap().event.kind
        };
        assert_eq!(first_report(1), EventKind::Unsure);
        assert_eq!(first_report(2), EventKind::Unsure);
        assert_eq!(first_report(3), EventKind::Wrong);
        // a start the caller states is sure from the first press
        let session = Session {
            start_ms: Some(0),
            ..Session::default()
        };
        let mut follower =
            Follower::with_session(&piece, &[], session, FollowConfig::default()).unwrap();
        let stray = Note { t_ms: 0, note: 99 };
        assert_eq!(follower.push(stray).unwrap().event.kind, EventKind::Wrong);
    }

    #[test]
    fn a_press_takes_a_note_only_when_it_is_clearly_nearer() {
        // letting any nearer press take a note (no margin) fails this test and so
        // does never letting one: an early strike holds the note until a press at
        // least 20 ms nearer to its time arrives
        let piece: Vec<Note> = (0..16u32)
            .map(|i| Note {
                t_ms: i * 500,
                note: 60,
            })
            .collect();
        let holder_of_note_10 = |second_late: u32| {
            let mut played: Vec<Note> = piece[..10].to_vec();
            // the next note 100 ms early, then the same key again a little after its time
            played.push(Note {
                t_ms: 5_000 - 100,
                note: 60,
            });
            played.push(Note {
                t_ms: 5_000 + second_late,
                note: 60,
            });
            let (events, _) = follow(&piece, &played, FollowConfig::default()).unwrap();
            events
                .iter()
                .find(|e| e.expected_index == Some(10))
                .map(|e| e.played_index)
        };
        assert_eq!(
            holder_of_note_10(60),
            Some(11),
            "40 ms nearer: it takes the note"
        );
        assert_eq!(holder_of_note_10(90), Some(10), "10 ms nearer: not enough");
    }

    #[test]
    fn a_hesitation_in_the_first_interval_does_not_set_the_tempo() {
        // regression: 1 200 ms before the second onset set the tempo at two
        // fifths, the speed stuck at a quarter and 91 of 108 right notes were unsure
        let (piece, hands) = two_hands(12);
        for (before_onset, wait) in [(1u32, 1_200u32), (2, 1_200), (1, 400), (3, 2_000)] {
            let mut played: Vec<Note> = piece
                .iter()
                .map(|n| Note {
                    t_ms: n.t_ms
                        + 300
                        + if n.t_ms >= before_onset * 250 {
                            wait
                        } else {
                            0
                        },
                    note: n.note,
                })
                .collect();
            played.sort_by_key(|n| (n.t_ms, n.note));
            let (events, score) =
                follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
            assert_eq!(
                (score.wrong, score.unsure, score.hits + score.late),
                (0, 0, piece.len()),
                "{wait} ms before onset {before_onset}: {}",
                kinds(&events)
            );
            assert!(score.late <= 2, "{}", kinds(&events));
            assert!(score.final_speed_ppm.abs_diff(1_000_000) < 30_000);
        }
    }

    #[test]
    fn steady_repeated_chords_are_all_hits_at_any_speed() {
        // regression: at exactly half speed a chord's second note was read
        // as the same key of the next chord and the run scored 0.46
        let (piece, hands) = repeated_chords(16);
        for percent in (40..=200).step_by(5) {
            let played = at_speed(&piece, percent);
            let (events, score) =
                follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
            assert!(
                events.iter().all(|e| e.kind == EventKind::Hit),
                "{percent} percent: {}",
                kinds(&events)
            );
            assert!((score.accuracy - 1.0).abs() < f32::EPSILON);
            assert!(score.final_speed_ppm.abs_diff(percent * 10_000) <= percent * 500);
        }
    }

    #[test]
    fn a_key_struck_again_in_repeated_chords_does_not_take_the_next_note() {
        // regression: a second strike 115 ms after a chord was credited as
        // the next chord's note and the real one was then called wrong
        let (piece, hands) = repeated_chords(16);
        let mut played = at_speed(&piece, 100);
        for chord in [5u32, 9, 12] {
            played.push(Note {
                t_ms: 300 + chord * 250 + 115,
                note: 64,
            });
        }
        played.sort_by_key(|n| (n.t_ms, n.note));
        let (events, score) =
            follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
        assert_eq!(score.hits + score.late, piece.len(), "{}", kinds(&events));
        assert_eq!(
            score.wrong + score.unsure + score.repeats,
            3,
            "{}",
            kinds(&events)
        );
    }

    #[test]
    fn a_later_double_strike_does_not_turn_a_chord_note_wrong() {
        // regression: a chord note matched after two stray keys was shown
        // as a hit and a double strike of its key a second later took the note from
        // it and left it wrong
        let (piece, hands) = repeated_chords(12);
        let mut played = at_speed(&piece, 100);
        // two stray keys just before the chord at 2 000 ms, then 64 twice at 3 000 ms
        played.push(Note {
            t_ms: 300 + 2_000 - 20,
            note: 61,
        });
        played.push(Note {
            t_ms: 300 + 2_000 - 10,
            note: 66,
        });
        played.push(Note {
            t_ms: 300 + 3_000 + 12,
            note: 64,
        });
        played.sort_by_key(|n| (n.t_ms, n.note));
        let mut follower = Follower::with_hands(&piece, &hands, FollowConfig::default()).unwrap();
        let mut view: Vec<Event> = Vec::new();
        for &p in &played {
            let update = follower.push(p).unwrap();
            for r in update.revised {
                let was = view[r.played_index as usize].kind;
                assert!(
                    !(matches!(was, EventKind::Hit | EventKind::Late)
                        && r.kind == EventKind::Wrong),
                    "press {} went from a note to wrong",
                    r.played_index
                );
                view[r.played_index as usize] = r;
            }
            view.push(update.event);
        }
        let score = follower.finish();
        assert_eq!(score.hits + score.late, piece.len(), "{}", kinds(&view));
        assert!(score.wrong + score.unsure == 3, "{}", kinds(&view));
    }

    #[test]
    fn a_bar_at_half_speed_and_back_is_followed() {
        // regression: a hard bar taken at half speed left right notes
        // wrong when the tempo came back
        let (piece, hands) = two_hands(10);
        let mut t = 300;
        let mut last_s = 0;
        let mut order: Vec<(Note, Hand)> =
            piece.iter().copied().zip(hands.iter().copied()).collect();
        order.sort_by_key(|(n, _)| (n.t_ms, n.note));
        let played: Vec<Note> = order
            .iter()
            .map(|(n, _)| {
                let slow = (8_000..10_000).contains(&last_s);
                t += (n.t_ms - last_s) * if slow { 2 } else { 1 };
                last_s = n.t_ms;
                Note {
                    t_ms: t,
                    note: n.note,
                }
            })
            .collect();
        let (events, score) =
            follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
        assert_eq!(score.wrong, 0, "{}", kinds(&events));
        assert_eq!(score.unsure, 0, "{}", kinds(&events));
        assert_eq!(score.hits + score.late, piece.len());
        // the first onset of each change is out of time, as a hesitation would be.
        // the notes after it are heard at the pace of the interval just played
        assert!(score.late <= 6, "{}", kinds(&events));
    }

    #[test]
    fn hesitations_in_two_of_the_first_three_stretches_do_not_set_the_tempo() {
        // a hesitant child: notes 250 ms apart played at five eighths of
        // the speed, with a second added before the third and the seventh onset.
        // each stretch measured holds two intervals and the slow one is left out
        let piece = notes(&line(36, 250));
        let mut t = 300;
        let played: Vec<Note> = piece
            .iter()
            .enumerate()
            .map(|(i, n)| {
                if i > 0 {
                    t += 400
                        + if i == 2 || i == 6 || i == 20 {
                            1_000
                        } else {
                            0
                        };
                }
                Note {
                    t_ms: t,
                    note: n.note,
                }
            })
            .collect();
        let (events, score) = follow(&piece, &played, FollowConfig::default()).unwrap();
        assert_eq!((score.wrong, score.unsure), (0, 0), "{}", kinds(&events));
        assert_eq!(score.hits + score.late, piece.len());
        assert!(
            score.late <= 3,
            "one late note a hesitation at most: {}",
            kinds(&events)
        );
        assert!(
            score.final_speed_ppm.abs_diff(625_000) < 40_000,
            "{score:?}"
        );
        // the tempo is right from the first time it is used
        assert!(
            events[8..]
                .iter()
                .all(|e| e.speed_ppm.abs_diff(625_000) < 60_000),
            "{:?}",
            events
                .iter()
                .map(|e| e.speed_ppm / 1000)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_hesitation_seen_by_both_hands_is_counted_once() {
        // a tune every 300 ms over a bass note every 600 ms, with 1 200 ms added
        // before the second onset. the bass's first interval holds the same
        // hesitation as the tune's: averaged into the tune's next, clean, interval
        // it would make two slow measurements of three and halve the tempo
        let mut piece = Vec::new();
        let mut hands = Vec::new();
        for i in 0..24u32 {
            piece.push(Note {
                t_ms: i * 300,
                note: 60 + ((i * 7 + (i / 5) * 3) % 17) as u8,
            });
            hands.push(Hand::Right);
            if i % 2 == 0 {
                piece.push(Note {
                    t_ms: i * 300,
                    note: 36 + ((i / 2) % 7) as u8,
                });
                hands.push(Hand::Left);
            }
        }
        let played: Vec<Note> = piece
            .iter()
            .map(|n| Note {
                t_ms: n.t_ms + 300 + if n.t_ms >= 300 { 1_200 } else { 0 },
                note: n.note,
            })
            .collect();
        let (events, score) =
            follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
        assert_eq!(score.hits, piece.len(), "{}", kinds(&events));
        assert!(
            events
                .iter()
                .all(|e| e.speed_ppm.abs_diff(1_000_000) < 30_000),
            "{:?}",
            events
                .iter()
                .map(|e| e.speed_ppm / 1000)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn a_chord_struck_twice_does_not_move_the_reading_to_the_same_music_elsewhere() {
        // found with our own check set: a scale in thirds written twice over. one
        // chord struck a second time fitted the first time through as well as it
        // fitted nothing where the player was and every note after it was read
        // as a note played again
        let mut piece = Vec::new();
        for i in 0..48u32 {
            let d = [0u8, 2, 4, 5, 7, 9, 11, 12, 12, 11, 9, 7, 5, 4, 2, 0][(i % 16) as usize];
            piece.push(Note {
                t_ms: i * 300,
                note: 60 + d,
            });
            piece.push(Note {
                t_ms: i * 300,
                note: 64 + d,
            });
        }
        let mut played = shifted(&piece, 300);
        // the chord of the twenty-first onset again, 80 ms after it
        let again: Vec<Note> = played[40..42]
            .iter()
            .map(|n| Note {
                t_ms: n.t_ms + 80,
                note: n.note,
            })
            .collect();
        played.extend(again);
        played.sort_by_key(|n| (n.t_ms, n.note));
        let (events, score) = follow(&piece, &played, FollowConfig::default()).unwrap();
        assert_eq!(score.repeats, 0, "{}", kinds(&events));
        assert_eq!(score.hits, piece.len(), "{}", kinds(&events));
        assert_eq!(score.wrong + score.unsure, 2, "{}", kinds(&events));
    }

    #[test]
    fn config_and_notes_are_validated() {
        let bad = |c: FollowConfig| matches!(Follower::new(&[], c), Err(FollowError::BadConfig(_)));
        let d = FollowConfig::default();
        assert!(bad(FollowConfig { band: 3, ..d }));
        assert!(bad(FollowConfig { window_ms: 0, ..d }));
        assert!(bad(FollowConfig {
            window_ms: 10_001,
            ..d
        }));
        assert!(bad(FollowConfig {
            relocate_after: 9,
            ..d
        }));
        assert!(bad(FollowConfig { pause_ms: 499, ..d }));
        assert!(bad(FollowConfig {
            chord_ms: 1_001,
            ..d
        }));
        assert_eq!(
            Follower::new(&notes(&[(0, 128)]), d).unwrap_err(),
            FollowError::NoteOutOfRange {
                played: false,
                index: 0,
                note: 128
            }
        );
        let mut f = Follower::new(&notes(&[(0, 60)]), d).unwrap();
        assert_eq!(
            f.push(Note { t_ms: 0, note: 200 }).unwrap_err(),
            FollowError::NoteOutOfRange {
                played: true,
                index: 0,
                note: 200
            }
        );
        assert_eq!(
            Follower::with_hands(&notes(&[(0, 60)]), &[Hand::Left, Hand::Left], d).unwrap_err(),
            FollowError::HandsLength {
                given: 2,
                expected: 1
            }
        );
    }

    #[test]
    fn out_of_order_presses_are_refused_and_change_nothing() {
        let mut f = Follower::new(&notes(&[(0, 60), (500, 62)]), FollowConfig::default()).unwrap();
        f.push(Note {
            t_ms: 100,
            note: 60,
        })
        .unwrap();
        let before = f.finish();
        let err = f.push(Note { t_ms: 50, note: 60 }).unwrap_err();
        assert_eq!(err, FollowError::PlayedOutOfOrder { index: 1 });
        assert_eq!(f.finish(), before);
        let next = f
            .push(Note {
                t_ms: 600,
                note: 62,
            })
            .unwrap();
        assert_eq!(next.event.kind, EventKind::Hit);
    }

    #[test]
    fn the_session_bound_is_enforced() {
        let played = vec![Note { t_ms: 0, note: 60 }; MAX_PLAYED + 1];
        assert_eq!(
            follow(&[], &played, FollowConfig::default()).unwrap_err(),
            FollowError::TooManyPlayed
        );
    }

    #[test]
    fn an_empty_piece_counts_every_press_wrong() {
        let (events, score) = run(&[], &[(0, 60), (100, 62)]);
        assert_eq!(kinds(&events), "WW");
        assert_eq!((score.wrong, score.expected), (2, 0));
        assert_eq!(score.hands, PlayedHands::Unknown);
    }
}
