import { describe, expect, it } from "vitest";

import { notJudgedOf, verdictOf } from "./scoring";

describe("what the Studio makes of an engine outcome", () => {
  it("calls a hit and a late note right and a wrong key wrong", () => {
    expect(verdictOf({ kind: "hit" })).toBe("right");
    expect(verdictOf({ kind: "late" })).toBe("right");
    expect(verdictOf({ kind: "wrong" })).toBe("wrong");
  });

  it("calls a replayed note right, for the note it repeats", () => {
    expect(verdictOf({ kind: "repeat" })).toBe("right");
  });

  it("calls an unsure press unsure and anything unknown unsure, so a new kind of outcome is never called right or wrong by mistake", () => {
    expect(verdictOf({ kind: "unsure" })).toBe("unsure");
    expect(verdictOf({ kind: "something new" })).toBe("unsure");
  });

  it("reads the share of presses not judged from the summary and is zero where the engine does not say", () => {
    expect(notJudgedOf({ hits: 3 })).toBe(0);
    expect(notJudgedOf({ unsure: 4 })).toBe(4);
    expect(notJudgedOf({ notJudged: 2 })).toBe(2);
    expect(notJudgedOf({ unsure: "many" })).toBe(0);
  });
});
