import { describe, expect, it } from "vitest";

import { History, correctedCount, effectiveHands, splitHands, splitPointChanges, withChange } from "./hands";
import { parseMidi } from "./midi-file";
import { name, noteOff, noteOn, smf, track } from "../tests/lib/smf";

const play = (notes: [number, number][], ch = 0) => notes.flatMap(([n, delta]) => [noteOn(delta, ch, n), noteOff(100, ch, n)]);

describe("the first guess at the hands", () => {
  it("lets track names decide, even against the pitches", () => {
    const s = smf([track([name("Right hand"), ...play([[40, 0], [42, 0]])]), track([name("Left hand"), ...play([[80, 0], [82, 0]])])]);
    const split = splitHands(parseMidi(s));
    expect(split.method).toBe("track_name");
    const song = parseMidi(s);
    // the right hand track holds the low notes and the left hand track the high ones and the names win
    song.notes.forEach((n, i) => expect(split.hands[i]).toBe(n.note < 60 ? "right" : "left"));
  });

  it("puts the lower track on the left when the tracks are not named", () => {
    const song = parseMidi(smf([track(play([[70, 0], [72, 0]])), track(play([[40, 0], [43, 0]]))]));
    const split = splitHands(song);
    expect(split.method).toBe("track_pitch");
    expect(split.hands.filter((h) => h === "left")).toHaveLength(2);
    song.notes.forEach((n, i) => expect(split.hands[i]).toBe(n.note < 60 ? "left" : "right"));
  });

  it("calls a narrow piece one hand", () => {
    const split = splitHands(parseMidi(smf([track(play([[64, 0], [66, 0], [67, 0]]))], 0)));
    expect(split.method).toBe("pitch");
    expect(new Set(split.hands)).toEqual(new Set(["right"]));
  });

  it("follows the music up and down one stream of notes", () => {
    const stream = play([[36, 0], [72, 0], [38, 0], [74, 0], [40, 0], [76, 0], [41, 0], [77, 0]]);
    const song = parseMidi(smf([track(stream)], 0));
    const split = splitHands(song);
    song.notes.forEach((n, i) => expect(split.hands[i]).toBe(n.note < 60 ? "left" : "right"));
  });
});

describe("corrections", () => {
  const guess = ["right", "right", "left", "left"] as const;

  it("keeps only what differs from the guess", () => {
    let c = withChange(guess, {}, [{ idx: 0, hand: "left" }, { idx: 2, hand: "left" }]);
    expect(c).toEqual({ "0": "left" });
    expect(effectiveHands(guess, c)).toEqual(["left", "right", "left", "left"]);
    expect(correctedCount(guess, c)).toBe(1);
    c = withChange(guess, c, [{ idx: 0, hand: "right" }]);
    expect(c).toEqual({});
  });

  it("ignores a note that is not there", () => {
    expect(withChange(guess, {}, [{ idx: 9, hand: "left" }, { idx: -1, hand: "left" }])).toEqual({});
  });

  it("splits at a pitch inside a range of notes", () => {
    const notes = [{ note: 50 }, { note: 62 }, { note: 58 }, { note: 70 }];
    expect(splitPointChanges(notes, 60).map((c) => c.hand)).toEqual(["left", "right", "left", "right"]);
    expect(splitPointChanges(notes, 60, 1, 2).map((c) => c.idx)).toEqual([1, 2]);
  });

  it("undoes one step at a time and goes back to the guess", () => {
    const h = new History({});
    h.apply({ "1": "left" });
    h.apply({ "1": "left", "3": "right" });
    expect(h.undo()).toEqual({ "1": "left" });
    expect(h.undo()).toEqual({});
    expect(h.canUndo).toBe(false);
    h.apply({ "2": "right" });
    expect(h.reset()).toEqual({});
    expect(h.undo()).toEqual({ "2": "right" });
  });
});

describe("a long piece", () => {
  it("is split in well under a second for 50 000 notes in one track", () => {
    const notes = Array.from({ length: 50_000 }, (_, i) => ({ tMs: i * 5, durMs: 4, note: 30 + ((i * 7) % 60), velocity: 80, channel: 0, track: 0 }));
    const began = performance.now();
    const split = splitHands({ notes, tracks: [{ index: 0, name: "", notes: notes.length }] });
    const took = performance.now() - began;
    expect(split.hands).toHaveLength(50_000);
    expect(took).toBeLessThan(1000);
  });
});
