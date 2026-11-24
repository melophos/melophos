import { describe, expect, it } from "vitest";

import { beatsPerSecond, describeNext, indicatorByBar, phraseInfo, type NextNote } from "./session";
import { SONGS } from "../songs";

const n = (spoken: string, hand: "right" | "left", together: boolean, finger: number | null = null): NextNote => ({ note: 60, label: spoken, spoken, hand, finger, together });

describe("the text line of what is next", () => {
  it("names the note, the hand and the finger, then what follows", () => {
    expect(describeNext([n("C 4", "right", true, 1), n("D 4", "right", false), n("E 4", "right", false)])).toBe("Next: C 4, right hand, finger 1. Then D 4, E 4.");
  });

  it("says together for two hands on one beat", () => {
    expect(describeNext([n("C 3", "left", true), n("C 4", "right", true), n("D 4", "right", false)])).toBe("Next: together, C 3, left hand and C 4, right hand. Then D 4, right hand.");
  });

  it("says when there is nothing left", () => {
    expect(describeNext([])).toBe("Nothing more to play.");
  });
});

describe("phrases", () => {
  const song = SONGS.find((s) => s.id === "brother-john")!;

  it("makes a phrase of four bars", () => {
    expect(phraseInfo(song, 1, 8, 1)).toEqual({ index: 0, count: 2, fromBar: 1, toBar: 4 });
    expect(phraseInfo(song, 1, 8, 5)).toEqual({ index: 1, count: 2, fromBar: 5, toBar: 8 });
    expect(phraseInfo(song, 3, 4, 4)).toEqual({ index: 0, count: 1, fromBar: 3, toBar: 4 });
  });
});

describe("the beat indicator", () => {
  it("switches to bars before it could flash faster than 2.5 a second", () => {
    expect(beatsPerSecond(120, 1)).toBe(2);
    expect(indicatorByBar(120, 1)).toBe(false);
    // 208 beats a minute is 3.5 a second
    expect(indicatorByBar(208, 1)).toBe(true);
    expect(indicatorByBar(100, 1.25)).toBe(false);
    expect(indicatorByBar(160, 1.25)).toBe(true);
  });
});
