import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, sanitise } from "./settings";

describe("settings", () => {
  it("takes the defaults for nothing or for junk", () => {
    expect(sanitise(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitise("text")).toEqual(DEFAULT_SETTINGS);
    expect(sanitise({ theme: "neon", volume: 7, calibrationMs: "soon", distance: 3 })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and drops the rest", () => {
    const s = sanitise({ theme: "dark", distance: "far", naming: "german", octave: "c3", volume: 0.25, metronome: true, calibrationMs: 35, labels: "bad" });
    expect(s).toMatchObject({ theme: "dark", distance: "far", naming: "german", octave: "c3", volume: 0.25, metronome: true, calibrationMs: 35, labels: "c" });
  });
});
