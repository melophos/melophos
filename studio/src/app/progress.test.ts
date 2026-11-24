import { describe, expect, it } from "vitest";

import { daysPractised, heatStep, mergeMissed, practisedCount, practisedPieces, recordSentence, seriesFor } from "./progress";
import type { SessionRecord } from "./store";

const rec = (id: string, startedAt: string, over: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  pieceId: "twinkle",
  pieceTitle: "Twinkle",
  startedAt,
  durationMs: 90_000,
  mode: "melody",
  hand: "both",
  fromBar: null,
  toBar: null,
  speedPct: 100,
  total: 20,
  firstTime: 15,
  wrongPresses: 5,
  longestRun: 8,
  score: { expected: 20, hits: 20, misses: 0, wrong: 5, repeats: 0, accuracy: 0.8, timingMs: null },
  laps: 1,
  missed: [{ note: 60, count: 2 }],
  ...over,
});

describe("days practised", () => {
  const today = new Date(2026, 10, 22, 12);

  it("covers the last 28 days ending today, oldest first", () => {
    const days = daysPractised([], today);
    expect(days).toHaveLength(28);
    expect(days[27]?.date).toBe("2026-11-22");
    expect(days[0]?.date).toBe("2026-10-26");
  });

  it("counts a day once however many sessions it holds", () => {
    const days = daysPractised([rec("a", new Date(2026, 10, 20, 9).toISOString()), rec("b", new Date(2026, 10, 20, 18).toISOString()), rec("c", new Date(2026, 10, 1, 9).toISOString())], today);
    expect(practisedCount(days)).toBe(2);
    expect(days.find((d) => d.date === "2026-11-20")).toMatchObject({ sessions: 2, minutes: 3 });
  });

  it("states the record as plain facts and never as a streak", () => {
    expect(recordSentence(daysPractised([], today))).toBe("You have not practised in the last 28 days.");
    const one = daysPractised([rec("a", new Date(2026, 10, 20, 9).toISOString())], today);
    expect(recordSentence(one)).toBe("You practised on 1 of the last 28 days.");
    expect(recordSentence(one)).not.toMatch(/streak/i);
  });
});

describe("series and misses", () => {
  it("lists a piece's sessions in time order with per cent figures", () => {
    const s = seriesFor([rec("b", "2026-11-02T10:00:00Z", { firstTime: 18 }), rec("a", "2026-11-01T10:00:00Z"), rec("x", "2026-11-03T10:00:00Z", { pieceId: "other" }), rec("l", "2026-11-04T10:00:00Z", { mode: "listen" })], "twinkle");
    expect(s.map((p) => [p.session, p.firstTimePct, p.accuracyPct])).toEqual([
      [1, 75, 80],
      [2, 90, 80],
    ]);
  });

  it("merges the keys missed across sessions", () => {
    const m = mergeMissed([rec("a", "2026-11-01T10:00:00Z"), rec("b", "2026-11-02T10:00:00Z", { missed: [{ note: 60, count: 1 }, { note: 62, count: 4 }] })]);
    expect([...m.entries()].sort()).toEqual([[60, 3], [62, 4]]);
    expect(mergeMissed([rec("a", "2026-11-01T10:00:00Z", { pieceId: "z" })], "twinkle").size).toBe(0);
  });

  it("gives the heat scale five steps and a plain zero", () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((c) => heatStep(c, 10))).toEqual([0, 1, 1, 2, 2, 3, 5]);
    expect(heatStep(3, 0)).toBe(0);
  });

  it("lists practised pieces newest first and leaves out listening", () => {
    const p = practisedPieces([rec("a", "2026-11-01T10:00:00Z"), rec("b", "2026-11-05T10:00:00Z", { pieceId: "ode", pieceTitle: "Ode" }), rec("c", "2026-11-06T10:00:00Z", { mode: "listen" })]);
    expect(p.map((x) => x.pieceId)).toEqual(["ode", "twinkle"]);
  });
});
