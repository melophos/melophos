# MELOPHOS core

The MELOPHOS scoring engine in Rust. It compares what was played with what a song expected and reports hits, misses, wrong notes, accuracy and timing.

> [!NOTE]
> This is a read-only copy published from [melophos/melophos](https://github.com/melophos/melophos). Open issues and pull requests there.

## Why Rust

The Studio scores live in the browser and the server scores stored sessions. Both must agree exactly. One Rust crate compiles to WebAssembly for the Studio and to a Python module for the server, so there is a single implementation. See ADR 3 in the [decisions](https://github.com/melophos/docs/blob/main/decisions.md).

## Usage

```rust
use melophos_core::{score, Note, ScoreConfig};

let expected = [Note { t_ms: 0, note: 60 }, Note { t_ms: 500, note: 62 }];
let played = [Note { t_ms: 30, note: 60 }, Note { t_ms: 520, note: 63 }];
let result = score(&expected, &played, ScoreConfig::default()).unwrap();
assert_eq!(result.hits, 1);
assert_eq!(result.wrong, 1);
```

## How scoring works

1. Each expected note, in the order given, is matched with the closest unused press of the same pitch inside the timing window (150 ms by default). Of two presses equally close the earlier wins.
2. Unmatched expected notes are misses. Unmatched presses are wrong notes.
3. Accuracy is hits divided by expected notes plus wrong notes, so pressing every key cannot score full marks.

The presses of each pitch are sorted once, so 20 000 notes against 20 000 presses take about 20 ms. Both lists are capped (100 000 notes, 216 000 presses) and a note above 127 is refused: `score` returns a `FollowError` for each.

## Following a performance

`score` compares presses with the clock as written. A learner who plays steadily at 60 percent speed is late on every note. `follow` aligns the presses with the piece as they arrive and measures the tempo as it goes, so a steady slow performance scores as steady: every note is a hit at any steady speed from 40 to 200 percent on the textures the tests cover, down to notes 120 ms apart as played. It follows each hand as a line of its own, one hand alone, hands a little apart, hesitations, restarts, repeats and jumps. A press it cannot place with confidence is reported as unsure and not as wrong. The rules, every figure it reports, its bounds, its measured behaviour and its limits are in [docs/scoring.md](../docs/scoring.md). Why it is built this way is in [docs/scoring-design.md](../docs/scoring-design.md). Every measurement is from synthetic performances: nobody has played into this engine.

```rust
use melophos_core::{follow, FollowConfig, Note};

let piece = [
    Note { t_ms: 0, note: 60 },
    Note { t_ms: 500, note: 62 },
    Note { t_ms: 1000, note: 64 },
    Note { t_ms: 1500, note: 65 },
];
// the same notes at 60 percent speed: every gap is 500 / 0.6 = 833 ms
let played = [
    Note { t_ms: 200, note: 60 },
    Note { t_ms: 1033, note: 62 },
    Note { t_ms: 1866, note: 64 },
    Note { t_ms: 2700, note: 65 },
];
let (events, score) = follow(&piece, &played, FollowConfig::default()).unwrap();
assert_eq!(score.hits, 4);
assert_eq!(score.wrong, 0);
assert!(score.final_speed_ppm.abs_diff(600_000) < 5_000);
assert_eq!(events.len(), 4);
```

For a live session create a `Follower` and call `push` for each press. It returns the event for that press, any earlier events it now reads differently (`revised`) and how many presses are final (`settled`). Keep one event for each press and replace the revised ones: the place may step back only when `revised` is not empty or the event has `jumped_from` set. `Follower::with_hands` and `follow_with_hands` take a hand label for each expected note. Each labelled hand is followed as its own line and the summary says which hands were played.

The caller can pass what it knows so the engine need not guess it. All of it is optional.

| Input | How | What it does |
| --- | --- | --- |
| Where the learner starts | `Session { start_ms: Some(ms), .. }` to `Follower::with_session` or `follow_session` | The first press is read at that written time and judged at once. Left out, the engine expects the top and leaves presses unsure until it has found the place |
| The hands practised | `Session { practise: Practise::Left, .. }` (or `Right`, `Both`) | With one hand named, the other hand's notes are never matched. A press that fits no note of the hand practised, on a key the other hand has written near the place, is left unsure: not credited and not called wrong, whether it is one slip or the other hand played throughout. Where the hands share their keys such a press is read as a note of the hand practised. Needs hand labels |
| A jump the learner asked for | `Follower::jump_to(ms)` before the next press. In a batch, `(press_index, ms)` pairs to `follow_session` | The next press is read from that written time. Notes played before and played again are repeats |

| Result | Meaning |
| --- | --- |
| `Hit` | The right note at the right place in time on the player's own clock |
| `Wrong` | A press the engine is sure was no note of the piece at the place the player had reached, including a key struck again straight after its note |
| `Unsure` | A press the engine cannot place with confidence. Show it neutrally. It counts neither for nor against the player |
| `Late` | The right note and place outside the window, early or late. The note counts as played, not as a hit and not as a wrong press |
| `Repeat` | A note matched again after a repeat or a restart. It is not penalised |

Every event carries `speed_ppm`, the tempo reached (1 000 000 is the written speed), `position` (the chord group reached), `error_ms` (against the player's own clock) and `jumped_from` (set where the reading arrived by a repeat, a restart or a jump). `FollowScore` adds `late`, `repeats`, `unsure`, `final_speed_ppm`, `mean_speed_ppm`, `hands`, `played_expected` and `played_accuracy`. A note is in time when it lands within a quarter of the gap between the notes around it, at the tempo being played, of where the player's own clock expects it. The window is never less than `window_ms` (150 ms). The tempo is the median of the last three intervals, so it follows an instant change within three intervals of at least 300 ms of score.

Limits: a piece of at most 100 000 notes, at most 216 000 presses in a session, notes from 0 to 127, presses in time order, a `window_ms` of 1 to 10 000 and a `band` of 4 to 256 (see `FollowConfig`). Bad input returns a `FollowError` that says what to change. Naming one hand for practice on a piece without hand labels is refused (`PractiseNeedsHands`), as is a jump that names no press (`BadJump`).

### Speed

Release build on an Apple M5 (arm64, macOS) with Rust 1.99.1, from `cargo run --release --example bench`, while the machine was running other work, so the tails include the scheduler. These figures are from this machine only.

| Case | Median per press | p99 | Worst seen |
| --- | --- | --- | --- |
| Following an exact performance, 100 to 100 000 notes | 0.5 to 0.6 us | 0.6 to 0.8 us | 31 us |
| Band 4, 64, 256 (1 000 notes) | 0.5 us | 0.5 to 0.6 us | 8 us |
| Presses of keys the piece does not have, 1 000 notes | 0.4 us | 0.4 us | 2 us |
| A long messy session: 200 000 presses of a child's mixture of mistakes on 26 640 notes, timed live from Python | 2 us (mean 33 us) | 361 us | 0.53 ms |
| Scattered presses over a 100 000 note piece (every press searches for a place) | 261 us | 304 us | 352 us |
| A whole 100 000 note exact performance in one call | 56 ms in all | | |

The sub-microsecond figure holds for exact playing only. A press that does not fit starts a search for another place, so a messy session averages tens of microseconds a press. The tail is that search: at most 1 028 places a press, which only a very long piece with a few pitches coming back all the time reaches. A test bounds the work of every press (see [docs/scoring.md](../docs/scoring.md#bounds)).

### Fixtures

There are three labelled sets, all synthetic, made for the follower before this one. `fixtures/corpus/` holds 14 textures as two pieces each, played in up to 59 ways across 34 families (the `-1` and `-2` files). `fixtures/final/` was made by its own generator (`make_final.py`) with other pieces, seeds and rules. In all there are 1 814 performances. The present follower was not tuned on them: the corpus test holds it to the harm it was measured at on each set (right notes called wrong, wrong presses called right, right notes left unsure and mean agreement). `fixtures/check/check_set.py` is a set of our own for trying a change (9 pieces in 21 ways of playing). It prints the same counts with the lowest accuracy given to a well-played performance and is not part of the golden file. `golden.json` holds a digest of every event and the exact summary of the native build, which the WebAssembly and Python tests match bit for bit. `python3 fixtures/generate.py` and `python3 fixtures/final/make_final.py` rewrite the sets. `UPDATE_GOLDEN=1 cargo test --test fixtures` rewrites the golden file after an intended change. The labels come from how each performance was built and never from the engine.

## WebAssembly

`wasm/` builds the same engine to an 84 KB WebAssembly module with a typed TypeScript wrapper. The same fixtures give the same bits as the native build, which a Node test checks. How to build it, why the build is reproducible and what a caller of the earlier version must change are in [wasm/README.md](wasm/README.md).

## Python module

`python/` builds the same engine as the Python module `melophos_core`, for the server to score stored sessions. It is built with [PyO3](https://pyo3.rs) and [maturin](https://www.maturin.rs). We chose them because they are the standard pair for a Rust extension: maturin builds a wheel straight from the crate in one command (`maturin build`) and PyO3 needs no hand-written C layer. The wheel uses the stable ABI (`abi3`), so one build per platform runs on every Python from 3.9 and the server's 3.12 and 3.14 both use it.

### Build and install

```bash
cd core/python
python3 -m venv .venv
.venv/bin/pip install "maturin>=1.7,<2" pytest
.venv/bin/maturin build --release --locked     # wheel in core/target/wheels
.venv/bin/maturin develop --release --locked   # or install it into the venv for development
.venv/bin/pytest -q
```

`make test-core-python` runs the last two. CI builds the wheel on Python 3.12 and 3.14 in the `Core (Python module)` job and keeps it as an artifact. On the machine that built this (Apple M5, Python 3.15) the 305 tests pass against the module installed by `maturin develop`.

### Interface

```python
from melophos_core import Follower, ScoringError, follow, score
```

A note is a pair `(time_ms, midi_note)`: the time is a whole number from 0 to 4 294 967 295 and the note from 0 to 127. A list of notes can be any sequence or other iterable of such pairs, each pair a tuple, a list or another two-item sequence. `expected` is the piece and `played` the presses in time order. `hands` is optional: one of `"left"`, `"right"` or `None` for each expected note (the server has these in `song_notes.hand`).

| Call | Returns |
| --- | --- |
| `score(expected, played, window_ms=150)` | `Score`: the first pass against the clock as written |
| `follow(expected, played, *, hands=None, start_ms=None, practise=None, jumps=None, window_ms=150, band=16, pause_ms=2500, chord_ms=50, relocate_after=3)` | `FollowResult`: `events` (one `FollowEvent` per press, every change of reading already applied) and `score` (a `FollowScore`) |
| `Follower(expected, *, hands=None, start_ms=None, practise=None, window_ms=150, band=16, pause_ms=2500, chord_ms=50, relocate_after=3)` | A live session. `push(t_ms, note)` returns a `PushResult` (`event`, `revised` and `settled`). `jump_to(to_ms)` says the learner goes on from that written time. `finish()` returns a `FollowScore`. `speed_ppm` and `position` are read-only |

`start_ms` is the written time the learner starts from, `practise` is `"left"`, `"right"` or `"both"` and `jumps` is a list of `(press_index, to_ms)` pairs: before the press with that index the learner asked to go on from `to_ms`. Each is optional and means "not known" when left out.

`MAX_EXPECTED` (100 000) and `MAX_PLAYED` (216 000) are the limits.

`follow` and `score` release the interpreter lock while they run, so a worker thread can score without blocking the server's other threads. A `Follower` is not safe to share between threads.

The result types are frozen (read only) and carry these attributes:

| Type | Attributes |
| --- | --- |
| `Score` | `expected`, `hits`, `misses`, `wrong` (ints) and `accuracy` (float from 0 to 1) and `mean_timing_error_ms` (float or `None`) |
| `FollowScore` | the same and `late`, `repeats`, `unsure`, `final_speed_ppm` (1 000 000 is the written speed), `mean_speed_ppm` (int or `None`), `hands` (`"unknown"`, `"neither"`, `"left"`, `"right"` or `"both"`), `played_expected` and `played_accuracy` |
| `FollowEvent` | `played_index`, `kind` (`"hit"`, `"wrong"`, `"late"`, `"repeat"` or `"unsure"`), `expected_index` (int or `None`), `position`, `error_ms`, `speed_ppm` and `jumped_from` (int or `None`) |

Each float also comes as its exact 32-bit pattern (`accuracy_bits`, `mean_timing_error_bits`, `played_accuracy_bits`) for tests that compare builds bit for bit. `accuracy` is the stored 32-bit value widened to a Python float, so it is exact but prints with more digits than the native value. Every result type can be pickled and compared.

What the server should store for a session: `result.score.accuracy`, `result.score.mean_timing_error_ms` and `result.score.final_speed_ppm`. Store `None` as a database null. Each is defined in [docs/scoring.md](../docs/scoring.md#the-figures). To show "right hand only" honestly, pass `hands` and show `played_accuracy` when `hands` is `"left"` or `"right"`. When the session records which hand was practised, pass it as `practise` too. Store `result.score.unsure` beside `late` if the session page shows counts: an unsure press is neither a hit nor a wrong press.

### Errors

- `ScoringError` (a subclass of `ValueError`) is raised when the engine refuses its input. The message names what to change. Causes: a time or note out of range however large (the message names the list and the index, for example `played[3] note must be a whole number from 0 to 127`), a setting out of range, a piece over 100 000 notes, more than 216 000 presses, hand labels of the wrong length and presses out of time order.
- `TypeError` is raised when an argument is not a sequence of integer pairs: a string, a pair of three items, a float or a bool where an int belongs. The message names the field.
- A refused `push` changes nothing, so the session can carry on with the next press.

The same module has a type stub (`__init__.pyi`) and a `py.typed` marker, so `mypy` checks calls to it.

## Development

```bash
cargo test
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

The binding crates are workspace members, so check them with `cargo fmt --all --check` and `cargo clippy --workspace --all-targets -- -D warnings` as well.

`rust-toolchain.toml` pins the compiler to Rust 1.99.1, which rustup installs and uses for every build here. The WebAssembly build checks for it, since the module is byte-for-byte reproducible only with that compiler. The lowest versions that compile were checked with those toolchains. The engine, the WebAssembly glue and the Python module build with Rust 1.85. The tests need 1.88 (for `proptest`).

## Licence

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE).
