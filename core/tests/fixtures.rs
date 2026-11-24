//! Runs the labelled corpus in `fixtures/corpus/` through the engine.
//!
//! The labels were written by the generator from how each performance was built,
//! so they are an independent answer: see `fixtures/generate.py`. Each set is
//! held to the harm it was measured at: right notes called wrong, wrong presses
//! called right, right notes left unsure and the mean agreement. `golden.json` holds a digest of every event and the exact
//! summary of this build, which the WebAssembly and Python tests must match bit
//! for bit. Set `UPDATE_GOLDEN=1` to rewrite it after an intended change.

// test data is small, so the numeric casts cannot lose anything
#![allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss
)]

use melophos_core::{
    follow_with_hands, score, Event, EventKind, FollowConfig, FollowScore, Hand, Note, PlayedHands,
    ScoreConfig,
};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

/// The tuning and design corpus, then the final check set made by a separate generator.
fn load() -> Vec<Value> {
    let mut files: Vec<PathBuf> = ["corpus", "final"]
        .iter()
        .flat_map(|d| std::fs::read_dir(dir().join(d)).unwrap())
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    files
        .iter()
        .map(|p| serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap())
        .collect()
}

fn notes(v: &Value) -> Vec<Note> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|p| Note {
            t_ms: u32::try_from(p[0].as_u64().unwrap()).unwrap(),
            note: u8::try_from(p[1].as_u64().unwrap()).unwrap(),
        })
        .collect()
}

fn hands(v: &Value) -> Vec<Hand> {
    v.as_array().map_or_else(Vec::new, |list| {
        list.iter()
            .map(|h| match h.as_str() {
                Some("left") => Hand::Left,
                Some("right") => Hand::Right,
                _ => Hand::Unknown,
            })
            .collect()
    })
}

fn config(v: &Value) -> FollowConfig {
    let get = |k: &str| v[k].as_u64().unwrap();
    FollowConfig {
        window_ms: u32::try_from(get("window_ms")).unwrap(),
        band: u16::try_from(get("band")).unwrap(),
        pause_ms: u32::try_from(get("pause_ms")).unwrap(),
        chord_ms: u32::try_from(get("chord_ms")).unwrap(),
        relocate_after: u8::try_from(get("relocate_after")).unwrap(),
    }
}

/// Whether the engine's reading of one press agrees with its label. The label
/// kinds are described in `fixtures/generate.py`.
fn agrees(event: &Event, label: &Value, pitch: &[u8]) -> bool {
    let kind = event.kind;
    let got = event.expected_index.map_or(-1, i64::from);
    let want = label[1].as_i64().unwrap();
    let same_pitch = || got >= 0 && pitch.get(got as usize) == pitch.get(want as usize);
    let label_kind = label[0].as_str().unwrap();
    // "~" after a kind: that kind, on this note or one of the same pitch within 3
    // notes, since identical pitches in a row cannot be told apart once timing moves
    if let Some(base) = label_kind.strip_suffix('~') {
        let near = got >= 0 && (got - want).abs() <= 3 && same_pitch();
        let kind_ok = match base {
            "hit" => kind == EventKind::Hit,
            "late" => kind == EventKind::Late,
            "either" => matches!(kind, EventKind::Hit | EventKind::Late),
            "repeat" => kind == EventKind::Repeat,
            other => panic!("unknown label {other}~"),
        };
        return near && kind_ok;
    }
    match label_kind {
        "hit" => kind == EventKind::Hit && got == want,
        "late" => kind == EventKind::Late && got == want,
        "either" => matches!(kind, EventKind::Hit | EventKind::Late) && got == want,
        "repeat" => kind == EventKind::Repeat && got == want,
        "wrong" => kind == EventKind::Wrong,
        "extra" => matches!(kind, EventKind::Wrong | EventKind::Repeat),
        "any" => matches!(kind, EventKind::Wrong | EventKind::Repeat) || got >= 0,
        "same" => kind != EventKind::Wrong && same_pitch(),
        other => panic!("unknown label {other}"),
    }
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

/// FNV-1a over every number of every event, each as 8 little-endian bytes. The
/// WebAssembly and Python tests compute the same digest.
fn digest(events: &[Event]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for e in events {
        for v in [
            i64::from(e.played_index),
            i64::from(e.kind.code()),
            e.expected_index.map_or(-1, i64::from),
            i64::from(e.position),
            i64::from(e.error_ms),
            i64::from(e.speed_ppm),
            e.jumped_from.map_or(-1, i64::from),
        ] {
            for b in v.to_le_bytes() {
                h ^= u64::from(b);
                h = h.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
    }
    format!("{h:016x}")
}

fn summary(s: &FollowScore) -> Value {
    json!({
        "expected": s.expected, "hits": s.hits, "late": s.late, "misses": s.misses,
        "wrong": s.wrong, "repeats": s.repeats, "unsure": s.unsure,
        "accuracy_bits": s.accuracy.to_bits(),
        "mean_timing_error_bits": s.mean_timing_error_ms.map(f32::to_bits),
        "final_speed_ppm": s.final_speed_ppm, "mean_speed_ppm": s.mean_speed_ppm,
        "hands": s.hands.code(), "played_expected": s.played_expected,
        "played_accuracy_bits": s.played_accuracy.to_bits(),
    })
}

/// Families whose every case must agree on every press: the piece played as
/// written, one hand alone and one voice of each chord.
const PERFECT: &[&str] = &["exact", "hand_alone", "one_voice"];

/// What each set was measured at, which `docs/scoring.md` states: the most
/// right notes called wrong, wrong presses called right and right notes left
/// unsure and the least mean agreement. A change that does worse on any of
/// them fails here and has to be looked at, not waved through.
const RW_TRAINING: usize = 3;
const WR_TRAINING: usize = 61;
const UNSURE_TRAINING: usize = 133;
const MEAN_TRAINING: f64 = 0.982;
const RW_DESIGN: usize = 4;
const WR_DESIGN: usize = 50;
const UNSURE_DESIGN: usize = 88;
const MEAN_DESIGN: f64 = 0.982;
const RW_FINAL: usize = 0;
const WR_FINAL: usize = 10;
const UNSURE_FINAL: usize = 4;
const MEAN_FINAL: f64 = 0.986;

const MEASURED: &[(&str, usize, usize, usize, f64)] = &[
    (
        "training",
        RW_TRAINING,
        WR_TRAINING,
        UNSURE_TRAINING,
        MEAN_TRAINING,
    ),
    ("design", RW_DESIGN, WR_DESIGN, UNSURE_DESIGN, MEAN_DESIGN),
    ("final", RW_FINAL, WR_FINAL, UNSURE_FINAL, MEAN_FINAL),
];

#[derive(Default)]
struct Harm {
    cases: usize,
    agreement: f64,
    right_called_wrong: usize,
    wrong_called_right: usize,
    right_unsure: usize,
    unsure: usize,
}

#[test]
fn the_corpus_keeps_to_the_harm_it_was_measured_at() {
    let mut sets: BTreeMap<&str, Harm> = BTreeMap::new();
    let mut families: BTreeMap<String, (f64, f64, usize)> = BTreeMap::new();
    for doc in load() {
        let expected = notes(&doc["expected"]);
        let pitch: Vec<u8> = expected.iter().map(|n| n.note).collect();
        let labels_of_hands = hands(&doc["hands"]);
        let cfg = config(&doc["config"]);
        let piece = doc["name"].as_str().unwrap();
        let set = match doc["split"].as_str() {
            Some("train") => "training",
            Some("test") => "design",
            _ => "final",
        };
        for case in doc["cases"].as_array().unwrap() {
            let name = format!("{piece}/{}", case["name"].as_str().unwrap());
            let played = notes(&case["played"]);
            let labels = case["labels"].as_array().unwrap();
            let (events, result) =
                follow_with_hands(&expected, &labels_of_hands, &played, cfg).unwrap();
            assert_eq!(events.len(), labels.len(), "{name}: one event per press");
            let harm = sets.entry(set).or_default();
            let mut agreed = 0;
            for (e, l) in events.iter().zip(labels) {
                agreed += usize::from(agrees(e, l, &pitch));
                let kind = l[0].as_str().unwrap().trim_end_matches('~');
                let right = matches!(kind, "hit" | "late" | "either" | "repeat" | "same");
                harm.right_called_wrong += usize::from(right && e.kind == EventKind::Wrong);
                harm.wrong_called_right += usize::from(
                    kind == "wrong"
                        && matches!(e.kind, EventKind::Hit | EventKind::Late | EventKind::Repeat),
                );
                harm.right_unsure += usize::from(right && e.kind == EventKind::Unsure);
                harm.unsure += usize::from(e.kind == EventKind::Unsure);
            }
            let agreement = if labels.is_empty() {
                1.0
            } else {
                agreed as f64 / labels.len() as f64
            };
            harm.cases += 1;
            harm.agreement += agreement;
            let family = case["family"].as_str().unwrap();
            if PERFECT.contains(&family) {
                assert!(
                    agreement >= 1.0,
                    "{name}: agreement {agreement:.3}, every press must agree"
                );
            }
            if let Some(h) = case["expect"]["hands"].as_str() {
                assert_eq!(hands_name(result.hands), h, "{name}: hands played");
            }
            let entry = families
                .entry(format!("{set} {family}"))
                .or_insert((0.0, 1.0, 0));
            entry.0 += agreement;
            entry.1 = entry.1.min(agreement);
            entry.2 += 1;
        }
    }
    for (family, (sum, worst, count)) in &families {
        eprintln!(
            "{family:<32} mean {:.3} worst {worst:.3}",
            sum / *count as f64
        );
    }
    let cases: usize = sets.values().map(|h| h.cases).sum();
    assert!(cases >= 1_500, "the corpus has {cases} cases");
    for &(set, rw, wr, unsure, mean) in MEASURED {
        let harm = &sets[set];
        let got = harm.agreement / harm.cases as f64;
        eprintln!(
            "{set}: {} cases, mean agreement {got:.4}, right called wrong {}, wrong called right {}, unsure {} ({} of them right notes)",
            harm.cases, harm.right_called_wrong, harm.wrong_called_right, harm.unsure, harm.right_unsure
        );
        assert!(
            harm.right_called_wrong <= rw,
            "{set}: {} right notes called wrong, measured {rw}",
            harm.right_called_wrong
        );
        assert!(
            harm.wrong_called_right <= wr,
            "{set}: {} wrong presses called right, measured {wr}",
            harm.wrong_called_right
        );
        assert!(
            harm.right_unsure <= unsure,
            "{set}: {} right notes left unsure, measured {unsure}",
            harm.right_unsure
        );
        assert!(
            got >= mean,
            "{set}: mean agreement {got:.4}, measured {mean}"
        );
    }
}

#[test]
fn output_matches_the_golden_file() {
    let mut golden = serde_json::Map::new();
    for doc in load() {
        let expected = notes(&doc["expected"]);
        let labels_of_hands = hands(&doc["hands"]);
        let cfg = config(&doc["config"]);
        for case in doc["cases"].as_array().unwrap() {
            let played = notes(&case["played"]);
            let plain = score(&expected, &played, ScoreConfig::default()).unwrap();
            let (events, result) =
                follow_with_hands(&expected, &labels_of_hands, &played, cfg).unwrap();
            golden.insert(
                format!(
                    "{}/{}",
                    doc["name"].as_str().unwrap(),
                    case["name"].as_str().unwrap()
                ),
                json!({
                    "score": {
                        "expected": plain.expected, "hits": plain.hits, "misses": plain.misses,
                        "wrong": plain.wrong, "accuracy_bits": plain.accuracy.to_bits(),
                        "mean_timing_error_bits": plain.mean_timing_error_ms.map(f32::to_bits),
                    },
                    "events": events.len(),
                    "digest": digest(&events),
                    "follow": summary(&result),
                }),
            );
        }
    }
    // one line for each case keeps the file small and a changed case easy to see
    let lines: Vec<String> = golden
        .iter()
        .map(|(k, v)| format!("{}:{}", Value::String(k.clone()), v))
        .collect();
    let text = format!("{{\n{}\n}}\n", lines.join(",\n"));
    let path = dir().join("golden.json");
    if std::env::var("UPDATE_GOLDEN").is_ok() {
        std::fs::write(&path, &text).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(&path).unwrap_or_default(),
        text,
        "golden.json is stale: run UPDATE_GOLDEN=1 cargo test --test fixtures"
    );
}

#[test]
fn the_digest_changes_when_any_event_number_changes() {
    let base = Event {
        played_index: 3,
        kind: EventKind::Hit,
        expected_index: Some(7),
        position: 2,
        error_ms: -4,
        speed_ppm: 1_000_000,
        jumped_from: None,
    };
    let one = digest(&[base]);
    for changed in [
        Event {
            played_index: 4,
            ..base
        },
        Event {
            kind: EventKind::Late,
            ..base
        },
        Event {
            expected_index: None,
            ..base
        },
        Event {
            position: 3,
            ..base
        },
        Event {
            error_ms: 4,
            ..base
        },
        Event {
            speed_ppm: 999_999,
            ..base
        },
        Event {
            jumped_from: Some(0),
            ..base
        },
    ] {
        assert_ne!(digest(&[changed]), one, "{changed:?}");
    }
}
