//! Scores a performance against the notes a song expects.

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

/// Matches each expected note with the closest unused press of the same pitch
/// inside the timing window, then counts what is left over as misses and wrong notes.
///
/// Wrong presses count against accuracy so that mashing every key cannot score 100%.
#[must_use]
pub fn score(expected: &[Note], played: &[Note], config: ScoreConfig) -> Score {
    let mut used = vec![false; played.len()];
    let mut timing_errors: Vec<u32> = Vec::new();

    for target in expected {
        let best = played
            .iter()
            .enumerate()
            .filter(|(i, p)| !used[*i] && p.note == target.note)
            .map(|(i, p)| (i, p.t_ms.abs_diff(target.t_ms)))
            .filter(|(_, error)| *error <= config.window_ms)
            .min_by_key(|(_, error)| *error);
        if let Some((index, error)) = best {
            used[index] = true;
            timing_errors.push(error);
        }
    }

    let hits = timing_errors.len();
    let wrong = used.iter().filter(|u| !**u).count();
    let denominator = expected.len() + wrong;
    Score {
        expected: expected.len(),
        hits,
        misses: expected.len() - hits,
        wrong,
        accuracy: if denominator == 0 {
            1.0
        } else {
            ratio(hits, denominator)
        },
        mean_timing_error_ms: if hits == 0 {
            None
        } else {
            Some(ratio(timing_errors.iter().map(|e| *e as usize).sum(), hits))
        },
    }
}

#[allow(clippy::cast_precision_loss)]
fn ratio(numerator: usize, denominator: usize) -> f32 {
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
        score(&notes(expected), &notes(played), ScoreConfig::default())
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

    #[test]
    fn empty_passage_is_perfect() {
        let result = scored(&[], &[]);
        assert_eq!(result.expected, 0);
        assert!((result.accuracy - 1.0).abs() < f32::EPSILON);
    }
}
