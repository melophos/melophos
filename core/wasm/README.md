# Scoring engine for the browser

The scoring engine in `../src` compiled to WebAssembly, with a small typed wrapper for TypeScript. It gives the same scores as the native build, bit for bit. This page says how to build it, how to use it and what a caller of the earlier version must change.

| Path | What it is |
| --- | --- |
| `src/lib.rs` | The glue crate (`melophos-core-wasm`). It passes flat typed arrays so no value is converted on the way |
| `build.sh` | The one command that builds everything |
| `package/src/index.ts` | The typed wrapper: `init`, `initSync`, `follow`, `scorePassage`, `Follower`, `Session`, `ScoringError` |
| `package/tests/` | Node tests: the whole corpus against `golden.json`, input checks of every shape and the unloaded state |
| `package/pkg/` | Built: the module and its generated glue (not in git) |
| `package/dist/` | Built: the wrapper as JavaScript with type declarations (not in git) |

## Build

You need Rust 1.99.1 (the version `core/rust-toolchain.toml` pins, which rustup picks for you) with the `wasm32-unknown-unknown` target, `wasm-bindgen-cli` at exactly the version in `Cargo.lock` and Node 24 or later.

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130 --locked
cd core/wasm/package && npm ci && cd ../..
sh wasm/build.sh
```

`build.sh` checks the compiler version and both tools and prints the command to run when one is wrong or missing. If a different `rustc` comes first on your path than the one rustup manages, it says so and shows how to put rustup's first.

From the repository root, `make test-core-wasm` builds and then runs the type check and the Node tests. CI runs the same steps in the `Core (WebAssembly)` job and keeps the built package as an artifact.

### Size

84 458 bytes for the module and about 18 000 bytes for the generated loader, measured on the build from this checkout. Running `WASM_OPT=1 sh wasm/build.sh` adds an optional size pass with binaryen. It is off by default because a different binaryen version can change the bytes.

### Memory

WebAssembly memory grows and never shrinks. A live session holds the piece (about 60 bytes a note), one number for each note and at most 7 readings of 48 presses, so a session of ordinary length takes a few hundred kilobytes. A batch `follow` call also holds one event for each press. The figure for a session at the press limit on a 100 000 note piece has not been measured for this version: the earlier follower took the module to 18 MB there. More than 216 000 presses are refused with a `ScoringError`.

### Why the build is reproducible

- The compiler is pinned in `core/rust-toolchain.toml` and the script stops on any other version.
- Dependencies come from `Cargo.lock` (`--locked`).
- The command line tool must equal the `wasm-bindgen` crate version or the script stops.
- Paths are remapped (`--remap-path-prefix`), so the bytes do not depend on where the repository is checked out.
- The name and producers sections are dropped and symbols are stripped.
- The profile is fixed in `Cargo.toml` (`[profile.wasm]`: size optimised, one codegen unit, link time optimisation, no unwinding).

Built here in place the module has the SHA-256 `02fa0fd92b846ef69633aa4e34e602af56273c21bd3f3a31f614fe670cbf4b89`. The build from a copy in another directory was checked for the earlier version and not again for this one. A different Rust or wasm-bindgen version gives different bytes. The script prints both versions beside the hash.

### Why the scores match the native build

Every decision the engine makes uses integers. The only floating point values are the accuracy, the accuracy over the hands played and the mean timing error, each a single division of two 32-bit floats. Sums are kept in 64-bit integers on every target, so a long session cannot wrap on the 32-bit WebAssembly target. That division is correctly rounded on every target by the IEEE 754 standard and WebAssembly follows it exactly. The engine uses no fused multiply-add and no maths functions. The build sets no fast-math flag. The wrapper hands back the exact bit pattern next to each float (`accuracyBits`) so a test can compare bits and not rounded text.

`package/tests/fixtures.test.ts` runs all 1 814 cases of the three labelled sets in `../fixtures` through `follow`, `scorePassage` and a live `Follower`. It compares a digest of every event and every summary number with `golden.json`, which the native test wrote. The native test fails when `golden.json` is stale. The Node test therefore fails when either side changes. See [docs/scoring.md](../../docs/scoring.md#floating-point-and-the-three-builds).

## Use

```ts
import { readFileSync } from "node:fs";
import { follow, initSync } from "@melophos/core";

initSync(readFileSync("node_modules/@melophos/core/pkg/melophos_core_wasm_bg.wasm"));
const { events, summary } = follow(piece, played);
console.log(summary.hits, summary.finalSpeedPpm);
```

In a browser call `await init(url)` with the URL of the `.wasm` file. Notes are `{ tMs, note }`. An expected note may also carry `hand: "left"` or `hand: "right"` so the summary can say which hands were played. Any bad input throws a `ScoringError` that names the field: a bad number (a fraction, a negative time, a pitch above 127), something that is not an array of notes, a hole in a sparse array, a getter that throws, presses out of time order, a configuration out of range and a list over its limit (`MAX_EXPECTED`, `MAX_PLAYED`).

Both `follow` and `Follower` take an optional `Session` after the configuration: what the caller knows, so the engine need not guess it.

```ts
const session = new Follower(song.notes, undefined, { startMs: barStartMs, practise: "right" });
session.jumpTo(phraseStartMs); // the learner pressed Repeat or Next phrase
const { events } = follow(song.notes, presses, undefined, { jumps: [{ beforePress: 40, toMs: 0 }] });
```

`startMs` is the written time the learner starts from. `practise` is `"left"`, `"right"` or `"both"`: with one hand named the other hand's notes are never matched and a press on one of its keys near the place that fits no note of the hand practised is `"unsure"`, so the notes need `hand`. `jumpTo` (live) and `jumps` (batch) say that the learner goes on from a written time. An event's `kind` is `"hit"`, `"late"`, `"repeat"`, `"wrong"` or `"unsure"`. Unsure is a press the engine cannot place with confidence: show it neutrally and count it neither way. The summary has `unsure` beside `wrong`.

For a live session create a `Follower`, call `push` for each press and `free()` at the end (or declare it with `using`). `push` returns the event for the press, any earlier events the engine now reads differently (`revised`) and how many presses are final (`settled`). Keep one event per press and replace the revised ones. The place may step back only when `revised` is not empty or the event has `jumpedFrom` set. `speedPpm` and `position` report where the session is. Calling `free()` twice does nothing. A session used after `free()` throws a `ScoringError` that says so.

## What a caller of the earlier version must change

Nothing in `studio/` was touched by this change. The Studio builds against the package as before. These are the changes its code needs to use what is new, none of which has been run in the Studio.

1. **Handle `"unsure"`.** `FollowEvent.kind` has a fifth value. A switch over kinds that treats everything but `"hit"` and `"late"` as wrong must not treat `"unsure"` as wrong. Show it neutrally: no wrong sound, no "Wrong" announcement and no change to a streak. It can later be revised to any other kind through `revised`.
2. **Treat `"repeat"` as a right note in the practice view.** After `jumpTo`, notes played before come back as `"repeat"`.
3. **Pass the start and the hand.** Pass `{ startMs, practise }` as the third argument of `new Follower` where the Studio knows them. It may then give the engine the whole piece with hand labels in place of a slice, so that in one-hand practice a press on one of the other hand's keys is not credited as a note. Such a press comes back as `"unsure"` whether it is one slip or the other hand played throughout. Where the two hands share their keys it can come back as a note of the hand practised.
4. **Tell the engine about Repeat and Next phrase** with `jumpTo(toMs)` on the live session in place of starting a new `Follower`. For the score of a whole run, pass `jumps` to `follow`.
5. **Stop widening the window for slow practice.** The engine now widens it with the gap between notes at the tempo being played. `windowMs` is the floor (150 ms). Keep the very wide window only where timing is not to be judged at all.
6. **Decide where `summary.unsure` is shown.** It is a count of its own and is not part of `accuracy`.
7. **The golden fixtures changed.** `core/fixtures/golden.json` was written again by the native test: every digest is new and each summary has an `unsure` field. A browser test that compares with it needs the kind list `["hit", "wrong", "late", "repeat", "unsure"]` when it computes a digest.

If the Studio ever sets a Content Security Policy it needs `script-src 'wasm-unsafe-eval'` so the browser may compile the module. `init` fetches the `.wasm` file, so `connect-src` must allow the place it is served from. The server must send it as `application/wasm` for the browser to compile it while it downloads.
