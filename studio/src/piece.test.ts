import { describe, expect, it } from "vitest";

import { Practice } from "./practice";
import { barCount, excerpt, groupsOf, layout, rangeOf, totalBeats } from "./piece";
import { SONGS, type Song } from "./songs";

const brother = SONGS.find((s) => s.id === "brother-john")!;

describe("layout", () => {
  it("follows one note after another when no start is given", () => {
    const song: Song = { id: "t", title: "t", composer: "t", tempo: 60, notes: [{ note: 60, beats: 1 }, { note: 62, beats: 2 }, { note: 64, beats: 1 }] };
    expect(layout(song).map((n) => n.startBeat)).toEqual([0, 1, 3]);
    expect(totalBeats(song)).toBe(4);
    expect(barCount(song)).toBe(1);
  });

  it("lays two hands on the same timeline", () => {
    const notes = layout(brother);
    expect(totalBeats(brother)).toBe(32);
    expect(barCount(brother)).toBe(8);
    expect(notes.filter((n) => n.hand === "left")).toHaveLength(8);
    // the left hand's first note shares a beat with the right hand's first
    expect(groupsOf(notes)[0]?.map((n) => n.hand).sort()).toEqual(["left", "right"]);
  });

  it("picks one hand and a range of bars", () => {
    const left = excerpt(brother, { hand: "left" });
    expect(left.every((n) => n.hand === "left")).toBe(true);
    const bars = excerpt(brother, { hand: "right", fromBar: 3, toBar: 4 });
    expect(bars[0]?.startBeat).toBe(8);
    expect(bars.at(-1)?.startBeat).toBeLessThan(16);
    expect(bars.map((n) => n.index)).toEqual(bars.map((_, i) => i));
  });

  it("finds the range of keys a passage uses", () => {
    expect(rangeOf(layout(brother))).toEqual({ lowest: 43, highest: 69 });
    expect(rangeOf([])).toBeNull();
  });
});

describe("practice with two hands and chords", () => {
  it("asks for both notes of a group before it steps on", () => {
    const p = new Practice(brother);
    expect(p.due).toEqual([48, 60]);
    expect(p.play(60, 0)?.correct).toBe(true);
    expect(p.position).toBe(0);
    expect(p.due).toEqual([48]);
    expect(p.upcoming(2)).toEqual([48, 62]);
    expect(p.play(48, 40)?.correct).toBe(true);
    expect(p.position).toBe(1);
  });

  it("counts notes right first time and what was missed", () => {
    const p = new Practice(brother, { hand: "right" });
    p.play(60, 0);
    p.play(61, 600);
    p.play(62, 700);
    p.play(64, 1400);
    const s = p.summary();
    expect(s.total).toBe(brother.notes.filter((n) => n.hand === "right").length);
    expect(s.firstTime).toBe(2);
    expect(p.missedNotes.get(62)).toBe(1);
  });

  it("practises one hand only", () => {
    const p = new Practice(brother, { hand: "left" });
    expect(p.upcoming(1)).toEqual([48]);
    expect(p.play(60, 0)?.correct).toBe(false);
  });
});
