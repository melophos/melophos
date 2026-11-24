import { describe, expect, it } from "vitest";

import { DemoPlayer, demoLengthMs, demoScript } from "./demo";
import { Practice } from "./practice";
import { SONGS } from "./songs";

describe("demo script", () => {
  it("is the same every time for the same seed", () => {
    const song = SONGS[0]!;
    expect(demoScript(song)).toEqual(demoScript(song));
  });

  it("scales with speed and keeps the notes", () => {
    const song = SONGS[1]!;
    const slow = demoScript(song, { hand: "both" }, 0.5);
    const fast = demoScript(song, { hand: "both" }, 1);
    expect(slow.filter((p) => p.on).map((p) => p.note)).toEqual(fast.filter((p) => p.on).map((p) => p.note));
    expect(demoLengthMs(slow)).toBeGreaterThan(demoLengthMs(fast));
  });

  it("finishes the piece through the real stepper with one wrong slip", () => {
    const song = SONGS[0]!;
    const p = new Practice(song);
    for (const press of demoScript(song).filter((x) => x.on)) p.play(press.note, press.atMs);
    expect(p.finished).toBe(true);
    expect(p.results.filter((r) => !r.correct)).toHaveLength(1);
  });

  it("plays two hands with chords", () => {
    const song = SONGS.find((s) => s.id === "brother-john")!;
    const p = new Practice(song);
    for (const press of demoScript(song).filter((x) => x.on)) p.play(press.note, press.atMs);
    expect(p.finished).toBe(true);
  });
});

describe("demo player", () => {
  it("hands each press out once when polled from the frame loop", () => {
    const script = demoScript(SONGS[1]!);
    const player = new DemoPlayer(script, 1000);
    const seen: number[] = [];
    for (let t = 0; t < 60_000; t += 16) seen.push(...player.poll(t).map((p) => p.note));
    expect(seen).toHaveLength(script.length);
    expect(player.done).toBe(true);
  });
});
