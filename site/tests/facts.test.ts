// the figures on the site are read from the files that hold them. these tests fail when a source changes shape or when two
// sources that must agree stop agreeing, so a figure cannot go stale on one page and not on another.
import { describe, expect, it } from "vitest";
import { FACT_SOURCES, PAGE_FIGURES, assertSharedLimits, fact, figure, serverFact, sharedIds, profileCount, type FactId } from "../src/lib/facts.ts";
import { PARTS } from "../src/data/status.ts";
import { HUB_CLAIMS } from "../src/data/hub-state.ts";
import { STUDIO_CLAIMS } from "../src/data/studio-state.ts";
import { readRoot } from "./lib/files.ts";

// the value of every figure, written out here. changing a source on purpose means changing this table in the same change,
// so a figure never moves without someone reading the page that prints it
const EXPECTED: Record<FactId, { value: number; printed: string }> = {
  ledCeilingMa: { value: 2700, printed: "2,700 mA" },
  idleGapMinutes: { value: 2, printed: "2 minutes" },
  bpmMin: { value: 30, printed: "30 beats a minute" },
  bpmMax: { value: 240, printed: "240 beats a minute" },
  wrongBlinkPeriodMs: { value: 500, printed: "500 ms" },
  speedMinPercent: { value: 25, printed: "25 per cent" },
  speedMaxPercent: { value: 125, printed: "125 per cent" },
  midiMaxMiB: { value: 1, printed: "1 MiB" },
  midiMaxTracks: { value: 32, printed: "32 tracks" },
  midiMaxNotes: { value: 50000, printed: "50,000 notes" },
  midiMaxHours: { value: 2, printed: "2 hours" },
  scoreWindowMs: { value: 150, printed: "150 ms" },
};

// a second, independent reading of the same source: the line is found by the name of the constant and its numbers are
// worked out by a different route from the one in facts.ts
const lineOf = (file: string, needle: string): string => readRoot(file).split("\n").find((l) => l.includes(needle)) ?? "";
const worked = (line: string): number => Function(`return ${line.split("=")[1]?.replace(/[;_]/g, "").trim()}`)() as number;
const INDEPENDENT: Record<FactId, () => number> = {
  ledCeilingMa: () => worked(lineOf("firmware/lib/practice/render.h", "const uint16_t kLedCurrentCeilingMa")),
  idleGapMinutes: () => worked(lineOf("firmware/lib/publish/publish.h", "kIdleGapMs")) / 60_000,
  bpmMin: () => Number(/< (\d+)/.exec(lineOf("firmware/lib/practice/practice.cpp", "settings.bpm < "))?.[1]),
  bpmMax: () => Number(/> (\d+)/.exec(lineOf("firmware/lib/practice/practice.cpp", "settings.bpm < "))?.[1]),
  wrongBlinkPeriodMs: () => worked(lineOf("firmware/lib/practice/practice.h", "kWrongBlinkPeriodMs")),
  speedMinPercent: () => Math.round(worked(lineOf("studio/src/clock.ts", "export const MIN_SPEED")) * 100),
  speedMaxPercent: () => Math.round(worked(lineOf("studio/src/clock.ts", "export const MAX_SPEED")) * 100),
  midiMaxMiB: () => worked(lineOf("studio/src/midi-file.ts", "export const MAX_BYTES")) / 2 ** 20,
  midiMaxTracks: () => worked(lineOf("studio/src/midi-file.ts", "export const MAX_TRACKS")),
  midiMaxNotes: () => worked(lineOf("studio/src/midi-file.ts", "export const MAX_NOTES")),
  midiMaxHours: () => worked(lineOf("studio/src/midi-file.ts", "export const MAX_DURATION_MS")) / 3_600_000,
  scoreWindowMs: () => Number(/window_ms: (\d+)/.exec(readRoot("core/src/follow.rs"))?.[1]),
};

describe("figures read from their source", () => {
  for (const id of Object.keys(FACT_SOURCES) as FactId[]) {
    it(`${id}: the value, the unit and the printed form are what a person expects`, () => {
      expect(fact(id), "facts.ts reading").toBe(EXPECTED[id].value);
      expect(INDEPENDENT[id](), "independent reading of the same source").toBe(EXPECTED[id].value);
      expect(figure(id)).toBe(EXPECTED[id].printed);
      // a figure is never printed with the digits of a floating point sum
      expect(figure(id)).not.toMatch(/\d\.\d{3,}|\d{7,}/);
    });
  }
  it("every figure has a fixture and a second reading", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(Object.keys(FACT_SOURCES).sort());
    expect(Object.keys(INDEPENDENT).sort()).toEqual(Object.keys(FACT_SOURCES).sort());
  });
  it("a figure that reads as a long decimal is refused", () => {
    expect(() => fact("midiMaxHours")).not.toThrow();
    expect(String(fact("midiMaxHours"))).toBe("2");
  });

  it("the LED ceiling is the firmware's constant and the page text carries it", () => {
    const fromFile = Number(/kLedCurrentCeilingMa = (\d+);/.exec(readRoot("firmware/lib/practice/render.h"))?.[1]);
    expect(fact("ledCeilingMa")).toBe(fromFile);
    expect(HUB_CLAIMS["ledCap"]?.text).toContain(`${fromFile.toLocaleString("en-GB")} mA`);
    expect(PARTS.find((p) => p.id === "firmware")?.built).toContain(`${fromFile.toLocaleString("en-GB")} mA`);
  });

  it("no wrong-note flash is faster than three a second and the page prints the real rate", () => {
    const perSecond = 1000 / fact("wrongBlinkPeriodMs");
    expect(perSecond).toBeLessThanOrEqual(3);
    expect(HUB_CLAIMS["flashing"]?.text).toContain(`${perSecond} flashes a second`);
  });

  it("the Studio's speed range and import limits are in the statements", () => {
    const practice = STUDIO_CLAIMS.find((c) => c.id === "practice")?.text ?? "";
    expect(practice).toContain("from 25 to 125 per cent");
    const imp = STUDIO_CLAIMS.find((c) => c.id === "import")?.text ?? "";
    expect(imp).toContain("1 MiB, 32 tracks, 50,000 notes and 2 hours");
  });

  it("the published accessibility document states the same ceiling", () => {
    expect(readRoot("docs/accessibility.md")).toContain(`${fact("ledCeilingMa")} mA`);
  });

  it("counts the profiles on disk", () => {
    expect(profileCount()).toBe(5);
    expect(PARTS.find((p) => p.id === "profiles")?.built).toContain("five profiles");
  });
});

describe("limits the page calls shared with the server", () => {
  it("are the same in the Studio and in the server", () => {
    expect(sharedIds().sort()).toEqual(["midiMaxHours", "midiMaxMiB", "midiMaxNotes", "midiMaxTracks"]);
    for (const id of sharedIds()) expect(serverFact(id), id).toBe(fact(id));
    expect(() => assertSharedLimits()).not.toThrow();
  });
  it("the page says shared and the limits match what it prints", () => {
    expect(STUDIO_CLAIMS.find((c) => c.id === "import")?.text).toContain("server's own limits");
    expect(serverFact("midiMaxHours")).toBe(2);
  });
});

describe("the power figure", () => {
  it("is the firmware's own ceiling and the firmware's budget document states it", () => {
    const doc = readRoot("firmware/docs/pins-and-power.md");
    expect(doc).toContain(`${fact("ledCeilingMa")} mA`);
  });
  it("no longer reads a budget table from the hardware folder", () => {
    expect(readRoot("site/src/lib/facts.ts")).not.toContain("hardware/README.md");
  });
});

describe("the colour tables agree", () => {
  it("the firmware's three lights are the role map's lights", () => {
    const roles = (JSON.parse(readRoot("studio/src/styles/lights.json")) as { roles: { id: string; led: number[] }[] }).roles;
    const cpp = readRoot("firmware/lib/practice/render.cpp");
    const rgb = (name: string): number[] => (new RegExp(`${name}\\[3\\] = \\{(\\d+), (\\d+), (\\d+)\\}`).exec(cpp) ?? []).slice(1).map(Number);
    expect(rgb("kAmber")).toEqual(roles.find((r) => r.id === "next-right")?.led);
    expect(rgb("kBlue")).toEqual(roles.find((r) => r.id === "next-left")?.led);
    expect(rgb("kRed")).toEqual(roles.find((r) => r.id === "wrong")?.led);
  });
});

describe("the figures a page must state", () => {
  it("every one resolves to text", () => {
    for (const f of PAGE_FIGURES) expect(f.text().length, f.why).toBeGreaterThan(3);
  });
});
