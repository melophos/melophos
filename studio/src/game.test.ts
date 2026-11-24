import { describe, expect, it } from "vitest";

import { bestId, difficultyKey, groupBests, judge, resultFrom, type Best, type Difficulty, type GameResult } from "./game";
import type { SessionRecord } from "./app/store";

const hard: Difficulty = { hand: "both", speedPct: 100, fromBar: null, toBar: null };
const record = (score: SessionRecord["score"]): SessionRecord => ({ id: "r", pieceId: "twinkle", pieceTitle: "Twinkle", startedAt: "2026-11-22T10:00:00Z", durationMs: 1, mode: "rhythm", hand: "both", fromBar: null, toBar: null, speedPct: 100, total: 0, firstTime: 0, wrongPresses: 0, longestRun: 0, score, laps: 1, missed: [] });
const result = (accuracy: number): GameResult => ({ accuracy, hits: 10, late: 1, misses: 2, wrong: 3, expected: 13, notJudged: 0 });
const best = (over: Partial<Best> = {}): Best => {
  const b: Best = { id: "", songId: "twinkle", songTitle: "Twinkle", difficulty: hard, engine: "v1", achievedAt: "2026-11-01T10:00:00Z", ...result(0.5), ...over };
  return { ...b, id: bestId(b.songId, b.difficulty, b.engine) };
};

describe("a game result is the engine's figures and nothing else", () => {
  it("takes every number from a field of the engine's summary", () => {
    const r = resultFrom(record({ expected: 13, hits: 10, late: 1, misses: 2, wrong: 3, repeats: 4, accuracy: 0.625, timingMs: null, notJudged: 5 }));
    expect(r).toEqual({ accuracy: 0.625, hits: 10, late: 1, misses: 2, wrong: 3, expected: 13, notJudged: 5 });
  });

  it("has no result when the engine gave no score", () => {
    expect(resultFrom(record(null))).toBeNull();
  });
});

describe("personal bests", () => {
  it("makes the first result of a song and setting its best", () => {
    expect(judge([], "twinkle", hard, result(0.4), "v1")).toEqual({ kind: "first" });
  });

  it("is a new best only for a higher engine accuracy and an equal one is not", () => {
    const keep = [best({ accuracy: 0.8 })];
    expect(judge(keep, "twinkle", hard, result(0.81), "v1")).toMatchObject({ kind: "new-best" });
    expect(judge(keep, "twinkle", hard, result(0.8), "v1")).toMatchObject({ kind: "not-best" });
    expect(judge(keep, "twinkle", hard, result(0.5), "v1")).toMatchObject({ kind: "not-best" });
  });

  it("keeps a best for each song, tempo, hand and range of bars apart", () => {
    const keep = [best({ accuracy: 0.9 })];
    expect(judge(keep, "twinkle", { ...hard, speedPct: 60 }, result(0.2), "v1")).toEqual({ kind: "first" });
    expect(judge(keep, "twinkle", { ...hard, hand: "left" }, result(0.2), "v1")).toEqual({ kind: "first" });
    expect(judge(keep, "twinkle", { ...hard, fromBar: 1, toBar: 2 }, result(0.2), "v1")).toEqual({ kind: "first" });
    expect(judge(keep, "ode-to-joy", hard, result(0.2), "v1")).toEqual({ kind: "first" });
    expect(new Set([difficultyKey("a", hard), difficultyKey("a", { ...hard, speedPct: 60 }), difficultyKey("a", { ...hard, hand: "left" }), difficultyKey("a", { ...hard, fromBar: 1, toBar: 2 }), difficultyKey("b", hard)]).size).toBe(5);
  });

  it("never compares a best from another version of the engine", () => {
    const old = [best({ engine: "old", accuracy: 0.99 })];
    expect(judge(old, "twinkle", hard, result(0.3), "new")).toEqual({ kind: "first" });
    const g = groupBests([...old, best({ engine: "new", accuracy: 0.3 })], "new");
    expect(g.current.map((b) => b.engine)).toEqual(["new"]);
    expect(g.earlier.map((b) => b.engine)).toEqual(["old"]);
  });
});

import { normaliseRange } from "./game";

describe("difficulty", () => {
  it("counts bars 1 to the end as the whole piece", () => {
    expect(normaliseRange(null, null, 8)).toEqual({ fromBar: null, toBar: null });
    expect(normaliseRange(1, 8, 8)).toEqual({ fromBar: null, toBar: null });
    expect(normaliseRange(3, 4, 8)).toEqual({ fromBar: 3, toBar: 4 });
    expect(normaliseRange(3, null, 8)).toEqual({ fromBar: 3, toBar: 8 });
  });
});
