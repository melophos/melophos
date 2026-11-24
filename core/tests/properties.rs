//! Properties the follower must keep for any input, plus the stated bounds:
//! the work per press, the tempo delay and the timing judgement.

// test data is small, so the numeric casts cannot lose anything
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss
)]

use melophos_core::{
    follow, follow_session, follow_with_hands, Event, EventKind, FollowConfig, Follower, Hand,
    Note, Session, MAX_REREAD,
};
use proptest::prelude::*;

fn piece(steps: &[(u32, u8)]) -> Vec<Note> {
    let mut t = 0;
    steps
        .iter()
        .map(|&(gap, note)| {
            t += gap;
            Note { t_ms: t, note }
        })
        .collect()
}

fn steps(max: usize) -> impl Strategy<Value = Vec<(u32, u8)>> {
    prop::collection::vec((0u32..700, 40u8..90), 0..max)
}

/// A varied tune with no two neighbouring pitches equal.
fn tune(count: u32, gap: u32) -> Vec<Note> {
    (0..count)
        .map(|i| Note {
            t_ms: i * gap,
            note: 50 + ((i * 7 + (i / 5) * 3) % 29) as u8,
        })
        .collect()
}

/// A two-hand piece in one of several textures: a tune, a scale, repeated chords
/// of two or three notes or repeated single notes in the right hand, over a bass
/// line, repeated chords, long notes or nothing in the left. `beat` is the gap
/// between right-hand onsets.
fn texture(right: u8, left: u8, beat: u32, onsets: u32) -> (Vec<Note>, Vec<Hand>) {
    let mut piece = Vec::new();
    let mut hands = Vec::new();
    for i in 0..onsets {
        let t = i * beat;
        let rh: Vec<u8> = match right % 5 {
            0 => vec![60 + ((i * 7 + (i / 5) * 3) % 17) as u8],
            1 => vec![60 + [0u8, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2][(i % 14) as usize]],
            2 => vec![64, 67],
            3 => vec![60, 64, 67],
            _ => vec![72],
        };
        for note in rh {
            piece.push(Note { t_ms: t, note });
            hands.push(Hand::Right);
        }
        let lh: Vec<u8> = match left % 4 {
            0 if i % 2 == 0 => vec![36 + ((i / 2) % 7) as u8],
            1 if i % 2 == 0 => vec![43, 48],
            2 if i % 4 == 0 => vec![41 + ((i / 4) % 3) as u8],
            _ => vec![],
        };
        for note in lh {
            piece.push(Note { t_ms: t, note });
            hands.push(Hand::Left);
        }
    }
    (piece, hands)
}

/// Plays a piece with each written moment at the time `at` gives it, the notes of a chord 3 ms apart.
fn played_at(piece: &[Note], at: impl Fn(u32) -> u32) -> Vec<Note> {
    let mut order: Vec<Note> = piece.to_vec();
    order.sort_by_key(|n| (n.t_ms, n.note));
    let mut last = 0;
    order
        .iter()
        .map(|n| {
            let t = at(n.t_ms).max(last);
            last = t + 3;
            Note {
                t_ms: t,
                note: n.note,
            }
        })
        .collect()
}

/// A session that mixes right playing with stray keys, jumps and stops, so that
/// readings are revised and places are searched for.
fn messy(expected: &[Note], seed: &[(u32, u8)]) -> Vec<Note> {
    let mut out = Vec::new();
    let mut t = 200;
    let mut i = 0;
    for &(gap, key) in seed {
        match key % 8 {
            0 => out.push(Note { t_ms: t, note: key }),
            1 => i = (gap as usize) % expected.len().max(1),
            2 => t += 3_000,
            _ => {
                if let Some(n) = expected.get(i) {
                    out.push(Note {
                        t_ms: t,
                        note: n.note,
                    });
                    i += 1;
                }
            }
        }
        t += gap % 400 + 20;
    }
    out
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(150))]

    #[test]
    fn the_same_input_always_gives_the_same_output(e in steps(40), p in steps(60)) {
        let (expected, played) = (piece(&e), piece(&p));
        let a = follow(&expected, &played, FollowConfig::default()).unwrap();
        let b = follow(&expected, &played, FollowConfig::default()).unwrap();
        prop_assert_eq!(a, b);
    }

    #[test]
    fn the_summary_is_what_the_events_say(e in steps(40), p in steps(120)) {
        let expected = piece(&e);
        for played in [piece(&p), messy(&expected, &p)] {
            let (events, score) = follow(&expected, &played, FollowConfig::default()).unwrap();
            prop_assert_eq!(events.len(), played.len());
            let count = |k: EventKind| events.iter().filter(|e| e.kind == k).count();
            prop_assert_eq!(score.hits, count(EventKind::Hit));
            prop_assert_eq!(score.late, count(EventKind::Late));
            prop_assert_eq!(score.wrong, count(EventKind::Wrong));
            prop_assert_eq!(score.repeats, count(EventKind::Repeat));
            prop_assert_eq!(score.unsure, count(EventKind::Unsure));
            prop_assert_eq!(score.hits + score.late + score.misses, expected.len());
            // no expected note is credited twice and only a matched press names a note
            let mut seen = vec![false; expected.len()];
            for ev in &events {
                match (ev.kind, ev.expected_index) {
                    (EventKind::Hit | EventKind::Late, Some(i)) => {
                        prop_assert!(!seen[i as usize], "note {} credited twice", i);
                        seen[i as usize] = true;
                        prop_assert_eq!(expected[i as usize].note, played[ev.played_index as usize].note);
                    }
                    (EventKind::Repeat, Some(_)) | (EventKind::Wrong | EventKind::Unsure, None) => {}
                    other => prop_assert!(false, "{:?}", other),
                }
            }
        }
    }

    #[test]
    fn a_live_session_keeps_its_promises(e in steps(40), p in steps(160)) {
        let expected = piece(&e);
        for played in [piece(&p), messy(&expected, &p)] {
            let mut follower = Follower::new(&expected, FollowConfig::default()).unwrap();
            let mut view: Vec<Event> = Vec::new();
            let mut settled = 0;
            let mut place = None;
            for (n, &note) in played.iter().enumerate() {
                let update = follower.push(note).unwrap();
                // presses made final are never read again and all but the open ones are final
                prop_assert!(update.settled >= settled);
                prop_assert!(update.settled as usize + MAX_REREAD > n);
                for r in &update.revised {
                    prop_assert!(r.played_index >= settled, "press {} was final", r.played_index);
                    view[r.played_index as usize] = *r;
                }
                settled = update.settled;
                // the place steps back only where the update says why
                if let Some(before) = place {
                    prop_assert!(
                        update.event.position >= before
                            || !update.revised.is_empty()
                            || update.event.jumped_from.is_some()
                    );
                }
                place = Some(update.event.position);
                view.push(update.event);
            }
            // and the live view ends as the batch call's answer
            let (batch, score) = follow(&expected, &played, FollowConfig::default()).unwrap();
            prop_assert_eq!(&view, &batch);
            prop_assert_eq!(follower.finish(), score);
        }
    }

    #[test]
    fn a_late_start_changes_nothing(e in steps(30), p in steps(50), shift in 0u32..5000) {
        let expected = piece(&e);
        let played = piece(&p);
        let later: Vec<Note> = played.iter().map(|n| Note { t_ms: n.t_ms + shift, note: n.note }).collect();
        let (a, _) = follow(&expected, &played, FollowConfig::default()).unwrap();
        let (b, _) = follow(&expected, &later, FollowConfig::default()).unwrap();
        prop_assert_eq!(a, b);
    }

    #[test]
    fn a_steady_performance_at_any_speed_is_all_hits_at_that_speed(
        percent in 40u32..=200,
        gap in 150u32..900,
        start in 0u32..2000,
    ) {
        let expected = tune(40, gap);
        let played: Vec<Note> = expected
            .iter()
            .map(|n| Note { t_ms: start + n.t_ms * 100 / percent, note: n.note })
            .collect();
        let (events, score) = follow(&expected, &played, FollowConfig::default()).unwrap();
        prop_assert!(events.iter().all(|e| e.kind == EventKind::Hit), "{:?}", score);
        let want = percent * 10_000;
        prop_assert!(score.final_speed_ppm.abs_diff(want) <= want / 20, "{} for {}", score.final_speed_ppm, want);
    }

    #[test]
    fn steady_play_at_any_speed_over_any_texture_is_all_hits(
        right in 0u8..5,
        left in 0u8..4,
        beat in prop::sample::select(vec![150u32, 250, 400, 500, 800, 1200]),
        percent in 40u32..=200,
    ) {
        // down to notes 120 ms apart as played: repeated chords faster than that
        // fall inside the floor of the window and are a stated limit
        let percent = percent.min(beat * 100 / 120);
        let (piece, hands) = texture(right, left, beat, 40);
        let played = played_at(&piece, |s| 300 + s * 100 / percent);
        let (events, score) = follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
        prop_assert!(events.iter().all(|e| e.kind == EventKind::Hit), "{:?}", score);
        prop_assert!((score.accuracy - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn no_single_interval_can_make_the_rest_of_a_session_unsure(
        right in 0u8..5,
        left in 0u8..4,
        beat in prop::sample::select(vec![250u32, 400, 500, 800]),
        percent in 50u32..=150,
        at in 1u32..40,
        wait in 200u32..2_400,
    ) {
        // one hesitation of any length before any onset, the first intervals
        // included: every note is still credited and at most the notes of the
        // moment after the hesitation are late
        let (piece, hands) = texture(right, left, beat, 40);
        let played = played_at(&piece, |s| 300 + s * 100 / percent + if s >= at * beat { wait } else { 0 });
        let (events, score) = follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
        prop_assert_eq!((score.wrong, score.unsure, score.repeats), (0, 0, 0), "{:?}", score);
        prop_assert_eq!(score.hits + score.late, piece.len());
        prop_assert!(score.late <= 5, "{:?}", score);
        let _ = events;
    }

    #[test]
    fn a_steady_run_always_recovers_the_tempo(
        right in 0u8..5,
        left in 0u8..4,
        beat in prop::sample::select(vec![250u32, 400, 500, 800]),
        first in prop::sample::select(vec![50u32, 70, 100, 140, 200]),
        second in prop::sample::select(vec![40u32, 60, 100, 150, 200]),
    ) {
        // any steady tempo, then at once any other from 40 to 200 percent and
        // steady again: nothing is wrong and from RECOVER onsets after the change
        // on every note is a hit at the new tempo
        const RECOVER: u32 = 12;
        // music of one repeated key alone is given a bass: there a doubling of speed
        // cannot be told from every note struck twice, which is a stated limit
        let left = if right == 4 && left == 3 { 0 } else { left };
        // where the same chord or key is written over and over, a speed-up of more
        // than about two and a half times cannot be told from keys struck twice
        let second = if right >= 2 { second.min(first * 22 / 10) } else { second };
        let (piece, hands) = texture(right, left, beat, 60);
        let turn = 24 * beat;
        let played = played_at(&piece, |s| {
            300 + if s <= turn { s * 100 / first } else { turn * 100 / first + (s - turn) * 100 / second }
        });
        let (events, score) = follow_with_hands(&piece, &hands, &played, FollowConfig::default()).unwrap();
        prop_assert_eq!(score.wrong, 0, "{:?}", score);
        let mut order: Vec<Note> = piece.clone();
        order.sort_by_key(|n| (n.t_ms, n.note));
        for (e, n) in events.iter().zip(&order) {
            if n.t_ms > turn + RECOVER * beat {
                prop_assert_eq!(e.kind, EventKind::Hit, "note at {} of {:?}", n.t_ms, score);
                prop_assert!(e.speed_ppm.abs_diff(second * 10_000) <= second * 1_000, "{}", e.speed_ppm);
            }
        }
    }

    #[test]
    fn a_note_is_turned_wrong_only_by_a_press_that_is_that_note(e in steps(40), p in steps(160)) {
        // a press shown as a hit or a late note can later be called wrong only when
        // another press now holds the note it had, as a hit or a late note. a wrong
        // press, a repeat or a move to another place never does it
        let expected = piece(&e);
        let played = messy(&expected, &p);
        let mut follower = Follower::new(&expected, FollowConfig::default()).unwrap();
        let mut view: Vec<Event> = Vec::new();
        let mut held: Vec<Option<u32>> = Vec::new();
        for &note in &played {
            let update = follower.push(note).unwrap();
            let mut turned = Vec::new();
            for r in update.revised {
                let i = r.played_index as usize;
                if r.kind == EventKind::Wrong && view[i].kind != EventKind::Wrong && held[i].is_some() {
                    turned.push(i);
                }
                view[i] = r;
            }
            view.push(update.event);
            held.push(None);
            for (i, ev) in view.iter().enumerate() {
                if matches!(ev.kind, EventKind::Hit | EventKind::Late) {
                    held[i] = ev.expected_index;
                }
            }
            for i in turned {
                let taken = view.iter().enumerate().any(|(j, ev)| {
                    j != i && matches!(ev.kind, EventKind::Hit | EventKind::Late) && ev.expected_index == held[i]
                });
                prop_assert!(taken, "press {} lost note {:?} to nobody and was called wrong", i, held[i]);
            }
        }
    }

    #[test]
    fn a_stated_jump_in_a_batch_is_the_live_jump(e in steps(40), p in steps(80), at in 0usize..80, to in 0u32..20_000) {
        let expected = piece(&e);
        let played = messy(&expected, &p);
        let at = at.min(played.len());
        let jumps = [(at as u32, to)];
        let batch = follow_session(&expected, &[], &played, Session::default(), &jumps, FollowConfig::default()).unwrap();
        let mut follower = Follower::new(&expected, FollowConfig::default()).unwrap();
        let mut view: Vec<Event> = Vec::new();
        for (n, &note) in played.iter().enumerate() {
            if n == at {
                follower.jump_to(to);
            }
            let update = follower.push(note).unwrap();
            for r in update.revised {
                view[r.played_index as usize] = r;
            }
            view.push(update.event);
        }
        prop_assert_eq!(view, batch.0);
    }
}

#[test]
fn tempo_follows_an_instant_change_within_three_intervals() {
    // the tempo is the median of the last three intervals of at least 300 ms of
    // score, so three such intervals after a change it is the new tempo
    for gap in [150u32, 300, 500, 900] {
        for (from, to) in [
            (100u32, 60u32),
            (100, 150),
            (70, 100),
            (130, 100),
            (100, 200),
            (100, 50),
        ] {
            let expected = tune(60, gap);
            let turn = 30 * gap;
            let mut played = Vec::new();
            for n in &expected {
                let t = if n.t_ms <= turn {
                    n.t_ms * 100 / from
                } else {
                    turn * 100 / from + (n.t_ms - turn) * 100 / to
                };
                played.push(Note {
                    t_ms: t,
                    note: n.note,
                });
            }
            let (events, score) = follow(&expected, &played, FollowConfig::default()).unwrap();
            assert_eq!(score.wrong, 0, "gap {gap}, {from} to {to}");
            let intervals = 3 * 300u32.div_ceil(gap).max(1) + 1;
            let want = to * 10_000;
            for e in &events[(30 + intervals) as usize + 1..] {
                assert!(
                    e.speed_ppm.abs_diff(want) <= want / 10,
                    "gap {gap}, {from} to {to}: press {} at {}",
                    e.played_index,
                    e.speed_ppm
                );
            }
        }
    }
}

#[test]
fn the_work_per_press_has_a_ceiling_that_does_not_grow_with_the_session() {
    // one press reads at most a few dozen notes in each of seven readings. a
    // search looks at no more than 1 028 places, each against the last 8 presses
    // and 16 notes a press and replays at most 8 of them over 8 presses
    const CEILING: u64 = 1_028 * 8 * 16 + 20_000;
    let mut rng = 0x2545_f491_4f6c_dd1du64;
    let mut next = move || {
        rng ^= rng << 13;
        rng ^= rng >> 7;
        rng ^= rng << 17;
        rng
    };
    // a long piece where one pitch comes back all the time, so searches find many places
    for size in [2_000u32, 100_000] {
        let expected: Vec<Note> = (0..size)
            .map(|i| Note {
                t_ms: i * 120,
                note: if i % 2 == 0 {
                    60
                } else {
                    61 + (i / 2 % 12) as u8
                },
            })
            .collect();
        let mut follower = Follower::new(&expected, FollowConfig::default()).unwrap();
        let mut worst = [0u64; 2];
        let mut t = 0;
        for n in 0..30_000u32 {
            t += (next() % 300) as u32;
            let note = match next() % 4 {
                0 => 60,
                1 => 61 + (next() % 12) as u8,
                _ => 40 + (next() % 50) as u8,
            };
            let before = follower.work();
            follower.push(Note { t_ms: t, note }).unwrap();
            let used = follower.work() - before;
            assert!(
                used <= CEILING,
                "press {n} of a {size} note piece used {used} units"
            );
            let half = usize::from(n >= 15_000);
            worst[half] = worst[half].max(used);
            assert!(follower.buffers() <= 7);
        }
        // the second half of the session costs no more than the first, give or take
        assert!(worst[1] <= worst[0] * 2 + 1_000, "{worst:?}");
        eprintln!(
            "{size} notes: worst press used {} then {} units",
            worst[0], worst[1]
        );
    }
}
