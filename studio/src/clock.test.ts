import { describe, expect, it } from "vitest";

import { Transport, audioTimeFor, clampSpeed } from "./clock";

// a clock that only moves when the test moves it
function manual(): { now: () => number; set: (t: number) => void } {
  let t = 0;
  return { now: () => t, set: (v) => (t = v) };
}

// a small seeded generator so the property checks are repeatable
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe("transport position", () => {
  it("is a pure function of clock time", () => {
    const c = manual();
    const tr = new Transport(120, c.now);
    tr.start(0);
    // 120 beats a minute is one beat every 500 ms
    expect(tr.position(1000)).toBeCloseTo(2, 9);
    expect(tr.position(1000)).toBeCloseTo(2, 9);
    expect(tr.position(250)).toBeCloseTo(0.5, 9);
  });

  it("counts in with a negative position", () => {
    const c = manual();
    const tr = new Transport(60, c.now);
    tr.start(0, 4);
    expect(tr.position(0)).toBe(-4);
    expect(tr.position(4000)).toBeCloseTo(0, 9);
  });

  it("slows down without moving the notes", () => {
    const c = manual();
    const tr = new Transport(100, c.now);
    tr.setSpeed(0.5);
    tr.start(0);
    // at half speed 100 beats a minute is 50, so one beat takes 1200 ms
    expect(tr.timeOf(4)).toBeCloseTo(4800, 6);
    expect(tr.position(2400)).toBeCloseTo(2, 9);
  });

  it("keeps its place when the speed changes while running", () => {
    const c = manual();
    const tr = new Transport(60, c.now);
    tr.start(0);
    c.set(2000);
    const before = tr.position();
    tr.setSpeed(0.5);
    expect(tr.position()).toBeCloseTo(before, 9);
    c.set(4000);
    expect(tr.position()).toBeCloseTo(before + 1, 9);
  });

  it("holds still while paused and carries on from there", () => {
    const c = manual();
    const tr = new Transport(60, c.now);
    tr.start(0);
    c.set(3000);
    tr.pause();
    c.set(9000);
    expect(tr.position()).toBeCloseTo(3, 9);
    tr.resume();
    c.set(10000);
    expect(tr.position()).toBeCloseTo(4, 9);
  });

  it("loops and counts the laps", () => {
    const c = manual();
    const tr = new Transport(60, c.now);
    tr.setLoop({ fromBeat: 4, toBeat: 8 });
    tr.start(4);
    expect(tr.position(3999)).toBeCloseTo(7.999, 6);
    expect(tr.position(4000)).toBeCloseTo(4, 9);
    expect(tr.lap(4000)).toBe(1);
    expect(tr.position(9000)).toBeCloseTo(5, 9);
    expect(tr.lap(9000)).toBe(2);
  });

  it("rejects an empty loop and clamps the speed to 25 to 125 per cent", () => {
    const tr = new Transport(60, () => 0);
    expect(() => tr.setLoop({ fromBeat: 4, toBeat: 4 })).toThrow(RangeError);
    expect(clampSpeed(0.1)).toBe(0.25);
    expect(clampSpeed(3)).toBe(1.25);
  });

  it("does not drift over ten simulated minutes at any tempo or speed", () => {
    const random = seeded(42);
    for (let i = 0; i < 50; i++) {
      const c = manual();
      const tempo = 30 + Math.floor(random() * 200);
      const speed = 0.25 + random();
      const tr = new Transport(tempo, c.now);
      tr.setSpeed(speed);
      tr.start(0);
      const beat = 60_000 / (tempo * clampSpeed(speed));
      // stepping the clock in small uneven frames must give the same answer as one jump
      let t = 0;
      while (t < 600_000) t += 5 + random() * 30;
      c.set(t);
      expect(Math.abs(tr.position() - t / beat), `tempo ${tempo} speed ${speed}`).toBeLessThan(1e-6);
      // a note is due exactly where its beat says, to a millisecond
      expect(Math.abs(tr.timeOf(1000) - 1000 * beat)).toBeLessThan(1);
    }
  });
});

describe("what is due to sound", () => {
  const notes = [{ startBeat: 0 }, { startBeat: 1 }, { startBeat: 2 }];

  it("hands each note out once across adjacent windows", () => {
    const c = manual();
    const tr = new Transport(60, c.now);
    tr.start(0);
    const heard: number[] = [];
    for (let t = 0; t < 4000; t += 16) heard.push(...tr.due(notes, t, t + 16, 4, false).map((s) => s.index));
    expect(heard).toEqual([0, 1, 2]);
  });

  it("gives clicks with the first beat of the bar accented", () => {
    const tr = new Transport(60, () => 0);
    tr.start(0, 4);
    const clicks = tr.due([], 0, 8000, 4, true);
    expect(clicks.map((s) => s.accent)).toEqual([true, false, false, false, true, false, false, false]);
    expect(clicks.map((s) => s.atMs)).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]);
  });

  it("plays a looped passage again each lap and leaves the rest out", () => {
    const c = manual();
    const tr = new Transport(60, c.now);
    tr.setLoop({ fromBeat: 1, toBeat: 3 });
    tr.start(1);
    const all = tr.due([{ startBeat: 0 }, { startBeat: 1 }, { startBeat: 2 }, { startBeat: 5 }], 0, 6000, 4, false);
    expect(all.map((s) => [s.index, Math.round(s.atMs)])).toEqual([
      [1, 0],
      [2, 1000],
      [1, 2000],
      [2, 3000],
      [1, 4000],
      [2, 5000],
    ]);
  });
});

describe("audio time", () => {
  it("places a performance time on the audio timeline using the output timestamp", () => {
    const ctx = { currentTime: 10, getOutputTimestamp: () => ({ contextTime: 9.9, performanceTime: 5000 }) };
    expect(audioTimeFor(ctx, 5100, 5050)).toBeCloseTo(10.0, 9);
  });

  it("falls back to the current time where the timestamp is missing", () => {
    expect(audioTimeFor({ currentTime: 2 }, 1500, 1000)).toBeCloseTo(2.5, 9);
  });
});
