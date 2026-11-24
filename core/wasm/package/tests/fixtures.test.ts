// the whole corpus through the WebAssembly build must give exactly the bits that
// the native build wrote to golden.json: a digest of every event and every summary
// number, floats compared as their 32-bit patterns and not as rounded decimals.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Follower, follow, scorePassage, type FollowEvent, type FollowSummary } from "../src/index.ts";
import { corpus, digest, golden, loadModule } from "./load.ts";

loadModule();
const want = golden();
const cases = corpus();
const handCodes = ["unknown", "neither", "left", "right", "both"];

const bits = (s: FollowSummary) => ({
  expected: s.expected,
  hits: s.hits,
  late: s.late,
  misses: s.misses,
  wrong: s.wrong,
  repeats: s.repeats,
  unsure: s.unsure,
  accuracy_bits: s.accuracyBits,
  mean_timing_error_bits: s.meanTimingErrorBits,
  final_speed_ppm: s.finalSpeedPpm,
  mean_speed_ppm: s.meanSpeedPpm,
  hands: handCodes.indexOf(s.hands),
  played_expected: s.playedExpected,
  played_accuracy_bits: s.playedAccuracyBits,
});

test("there is a golden entry for every case and none left over", () => {
  assert.deepEqual(Object.keys(want).sort(), cases.map((c) => c.key).sort());
  assert.ok(cases.length >= 1500);
});

test("every case: follow matches the native build bit for bit", () => {
  for (const c of cases) {
    const g = want[c.key]!;
    const got = follow(c.expected, c.played, c.config);
    assert.equal(got.events.length, g.events, c.key);
    assert.equal(digest(got.events), g.digest, c.key);
    assert.deepEqual(bits(got.summary), g.follow, c.key);
  }
});

test("every case: score matches the native build bit for bit", () => {
  for (const c of cases) {
    const got = scorePassage(c.expected, c.played);
    assert.deepEqual(
      {
        expected: got.expected,
        hits: got.hits,
        misses: got.misses,
        wrong: got.wrong,
        accuracy_bits: got.accuracyBits,
        mean_timing_error_bits: got.meanTimingErrorBits,
      },
      want[c.key]!.score,
      c.key,
    );
  }
});

test("every case: a live session ends with the same alignment", () => {
  for (const c of cases) {
    const session = new Follower(c.expected, c.config);
    try {
      const final: FollowEvent[] = [];
      for (const press of c.played) {
        const { event, revised } = session.push(press);
        for (const r of revised) final[r.playedIndex] = r;
        final.push(event);
      }
      assert.equal(digest(final), want[c.key]!.digest, c.key);
      assert.deepEqual(bits(session.finish()), want[c.key]!.follow, c.key);
    } finally {
      session.free();
    }
  }
});
