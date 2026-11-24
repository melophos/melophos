// with no scoring module a key is still checked, by a plainer rule. The page never calls a wrong key right
import { describe, expect, it } from "vitest";
import { advance, beatMs, excerpt, make, world } from "../../tests/lib/drive";

describe("Rhythm mode with no scoring module", () => {
  it("calls the notes that are due right and every other key wrong", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "twinkle" });
    s.start();
    const ms = beatMs(song.tempo);
    const origin = world.clock + 4 * ms;
    advance(origin);
    const first = excerpt(song, { hand: "both" })[0]!;
    for (const wrong of [30, 31, 100]) {
      s.input(wrong, true, world.clock, "midi");
      expect(s.getSnapshot().lastEvent?.kind, `key ${wrong}`).toBe("wrong");
    }
    advance(world.clock + 20);
    s.input(first.note, true, world.clock, "midi");
    expect(s.getSnapshot().lastEvent?.kind).toBe("right");
  });

  it("finishes with counts and no accuracy figure", () => {
    world.clock = 1000;
    const { s, song } = make({ songId: "twinkle" });
    s.start();
    const ms = beatMs(song.tempo);
    const origin = world.clock + 4 * ms;
    for (const n of excerpt(song, { hand: "both" })) {
      advance(origin + n.startBeat * ms);
      s.input(n.note, true, world.clock, "midi");
    }
    advance(world.clock + 8 * ms);
    const r = s.getSnapshot().result!;
    expect(r.score).toBeNull();
    expect(r.firstTime).toBe(14);
  });
});
