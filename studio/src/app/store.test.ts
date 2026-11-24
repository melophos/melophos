import { describe, expect, it } from "vitest";

import { exportJson, memoryStore, parseExport, validPiece, validRecord, type SessionRecord } from "./store";

const record = (id: string, when: string): SessionRecord => ({
  id,
  pieceId: "twinkle",
  pieceTitle: "Twinkle, Twinkle, Little Star",
  startedAt: when,
  durationMs: 60000,
  mode: "melody",
  hand: "both",
  fromBar: null,
  toBar: null,
  speedPct: 100,
  total: 14,
  firstTime: 12,
  wrongPresses: 2,
  longestRun: 9,
  score: { expected: 14, hits: 14, misses: 0, wrong: 2, repeats: 0, accuracy: 0.875, timingMs: null },
  laps: 1,
  missed: [{ note: 67, count: 2 }],
});

describe("session store", () => {
  it("keeps records in time order and clears them", async () => {
    const s = memoryStore();
    await s.add(record("b", "2026-11-02T10:00:00Z"));
    await s.add(record("a", "2026-11-01T10:00:00Z"));
    expect((await s.list()).map((r) => r.id)).toEqual(["a", "b"]);
    await s.clear();
    expect(await s.list()).toEqual([]);
  });
});

describe("export and import", () => {
  it("round trips every record", () => {
    const records = [record("a", "2026-11-01T10:00:00Z"), record("b", "2026-11-02T10:00:00Z")];
    const parsed = parseExport(exportJson(records, new Date("2026-11-03T00:00:00Z")));
    expect(parsed).toEqual({ ok: true, sessions: records, bests: [], skipped: 0 });
  });

  it("says why a file is refused", () => {
    expect(parseExport("not json")).toMatchObject({ ok: false });
    expect(parseExport('{"format":"other"}')).toMatchObject({ ok: false });
    expect(parseExport('{"format":"melophos-studio-export","version":2,"sessions":[]}')).toMatchObject({ ok: false, reason: expect.stringMatching(/newer Studio/) });
    expect(parseExport('{"format":"melophos-studio-export","version":1}')).toMatchObject({ ok: false });
  });

  it("skips a bad record and keeps the good ones", () => {
    const good = record("a", "2026-11-01T10:00:00Z");
    const text = JSON.stringify({ format: "melophos-studio-export", version: 1, sessions: [good, { id: "x" }, { ...good, id: "", mode: "free" }] });
    expect(parseExport(text)).toEqual({ ok: true, sessions: [good], bests: [], skipped: 2 });
  });

  it("refuses a file that is too big", () => {
    expect(parseExport("x".repeat(21 * 1024 * 1024))).toMatchObject({ ok: false, reason: expect.stringMatching(/20 MB/) });
  });
});

describe("records of an old shape", () => {
  it("are left out one by one and never hide the rest", () => {
    const good = record("a", "2026-11-01T10:00:00Z");
    expect([{ id: "old-shape" }, good, null, "text", { ...good, startedAt: 7 }].map(validRecord).filter(Boolean)).toEqual([good]);
  });

  it("applies to pieces too", () => {
    const piece = { id: "p", title: "t", notes: [[0, 1, 60, 0, 0]], guess: ["r"], tempo: 100, beatsPerBar: 4, corrections: {} };
    expect(validPiece(piece)).toBe(true);
    expect(validPiece({ ...piece, guess: [] })).toBe(false);
    expect(validPiece({ id: "p" })).toBe(false);
  });
});

import { wipeEverything, type WipeEnv } from "./store";

describe("deleting everything says done only after looking", () => {
  const clean = (over: Partial<WipeEnv> = {}): WipeEnv => ({ deleteDatabase: async () => undefined, clearLocal: () => undefined, clearCaches: async () => undefined, unregisterWorkers: async () => undefined, look: async () => [], ...over });

  it("is done when the look finds nothing", async () => {
    expect(await wipeEverything(clean())).toEqual({ ok: true, remaining: [] });
  });

  it("is not done when every step reported success but the look finds something left", async () => {
    const r = await wipeEverything(clean({ look: async () => ["The saved record is still there."] }));
    expect(r.ok).toBe(false);
    expect(r.remaining).toEqual(["The saved record is still there."]);
  });

  it("is not done when a step fails and says which", async () => {
    const r = await wipeEverything(clean({ clearCaches: async () => { throw new Error("no"); }, deleteDatabase: async () => { throw new Error("Another tab of the Studio is holding the record."); } }));
    expect(r.ok).toBe(false);
    expect(r.remaining.join(" ")).toMatch(/Another tab.*saved copy of the app could not be removed/);
  });

  it("looks after the steps and not before", async () => {
    const order: string[] = [];
    await wipeEverything(clean({ deleteDatabase: async () => void order.push("delete"), clearCaches: async () => void order.push("caches"), look: async () => (order.push("look"), []) }));
    expect(order).toEqual(["delete", "caches", "look"]);
  });
});

import type { Best } from "../game";

const aBest = (id: string): Best => ({ id, songId: "twinkle", songTitle: "Twinkle", difficulty: { hand: "both", speedPct: 100, fromBar: null, toBar: null }, engine: "v1", achievedAt: "2026-11-01T10:00:00Z", accuracy: 0.9, hits: 9, late: 0, misses: 1, wrong: 0, expected: 10, notJudged: 0 });

describe("personal bests in the record", () => {
  it("are stored, replaced by id and cleared with everything else", async () => {
    const s = memoryStore();
    await s.putBest(aBest("a"));
    await s.putBest({ ...aBest("a"), accuracy: 0.95 });
    await s.putBest(aBest("b"));
    expect((await s.listBests()).map((b) => [b.id, b.accuracy])).toEqual([["a", 0.95], ["b", 0.9]]);
    await s.clear();
    expect(await s.listBests()).toEqual([]);
  });

  it("travel with an export and an import and a bad one is skipped", () => {
    const text = exportJson([], new Date("2026-11-03T00:00:00Z"), [aBest("a")]);
    const parsed = parseExport(text);
    expect(parsed).toMatchObject({ ok: true, bests: [aBest("a")] });
    const tampered = JSON.stringify({ format: "melophos-studio-export", version: 1, sessions: [], bests: [aBest("a"), { id: "x" }, { ...aBest("b"), accuracy: 7 }] });
    expect(parseExport(tampered)).toMatchObject({ ok: true, bests: [aBest("a")] });
  });

  it("an export made before the game has none", () => {
    expect(parseExport('{"format":"melophos-studio-export","version":1,"sessions":[]}')).toMatchObject({ ok: true, bests: [] });
  });

  it("are added together with the sessions in one go", async () => {
    const s = memoryStore();
    await s.addMany([], [aBest("a")]);
    expect(await s.listBests()).toHaveLength(1);
  });
});
