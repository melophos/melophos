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
let result = score(&expected, &played, ScoreConfig::default());
assert_eq!(result.hits, 1);
assert_eq!(result.wrong, 1);
```

## How scoring works

1. Each expected note is matched with the closest unused press of the same pitch inside the timing window (150 ms by default).
2. Unmatched expected notes are misses. Unmatched presses are wrong notes.
3. Accuracy is hits divided by expected notes plus wrong notes, so pressing every key cannot score full marks.

## Development

```bash
cargo test
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

## Licence

GNU Affero General Public License v3.0 or later, see [LICENSE](LICENSE).
