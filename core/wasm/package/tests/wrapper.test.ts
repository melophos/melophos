// behaviour of the wrapper itself: loading, bad input of every shape and the defaults.

import assert from "node:assert/strict";
import { test } from "node:test";
import { limits } from "../pkg/melophos_core_wasm.js";
import {
  DEFAULT_CONFIG,
  Follower,
  MAX_EXPECTED,
  MAX_PLAYED,
  ScoringError,
  follow,
  scorePassage,
  type Note,
} from "../src/index.ts";
import { corpus, loadModule } from "./load.ts";

loadModule();

const tune = Array.from({ length: 24 }, (_, i) => ({ tMs: i * 400, note: 50 + ((i * i * 7 + i * 3 + 11 * Math.floor(i / 5)) % 29) }));
const refused = (e: unknown): boolean => e instanceof ScoringError;

test("an empty piece and an empty performance are a perfect score", () => {
  const r = follow([], []);
  assert.equal(r.events.length, 0);
  assert.equal(r.summary.accuracy, 1);
  assert.equal(r.summary.meanTimingErrorMs, null);
  assert.equal(r.summary.hands, "unknown");
  assert.equal(scorePassage([], []).accuracy, 1);
});

test("the limits and the defaults are the ones in the Rust crate", () => {
  assert.deepEqual(Array.from(limits()), [MAX_EXPECTED, MAX_PLAYED]);
  const c = corpus()[0]!;
  assert.deepEqual(follow(c.expected, c.played), follow(c.expected, c.played, { ...DEFAULT_CONFIG }));
});

test("numbers that a typed array would silently wrap are refused", () => {
  const bad = (tMs: unknown, note: unknown) => () => follow([], [{ tMs, note } as unknown as Note]);
  for (const [t, n] of [[-1, 60], [1.5, 60], [4_294_967_296, 60], [0, 128], [0, 60.5], [Number.NaN, 60], ["5", 60], [0, null]]) {
    assert.throws(bad(t, n), refused, `${String(t)}, ${String(n)}`);
  }
});

test("input of the wrong shape is a ScoringError that says what is wrong", () => {
  const any = (x: unknown) => x as Note[];
  assert.throws(() => follow(any(null), []), (e: unknown) => refused(e) && /expected must be an array/.test(String(e)));
  assert.throws(() => follow(any("abc"), []), refused);
  assert.throws(() => follow([], any({ length: 1 })), refused);
  assert.throws(() => scorePassage(any(undefined), []), refused);
  // a hole in a sparse array is not the note (0, 0)
  const sparse: Note[] = [{ tMs: 0, note: 60 }];
  sparse[2] = { tMs: 10, note: 62 };
  assert.throws(() => follow(sparse, []), (e: unknown) => refused(e) && /expected\[1\]/.test(String(e)));
  // a getter that throws is reported, not passed through untyped
  const hostile = { get tMs(): number { throw new Error("no"); }, note: 60 };
  assert.throws(() => follow([hostile], []), (e: unknown) => refused(e) && /expected\[0\]\.tMs/.test(String(e)));
  assert.throws(() => follow([{ tMs: 0, note: 60, hand: "middle" as "left" }], []), /hand/);
  assert.throws(() => follow([], [], null as unknown as undefined), refused);
});

test("a configuration out of range is refused with the name of the field", () => {
  assert.throws(() => follow([], [], { band: 2 }), /band/);
  assert.throws(() => follow([], [], { relocateAfter: 9 }), /relocateAfter/);
  assert.throws(() => follow([], [], { pauseMs: 10 }), /pauseMs/);
  assert.throws(() => follow([], [], { windowMs: 10_001 }), /windowMs/);
});

test("lists over the limits are refused before anything is copied", () => {
  const huge = { length: MAX_EXPECTED + 1 } as unknown as Note[];
  assert.throws(() => follow(Array.from(huge, (_, i) => ({ tMs: i, note: 60 })), []), /100000/);
  const presses = Array.from({ length: MAX_PLAYED + 1 }, () => ({ tMs: 0, note: 60 }));
  assert.throws(() => follow([], presses), /216000/);
  assert.throws(() => scorePassage([], presses), /216000/);
});

test("presses out of time order are refused by the engine and change nothing", () => {
  const session = new Follower([{ tMs: 0, note: 60 }, { tMs: 500, note: 62 }]);
  try {
    session.push({ tMs: 100, note: 60 });
    assert.throws(() => session.push({ tMs: 50, note: 60 }), (e: unknown) => refused(e) && /earlier/.test(String(e)));
    assert.equal(session.push({ tMs: 600, note: 62 }).event.kind, "hit");
    assert.throws(() => session.push(null as unknown as Note), refused);
  } finally {
    session.free();
  }
  assert.throws(() => follow([], [{ tMs: 5, note: 1 }, { tMs: 4, note: 1 }]), /earlier/);
});

test("a live session reports the tempo and the place as it goes", () => {
  const session = new Follower(tune);
  try {
    for (const n of tune) session.push({ tMs: Math.round((n.tMs * 100) / 60), note: n.note });
    assert.ok(Math.abs(session.speedPpm - 600_000) < 20_000, `speed ${String(session.speedPpm)}`);
    assert.equal(session.position, 23);
    assert.equal(session.finish().hits, 24);
  } finally {
    session.free();
  }
});

test("a session used after free says so and freeing twice does nothing", () => {
  const session = new Follower(tune);
  session.free();
  session.free();
  const gone = (e: unknown): boolean => refused(e) && /freed/.test(String(e));
  assert.throws(() => session.push({ tMs: 0, note: 60 }), gone);
  assert.throws(() => session.finish(), gone);
  assert.throws(() => session.speedPpm, gone);
  assert.throws(() => session.position, gone);
});

test("a hand played alone is reported as that hand", () => {
  const piece: Note[] = [];
  for (let i = 0; i < 20; i++) {
    piece.push({ tMs: i * 500, note: 72 + (i % 5), hand: "right" });
    piece.push({ tMs: i * 500, note: 48 + (i % 4), hand: "left" });
  }
  const right = piece.filter((n) => n.hand === "right").map(({ tMs, note }) => ({ tMs, note }));
  const { summary } = follow(piece, right);
  assert.equal(summary.hands, "right");
  assert.equal(summary.wrong, 0);
  assert.equal(summary.playedExpected, 20);
  assert.equal(summary.playedAccuracy, 1);
});

test("the timing error sum does not wrap past 32 bits", () => {
  // 128 pitches, 100 notes each 40 000 000 ms apart, every press 10 000 000 ms late:
  // the errors add up to 1.28e11, which a 32-bit sum would wrap
  const expected: Note[] = [];
  const played: Note[] = [];
  for (let note = 0; note < 128; note++) {
    for (let k = 0; k < 100; k++) {
      expected.push({ tMs: k * 40_000_000, note });
      played.push({ tMs: k * 40_000_000 + 10_000_000, note });
    }
  }
  const result = scorePassage(expected, played, 4_000_000_000);
  assert.equal(result.hits, 12_800);
  assert.equal(result.meanTimingErrorMs, 10_000_000);
});

const twoHands = (): Note[] => {
  const piece: Note[] = [];
  for (let i = 0; i < 24; i++) {
    piece.push({ tMs: i * 500, note: 72 + ((i * 5 + Math.floor(i / 3)) % 11), hand: "right" });
    for (let k = 0; k < 2; k++) piece.push({ tMs: i * 500 + k * 250, note: 43 + ((i * 3 + k * 4) % 9), hand: "left" });
  }
  return piece;
};

test("a start the caller knows makes the first press a hit", () => {
  const piece = twoHands();
  const part = piece
    .filter((n) => n.tMs >= 10_000)
    .map((n) => ({ tMs: n.tMs - 10_000 + 300, note: n.note }))
    .sort((a, b) => a.tMs - b.tMs || a.note - b.note);
  const told = new Follower(piece, undefined, { startMs: 10_000 });
  try {
    for (const press of part) assert.equal(told.push(press).event.kind, "hit");
  } finally {
    told.free();
  }
  // not told, every press still ends as a hit and none is ever wrong
  assert.deepEqual([...new Set(follow(piece, part).events.map((e) => e.kind))], ["hit"]);
});

test("the hand named for practice is the only one matched", () => {
  const piece = twoHands();
  const right = piece.filter((n) => n.hand === "right").map((n) => ({ tMs: n.tMs + 300, note: n.note }));
  const slip = piece.find((n) => n.hand === "left" && n.tMs === right[9]!.tMs - 300)!.note;
  right[9] = { tMs: right[9]!.tMs, note: slip };
  const told = follow(piece, right, undefined, { practise: "right" });
  // the key is the other hand's note at that place: it is not credited and not called wrong
  assert.equal(told.events[9]!.kind, "unsure");
  assert.equal(told.events[9]!.expectedIndex, null);
  assert.equal(told.summary.hands, "right");
  assert.equal(told.summary.playedExpected, 24);
  assert.equal(told.summary.wrong, 0);
  assert.equal(told.summary.unsure, 1);
  assert.ok(["hit", "late"].includes(follow(piece, right).events[9]!.kind));
  // both hands played with one named: the other hand's presses are all left unsure
  const all = [...piece].sort((a, b) => a.tMs - b.tMs || a.note - b.note).map((n) => ({ tMs: n.tMs + 300, note: n.note }));
  const both = follow(piece, all, undefined, { practise: "right" });
  assert.equal(both.summary.hits, 24);
  assert.equal(both.summary.wrong, 0);
  assert.equal(both.summary.unsure, 48);
  const bare = piece.map(({ tMs, note }) => ({ tMs, note }));
  assert.throws(() => follow(bare, right, undefined, { practise: "right" }), refused);
  assert.throws(() => follow(piece, right, undefined, { practise: "both hands" as "both" }), refused);
});

test("a stated jump is followed live and in a batch", () => {
  const piece = Array.from({ length: 24 }, (_, i) => ({ tMs: i * 400, note: 50 + ((i * 7 + Math.floor(i / 5) * 3) % 29) }));
  const played = [...piece.slice(0, 12), ...piece.slice(4, 16).map((n, k) => ({ tMs: piece[11]!.tMs + 1000 + 400 * k, note: n.note }))];
  const session = new Follower(piece);
  const kinds: string[] = [];
  try {
    played.forEach((press, i) => {
      if (i === 12) session.jumpTo(1600);
      kinds.push(session.push(press).event.kind);
    });
    const want = [...Array<string>(12).fill("hit"), ...Array<string>(8).fill("repeat"), ...Array<string>(4).fill("hit")];
    assert.deepEqual(kinds, want);
    const batch = follow(piece, played, undefined, { jumps: [{ beforePress: 12, toMs: 1600 }] });
    assert.deepEqual(batch.events.map((e) => e.kind), want);
    assert.deepEqual(batch.summary, session.finish());
    assert.notEqual(batch.events[12]!.jumpedFrom, null);
    assert.throws(() => follow(piece, played, undefined, { jumps: [{ beforePress: 99, toMs: 0 }] }), refused);
    assert.throws(() => session.jumpTo(-1), refused);
  } finally {
    session.free();
  }
});

test("a press that cannot be placed is unsure and counts neither way", () => {
  const piece = Array.from({ length: 16 }, (_, i) => ({ tMs: i * 500, note: 50 + ((i * 7 + Math.floor(i / 5) * 3) % 29) }));
  const played = piece.map((n) => ({ ...n }));
  played[6] = { tMs: played[6]!.tMs, note: piece[8]!.note };
  played.splice(8, 1);
  const result = follow(piece, played);
  assert.equal(result.events[6]!.kind, "unsure");
  assert.equal(result.events[6]!.expectedIndex, null);
  assert.equal(result.summary.unsure, 1);
  assert.equal(result.summary.wrong, 0);
  assert.equal(result.summary.accuracy, Math.fround(result.summary.hits / 16));
});
