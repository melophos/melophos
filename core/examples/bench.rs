//! Times the follower. Run with `cargo run --release --example bench`.
//!
//! The figures depend on the machine, so the README states which machine its numbers came from.

// test data is small and written by hand, so the numeric casts cannot lose anything
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap
)]

use melophos_core::{follow, FollowConfig, Follower, Note};
use std::hint::black_box;
use std::time::Instant;

fn piece(count: u32) -> Vec<Note> {
    (0..count)
        .map(|i| Note {
            t_ms: i * 250,
            note: 40 + ((i * i * 7 + i * 3 + i / 5 * 11) % 41) as u8,
        })
        .collect()
}

fn per_press(label: &str, expected: &[Note], played: &[Note], config: FollowConfig, rounds: u32) {
    // every press timed on its own, over all rounds: the median is the typical
    // cost and the tail shows what the machine's scheduler adds on top
    let mut each: Vec<f64> = Vec::with_capacity(played.len() * rounds as usize);
    for _ in 0..rounds {
        let mut follower = Follower::new(expected, config).unwrap();
        for &note in played {
            let one = Instant::now();
            black_box(follower.push(black_box(note)).unwrap());
            each.push(one.elapsed().as_secs_f64() * 1e6);
        }
    }
    each.sort_by(f64::total_cmp);
    let at = |per_mille: usize| each[(each.len() - 1) * per_mille / 1_000];
    println!(
        "{label:<46} median {:>8.2} us  p99 {:>8.2} us  p99.9 {:>8.2} us  worst {:>9.1} us",
        at(500),
        at(990),
        at(999),
        each[each.len() - 1]
    );
}

fn main() {
    let config = FollowConfig::default();
    for size in [100_u32, 1_000, 10_000, 100_000] {
        let expected = piece(size);
        per_press(
            &format!("exact performance, {size} notes, band 16"),
            &expected,
            &expected,
            config,
            5,
        );
    }
    let expected = piece(1_000);
    for band in [4_u16, 16, 64, 256] {
        per_press(
            &format!("exact performance, 1000 notes, band {band}"),
            &expected,
            &expected,
            FollowConfig { band, ..config },
            5,
        );
    }
    // a player whose presses match nothing keeps the follower searching for a new place
    let noise: Vec<Note> = (0..1_000)
        .map(|i| Note {
            t_ms: i * 250,
            note: 120 + (i % 7) as u8,
        })
        .collect();
    per_press(
        "presses that match nothing, 1000 notes",
        &expected,
        &noise,
        config,
        5,
    );
    let big = piece(100_000);
    let lost: Vec<Note> = (0..2_000)
        .map(|i| Note {
            t_ms: i * 250,
            note: 40 + ((i * 13) % 41) as u8,
        })
        .collect();
    per_press(
        "scattered presses, 100000 notes, searching",
        &big,
        &lost,
        config,
        3,
    );
    let start = Instant::now();
    let (events, _) = follow(&big, &big, config).unwrap();
    black_box(&events);
    println!(
        "whole 100000 note performance in one call: {:.1} ms",
        start.elapsed().as_secs_f64() * 1e3
    );
}
