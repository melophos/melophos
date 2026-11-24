//! Scores a performance against the notes a song expects.

use crate::follow::{FollowError, MAX_EXPECTED, MAX_PLAYED};

/// A single key press: when it happened and which MIDI note it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Note {
    /// Milliseconds since the start of the passage.
    pub t_ms: u32,
    /// MIDI note number, middle C is 60.
    pub note: u8,
}

/// How strict scoring is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScoreConfig {
    /// A press counts as a hit only within this many milliseconds of the expected time.
    pub window_ms: u32,
}

impl Default for ScoreConfig {
    fn default() -> Self {
        Self { window_ms: 150 }
    }
}

/// The result of scoring one passage.
#[derive(Debug, Clone, PartialEq)]
pub struct Score {
    /// Notes the passage expected.
    pub expected: usize,
    /// Expected notes matched by a press of the right pitch in time.
    pub hits: usize,
    /// Expected notes with no matching press.
    pub misses: usize,
    /// Presses that matched no expected note.
    pub wrong: usize,
    /// Hits divided by expected notes plus wrong presses, from 0 to 1.
    pub accuracy: f32,
    /// Mean absolute timing error of the hits, `None` when there were no hits.
    pub mean_timing_error_ms: Option<f32>,
}

/// Matches each expected note, in the order given, with the closest unused press
/// of the same pitch inside the timing window, then counts what is left over as
/// misses and wrong notes. Of two presses equally close the earlier wins, then the
/// one given first.
///
/// Wrong presses count against accuracy so that mashing every key cannot score 100%.
///
/// The presses of each pitch are sorted once and the nearest unused press on
/// either side is found in near constant time, so the work grows with
/// `(expected + played) log played` and not with their product.
///
/// # Errors
/// Returns [`FollowError::TooManyExpected`] above [`MAX_EXPECTED`] notes,
/// [`FollowError::TooManyPlayed`] above [`MAX_PLAYED`] presses and
/// [`FollowError::NoteOutOfRange`] for a note above 127.
pub fn score(
    expected: &[Note],
    played: &[Note],
    config: ScoreConfig,
) -> Result<Score, FollowError> {
    if expected.len() > MAX_EXPECTED {
        return Err(FollowError::TooManyExpected {
            given: expected.len(),
        });
    }
    if played.len() > MAX_PLAYED {
        return Err(FollowError::TooManyPlayed);
    }
    for (list, played_list) in [(expected, false), (played, true)] {
        if let Some(i) = list.iter().position(|n| n.note > 127) {
            return Err(FollowError::NoteOutOfRange {
                played: played_list,
                index: u32::try_from(i).unwrap_or(u32::MAX),
                note: list[i].note,
            });
        }
    }
    // the presses of each pitch in time order, ties by the order given
    let mut by_pitch: Vec<Vec<(u32, usize)>> = vec![Vec::new(); 128];
    for (i, p) in played.iter().enumerate() {
        by_pitch[usize::from(p.note)].push((p.t_ms, i));
    }
    let mut free: Vec<Free> = by_pitch
        .iter_mut()
        .map(|list| {
            list.sort_unstable();
            Free::new(list)
        })
        .collect();
    let mut used = 0usize;
    let mut hits = 0usize;
    let mut error_sum: u64 = 0;
    for target in expected {
        let pitch = usize::from(target.note);
        let list = &by_pitch[pitch];
        let slots = &mut free[pitch];
        let at = list.partition_point(|&(t, _)| t < target.t_ms);
        let right = slots.next(at);
        let left = at
            .checked_sub(1)
            .and_then(|i| slots.prev(i))
            .map(|i| slots.first_of_run(i));
        let error = |i: usize| list[i].0.abs_diff(target.t_ms);
        let pick = match (left, right) {
            (Some(l), Some(r)) => Some(if error(l) <= error(r) { l } else { r }),
            (l, r) => l.or(r),
        };
        if let Some(i) = pick.filter(|&i| error(i) <= config.window_ms) {
            error_sum += u64::from(error(i));
            slots.take(i);
            used += 1;
            hits += 1;
        }
    }
    let wrong = played.len() - used;
    Ok(Score {
        expected: expected.len(),
        hits,
        misses: expected.len() - hits,
        wrong,
        accuracy: if expected.len() + wrong == 0 {
            1.0
        } else {
            ratio(hits as u64, (expected.len() + wrong) as u64)
        },
        mean_timing_error_ms: (hits > 0).then(|| ratio(error_sum, hits as u64)),
    })
}

/// The unused presses of one pitch: the nearest unused slot on either side of a
/// position and the first unused slot of a run of equal times, each found by
/// path-halving over links that skip used slots.
struct Free {
    next: Vec<usize>,
    prev: Vec<usize>,
    run: Vec<usize>,
}

impl Free {
    fn new(list: &[(u32, usize)]) -> Self {
        let n = list.len();
        let mut run = vec![0; n];
        for i in 1..n {
            run[i] = if list[i].0 == list[i - 1].0 {
                run[i - 1]
            } else {
                i
            };
        }
        // slot n is a sentinel for the right side and slot 0 of `prev` is shifted by one for the left
        Self {
            next: (0..=n).collect(),
            prev: (0..=n).collect(),
            run,
        }
    }

    fn find(links: &mut [usize], mut i: usize) -> usize {
        while links[i] != i {
            links[i] = links[links[i]];
            i = links[i];
        }
        i
    }

    /// The first unused slot at `i` or after it.
    fn next(&mut self, i: usize) -> Option<usize> {
        let n = self.next.len() - 1;
        let found = Self::find(&mut self.next, i.min(n));
        (found < n).then_some(found)
    }

    /// The last unused slot at `i` or before it.
    fn prev(&mut self, i: usize) -> Option<usize> {
        // prev is indexed from 1 so that 0 means nothing is left
        let found = Self::find(&mut self.prev, i + 1);
        found.checked_sub(1)
    }

    /// The first unused slot among those with the same time as slot `i`.
    fn first_of_run(&mut self, i: usize) -> usize {
        self.next(self.run[i]).unwrap_or(i)
    }

    fn take(&mut self, i: usize) {
        self.next[i] = i + 1;
        self.prev[i + 1] = i;
    }
}

#[allow(clippy::cast_precision_loss)]
fn ratio(numerator: u64, denominator: u64) -> f32 {
    // both values stay below 2^24 under the limits, so each converts exactly
    // and the one division is correctly rounded on every target
    numerator as f32 / denominator as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notes(pairs: &[(u32, u8)]) -> Vec<Note> {
        pairs
            .iter()
            .map(|&(t_ms, note)| Note { t_ms, note })
            .collect()
    }

    fn scored(expected: &[(u32, u8)], played: &[(u32, u8)]) -> Score {
        score(&notes(expected), &notes(played), ScoreConfig::default()).unwrap()
    }

    #[test]
    fn perfect_performance() {
        let passage = [(0, 60), (500, 62), (1000, 64)];
        let result = scored(&passage, &passage);
        assert_eq!(result.hits, 3);
        assert_eq!(result.wrong, 0);
        assert!((result.accuracy - 1.0).abs() < f32::EPSILON);
        assert_eq!(result.mean_timing_error_ms, Some(0.0));
    }

    #[test]
    fn slightly_late_still_hits() {
        let result = scored(&[(0, 60), (500, 62)], &[(40, 60), (560, 62)]);
        assert_eq!(result.hits, 2);
        assert_eq!(result.mean_timing_error_ms, Some(50.0));
    }

    #[test]
    fn too_late_is_a_miss_and_a_wrong_press() {
        let result = scored(&[(0, 60)], &[(400, 60)]);
        assert_eq!(result.hits, 0);
        assert_eq!(result.misses, 1);
        assert_eq!(result.wrong, 1);
        assert_eq!(result.mean_timing_error_ms, None);
    }

    #[test]
    fn wrong_pitch_is_counted() {
        let result = scored(&[(0, 60), (500, 62)], &[(0, 60), (500, 63)]);
        assert_eq!(result.hits, 1);
        assert_eq!(result.wrong, 1);
        assert!((result.accuracy - 1.0 / 3.0).abs() < 1e-6);
    }

    #[test]
    fn chords_match_every_note() {
        let chord = [(0, 60), (0, 64), (0, 67)];
        let result = scored(&chord, &[(10, 67), (5, 60), (0, 64)]);
        assert_eq!(result.hits, 3);
    }

    #[test]
    fn each_press_is_used_once() {
        let result = scored(&[(0, 60), (100, 60)], &[(50, 60)]);
        assert_eq!(result.hits, 1);
        assert_eq!(result.misses, 1);
    }

    #[test]
    fn mashing_keys_cannot_score_full_marks() {
        let played: Vec<(u32, u8)> = (21..=108).map(|n| (0, n)).collect();
        let result = scored(&[(0, 60)], &played);
        assert_eq!(result.hits, 1);
        assert!(result.accuracy < 0.05);
    }

    /// 128 pitches, 100 notes each 40 000 000 ms apart, every press 10 000 000 ms
    /// late: the errors add up to 1.28e11, far past what 32 bits hold.
    pub(crate) fn huge_errors() -> (Vec<Note>, Vec<Note>) {
        let mut expected = Vec::new();
        let mut played = Vec::new();
        for note in 0..128u8 {
            for k in 0..100u32 {
                expected.push(Note {
                    t_ms: k * 40_000_000,
                    note,
                });
                played.push(Note {
                    t_ms: k * 40_000_000 + 10_000_000,
                    note,
                });
            }
        }
        (expected, played)
    }

    #[test]
    fn the_timing_error_sum_does_not_wrap_past_32_bits() {
        let (expected, played) = huge_errors();
        let result = score(
            &expected,
            &played,
            ScoreConfig {
                window_ms: 4_000_000_000,
            },
        )
        .unwrap();
        assert_eq!(result.hits, 12_800);
        assert_eq!(result.mean_timing_error_ms, Some(10_000_000.0));
    }

    #[test]
    fn each_side_is_capped_and_bad_notes_refused() {
        let many = vec![Note { t_ms: 0, note: 60 }; MAX_PLAYED + 1];
        assert_eq!(
            score(&[], &many, ScoreConfig::default()),
            Err(FollowError::TooManyPlayed)
        );
        let piece = vec![Note { t_ms: 0, note: 60 }; MAX_EXPECTED + 1];
        assert!(matches!(
            score(&piece, &[], ScoreConfig::default()),
            Err(FollowError::TooManyExpected { .. })
        ));
        assert!(matches!(
            score(&[], &[Note { t_ms: 0, note: 200 }], ScoreConfig::default()),
            Err(FollowError::NoteOutOfRange { played: true, .. })
        ));
    }

    #[test]
    fn equally_close_presses_go_to_the_earlier_then_the_first_given() {
        let result = scored(&[(100, 60)], &[(150, 60), (50, 60)]);
        assert_eq!(result.hits, 1);
        assert_eq!(result.mean_timing_error_ms, Some(50.0));
        // the press at 50 is taken, so a second note at 150 gets the press at 150
        let result = scored(&[(100, 60), (150, 60)], &[(150, 60), (50, 60)]);
        assert_eq!(result.mean_timing_error_ms, Some(25.0));
    }

    #[test]
    fn large_inputs_are_matched_quickly() {
        // 20 000 by 20 000 took 1.8 s with the old matching: now it is a sort and a pass
        let expected: Vec<Note> = (0..20_000u32)
            .map(|i| Note {
                t_ms: i * 100,
                note: 40 + (i % 40) as u8,
            })
            .collect();
        let start = std::time::Instant::now();
        let result = score(&expected, &expected, ScoreConfig::default()).unwrap();
        assert_eq!(result.hits, 20_000);
        assert!(
            start.elapsed().as_secs_f64() < 1.0,
            "took {:?}",
            start.elapsed()
        );
    }

    #[test]
    fn empty_passage_is_perfect() {
        let result = scored(&[], &[]);
        assert_eq!(result.expected, 0);
        assert!((result.accuracy - 1.0).abs() < f32::EPSILON);
    }
}
