import { describe, expect, it } from "vitest";

import { Practice } from "./practice";
import type { Song } from "./songs";

const song: Song = { id: "t", title: "Test", composer: "Test", tempo: 60, notes: [{ note: 60, beats: 1 }, { note: 62, beats: 1 }, { note: 64, beats: 2 }] };

describe("practice", () => {
  it("lights the next notes in order", () => {
    const p = new Practice(song);
    expect(p.upcoming(2)).toEqual([60, 62]);
    p.play(60, 0);
    expect(p.upcoming(2)).toEqual([62, 64]);
  });

  it("waits on a wrong note and scores it", () => {
    const p = new Practice(song);
    p.play(60, 0);
    expect(p.play(61, 1000)?.correct).toBe(false);
    expect(p.position).toBe(1);
    p.play(62, 1100);
    p.play(64, 2000);
    expect(p.finished).toBe(true);
    expect(p.summary()).toMatchObject({ notes: 4, correct: 3, accuracy: 0.75, bestStreak: 2 });
  });

  it("measures timing against the beat", () => {
    const p = new Practice(song);
    p.play(60, 500);
    // at 60 beats a minute the second note is due one second after the first
    expect(p.play(62, 1600)?.offsetMs).toBe(100);
  });
});
